/**
 * What a human supplies about one hypothesis — never fetched, scraped, or
 * looked up on their behalf. This is the verify-mode boundary: the app can
 * only check whether a candidate the user already named is supported by
 * signals already in the vault, never go find out who someone is from a
 * bare identifier. See DESIGN.md's OSINT collector decision for why.
 */
export interface CandidateInput {
  /** A human-readable name for this hypothesis — "my coworker Alex," a full name, whatever the user actually has. Not itself checked against anything. */
  label: string;
  username?: string;
  email?: string;
  phone?: string;
  /** Text the user believes the candidate actually wrote (a public post, a comment, an email) — pasted in, never fetched by the app. */
  writingSample?: string;
}
