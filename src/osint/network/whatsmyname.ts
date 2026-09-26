import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isPublicHostname, type PageRequest } from "./http";

/**
 * WhatsMyName's site rules (https://github.com/WebBreacher/WhatsMyName,
 * CC BY-SA 4.0), as docket reads them. The data is pinned by commit and
 * hash in models/whatsmyname.json and bundled with the app; this file
 * never downloads it.
 *
 * Every rule is outside data that decides where a victim's request goes,
 * so each one is validated when loaded and dropped (with a reason) if it
 * could send a request anywhere unexpected:
 *   - https only, to a public DNS host (no IP address, no localhost);
 *   - the handle may be in the host only as a subdomain in front of a
 *     fixed domain ("{account}.tumblr.com"), so the request stays on
 *     that site;
 *   - only allowlisted headers; a rule that needs Host, Cookie, Origin,
 *     or any other header is dropped rather than sent without it.
 * Rules marked broken upstream (valid: false) or behind bot protection
 * are dropped too: they'd only ever answer "couldn't tell".
 */

interface WmnRule {
  name: string;
  uri_check: string;
  uri_pretty?: string;
  post_body?: string;
  headers?: Record<string, string>;
  strip_bad_char?: string;
  e_code: number;
  e_string: string;
  m_code: number;
  m_string: string;
  known: string[];
  cat: string;
  valid?: boolean;
  protection?: string[];
}

export interface SiteRule {
  name: string;
  category: string;
  /** Dating, adult, health, or political: checked only when the user opts in. */
  sensitive: boolean;
  uriCheck: string;
  /** The public profile page. Absent for a rule that asks an API by POST and names no profile page. */
  uriPretty?: string;
  postBody?: string;
  headers: Record<string, string>;
  stripBadChar: string;
  eCode: number;
  eString: string;
  mCode: number;
  mString: string;
  /** Handles WhatsMyName lists as existing on this site, for verification. */
  known: string[];
}

export interface DroppedRule {
  name: string;
  reason: string;
}

export const SENSITIVE_CATEGORIES = new Set(["xx NSFW xx", "dating", "health", "political"]);

const ALLOWED_HEADERS = new Set(["user-agent", "accept", "accept-language", "content-type", "cache-control", "x-requested-with"]);

const PLACEHOLDER = "{account}";
const SAMPLE_HANDLE = "docketprobe";

/** Why a rule's URL template can't be used, or undefined when it can. */
function urlProblem(template: string): string | undefined {
  let url: URL;
  try {
    url = new URL(template.replaceAll(PLACEHOLDER, SAMPLE_HANDLE));
  } catch {
    return "not a URL";
  }
  if (url.protocol !== "https:") return "not https";
  if (!isPublicHostname(url.hostname)) return "not a public host";
  if (url.hostname.includes(SAMPLE_HANDLE.toLowerCase())) {
    // Only as leading label(s) in front of a fixed domain with a dot in it.
    const fixed = new URL(template.replace(/^https:\/\/\{account\}\./, "https://")).hostname;
    if (!template.startsWith(`https://${PLACEHOLDER}.`) || !fixed.includes(".") || fixed.includes("{")) return "handle in the host";
  }
  if (url.username || url.password) return "credentials in the URL";
  return undefined;
}

function ruleProblem(rule: WmnRule): string | undefined {
  if (rule.valid === false) return "marked broken upstream";
  // "user-agent" only means the site turns away non-browser clients, and
  // docket sends a browser identity; verification decides if it works.
  const protection = (rule.protection ?? []).filter((p) => p !== "user-agent");
  if (protection.length > 0) return `behind bot protection (${protection.join(", ")})`;
  if (typeof rule.uri_check !== "string") return "no URL";
  const url = urlProblem(rule.uri_check);
  if (url) return url;
  if (rule.uri_pretty) {
    const pretty = urlProblem(rule.uri_pretty);
    if (pretty) return `profile link: ${pretty}`;
  }
  for (const header of Object.keys(rule.headers ?? {})) {
    if (!ALLOWED_HEADERS.has(header.toLowerCase())) return `needs a header docket doesn't send (${header})`;
  }
  if (rule.post_body !== undefined && !rule.post_body.includes(PLACEHOLDER)) return "POST body without the handle";
  if (!Number.isInteger(rule.e_code) || !Number.isInteger(rule.m_code)) return "no status codes";
  if (typeof rule.e_string !== "string" || typeof rule.m_string !== "string") return "no detection strings";
  return undefined;
}

