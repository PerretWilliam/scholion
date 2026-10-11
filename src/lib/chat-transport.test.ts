/// <reference types="node" />
// The whole chat pipeline against a fake OpenAI-compatible model server: only the Tauri commands
// (`@/lib/ipc`) are mocked, so prompts, parsing and streaming run for real.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type ChatMessage, createChatTransport } from "@/lib/chat-transport";
import type { DocEntry, SearchHit } from "@/lib/ipc";

const doc = {
  name: "Python",
  slug: "python",
  version: "3.14",
  attribution: "<p>DevDocs</p>",
} as DocEntry;
const hit: SearchHit = {
  name: "Sorting HOW TO",
  path: "howto/sorting",
  type: "",
  url: "https://devdocs.io/python/howto/sorting",
};

const ipc = vi.hoisted(() => ({
  port: 0,
  searchDoc: vi.fn(),
}));
vi.mock("@/lib/ipc", () => ({
  detectDoc: async () => null,
  getDocs: async () => ({ installed: [{ entry: doc }] }),
  getPassage: async () => "sorted(iterable, key=None)",
  startLlm: async () => ipc.port,
  searchDoc: ipc.searchDoc,
}));

/** Request bodies received by the fake model, in order. */
let requests: { system: string; user: string; stream: boolean }[] = [];
let server: Server;

/** What the fake model says, by the kind of request (told apart by its instructions). */
function reply(system: string): string {
  if (system.includes("search terms")) return "sorted sort key";
  if (system.includes("standalone question")) return "How do I sort a dict by value?";
  if (system.includes("follow-up questions"))
    return "How do I reverse the order?\nWhat is a key function?";
  return "Use `sorted()` with `key` [1].";
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const json = JSON.parse(body);
      const text = (role: string) =>
        json.messages
          .filter((m: { role: string }) => m.role === role)
          .map((m: { content: string }) => m.content)
          .join("\n");
      const system = text("system");
      requests.push({ system, user: text("user"), stream: !!json.stream });
      const content = reply(system);
      const base = { id: "1", created: 0, model: "local" };
      if (json.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const chunk = (delta: object, finish: string | null) =>
          `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
        res.write(chunk({ role: "assistant", content }, null));
        res.write(chunk({}, "stop"));
        res.end("data: [DONE]\n\n");
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ...base,
            object: "chat.completion",
            choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        );
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  ipc.port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  requests = [];
  ipc.searchDoc.mockReset().mockResolvedValue([hit]);
});

const message = (role: "user" | "assistant", text: string): ChatMessage => ({
  id: `${role}-${text}`,
  role,
  parts: [{ type: "text", text }],
});

/** Runs the pipeline on `messages` and returns every chunk it streams. */
async function run(messages: ChatMessage[]) {
  const transport = createChatTransport(() => ({
    slug: "python",
    model: "model.gguf",
    cloud: null,
    selectDoc: () => {},
  }));
  const stream = await transport.sendMessages({
    chatId: "c",
    messageId: undefined,
    trigger: "submit-message",
    messages,
    abortSignal: undefined,
  });
  const chunks: { type: string; delta?: string; data?: unknown }[] = [];
  for (const reader = stream.getReader(); ; ) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    chunks.push(value);
  }
}

describe("chat pipeline", () => {
  it("searches with the model's keywords, then streams a cited answer and follow-ups", async () => {
    const chunks = await run([message("user", "How do I sort a list?")]);

    // Keywords from the model, then the whole question, are searched.
    expect(ipc.searchDoc).toHaveBeenCalledWith("python", "sorted", 2);
    expect(ipc.searchDoc).toHaveBeenCalledWith(
      "python",
      "How do I sort a list? sorted sort key",
      4,
    );
    // No earlier turn: no rewriting request.
    expect(requests.some((r) => r.system.includes("standalone question"))).toBe(false);

    const answer = requests.find((r) => r.stream);
    expect(answer?.user).toContain("<passage 1: Sorting HOW TO>");
    expect(answer?.user).toContain("sorted(iterable, key=None)");

    const types = chunks.map((c) => c.type);
    expect(types).toContain("data-sources");
    expect(chunks.filter((c) => c.type === "text-delta").map((c) => c.delta)).toEqual([
      "Use `sorted()` with `key` [1].",
    ]);
    const suggestions = chunks.find((c) => c.type === "data-suggestions");
    expect(suggestions?.data).toEqual({
      questions: ["How do I reverse the order?", "What is a key function?"],
    });
  });

  it("rewrites a follow-up into a standalone question before searching", async () => {
    await run([
      message("user", "How do I sort a list?"),
      message("assistant", "Use sorted()."),
      message("user", "And with a dict?"),
    ]);

    const rewrite = requests.find((r) => r.system.includes("standalone question"));
    expect(rewrite?.user).toContain("User: How do I sort a list?");
    expect(rewrite?.user).toContain("Latest question: And with a dict?");
    expect(ipc.searchDoc).toHaveBeenCalledWith(
      "python",
      "How do I sort a dict by value? sorted sort key",
      4,
    );
    expect(requests.find((r) => r.stream)?.user).toContain(
      "Question: How do I sort a dict by value?",
    );
  });

  it("says so when no page matches", async () => {
    ipc.searchDoc.mockResolvedValue([]);
    const chunks = await run([message("user", "Something unknown")]);
    expect(chunks.some((c) => c.type === "data-sources")).toBe(false);
    expect(requests.some((r) => r.stream)).toBe(false);
    expect(chunks.find((c) => c.type === "text-delta")?.delta).toContain("Nothing in the");
  });
});
