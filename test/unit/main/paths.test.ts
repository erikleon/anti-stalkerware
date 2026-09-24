import { describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { expandHome } from "../../../src/main/paths";

describe("expandHome", () => {
  it("expands a bare ~ to the home directory", () => {
    expect(expandHome("~")).toBe(homedir());
  });

  it("expands ~/... to a path under the home directory", () => {
    expect(expandHome("~/Library/Messages/chat.db")).toBe(join(homedir(), "Library/Messages/chat.db"));
  });

  it("leaves an already-absolute path unchanged", () => {
    expect(expandHome("/Users/someone/Library/Messages/chat.db")).toBe("/Users/someone/Library/Messages/chat.db");
  });

  it("leaves a relative path with no ~ unchanged", () => {
    expect(expandHome("chat.db")).toBe("chat.db");
  });

  it("does not touch a ~ that isn't at the start of the path (not a home-directory reference)", () => {
    expect(expandHome("/tmp/not~a/home/path")).toBe("/tmp/not~a/home/path");
  });
});
