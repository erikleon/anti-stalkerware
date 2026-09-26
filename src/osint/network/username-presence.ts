/**
 * Username helpers shared by the OSINT username check
 * (username-check.ts): which handles are safe to send, and which to
 * suggest. The site rules themselves come from WhatsMyName
 * (whatsmyname.ts).
 */

/**
 * A handle as the checks will send it, or undefined if it can't be one.
 * Strict on purpose: only characters handles actually use, so nothing
 * else from a message can ride along into a URL.
 */
export function normalizeHandle(input: string): string | undefined {
  const handle = input.trim().replace(/^@/, "");
  return /^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/.test(handle) ? handle : undefined;
}

/**
 * Handles worth offering as suggestions: @mentions in the sender's own
 * messages, the sender's identifier when it looks like a handle, and
 * usernames from the known-accounts list. The person still picks one and
 * starts the check; nothing is checked automatically.
 */
export function suggestHandles(senderIdentifier: string, senderTexts: readonly string[], knownUsernames: readonly string[]): string[] {
  const found = new Set<string>();
  const add = (value: string) => {
    const handle = normalizeHandle(value);
    if (handle) found.add(handle);
  };
  if (!/^[+\d\s().-]+$/.test(senderIdentifier) && !senderIdentifier.includes("@")) add(senderIdentifier);
  for (const text of senderTexts) for (const match of text.matchAll(/(?:^|[^\w@])@([A-Za-z0-9._-]{2,40})/g)) add(match[1]!);
  for (const username of knownUsernames) add(username);
  return [...found];
}
