// Conversation history, kept in the webview's localStorage (text only, a few KB per chat).
import type { ChatMessage } from "@/lib/chat-transport";

const KEY = "scholion.conversations";
const TITLE_CHARS = 50;

export interface Conversation {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
}

export function loadConversations(): Conversation[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Conversation[];
  } catch {
    // An unreadable history is dropped rather than blocking the app.
    return [];
  }
}

export function saveConversations(list: Conversation[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
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
