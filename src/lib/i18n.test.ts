/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { completeness, flagOf, LANGUAGES, type Messages, translate } from "@/lib/i18n";
import en from "@/locales/en.json";

const localesDir = join(__dirname, "../locales");
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join();

describe("translate", () => {
  it("fills placeholders and falls back to English", () => {
    expect(translate({ "chat.sources": "Sources ({doc}) :" }, "chat.sources", { doc: "Go" })).toBe(
      "Sources (Go) :",
    );
    expect(translate({}, "chat.sources", { doc: "Go" })).toBe("Sources (Go):");
    expect(translate({ "chat.send": "  " }, "chat.send")).toBe("Send");
  });
});

describe("flagOf", () => {
  it("uses the region of the code, else the usual country, else a globe", () => {
    expect(flagOf("fr")).toBe("🇫🇷");
    expect(flagOf("pt-BR")).toBe("🇧🇷");
    expect(flagOf("zh-CN")).toBe("🇨🇳");
    expect(flagOf("xx")).toBe("🌐");
  });
});

describe("completeness", () => {
  it("is 100 only when every message is translated", () => {
    expect(completeness(en)).toBe(100);
    expect(completeness({})).toBe(0);
    const almost: Messages = { ...en };
    delete almost["chat.send"];
    expect(completeness(almost)).toBe(99);
  });
});

describe("locale files", () => {
  const files = readdirSync(localesDir).filter((f) => f.endsWith(".json"));

  it("are all listed as languages", () => {
    expect(LANGUAGES.map((l) => l.code).sort()).toEqual(files.map((f) => f.slice(0, -5)).sort());
  });

  for (const file of files) {
    it(`${file} only has known keys, with the same placeholders as English`, () => {
      const messages = JSON.parse(readFileSync(join(localesDir, file), "utf8")) as Record<
        string,
        string
      >;
      for (const [key, text] of Object.entries(messages)) {
        expect(key in en, `unknown key ${key}`).toBe(true);
        if (text.trim()) {
          expect(placeholders(text), key).toBe(placeholders(en[key as keyof typeof en]));
        }
      }
    });
  }
});

describe("keys in the code", () => {
  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) sources.push(path);
    }
  };
  walk(join(__dirname, ".."));
  const used = new Set(
    sources.flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/\bt\(\s*"([\w.]+)"/g)].map((m) => m[1] as string),
    ),
  );

  it("all exist in English", () => {
    expect([...used].filter((k) => !(k in en))).toEqual([]);
  });

  it("are all used (no dead messages)", () => {
    expect(Object.keys(en).filter((k) => !used.has(k))).toEqual([]);
  });
});
