// Conversation history, stored by Rust in `history.json` in the app data folder.
import type { ChatMessage, Sources } from "@/lib/chat-transport";
import { getHistory, setHistory } from "@/lib/ipc";

/** Where versions before the history file kept the conversations. */
const LEGACY_KEY = "scholion.conversations";
const TITLE_CHARS = 50;

export interface Conversation {
  id: string;
  title: string;
  updatedAt: number;
  /** True once the user renamed it: the title no longer follows the first question. */
  renamed?: boolean;
  /** Doc used for the last question; absent in conversations saved by older versions. */
  slug?: string;
  messages: ChatMessage[];
}

export async function loadConversations(): Promise<Conversation[]> {
  const saved = (await getHistory()) as Conversation[];
  if (saved.length > 0) return saved;
  const legacy = readLegacy();
  if (legacy.length > 0) {
    await setHistory(legacy);
    localStorage.removeItem(LEGACY_KEY);
  }
  return legacy;
}

function readLegacy(): Conversation[] {
  try {
    return JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "[]") as Conversation[];
  } catch {
    // Nothing to import from an unreadable old history.
    return [];
  }
}

let writes: Promise<unknown> = Promise.resolve();

/** Writes happen one after the other, so an older list never overwrites a newer one. */
export function saveConversations(list: Conversation[]): Promise<void> {
  const write = writes.then(() => setHistory(list));
  writes = write.catch(() => {});
  return write;
}

/** The first question, shortened. */
export function titleOf(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  const text = (first?.parts ?? [])
    .map((p) => (p.type === "text" ? p.text : ""))
    .join(" ")
    .trim();
  return text.length > TITLE_CHARS ? `${text.slice(0, TITLE_CHARS).trimEnd()}…` : text || "Chat";
}

/** Adds or replaces a conversation; the most recently updated comes first. */
export function upsert(list: Conversation[], conversation: Conversation): Conversation[] {
  return [conversation, ...list.filter((c) => c.id !== conversation.id)].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
}

const textOf = (m: ChatMessage) =>
  m.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n")
    .trim();

/** True when the title or any message contains `query`, ignoring case. */
export function matches(c: Conversation, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || [c.title, ...c.messages.map(textOf)].some((t) => t.toLowerCase().includes(q));
}

/** The conversation as a Markdown document, with the sources under each answer. */
export function toMarkdown(c: Conversation): string {
  const turns = c.messages.map((m) => {
    if (m.role === "user") return `## Question\n\n${textOf(m)}`;
    const sources = m.parts.find((p) => p.type === "data-sources") as { data: Sources } | undefined;
    const list = (sources?.data.pages ?? [])
      .map((p, i) => `[${i + 1}] [${p.title}](${p.url})`)
      .join("  \n");
    const footer = sources ? `\n\n**Sources (${sources.data.doc})**  \n${list}` : "";
    return `## Answer\n\n${textOf(m)}${footer}`;
  });
  return `# ${c.title}\n\n${turns.join("\n\n")}\n`;
}
