import type { Message } from "../types/message";

/**
 * Structural pattern detection for abuse that doesn't read as toxic on its
 * face: coercive control, monitoring, and escalation. No model can reliably
 * infer this from message text alone without the relationship context a
 * user has and a classifier doesn't — so these detectors work off
 * structure and user-supplied context instead of trying to guess intent
 * from wording.
 *
 * Every detector here is a heuristic, not a verified-accurate classifier.
 * location-or-schedule-mention in particular is a starting keyword list,
 * not a tuned model — it needs real evaluation against the coercive-control
 * eval set (see TODOS.md / the plan review's detection-eval discussion)
 * before its output should be trusted as anything more than "worth a
 * human's attention."
 */
export type SignalKind =
  | "contact-after-marked-boundary"
  | "location-or-schedule-mention"
  | "new-correlated-identifier"
  | "escalating-frequency"
  | "channel-switch"
  | "user-tagged-phrase";

export interface Signal {
  kind: SignalKind;
  message: Message;
  detail: string;
}

/** A boundary the user has explicitly marked, e.g. "told them to stop contacting me on 2026-08-01". */
export interface UserBoundary {
  setAt: Date;
  description: string;
  /** If set, this boundary only applies to messages from this sender. Unset means it applies to any non-self message after setAt. */
  appliesToSender?: string;
}

/** A phrase the user has flagged as personally significant — a nickname, a threat, a reference only their abuser would know. */
export interface UserTaggedPhrase {
  phrase: string;
  /** Why the user flagged it, shown alongside a match so a hit is self-explanatory. */
  note: string;
}

export interface DetectionContext {
  boundaries: UserBoundary[];
  taggedPhrases: UserTaggedPhrase[];
  /** Senders already confirmed abusive (crossed the toxicity threshold or were user-confirmed) — the baseline new-correlated-identifier and escalating-frequency compare against. */
  knownAbusiveSenders: string[];
}

export interface SignalDetector {
  detect(messages: Message[], context: DetectionContext): Signal[];
}

const EMPTY_CONTEXT: DetectionContext = { boundaries: [], taggedPhrases: [], knownAbusiveSenders: [] };

/** Flags any non-self message sent after a boundary the user marked, from the sender that boundary applies to (or any sender, if unscoped). */
export function detectContactAfterBoundary(messages: Message[], boundaries: UserBoundary[]): Signal[] {
  const signals: Signal[] = [];
  for (const message of messages) {
    if (message.fromSelf) continue;
    for (const boundary of boundaries) {
      if (boundary.appliesToSender && boundary.appliesToSender !== message.sender) continue;
      if (message.sentAt > boundary.setAt) {
        signals.push({
          kind: "contact-after-marked-boundary",
          message,
          detail: `Sent after boundary "${boundary.description}" (set ${boundary.setAt.toISOString()})`,
        });
        break; // one flag per message is enough even if multiple boundaries apply
      }
    }
  }
  return signals;
}

/**
 * Starting keyword list for location/schedule/surveillance references.
 * Deliberately narrow and easy to extend — false negatives here are
 * expected and the reason this whole module exists alongside a toxicity
 * classifier rather than instead of one.
 */
const LOCATION_SCHEDULE_PATTERNS: RegExp[] = [
  /\b(saw|see|seeing) you (at|near|outside|by)\b/i,
  /\bdrove (by|past)\b/i,
  /\b(outside|near) your (house|home|work|office|apartment|school)\b/i,
  /\bfollow(ed|ing)? you\b/i,
  /\bwatching you\b/i,
  /\bknow where you (live|work|are)\b/i,
  /\byour (new )?(address|workplace|schedule|route)\b/i,
  /\b(picked up|dropped off) (the kids|your kids)\b/i,
];

export function detectLocationOrScheduleMentions(messages: Message[]): Signal[] {
  const signals: Signal[] = [];
  for (const message of messages) {
    if (message.fromSelf) continue;
    const match = LOCATION_SCHEDULE_PATTERNS.find((pattern) => pattern.test(message.text));
    if (match) {
      signals.push({
        kind: "location-or-schedule-mention",
        message,
        detail: `Matched pattern: ${match.source}`,
      });
    }
  }
  return signals;
}

export function detectUserTaggedPhrases(messages: Message[], taggedPhrases: UserTaggedPhrase[]): Signal[] {
  const signals: Signal[] = [];
  for (const message of messages) {
    if (message.fromSelf) continue;
    for (const tagged of taggedPhrases) {
      if (message.text.toLowerCase().includes(tagged.phrase.toLowerCase())) {
        signals.push({
          kind: "user-tagged-phrase",
          message,
          detail: `Contains "${tagged.phrase}" — ${tagged.note}`,
        });
      }
    }
  }
  return signals;
}

/**
 * Flags a sender's first-ever message if it lands soon after the most
 * recent message from an already-known abusive sender — the burner-number
 * pattern, where contact appears to continue under a new identity right
 * after the old one goes quiet. `windowHours` is deliberately a parameter,
 * not a constant: this is a guess at a reasonable window, not a tuned one.
 */
