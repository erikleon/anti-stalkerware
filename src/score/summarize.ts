import type { Message } from "../types/message";
import type { Signal } from "./signals";

/**
 * Local summarization via Ollama's HTTP API (optional — triage and the
 * vault work fine without it; see isAvailable()). This organizes what the
 * user already knows and has tagged; it does not diagnose intent from
 * message text on its own. Earlier drafts of this module treated a
 * language model as a fallback abuse detector. That was wrong: the model
 * has no more relationship context than the classifier does, so asking it
 * to detect coercive control just trades missed threats for a confident,
 * sometimes invented, narrative. The prompt below is written to keep the
 * model inside that boundary — organizing and dating what's already been
 * flagged, not asserting anything new about intent.
 */
export interface Summarizer {
  summarizeThread(messages: Message[], signals: Signal[]): Promise<string>;
  isAvailable(): Promise<boolean>;
}

export interface OllamaSummarizerOptions {
  /** Default matches Ollama's own local default — override for a different host/port, or to point tests at a fake server. */
  baseUrl?: string;
  /** No default is claimed to be "the right model" — whatever's actually pulled on the user's machine is what runs. Ollama returns a clear error if this model isn't present. */
  model: string;
  timeoutMs?: number;
}

interface OllamaGenerateResponse {
  response: string;
  done: boolean;
}

interface OllamaTagsResponse {
  models: Array<{ name: string }>;
}

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_TIMEOUT_MS = 60_000;

export class OllamaSummarizer implements Summarizer {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: OllamaSummarizerOptions) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/tags`, { method: "GET" });
      if (!response.ok) return false;
      const body = (await response.json()) as OllamaTagsResponse;
      return body.models.some((m) => m.name === this.model || m.name.startsWith(`${this.model}:`));
    } catch {
      // Ollama not installed, not running, or the model isn't pulled —
      // all the same "not available" from this app's point of view.
      return false;
    }
  }

  async summarizeThread(messages: Message[], signals: Signal[]): Promise<string> {
    const prompt = buildSummaryPrompt(messages, signals);
    const response = await this.fetchWithTimeout(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt, stream: false }),
    });
    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status} ${await response.text()}`);
    }
    const body = (await response.json()) as OllamaGenerateResponse;
    return body.response;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * The model is asked to organize a timeline from the messages and the
 * signals already detected elsewhere in the app — never to decide on its
 * own whether something is threatening. That judgment stays with the
 * structural detectors, the toxicity classifier, and the user.
 */
function buildSummaryPrompt(messages: Message[], signals: Signal[]): string {
  const timeline = messages
    .map((m) => `[${m.sentAt.toISOString()}] ${m.fromSelf ? "you" : m.sender}: ${m.text}`)
    .join("\n");

  const flaggedPatterns = signals.length
    ? signals.map((s) => `- ${s.kind}: ${s.detail}`).join("\n")
    : "(none flagged)";

  return [
    "You are organizing a message timeline for someone documenting harassment. ",
    "Do not add interpretation, motive, or judgment beyond what is stated below. ",
    "Do not decide whether anything here is threatening — that has already been assessed elsewhere. ",
    "Write a short, neutral, chronological summary: what was said, when, and which flagged patterns apply to which messages.",
    "",
    "Messages:",
    timeline,
    "",
    "Patterns already flagged by other parts of this application:",
    flaggedPatterns,
  ].join("\n");
}
