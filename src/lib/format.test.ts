import { describe, expect, it } from "vitest";
import { docTitle, formatBytes } from "@/lib/format";
import type { DocEntry } from "@/lib/ipc";

const doc = (overrides: Partial<DocEntry>): DocEntry => ({
  name: "C",
  slug: "c",
  type: "cppref",
  version: "",
  release: null,
  mtime: 0,
  db_size: 0,
  attribution: "",
  alias: null,
  links: {},
  ...overrides,
});

describe("formatBytes", () => {
  it("uses decimal units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(5_128_537)).toBe("5.1 MB");
    expect(formatBytes(2_740_000_000)).toBe("2.7 GB");
  });
});

describe("docTitle", () => {
  it("prefers the release, falls back to version, then name only", () => {
    expect(docTitle(doc({ name: "Python", version: "3.15", release: "3.15.0" }))).toBe(
      "Python 3.15.0",
    );
    expect(docTitle(doc({ name: "Go", version: "1.25" }))).toBe("Go 1.25");
    expect(docTitle(doc({}))).toBe("C");
  });
});
