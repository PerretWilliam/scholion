import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-transport";
import { type Conversation, titleOf, upsert } from "@/lib/history";

const user = (text: string): ChatMessage => ({
  id: text,
  role: "user",
  parts: [{ type: "text", text }],
});

const conversation = (id: string, updatedAt: number): Conversation => ({
  id,
  title: id,
  updatedAt,
  messages: [],
});

describe("titleOf", () => {
  it("uses the first question, shortened", () => {
    expect(titleOf([user("How do I sort a list?"), user("And a dict?")])).toBe(
      "How do I sort a list?",
    );
    expect(titleOf([user("x".repeat(80))])).toBe(`${"x".repeat(50)}…`);
    expect(titleOf([])).toBe("Chat");
  });
});

describe("upsert", () => {
  it("replaces by id and puts the latest first", () => {
    const list = [conversation("a", 3), conversation("b", 2)];
    const next = upsert(list, conversation("b", 5));
    expect(next.map((c) => c.id)).toEqual(["b", "a"]);
    expect(upsert(next, conversation("c", 1)).map((c) => c.id)).toEqual(["b", "a", "c"]);
  });
});
