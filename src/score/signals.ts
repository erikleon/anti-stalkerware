import type { Message } from "../types/message";

/**
 * Structural pattern detection for abuse that doesn't read as toxic on its
 * face: coercive control, monitoring, and escalation. No model can reliably
 * infer this from message text alone without the relationship context a
 * user has and a classifier doesn't — so these detectors work off
 * structure and user-supplied context instead of trying to guess intent
 * from wording.
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
}

export interface SignalDetector {
  detect(messages: Message[], boundaries: UserBoundary[]): Signal[];
}
