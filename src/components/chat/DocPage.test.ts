import { describe, expect, it } from "vitest";
import { resolveDocLink } from "@/components/chat/DocPage";

const pageUrl = "https://devdocs.io/c/string/byte/strcpy";

describe("resolveDocLink", () => {
  it("keeps relative links inside the doc", () => {
    expect(resolveDocLink("../../header/string", "c", pageUrl)).toEqual({
      kind: "page",
      path: "header/string",
    });
    expect(resolveDocLink("memcpy#Example", "c", pageUrl)).toEqual({
      kind: "page",
      path: "string/byte/memcpy#Example",
    });
  });

  it("scrolls for same-page anchors", () => {
    expect(resolveDocLink("#Parameters", "c", pageUrl)).toEqual({
      kind: "anchor",
      id: "Parameters",
    });
  });

  it("opens other sites externally and ignores other schemes", () => {
    expect(resolveDocLink("https://en.cppreference.com/w/c", "c", pageUrl)).toEqual({
      kind: "external",
      url: "https://en.cppreference.com/w/c",
    });
    expect(resolveDocLink("/python~3.15/library/os", "c", pageUrl)).toEqual({
      kind: "external",
      url: "https://devdocs.io/python~3.15/library/os",
    });
    expect(resolveDocLink("javascript:alert(1)", "c", pageUrl)).toBeNull();
  });
});
