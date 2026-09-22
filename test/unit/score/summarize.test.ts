import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { OllamaSummarizer } from "../../../src/score/summarize";
import type { Message } from "../../../src/types/message";
import type { Signal } from "../../../src/score/signals";

function msg(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    rawRecordHash: "h1",
    source: "imessage",
    threadId: "thread-a",
    sender: "stalker@example.com",
    fromSelf: false,
    text: "hello",
    sentAt: new Date("2026-01-01T00:00:00Z"),
    provenance: "live",
    ...overrides,
  };
}

/** A minimal fake Ollama server matching the real /api/generate and /api/tags shapes. */
function startFakeOllama(handlers: {
  onGenerate?: (body: unknown) => { status: number; body: unknown };
  onTags?: () => { status: number; body: unknown };
}): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        if (req.url === "/api/generate" && handlers.onGenerate) {
          const { status, body } = handlers.onGenerate(raw ? JSON.parse(raw) : undefined);
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(body));
        } else if (req.url === "/api/tags" && handlers.onTags) {
          const { status, body } = handlers.onTags();
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(body));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

describe("OllamaSummarizer", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    server = undefined;
  });

  describe("isAvailable", () => {
    it("returns true when the configured model is in the local model list", async () => {
      const fake = await startFakeOllama({
        onTags: () => ({ status: 200, body: { models: [{ name: "llama3.2:latest" }] } }),
      });
      server = fake.server;
      const summarizer = new OllamaSummarizer({ baseUrl: fake.baseUrl, model: "llama3.2" });
      expect(await summarizer.isAvailable()).toBe(true);
    });

    it("returns false when the configured model isn't pulled", async () => {
      const fake = await startFakeOllama({
        onTags: () => ({ status: 200, body: { models: [{ name: "mistral:latest" }] } }),
      });
      server = fake.server;
      const summarizer = new OllamaSummarizer({ baseUrl: fake.baseUrl, model: "llama3.2" });
      expect(await summarizer.isAvailable()).toBe(false);
    });

    it("returns false when nothing is listening at all (Ollama not running)", async () => {
      const summarizer = new OllamaSummarizer({ baseUrl: "http://127.0.0.1:1", model: "llama3.2", timeoutMs: 500 });
      expect(await summarizer.isAvailable()).toBe(false);
    }, 2000);
  });

  describe("summarizeThread", () => {
    it("sends the model name and gets back the response text", async () => {
      let capturedBody: unknown;
      const fake = await startFakeOllama({
        onGenerate: (body) => {
          capturedBody = body;
          return { status: 200, body: { model: "llama3.2", response: "A neutral summary.", done: true } };
        },
      });
      server = fake.server;
      const summarizer = new OllamaSummarizer({ baseUrl: fake.baseUrl, model: "llama3.2" });

      const result = await summarizer.summarizeThread([msg()], []);
      expect(result).toBe("A neutral summary.");
      expect((capturedBody as { model: string }).model).toBe("llama3.2");
      expect((capturedBody as { stream: boolean }).stream).toBe(false);
    });

    it("includes flagged signals in the prompt sent to the model", async () => {
      let capturedPrompt = "";
      const fake = await startFakeOllama({
        onGenerate: (body) => {
          capturedPrompt = (body as { prompt: string }).prompt;
          return { status: 200, body: { response: "ok", done: true } };
        },
      });
      server = fake.server;
      const summarizer = new OllamaSummarizer({ baseUrl: fake.baseUrl, model: "llama3.2" });

      const signal: Signal = { kind: "location-or-schedule-mention", message: msg(), detail: "drove by your work" };
      await summarizer.summarizeThread([msg()], [signal]);

      expect(capturedPrompt).toContain("location-or-schedule-mention");
      expect(capturedPrompt).toContain("drove by your work");
    });

    it("instructs the model not to add its own interpretation of intent", async () => {
      let capturedPrompt = "";
      const fake = await startFakeOllama({
        onGenerate: (body) => {
          capturedPrompt = (body as { prompt: string }).prompt;
          return { status: 200, body: { response: "ok", done: true } };
        },
      });
      server = fake.server;
      const summarizer = new OllamaSummarizer({ baseUrl: fake.baseUrl, model: "llama3.2" });
      await summarizer.summarizeThread([msg()], []);

      expect(capturedPrompt.toLowerCase()).toContain("do not add interpretation");
    });

    it("throws a clear error when Ollama returns a non-2xx response", async () => {
      const fake = await startFakeOllama({
        onGenerate: () => ({ status: 500, body: { error: "model not found" } }),
      });
      server = fake.server;
      const summarizer = new OllamaSummarizer({ baseUrl: fake.baseUrl, model: "nonexistent-model" });
      await expect(summarizer.summarizeThread([msg()], [])).rejects.toThrow(/Ollama request failed/);
    });

    it("aborts and throws if the request takes longer than the configured timeout", async () => {
      const server2 = createServer((_req, res) => {
        // Never respond — simulates a hung Ollama.
        setTimeout(() => res.end(), 10_000);
      });
      await new Promise<void>((resolve) => server2.listen(0, "127.0.0.1", resolve));
      server = server2;
      const address = server2.address();
      const port = typeof address === "object" && address ? address.port : 0;

      const summarizer = new OllamaSummarizer({ baseUrl: `http://127.0.0.1:${port}`, model: "llama3.2", timeoutMs: 100 });
      await expect(summarizer.summarizeThread([msg()], [])).rejects.toThrow();
    });
  });
});
