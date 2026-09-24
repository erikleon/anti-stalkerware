import {
  createZonedDateTime,
  isDateTimeError,
  parsePlainDate,
  projectInstant,
  resolveZonedDateTime,
  startOfZonedDateTimeUnit,
  toPlainDateString,
  toZonedDateTimeString,
} from "strictdatetime";

/**
 * The few places docket needs a person's local calendar, not just an
 * instant: a boundary date they picked, the local day a message was sent
 * on, and the local time an evidence export records. Everything else in
 * the app stores and compares plain instants, where a Date is enough.
 *
 * Main process only. The renderer has no bundler, so it can't import an
 * npm package; it sends a "YYYY-MM-DD" string and the main process does
 * the time-zone work here.
 */

/** The time zone of this machine, as an IANA name ("America/New_York"). Throws if the host can't name one, rather than quietly assuming UTC. */
export function localTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Validates the name the same way every other call here will.
  createZonedDateTime({ epochMilliseconds: 0, timeZone: zone });
  return zone;
}

/**
 * The first instant of a calendar date in a time zone. "2026-09-24" in
 * New York is 04:00 UTC, not 00:00 UTC — reading the string with
 * `new Date()` gets that wrong for anyone not in UTC.
 *
 * Throws DateTimeError for anything that isn't a real YYYY-MM-DD date
 * ("2026-02-30", "09/24/2026").
 */
export function startOfLocalDay(isoDate: string, timeZone: string): Date {
  const date = parsePlainDate(isoDate);
  // Noon exists on every calendar day in every zone, so resolving it never
  // needs a policy; the day boundary is then found from there.
  const noon = resolveZonedDateTime({ ...date, hour: 12, minute: 0, second: 0, millisecond: 0 }, timeZone);
  // "compatible" is the only policy that gives the first instant of the day
  // both when midnight is skipped (it moves forward to the first real time)
  // and when midnight happens twice (it takes the first one). "earlier" and
  // "later" each put part of one day inside the next in one of those cases:
  // https://github.com/erikleon/strictdatetime/issues (day-boundary report)
  const start = startOfZonedDateTimeUnit(noon, "day", { disambiguation: "compatible" });
  return new Date(start.epochMilliseconds);
}

/**
 * The local calendar date ("2026-09-23") an instant falls on in a time
 * zone. Before 1970, which named zones can't represent here, it's the UTC
 * date marked " UTC" — a wrong or corrupt timestamp shouldn't fail the
 * screen that shows it.
 */
export function localDateString(instant: Date, timeZone: string): string {
  try {
    const { year, month, day } = projectInstant(instant.getTime(), timeZone);
    return toPlainDateString({ year, month, day });
  } catch (err) {
    if (isDateTimeError(err) && err.code === "OUT_OF_RANGE") return `${instant.toISOString().slice(0, 10)} UTC`;
    throw err;
  }
}

/**
 * An instant written with its local offset and zone name, e.g.
 * "2026-09-23T21:00:00.000-04:00[America/New_York]": the exact instant and
 * the wall-clock time the person saw, in one string.
 *
 * Returns undefined for an instant before 1970, which named time zones
 * can't represent here. Callers keep the UTC timestamp, so nothing is lost.
 */
export function zonedTimestamp(instant: Date, timeZone: string): string | undefined {
  try {
    return toZonedDateTimeString(createZonedDateTime({ epochMilliseconds: instant.getTime(), timeZone }));
  } catch (err) {
    if (isDateTimeError(err) && err.code === "OUT_OF_RANGE") return undefined;
    throw err;
  }
}