export function detectNewCorrelatedIdentifiers(
  messages: Message[],
  knownAbusiveSenders: string[],
  windowHours = 72,
): Signal[] {
  if (knownAbusiveSenders.length === 0) return [];
  const knownSet = new Set(knownAbusiveSenders);
  const windowMs = windowHours * 60 * 60 * 1000;

  const nonSelf = messages.filter((m) => !m.fromSelf);
  const lastKnownAbusiveAt = nonSelf
    .filter((m) => knownSet.has(m.sender))
    .reduce<Date | undefined>((latest, m) => (!latest || m.sentAt > latest ? m.sentAt : latest), undefined);
  if (!lastKnownAbusiveAt) return [];

  const firstMessageBySender = new Map<string, Message>();
  for (const message of nonSelf) {
    if (knownSet.has(message.sender)) continue;
    const existing = firstMessageBySender.get(message.sender);
    if (!existing || message.sentAt < existing.sentAt) {
      firstMessageBySender.set(message.sender, message);
    }
  }

  const signals: Signal[] = [];
  for (const message of firstMessageBySender.values()) {
    const deltaMs = message.sentAt.getTime() - lastKnownAbusiveAt.getTime();
    if (deltaMs >= 0 && deltaMs <= windowMs) {
      signals.push({
        kind: "new-correlated-identifier",
        message,
        detail: `First message from this sender, ${Math.round(deltaMs / (60 * 60 * 1000))}h after the last message from a known abusive sender — unverified correlation, not a confirmed identity match`,
      });
    }
  }
  return signals;
}

/**
 * Flags a sender's message rate in the most recent day against their own
 * baseline rate over the preceding month. Needs a minimum sample size —
 * a sender's second-ever message always looks like "infinite escalation"
 * from a rate of near-zero, which isn't a meaningful signal.
 */
export function detectEscalatingFrequency(
  messages: Message[],
  options: { recentWindowHours?: number; baselineWindowDays?: number; minimumBaselineMessages?: number; escalationMultiplier?: number } = {},
): Signal[] {
  const recentWindowMs = (options.recentWindowHours ?? 24) * 60 * 60 * 1000;
  const baselineWindowMs = (options.baselineWindowDays ?? 30) * 24 * 60 * 60 * 1000;
  const minimumBaselineMessages = options.minimumBaselineMessages ?? 5;
  const escalationMultiplier = options.escalationMultiplier ?? 3;

  const bySender = new Map<string, Message[]>();
  for (const message of messages) {
    if (message.fromSelf) continue;
    const list = bySender.get(message.sender) ?? [];
    list.push(message);
    bySender.set(message.sender, list);
  }

  const signals: Signal[] = [];
  for (const [, senderMessages] of bySender) {
    senderMessages.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    const latest = senderMessages[senderMessages.length - 1]!.sentAt.getTime();
    const recentCutoff = latest - recentWindowMs;
    const baselineCutoff = latest - recentWindowMs - baselineWindowMs;

    const recent = senderMessages.filter((m) => m.sentAt.getTime() > recentCutoff);
    const baseline = senderMessages.filter(
      (m) => m.sentAt.getTime() <= recentCutoff && m.sentAt.getTime() > baselineCutoff,
    );
    if (baseline.length < minimumBaselineMessages) continue;

    const recentRatePerHour = recent.length / (recentWindowMs / (60 * 60 * 1000));
    const baselineRatePerHour = baseline.length / (baselineWindowMs / (60 * 60 * 1000));
    if (baselineRatePerHour > 0 && recentRatePerHour >= baselineRatePerHour * escalationMultiplier) {
      const mostRecent = recent[recent.length - 1];
      if (mostRecent) {
        signals.push({
          kind: "escalating-frequency",
          message: mostRecent,
          detail: `${recent.length} messages in the last ${(options.recentWindowHours ?? 24)}h vs a baseline of ~${baselineRatePerHour.toFixed(2)}/h`,
        });
      }
    }
  }
  return signals;
}

/** Flags a message when the sender's previous message came through a different ingest source — a sudden switch from texting to email, for instance. */
export function detectChannelSwitch(messages: Message[]): Signal[] {
  const bySender = new Map<string, Message[]>();
  for (const message of messages) {
    if (message.fromSelf) continue;
    const list = bySender.get(message.sender) ?? [];
    list.push(message);
    bySender.set(message.sender, list);
  }

  const signals: Signal[] = [];
  for (const [, senderMessages] of bySender) {
    senderMessages.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    for (let i = 1; i < senderMessages.length; i++) {
      const previous = senderMessages[i - 1]!;
      const current = senderMessages[i]!;
      if (current.source !== previous.source) {
        signals.push({
          kind: "channel-switch",
          message: current,
          detail: `Switched from ${previous.source} to ${current.source}`,
        });
      }
    }
  }
  return signals;
}

/** Runs every structural detector and returns the combined result. The real SignalDetector this app uses. */
export class StructuralSignalDetector implements SignalDetector {
  detect(messages: Message[], context: DetectionContext = EMPTY_CONTEXT): Signal[] {
    return [
      ...detectContactAfterBoundary(messages, context.boundaries),
      ...detectLocationOrScheduleMentions(messages),
      ...detectUserTaggedPhrases(messages, context.taggedPhrases),
      ...detectNewCorrelatedIdentifiers(messages, context.knownAbusiveSenders),
      ...detectEscalatingFrequency(messages),
      ...detectChannelSwitch(messages),
    ];
  }
}
