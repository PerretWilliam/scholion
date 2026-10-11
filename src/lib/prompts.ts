// Prompts for the local model, and the pure helpers around them. See docs/spec.md, "Answer generation".
import type { SearchHit } from "@/lib/ipc";

/** Pages given to the model per answer. Their size is capped in Rust (`PASSAGE_CHARS`). */
export const MAX_PASSAGES = 3;
const MAX_KEYWORDS = 5;

export function keywordInstructions(doc: string): string {
  return [
    `You turn a programming question into search terms for the ${doc} documentation.`,
    `Reply with at most ${MAX_KEYWORDS} terms separated by spaces, most specific first:`,
    "function, class, method or keyword names, then English words. No other text.",
  ].join("\n");
}

/**
 * The question after one worked example. A non-English example teaches the model to reply with
 * English terms: the docs are in English (measured on Qwen3.5 4B).
 */
export function keywordMessages(question: string) {
  return [
    { role: "user", content: "Comment connaître la longueur d'une liste ?" },
    { role: "assistant", content: "len length size list" },
    { role: "user", content: question },
  ] as const;
}

const words = (text: string) =>
  text
    .split(/[\s,;?!]+/)
    .map((w) => w.replace(/^[-*•`"'(]+|(\(\))?[`"'),.:]*$/g, ""))
    .filter((w) => w.length > 1);

/**
 * Search terms from the model's first reply line, tolerating quotes, bullets and `fn()`. Small
 * models sometimes echo the question instead: then there are no terms, and the full-text search
 * of the question does the work.
 */
export function parseKeywords(reply: string, question: string): string[] {
  const terms = [...new Set(words(reply.split("\n")[0] ?? ""))];
  const asked = new Set(words(question.toLowerCase()));
  const echoed = terms.filter((t) => asked.has(t.toLowerCase())).length;
  return echoed > terms.length / 2 ? [] : terms.slice(0, MAX_KEYWORDS);
}

/** First hits of distinct pages, in order: one passage per page. */
export function pickPages(hits: SearchHit[], max = MAX_PASSAGES): SearchHit[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const [page = ""] = hit.path.split("#");
    if (seen.has(page) || seen.size >= max) return false;
    seen.add(page);
    return true;
  });
}

export function answerInstructions(doc: string): string {
  return [
    `You answer programming questions using only the ${doc} documentation passages provided.`,
    "- Answer in the language of the question.",
    "- Be brief: a short explanation, then one code example when it helps.",
    "- Use only facts from the passages. If they do not answer the question, say so plainly",
    "  instead of guessing.",
    "- Never write URLs or links: the sources are shown under your answer.",
  ].join("\n");
}

export interface Passage {
  title: string;
  text: string;
}

export function answerPrompt(question: string, passages: Passage[]): string {
  const context = passages
    .map((p, i) => `<passage ${i + 1}: ${p.title}>\n${p.text}\n</passage>`)
    .join("\n\n");
  return `${context}\n\nQuestion: ${question}`;
}
