import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Message, RawRecord } from "../../types/message";
import type { IngestResult } from "../adapter";
import { hashPayload } from "../hash";
import { quarantine } from "../quarantine";

/**
 * Parses the JSON export from Instagram's "Download your information"
 * tool. Instagram gives personal accounts no API for reading DMs, so the
 * export is the only legitimate way in. Layout (older exports drop the
 * `your_instagram_activity/` level):
 *
 *   <export>/your_instagram_activity/messages/
 *     inbox/<thread folder>/message_1.json, message_2.json, ...
 *     message_requests/<thread folder>/message_1.json   ← people you don't follow
 *   <export>/personal_information/personal_information/personal_information.json
 *
 * Two quirks shape this file:
 *   - Senders are named by display name, not username. The thread folder
 *     name ("someone_1234567890") is kept as an alias so a blocked
 *     username can still be matched against it.
 *   - Meta writes every string as UTF-8 bytes escaped one byte per
 *     character ("â\u0080\u0099" for "’"). decodeMetaString undoes that.
 *
 * Unsent and deleted messages are not in the export at all — unlike the
 * iMessage adapter's WAL recovery, there is nothing here to recover them from.
 */

export const INSTAGRAM_PARSER_VERSION = "instagram-json-1";

interface RawInstagramMessage {
  sender_name?: string;
  timestamp_ms?: number;
  content?: string;
  [key: string]: unknown;
}

interface RawInstagramThreadFile {
  participants?: Array<{ name?: string }>;
  messages?: RawInstagramMessage[];
  title?: string;
  thread_path?: string;
}

export interface InstagramThread {
  /** e.g. "inbox/someone_1234567890" — stable across exports, used as the vault thread id. */
  threadPath: string;
  /** The part of the folder name before its numeric suffix. Often the other person's username. */
  folderAlias: string;
  participants: string[];
  messages: RawInstagramMessage[];
}

/** A file that couldn't be read as a thread. Quarantined whole, never skipped silently. */
export interface InstagramFileProblem {
  relativePath: string;
  bytes: Buffer;
  reason: string;
}

export interface InstagramExport {
  ownerName: string;
  threads: InstagramThread[];
  problems: InstagramFileProblem[];
}

/** Undoes Meta's one-byte-per-character UTF-8 escaping. Leaves a string alone if it can't be that (a character above U+00FF). */
export function decodeMetaString(value: string): string {
  if (!/^[\u0000-ÿ]*$/.test(value)) return value;
  return Buffer.from(value, "latin1").toString("utf8");
}

function messagesRoots(exportDir: string): string[] {
  return [join(exportDir, "your_instagram_activity", "messages"), join(exportDir, "messages")].filter((dir) => existsSync(dir));
}

async function listDirs(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

async function readOwnerName(exportDir: string): Promise<string | undefined> {
  const candidates = [
    join(exportDir, "personal_information", "personal_information", "personal_information.json"),
    join(exportDir, "personal_information", "personal_information.json"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, "utf8"));
    } catch (err) {
      throw new Error(`couldn't read ${path}: ${(err as Error).message}`);
    }
    const profile = (parsed as { profile_user?: Array<{ string_map_data?: Record<string, { value?: string }> }> }).profile_user?.[0];
    const name = profile?.string_map_data?.["Name"]?.value;
    if (typeof name === "string" && name.length > 0) return decodeMetaString(name);
  }
  return undefined;
}

/**
 * Loads every thread in the export. Throws a plain, actionable error when
 * the folder isn't a JSON Instagram export at all, since that's the
 * mistake someone is most likely to make (choosing the zip's parent
 * folder, or an export requested in HTML format).
 */
