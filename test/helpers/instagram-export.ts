import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Encodes a string the way Meta's exports do: each UTF-8 byte as its own \u00XX character. */
export function metaEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("latin1");
}

export interface FixtureThread {
  folder: string;
  box?: "inbox" | "message_requests";
  participants: string[];
  messages: Array<{ sender_name?: string; timestamp_ms?: number; content?: string; photos?: unknown[] }>;
}

/** Writes a minimal Instagram "Download your information" JSON export under `root`. */
export function writeInstagramExport(
  root: string,
  options: { owner?: string; threads: FixtureThread[]; blocked?: unknown; legacyLayout?: boolean },
): void {
  const messagesDir = options.legacyLayout ? join(root, "messages") : join(root, "your_instagram_activity", "messages");
  for (const thread of options.threads) {
    const dir = join(messagesDir, thread.box ?? "inbox", thread.folder);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "message_1.json"),
      JSON.stringify({
        participants: thread.participants.map((name) => ({ name: metaEncode(name) })),
        messages: thread.messages.map((m) => ({
          ...m,
          ...(m.sender_name !== undefined ? { sender_name: metaEncode(m.sender_name) } : {}),
          ...(m.content !== undefined ? { content: metaEncode(m.content) } : {}),
        })),
        title: thread.participants[0],
        thread_path: `${thread.box ?? "inbox"}/${thread.folder}`,
      }),
    );
  }
  if (options.owner) {
    const dir = join(root, "personal_information", "personal_information");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "personal_information.json"),
      JSON.stringify({ profile_user: [{ string_map_data: { Name: { value: metaEncode(options.owner) }, Username: { value: "me_here" } } }] }),
    );
  }
  if (options.blocked !== undefined) {
    const dir = join(root, "connections", "followers_and_following");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "blocked_profiles.json"), JSON.stringify(options.blocked));
  }
}
