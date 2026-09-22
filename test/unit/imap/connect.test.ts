import { describe, expect, it } from "vitest";
import { connectImap } from "../../../src/ingest/imap/reader";

describe("connectImap", () => {
  it("refuses to connect without either an access token or an app password", async () => {
    await expect(
      connectImap({ host: "imap.example.com", port: 993, secure: true, user: "victim@example.com" }),
    ).rejects.toThrow(/accessToken or appPassword/);
  });
});
