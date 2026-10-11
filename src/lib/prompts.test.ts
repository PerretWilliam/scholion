import { describe, expect, it } from "vitest";
import type { SearchHit } from "@/lib/ipc";
import {
  answerInstructions,
  answerPrompt,
  linkCitations,
  needsRewrite,
  parseFollowUps,
  parseKeywords,
  parseRewrite,
  pickPages,
  rewritePrompt,
} from "@/lib/prompts";

const hit = (path: string): SearchHit => ({ name: path, path, type: "", url: "" });

describe("parseKeywords", () => {
  const question = "Comment copier une chaîne de caractères ?";

  it("cleans up model replies", () => {
    expect(parseKeywords("`strcpy`, strncpy memcpy  copy string strcpy", question)).toEqual([
      "strcpy",
      "strncpy",
      "memcpy",
      "copy",
      "string",
    ]);
    expect(parseKeywords('"str.join" (list) array.filter()', question)).toEqual([
      "str.join",
      "list",
      "array.filter",
    ]);
    expect(parseKeywords("read line file\nread line file", question)).toEqual([
      "read",
      "line",
      "file",
    ]);
    expect(parseKeywords("  ", question)).toEqual([]);
  });

  it("drops a reply that echoes the question", () => {
    expect(parseKeywords("comment copier une chaîne de caractères", question)).toEqual([]);
    expect(parseKeywords("strcpy copier", question)).toEqual(["strcpy", "copier"]);
  });
});

describe("pickPages", () => {
  it("keeps the first hit of each page, up to the limit", () => {
    const hits = ["a#x", "a#y", "b", "c", "d", "e"].map(hit);
    expect(pickPages(hits).map((h) => h.path)).toEqual(["a#x", "b", "c", "d"]);
    expect(pickPages(hits, 1).map((h) => h.path)).toEqual(["a#x"]);
  });
});

describe("prompts", () => {
  it("ground the answer in the passages", () => {
    const rules = answerInstructions("C");
    expect(rules).toContain("C documentation");
    expect(rules).toContain("language of the question");
    expect(rules).toContain("Never write URLs");

    const prompt = answerPrompt("copier une chaîne ?", [
      { title: "strcpy", text: "Copies src." },
      { title: "memcpy", text: "Copies bytes." },
    ]);
    expect(prompt).toBe(
      "<passage 1: strcpy>\nCopies src.\n</passage>\n\n<passage 2: memcpy>\nCopies bytes.\n</passage>\n\nQuestion: copier une chaîne ?\n\nAnswer in the language of the question above, not in English unless the question is in English.",
    );
  });
});

describe("parseFollowUps", () => {
  it("keeps up to three questions, without bullets or numbering", () => {
    const reply =
      "1. Comment hériter d'une classe ?\n- \"Qu'est-ce que `self` ?\"\nSure!\n* Comment définir __init__ ?\n* Une quatrième question ?";
    expect(parseFollowUps(reply)).toEqual([
      "Comment hériter d'une classe ?",
      "Qu'est-ce que `self` ?",
      "Comment définir __init__ ?",
    ]);
    expect(parseFollowUps("No question here.")).toEqual([]);
  });
});

describe("rewrite", () => {
  it("builds a prompt from the latest turns and falls back to the question", () => {
    const history = [
      { role: "user", text: "How do I sort a list?" },
      { role: "assistant", text: "Use sorted()." },
    ] as const;
    expect(rewritePrompt([...history], "And with a dict?")).toBe(
      "Conversation:\nUser: How do I sort a list?\nAssistant: Use sorted().\n\nLatest question: And with a dict?",
    );
    expect(parseRewrite('Question: "How do I sort a dict?"\nextra', "x")).toBe(
      "How do I sort a dict?",
    );
    expect(parseRewrite("  \n", "x")).toBe("x");
  });
});

describe("linkCitations", () => {
  it("links existing passages only, and leaves code alone", () => {
    const text = "Use it [1][3]. `a[1]` and\n```py\nx[2]\n```\nSee [2](https://x.y).";
    expect(linkCitations(text, 2)).toBe(
      "Use it [\\[1\\]](#cite-1)[3]. `a[1]` and\n```py\nx[2]\n```\nSee [2](https://x.y).",
    );
  });
});

describe("needsRewrite", () => {
  it("rewrites short or referring questions only", () => {
    expect(needsRewrite("And with a dict?")).toBe(true);
    expect(needsRewrite("How can I sort a list of dictionaries by one of their keys?")).toBe(false);
    expect(needsRewrite("How can I sort a list of dictionaries and reverse it afterwards?")).toBe(
      true,
    );
  });
});
