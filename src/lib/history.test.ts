import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-transport";
import { type Conversation, matches, titleOf, toMarkdown, upsert } from "@/lib/history";

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

describe("matches", () => {
  it("looks in the title and the messages", () => {
    const c = { ...conversation("Sorting", 1), messages: [user("Use key= for a custom order")] };
    expect(matches(c, "sort")).toBe(true);
    expect(matches(c, "CUSTOM")).toBe(true);
    expect(matches(c, "dict")).toBe(false);
    expect(matches(c, "  ")).toBe(true);
  });
});

describe("toMarkdown", () => {
  it("writes questions, answers and numbered sources", () => {
    const answer: ChatMessage = {
      id: "a",
      role: "assistant",
      parts: [
        {
          type: "data-sources",
          data: {
            doc: "Python 3.14",
            slug: "python",
            name: "Python",
            attribution: "",
            pages: [{ title: "Sorting", url: "https://devdocs.io/python/howto/sorting" }],
          },
        },
        { type: "text", text: "Use sorted() [1]." },
      ],
    };
    expect(toMarkdown({ ...conversation("Sort", 1), messages: [user("How?"), answer] })).toBe(
      "# Sort\n\n## Question\n\nHow?\n\n## Answer\n\nUse sorted() [1].\n\n**Sources (Python 3.14)**  \n[1] [Sorting](https://devdocs.io/python/howto/sorting)\n",
    );
  });
});
