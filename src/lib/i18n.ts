// Interface translations. `src/locales/en.json` is the reference; every other `<code>.json` in that
// folder is a language, picked up automatically. Missing keys fall back to English.
import { useSyncExternalStore } from "react";
import en from "@/locales/en.json";

export type MessageKey = keyof typeof en;
export type Messages = Partial<Record<MessageKey, string>>;
type Vars = Record<string, string | number>;

const files = import.meta.glob<Messages>("../locales/*.json", { eager: true, import: "default" });
const catalogs: Record<string, Messages> = Object.fromEntries(
  Object.entries(files).map(([path, messages]) => [path.match(/([^/]+)\.json$/)?.[1], messages]),
);

/** The text of `key` in `messages`, else English, with `{name}` placeholders filled in. */
export function translate(messages: Messages, key: MessageKey, vars?: Vars): string {
  const text = messages[key]?.trim() ? messages[key] : en[key];
  return vars ? text.replace(/\{(\w+)\}/g, (all, name) => String(vars[name] ?? all)) : text;
}

/** Share of the English messages a language has, rounded down: 100 only when it is complete. */
export function completeness(messages: Messages): number {
  const keys = Object.keys(en) as MessageKey[];
  return Math.floor((keys.filter((k) => messages[k]?.trim()).length / keys.length) * 100);
}

/** Languages by name, each in its own language, with how much of the interface it covers. */
export const LANGUAGES = Object.entries(catalogs)
  .map(([code, messages]) => {
    let name = code;
    try {
      const own = new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
      name = own.charAt(0).toLocaleUpperCase(code) + own.slice(1);
    } catch {
      // An engine without that language name: the code stands in.
    }
    return { code, name, percent: completeness(messages) };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const STORAGE_KEY = "scholion.language";

/** Exact code first (`zh-CN`), then the same base language (`pt-BR` → `pt`). */
function closest(tag: string): string | undefined {
  const lower = tag.toLowerCase();
  const codes = Object.keys(catalogs);
  return (
    codes.find((c) => c.toLowerCase() === lower) ??
    codes.find((c) => c.split("-")[0]?.toLowerCase() === lower.split("-")[0])
  );
}

function initialLanguage(): string {
  try {
    const saved = typeof window === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
    if (saved && saved in catalogs) return saved;
  } catch {
    // No storage (private window): fall through to the system language.
  }
  const system = typeof navigator === "undefined" ? [] : navigator.languages;
  return system.map(closest).find(Boolean) ?? "en";
}

let current = initialLanguage();
const listeners = new Set<() => void>();
if (typeof document !== "undefined") document.documentElement.lang = current;

export const currentLanguage = () => current;

export function setLanguage(code: string) {
  if (!(code in catalogs)) return;
  current = code;
  try {
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // The choice just does not survive a restart.
  }
  if (typeof document !== "undefined") document.documentElement.lang = code;
  for (const listener of listeners) listener();
}

export const t = (key: MessageKey, vars?: Vars) => translate(catalogs[current] ?? {}, key, vars);

/** Re-renders the component when the language changes. Call it in components that show text. */
export function useLanguage(): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
