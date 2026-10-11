// Prompts for the local model, and the pure helpers around them. See docs/spec.md, "Answer generation".
import type { SearchHit } from "@/lib/ipc";

/** Pages given to the model per answer. Their size is capped in Rust (`PASSAGE_CHARS`). */
export const MAX_PASSAGES = 4;
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

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

/** Earlier turns kept to resolve a follow-up question, and the characters kept of each. */
export const REWRITE_TURNS = 4;
const REWRITE_TURN_CHARS = 400;

export function rewriteInstructions(doc: string): string {
  return [
    `You prepare a question for a search in the ${doc} documentation.`,
    "Rewrite the latest question as one standalone question, in the same language, replacing",
    'references to the conversation ("and with a dict?", "it", "that one") by what they mean.',
    "If it already stands alone, repeat it unchanged. Reply with the question only.",
  ].join("\n");
}

export function rewritePrompt(history: Turn[], question: string): string {
  const turns = history
    .slice(-REWRITE_TURNS)
    .map(
      (t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text.slice(0, REWRITE_TURN_CHARS)}`,
    )
    .join("\n");
  return `Conversation:\n${turns}\n\nLatest question: ${question}`;
}

/** The rewritten question, or the original when the model returned nothing usable. */
export function parseRewrite(reply: string, question: string): string {
  const line = reply
    .split("\n")
    .map((l) =>
      l
        .replace(/^\s*(?:Standalone question|Question)\s*:\s*/i, "")
        .replace(/^["'`]+|["'`]+$/g, "")
        .trim(),
    )
    .find(Boolean);
  return line && line.length <= 300 ? line : question;
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
    `You write documentation-style answers to programming questions, using only the ${doc} documentation passages provided.`,
    "- Answer in the language of the question, headings included, even though the passages are in",
    "  English. Translate the headings below; never answer in English to a question in French.",
    "- Explain, do not just show code. Think about what this developer needs to use the answer",
    "  correctly, then write short sections, each with a `###` heading, that cover it. Typical",
    "  sections, to adapt to the question and not to follow blindly:",
    "  the exact signature or syntax in a code block; what it does and when to use it; how it",
    "  works (every parameter one by one with its default, the return value, rules, edge cases,",
    "  errors); complete commented examples for each important use, with the language after the",
    "  opening fence, for example ```python.",
    "- Complexity, performance and similar notes only fit some topics (functions, algorithms, data",
    "  structures). Include them when they apply, from the passages or from standard knowledge",
    '  marked "(general knowledge)". When they do not apply, or you cannot state them reliably,',
    "  leave them out and use that space for what helps more here: pitfalls and common mistakes,",
    "  differences with a close alternative, related functions, version or platform notes,",
    "  or when not to use it. Never write a section just to fill the list.",
    "- Be complete and precise: do not leave out any detail of the passages that a developer needs",
    "  to use this correctly. No filler, no repetition.",
    "- Apart from the general knowledge above, use only facts from the passages. If they do not",
    "  answer the question, say so plainly instead of guessing.",
    "- Support each statement taken from a passage with its number in square brackets, for",
    "  example [1] or [2][3], placed after the statement. A statement that no passage supports",
    '  is either left out or marked "(general knowledge)". Never cite a passage you did not use.',
    "- Never write URLs or links: the sources are shown under your answer.",
  ].join("\n");
}

export const MAX_FOLLOW_UPS = 3;

export function followUpInstructions(doc: string): string {
  return [
    `Suggest ${MAX_FOLLOW_UPS} short follow-up questions a developer could ask next about the ${doc} documentation.`,
    "One question per line, in the language of the question. No numbering, no other text.",
  ].join("\n");
}

/** The question and the start of the answer: enough for follow-ups, small for the context. */
export function followUpPrompt(question: string, answer: string): string {
  return `Question: ${question}\n\nAnswer:\n${answer.slice(0, 800)}`;
}

/** Question lines of the model's reply, without bullets or numbering. */
export function parseFollowUps(reply: string): string[] {
  const questions = reply
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/^["'`]+|["'`]+$/g, ""))
    .filter((line) => line.length >= 8 && line.length <= 120 && line.endsWith("?"));
  return [...new Set(questions)].slice(0, MAX_FOLLOW_UPS);
}

export interface Passage {
  title: string;
  text: string;
}

export function answerPrompt(question: string, passages: Passage[]): string {
  const context = passages
    .map((p, i) => `<passage ${i + 1}: ${p.title}>\n${p.text}\n</passage>`)
    .join("\n\n");
  // The reminder comes last because small models follow the end of the prompt most closely.
  return `${context}\n\nQuestion: ${question}\n\nAnswer in the language of the question above, not in English unless the question is in English.`;
}
