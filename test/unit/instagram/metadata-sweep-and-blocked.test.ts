import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTestDir } from "../../helpers/tmp-dir";
import { writeInstagramExport } from "../../helpers/instagram-export";
import { loadInstagramExport } from "../../../src/ingest/instagram/reader";
import { sweepInstagramExport } from "../../../src/ingest/instagram/metadata-sweep";
import { readInstagramBlocked } from "../../../src/ingest/instagram/blocked";

const T0 = 1_700_000_000_000;

describe("Instagram sweep and block list", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "docket-instagram-sweep-test-"));
  });

  afterEach(() => {
    removeTestDir(dir);
  });

  it("sweeps every sender but the owner, with the one-to-one folder name as an alias", async () => {
    writeInstagramExport(dir, {
      owner: "Me Here",
      threads: [
        {
          folder: "alexb_111",
          participants: ["Alex B", "Me Here"],
          messages: [
            { sender_name: "Alex B", timestamp_ms: T0 + 5, content: "one" },
            { sender_name: "Alex B", timestamp_ms: T0, content: "two" },
            { sender_name: "Me Here", timestamp_ms: T0 + 1, content: "mine" },
          ],
        },
        {
          folder: "group_333",
          participants: ["Alex B", "Sam", "Me Here"],
          messages: [{ sender_name: "Sam", timestamp_ms: T0 + 2, content: "hey" }],
        },
      ],
    });
    const rows = sweepInstagramExport(await loadInstagramExport(dir));
    const alex = rows.find((r) => r.sender === "Alex B")!;
    expect(alex).toMatchObject({ messageCount: 2, aliases: ["alexb"] });
    expect(alex.firstSeenAt.getTime()).toBe(T0);
    expect(alex.lastSeenAt.getTime()).toBe(T0 + 5);
    // A group thread's folder name isn't any one person's alias.
    expect(rows.find((r) => r.sender === "Sam")?.aliases).toBeUndefined();
    expect(rows.some((r) => r.sender === "Me Here")).toBe(false);
  });

  it("reads blocked usernames from value, title, or the profile link, counting entries with none", async () => {
    writeInstagramExport(dir, {
      threads: [],
      blocked: {
        relationships_blocked_users: [
          { title: "", string_list_data: [{ href: "https://www.instagram.com/old_handle", value: "old_handle", timestamp: 1 }] },
          { title: "newer_style", string_list_data: [{ href: "https://www.instagram.com/newer_style", timestamp: 2 }] },
          { title: "", string_list_data: [{ href: "https://www.instagram.com/_u/link_only", timestamp: 3 }] },
          { title: "", string_list_data: [{ timestamp: 4 }] },
        ],
      },
    });
    expect(await readInstagramBlocked(dir)).toEqual({ status: "ok", usernames: ["old_handle", "newer_style", "link_only"], skipped: 1 });
  });

  it("reports not-found when the export has no block list", async () => {
    expect(await readInstagramBlocked(dir)).toEqual({ status: "not-found", usernames: [], skipped: 0 });
  });

  it("throws a plain error for a block list with an unexpected layout", async () => {
    writeInstagramExport(dir, { threads: [], blocked: { something_else: [] } });
    await expect(readInstagramBlocked(dir)).rejects.toThrow(/unexpected layout/);
  });
});