export async function loadInstagramExport(exportDir: string): Promise<InstagramExport> {
  const roots = messagesRoots(exportDir);
  if (roots.length === 0) {
    throw new Error(
      "this folder doesn't look like an Instagram export — no messages folder found. Choose the folder you unzipped the export into.",
    );
  }

  const threads: InstagramThread[] = [];
  const problems: InstagramFileProblem[] = [];
  let sawHtml = false;

  for (const root of roots) {
    for (const box of ["inbox", "message_requests"]) {
      for (const folder of await listDirs(join(root, box))) {
        const threadDir = join(root, box, folder);
        const files = (await readdir(threadDir)).filter((f) => /^message_\d+\.(json|html)$/.test(f));
        if (files.some((f) => f.endsWith(".html"))) sawHtml = true;
        const jsonFiles = files
          .filter((f) => f.endsWith(".json"))
          .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
        if (jsonFiles.length === 0) continue;

        const thread: InstagramThread = {
          threadPath: `${box}/${folder}`,
          folderAlias: folder.replace(/_\d+$/, ""),
          participants: [],
          messages: [],
        };
        for (const file of jsonFiles) {
          const bytes = await readFile(join(threadDir, file));
          let parsed: RawInstagramThreadFile;
          try {
            parsed = JSON.parse(bytes.toString("utf8")) as RawInstagramThreadFile;
          } catch (err) {
            problems.push({ relativePath: `${box}/${folder}/${file}`, bytes, reason: `not valid JSON: ${(err as Error).message}` });
            continue;
          }
          if (!Array.isArray(parsed.messages)) {
            problems.push({ relativePath: `${box}/${folder}/${file}`, bytes, reason: "no messages array in this thread file" });
            continue;
          }
          for (const p of parsed.participants ?? []) {
            if (typeof p.name === "string") {
              const name = decodeMetaString(p.name);
              if (!thread.participants.includes(name)) thread.participants.push(name);
            }
          }
          thread.messages.push(...parsed.messages);
        }
        if (thread.messages.length > 0 || thread.participants.length > 0) threads.push(thread);
      }
    }
  }

  if (threads.length === 0 && problems.length === 0) {
    throw new Error(
      sawHtml
        ? "this Instagram export is in HTML format. Request a new export and choose JSON as the format."
        : "no message threads found in this Instagram export.",
    );
  }

  const ownerName = (await readOwnerName(exportDir)) ?? inferOwnerName(threads);
  if (!ownerName) {
    throw new Error(
      "couldn't tell which participant is you. Include \"Personal information\" when you request the Instagram export, then try again.",
    );
  }
  return { ownerName, threads, problems };
}

/** The one name that's a participant in every thread — the account owner — when the export has no personal_information file. Needs at least two threads to mean anything. */
export function inferOwnerName(threads: readonly InstagramThread[]): string | undefined {
  if (threads.length < 2) return undefined;
  let common = new Set(threads[0]!.participants);
  for (const thread of threads.slice(1)) {
    common = new Set(thread.participants.filter((p) => common.has(p)));
  }
  return common.size === 1 ? [...common][0] : undefined;
}

/**
 * Yields the messages in threads with a selected sender: that sender's
 * messages and the owner's own replies in the same thread. Other people
 * in a group thread are left out — nobody enters the vault unless the
 * user chose them.
 */
export function* parseInstagramExport(exp: InstagramExport, selectedSenders: readonly string[]): Generator<IngestResult> {
  const selected = new Set(selectedSenders);

  for (const problem of exp.problems) {
    const raw = buildRawRecord(problem.bytes);
    yield { kind: "quarantined", raw, quarantine: quarantine(raw, "instagram", `${problem.relativePath}: ${problem.reason}`) };
  }

  for (const thread of exp.threads) {
    if (!thread.participants.some((p) => selected.has(p))) continue;

    for (const rawMessage of thread.messages) {
      const sender = typeof rawMessage.sender_name === "string" ? decodeMetaString(rawMessage.sender_name) : undefined;
      const fromSelf = sender === exp.ownerName;
      if (sender !== undefined && !fromSelf && !selected.has(sender)) continue;

      const raw = buildRawRecord(Buffer.from(JSON.stringify({ thread_path: thread.threadPath, message: rawMessage }), "utf8"));
      if (sender === undefined || typeof rawMessage.timestamp_ms !== "number" || !Number.isFinite(rawMessage.timestamp_ms)) {
        yield { kind: "quarantined", raw, quarantine: quarantine(raw, "instagram", "missing sender_name or timestamp_ms") };
        continue;
      }
      if (typeof rawMessage.content !== "string") {
        yield {
          kind: "quarantined",
          raw,
          quarantine: quarantine(raw, "instagram", "no text (a photo, video, voice message, or shared post) — media isn't imported yet"),
        };
        continue;
      }

      const message: Message = {
        id: `ig-${raw.hash.slice(0, 24)}`,
        rawRecordHash: raw.hash,
        source: "instagram",
        threadId: `instagram:${thread.threadPath}`,
        sender,
        fromSelf,
        text: decodeMetaString(rawMessage.content),
        sentAt: new Date(rawMessage.timestamp_ms),
        provenance: "live",
      };
      yield { kind: "message", raw, message };
    }
  }
}

function buildRawRecord(payload: Buffer): RawRecord {
  const hash = hashPayload(payload);
  return {
    id: `ig-${hash.slice(0, 24)}`,
    source: "instagram",
    payload,
    acquiredAt: new Date(),
    hash,
    parserVersion: INSTAGRAM_PARSER_VERSION,
  };
}