/** Validates every rule in WhatsMyName's data. */
export function parseRules(data: unknown): { rules: SiteRule[]; dropped: DroppedRule[] } {
  const sites = (data as { sites?: unknown }).sites;
  if (!Array.isArray(sites)) throw new Error("WhatsMyName data has no sites list");
  const rules: SiteRule[] = [];
  const dropped: DroppedRule[] = [];
  for (const raw of sites as WmnRule[]) {
    const name = typeof raw?.name === "string" ? raw.name : "(unnamed)";
    const problem = ruleProblem(raw);
    if (problem) {
      dropped.push({ name, reason: problem });
      continue;
    }
    rules.push({
      name,
      category: raw.cat,
      sensitive: SENSITIVE_CATEGORIES.has(raw.cat),
      uriCheck: raw.uri_check,
      // A GET check URL is usually the profile page itself; a POST one is an API.
      ...(raw.uri_pretty ? { uriPretty: raw.uri_pretty } : raw.post_body === undefined ? { uriPretty: raw.uri_check } : {}),
      ...(raw.post_body !== undefined ? { postBody: raw.post_body } : {}),
      headers: raw.headers ?? {},
      stripBadChar: raw.strip_bad_char ?? "",
      eCode: raw.e_code,
      eString: raw.e_string,
      mCode: raw.m_code,
      mString: raw.m_string,
      known: Array.isArray(raw.known) ? raw.known : [],
    });
  }
  return { rules, dropped };
}

/**
 * The request for one rule and handle. The handle has already passed
 * normalizeHandle (letters, digits, ".", "_", "-"), so it can't carry
 * anything else into the URL or body; the rule's strip_bad_char removes
 * characters that site doesn't allow. Undefined if nothing is left.
 */
export function buildRequest(rule: SiteRule, handle: string): PageRequest | undefined {
  const cleaned = [...handle].filter((c) => !rule.stripBadChar.includes(c)).join("");
  if (cleaned.length === 0) return undefined;
  const url = rule.uriCheck.replaceAll(PLACEHOLDER, encodeURIComponent(cleaned));
  return rule.postBody !== undefined
    ? { url, method: "POST", headers: rule.headers, body: rule.postBody.replaceAll(PLACEHOLDER, cleaned) }
    : { url, method: "GET", headers: rule.headers };
}

export function profileUrl(rule: SiteRule, handle: string): string | undefined {
  if (!rule.uriPretty) return undefined;
  const cleaned = [...handle].filter((c) => !rule.stripBadChar.includes(c)).join("");
  return rule.uriPretty.replaceAll(PLACEHOLDER, encodeURIComponent(cleaned));
}

// The same markers WhatsMyName's own checker uses to spot a bot-block
// page. Used only to say why an answer was unclear: a page that cleanly
// matches a rule stays found or missing even if it mentions Cloudflare in
// a script URL.
const BLOCK_MARKERS = ["cloudflare", "cf-ray", "just a moment", "ddos-guard", "captcha", "access denied", "enable javascript", "checking your browser"];

export type Classification = { status: "found" | "not-found" } | { status: "unknown"; reason: string };

/**
 * Reads a response the way WhatsMyName's checker does: found when the
 * status is e_code and the page contains e_string; missing when the
 * status is m_code and the page contains m_string. Matching is literal and
 * case-sensitive; an empty string means no string is required. Anything
 * else, including a page matching both, is "couldn't tell".
 */
export function classify(rule: SiteRule, status: number, body: string): Classification {
  const found = status === rule.eCode && body.includes(rule.eString);
  const missing = status === rule.mCode && body.includes(rule.mString);
  if (found && !missing) return { status: "found" };
  if (missing && !found) return { status: "not-found" };
  if (found && missing) return { status: "unknown", reason: "the answer matched both found and missing" };
  if (status === 429) return { status: "unknown", reason: "rate limited" };
  const lower = body.toLowerCase();
  if (BLOCK_MARKERS.some((m) => lower.includes(m)) || status === 403 || status === 503) {
    return { status: "unknown", reason: "blocked by bot protection" };
  }
  return { status: "unknown", reason: `unexpected answer (HTTP ${status})` };
}

export interface WhatsMyNameManifest {
  revision: string;
  files: Array<{ name: string; sha256: string }>;
  majorPlatforms: string[];
  passList: string[];
  verifiedAt: string | null;
}

export interface LoadedWhatsMyName {
  manifest: WhatsMyNameManifest;
  /** Every rule that passed validation, whether or not it passed verification. */
  rules: SiteRule[];
  dropped: DroppedRule[];
}

/**
 * Loads the bundled data from `modelsDir` (whatsmyname.json and the
 * whatsmyname/ folder), checking every file against its pinned hash.
 */
export async function loadWhatsMyName(modelsDir: string): Promise<LoadedWhatsMyName> {
  const manifest = JSON.parse(await readFile(join(modelsDir, "whatsmyname.json"), "utf8")) as WhatsMyNameManifest;
  for (const file of manifest.files) {
    let bytes: Buffer;
    try {
      bytes = await readFile(join(modelsDir, "whatsmyname", file.name));
    } catch (err) {
      throw new Error(`site rules file ${file.name} is missing (${(err as Error).message}). Run: npm run fetch-assets`);
    }
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== file.sha256) throw new Error(`site rules file ${file.name} doesn't match models/whatsmyname.json (sha256 ${actual})`);
  }
  let data: unknown;
  try {
    data = JSON.parse(await readFile(join(modelsDir, "whatsmyname", "wmn-data.json"), "utf8"));
  } catch (err) {
    throw new Error(`site rules can't be read: ${(err as Error).message}`);
  }
  return { manifest, ...parseRules(data) };
}
