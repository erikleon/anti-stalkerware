import { describe, expect, it } from "vitest";
import { confirmationMatches } from "../../src/vault/destroy";

describe("confirmationMatches", () => {
  it("confirms when the typed phrase matches exactly", () => {
    expect(
      confirmationMatches({ expectedPhrase: "REMOVE LOCAL APP DATA", typedPhrase: "REMOVE LOCAL APP DATA" }),
    ).toBe(true);
  });

  it("refuses on any mismatch, including case and whitespace", () => {
    expect(
      confirmationMatches({ expectedPhrase: "REMOVE LOCAL APP DATA", typedPhrase: "remove local app data" }),
    ).toBe(false);
    expect(
      confirmationMatches({ expectedPhrase: "REMOVE LOCAL APP DATA", typedPhrase: "REMOVE LOCAL APP DATA " }),
    ).toBe(false);
    expect(confirmationMatches({ expectedPhrase: "REMOVE LOCAL APP DATA", typedPhrase: "" })).toBe(false);
  });
});
