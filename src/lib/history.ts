// Conversation history, stored by Rust in `history.json` in the app data folder.
import type { ChatMessage } from "@/lib/chat-transport";
import { getHistory, setHistory } from "@/lib/ipc";

/** Where versions before the history file kept the conversations. */
const LEGACY_KEY = "scholion.conversations";
const TITLE_CHARS = 50;

export interface Conversation {
  id: string;
  title: string;
  updatedAt: number;
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
