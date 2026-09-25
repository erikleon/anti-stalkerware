import { describe, expect, it } from "vitest";
import { localDateString, localTimeZone, resolveLocalDateTime, startOfLocalDay, zonedTimestamp } from "../../../src/time/local-time";

describe("startOfLocalDay", () => {
  it("is local midnight, not UTC midnight", () => {
    expect(startOfLocalDay("2026-09-24", "America/New_York").toISOString()).toBe("2026-09-24T04:00:00.000Z");
    expect(startOfLocalDay("2026-09-24", "Asia/Tokyo").toISOString()).toBe("2026-09-23T15:00:00.000Z");
    expect(startOfLocalDay("2026-09-24", "UTC").toISOString()).toBe("2026-09-24T00:00:00.000Z");
  });

  it("starts a day whose midnight is skipped at its first real time, not in the day before", () => {
    // Santiago moves clocks from 00:00 to 01:00 on 2026-09-06.
    expect(startOfLocalDay("2026-09-06", "America/Santiago").toISOString()).toBe("2026-09-06T04:00:00.000Z");
  });

  it("starts a day whose midnight happens twice at the first one", () => {
    // Havana moves clocks from 01:00 back to 00:00 on 2026-11-01.
    expect(startOfLocalDay("2026-11-01", "America/Havana").toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });

  it("refuses a date that doesn't exist or isn't YYYY-MM-DD", () => {
    expect(() => startOfLocalDay("2026-02-30", "UTC")).toThrow();
    expect(() => startOfLocalDay("09/24/2026", "UTC")).toThrow();
  });
});

describe("localDateString", () => {
  it("is the calendar date in the given zone", () => {
    const evening = new Date("2026-09-24T01:00:00Z");
    expect(localDateString(evening, "America/New_York")).toBe("2026-09-23");
    expect(localDateString(evening, "UTC")).toBe("2026-09-24");
  });

  it("falls back to the UTC date, marked, before 1970", () => {
    expect(localDateString(new Date("1969-07-20T20:17:00Z"), "America/New_York")).toBe("1969-07-20 UTC");
  });
});

describe("zonedTimestamp", () => {
  it("writes the instant with its offset and zone name", () => {
    expect(zonedTimestamp(new Date("2026-09-24T01:00:00Z"), "America/New_York")).toBe("2026-09-23T21:00:00.000-04:00[America/New_York]");
  });

  it("returns undefined before 1970 instead of failing an export", () => {
    expect(zonedTimestamp(new Date("1969-12-31T00:00:00Z"), "America/New_York")).toBeUndefined();
  });
});

describe("localTimeZone", () => {
  it("names a zone the other functions accept", () => {
    expect(() => localDateString(new Date(), localTimeZone())).not.toThrow();
  });
});

describe("resolveLocalDateTime", () => {
  const NY = "America/New_York";

  it("resolves an ordinary datetime-local value, which has no seconds", () => {
    expect(resolveLocalDateTime("2026-09-23T21:15", NY)).toEqual({
      status: "ok",
      instant: new Date("2026-09-24T01:15:00.000Z"),
      zoned: "2026-09-23T21:15:00.000-04:00[America/New_York]",
    });
  });

  it("asks which one when the time happened twice (clocks went back)", () => {
    const result = resolveLocalDateTime("2026-11-01T01:30", NY);
    expect(result.status).toBe("ambiguous");
    if (result.status !== "ambiguous") return;
    expect(result.earlier.zoned).toBe("2026-11-01T01:30:00.000-04:00[America/New_York]");
    expect(result.later.zoned).toBe("2026-11-01T01:30:00.000-05:00[America/New_York]");
  });

  it("uses the person's choice for an ambiguous time", () => {
    const result = resolveLocalDateTime("2026-11-01T01:30", NY, "later");
    expect(result).toMatchObject({ status: "ok", zoned: "2026-11-01T01:30:00.000-05:00[America/New_York]" });
  });

  it("says a skipped time never happened instead of moving it", () => {
    expect(resolveLocalDateTime("2026-03-08T02:30", NY)).toEqual({ status: "nonexistent" });
    expect(resolveLocalDateTime("2026-03-08T02:30", NY, "earlier")).toEqual({ status: "nonexistent" });
  });

  it("calls anything that isn't a real local date and time invalid", () => {
    expect(resolveLocalDateTime("2026-02-30T10:00", NY)).toEqual({ status: "invalid" });
    expect(resolveLocalDateTime("yesterday", NY)).toEqual({ status: "invalid" });
    expect(resolveLocalDateTime("1969-07-20T20:17", NY)).toEqual({ status: "invalid" });
  });
});
