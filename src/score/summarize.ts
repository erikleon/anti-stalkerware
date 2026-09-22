import type { Message } from "../types/message";
import type { Signal } from "./signals";

/**
 * Local summarization via Ollama (optional — triage and the vault work fine
 * without it). This organizes what the user already knows and has tagged;
 * it does not diagnose intent from message text on its own. Earlier drafts
 * of this module treated a language model as a fallback abuse detector.
 * That was wrong: the model has no more relationship context than the
 * classifier does, so asking it to detect coercive control just trades
 * missed threats for a confident, sometimes invented, narrative.
 */
export interface Summarizer {
  summarizeThread(messages: Message[], signals: Signal[]): Promise<string>;
  isAvailable(): Promise<boolean>;
}
