import { describe, expect, it } from "vitest";
import type { SearchHit } from "@/lib/ipc";
import { answerInstructions, answerPrompt, parseKeywords, pickPages } from "@/lib/prompts";

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
    const hits = ["a#x", "a#y", "b", "c", "d"].map(hit);
    expect(pickPages(hits).map((h) => h.path)).toEqual(["a#x", "b", "c"]);
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
      "<passage 1: strcpy>\nCopies src.\n</passage>\n\n<passage 2: memcpy>\nCopies bytes.\n</passage>\n\nQuestion: copier une chaîne ?",
    );
  });
});
