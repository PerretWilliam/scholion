import { openUrl } from "@tauri-apps/plugin-opener";
import DOMPurify from "dompurify";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ExternalLink,
  Maximize2,
  Minimize2,
  Search,
  X,
} from "lucide-react";
import { createContext, useEffect, useMemo, useRef, useState } from "react";
import { codeToHtml } from "shiki";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t, useLanguage } from "@/lib/i18n";
import type { Page } from "@/lib/ipc";

/** Opens a page of an installed doc (entry path) in the reader next to the chat. */
export const OpenDocContext = createContext<(slug: string, path: string) => void>(() => {});

/** Entry path of a DevDocs page URL, as built by `page_url` in Rust. */
export function entryPath(slug: string, url: string): string {
  return url.slice(`${DEVDOCS_ORIGIN}/${slug}/`.length);
}

interface DocPageProps {
  slug: string;
  page: Page;
  /** Label of the back button. */
  backLabel?: string;
  /** Shows a button to fill the window, or to leave it again when `expanded`. */
  expanded?: boolean;
  onToggleExpanded?: () => void;
  onBack: () => void;
  /** Opens another page of the same doc, given its entry path. */
  onNavigate: (path: string) => void;
}

const DEVDOCS_ORIGIN = "https://devdocs.io";

/**
 * Where a link inside a DevDocs page leads: another page of this doc, an anchor on this page,
 * or an external URL. Relative links resolve against the page's devdocs.io URL.
 */
export function resolveDocLink(
  href: string,
  slug: string,
  pageUrl: string,
):
  | { kind: "anchor"; id: string }
  | { kind: "page"; path: string }
  | { kind: "external"; url: string }
  | null {
  let target: URL;
  try {
    target = new URL(href, pageUrl);
  } catch {
    return null;
  }
  const current = new URL(pageUrl);
  if (target.origin === current.origin && target.pathname === current.pathname && target.hash) {
    return { kind: "anchor", id: decodeURIComponent(target.hash.slice(1)) };
  }
  const prefix = `/${slug}/`;
  if (target.origin === DEVDOCS_ORIGIN && target.pathname.startsWith(prefix)) {
    return { kind: "page", path: target.pathname.slice(prefix.length) + target.hash };
  }
  if (target.protocol === "https:" || target.protocol === "http:") {
    return { kind: "external", url: target.href };
  }
  return null;
}

/** Offsets of every case-insensitive occurrence of `query` in `text`. */
export function matchOffsets(text: string, query: string): number[] {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const offsets: number[] = [];
  for (let i = q ? t.indexOf(q) : -1; i >= 0; i = t.indexOf(q, i + q.length)) offsets.push(i);
  return offsets;
}

const MAX_MATCHES = 1000;

/** An element of the displayed page by id: the app has ids of its own. */
const inPage = (root: HTMLElement | null, id: string) =>
  root?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);

/** One range per match inside a single text node: a match split by a tag is not found. */
function findRanges(root: HTMLElement, query: string): Range[] {
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (
    let node = walker.nextNode();
    node && ranges.length < MAX_MATCHES;
    node = walker.nextNode()
  ) {
    for (const start of matchOffsets(node.nodeValue ?? "", query)) {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + query.length);
      ranges.push(range);
    }
  }
  return ranges;
}

/** The WebView may predate the CSS Custom Highlight API: then there is no find bar. */
const canFind = typeof CSS !== "undefined" && "highlights" in CSS;

function clearFind() {
  CSS.highlights.delete("find");
  CSS.highlights.delete("find-current");
}

/** Code blocks longer than this stay plain: highlighting them would freeze the window. */
const MAX_HIGHLIGHT_CHARS = 20_000;

/**
 * Colors the `<pre data-language>` blocks of a rendered page, following the OS color scheme.
 * Unknown languages stay plain.
 */
async function highlightCode(root: HTMLElement, isStale: () => boolean) {
  for (const pre of root.querySelectorAll<HTMLElement>("pre[data-language]")) {
    const code = pre.textContent ?? "";
    if (code.length > MAX_HIGHLIGHT_CHARS) continue;
    try {
      const colored = await codeToHtml(code, {
        lang: pre.dataset.language ?? "text",
        themes: { light: "github-light", dark: "github-dark" },
        defaultColor: false,
        structure: "inline",
      });
      if (isStale()) return;
      pre.innerHTML = colored;
      pre.classList.add("shiki");
    } catch {
      // A language shiki does not know: the block stays plain text.
    }
  }
}

export function DocPage({
  slug,
  page,
  backLabel,
  expanded,
  onToggleExpanded,
  onBack,
  onNavigate,
}: DocPageProps) {
  useLanguage();
  // DevDocs HTML is third-party content rendered next to the IPC bridge: always sanitize.
  const html = useMemo(
    () => DOMPurify.sanitize(page.html, { FORBID_TAGS: ["style", "form"], FORBID_ATTR: ["style"] }),
    [page.html],
  );

  const body = useRef<HTMLDivElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  /** Text search in the page: null while the bar is closed. */
  const [find, setFind] = useState<{ query: string; current: number } | null>(null);
  const [matches, setMatches] = useState(0);
  /** Bumped each time the ranges are recomputed, even when their number stays the same. */
  const [generation, setGeneration] = useState(0);
  const ranges = useRef<Range[]>([]);
  /** Bumped when highlighted code replaces text nodes, which invalidates the ranges. */
  const [highlighted, setHighlighted] = useState(0);

  // An entry path can point into a long page: show that section. Highlighting changes the
  // height of the blocks above it, so the scroll waits for it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per page.
  useEffect(() => {
    let stale = false;
    const id = decodeURIComponent(new URL(page.url).hash.slice(1));
    const show = () => id && inPage(body.current, id)?.scrollIntoView();
    show();
    if (body.current)
      highlightCode(body.current, () => stale).then(() => {
        if (stale) return;
        show();
        setHighlighted((n) => n + 1);
      });
    return () => {
      stale = true;
    };
  }, [html]);

  const query = find?.query;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `html` and `highlighted` change the text nodes.
  useEffect(() => {
    if (!canFind || !body.current || !query) {
      ranges.current = [];
      setMatches(0);
      return;
    }
    ranges.current = findRanges(body.current, query);
    setMatches(ranges.current.length);
    setGeneration((g) => g + 1);
    CSS.highlights.set("find", new Highlight(...ranges.current));
    return clearFind;
  }, [query, html, highlighted]);

  const current = find?.current ?? 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `generation` marks new ranges.
  useEffect(() => {
    const range = ranges.current[current];
    if (!canFind || !range) return;
    CSS.highlights.set("find-current", new Highlight(range));
    range.startContainer.parentElement?.scrollIntoView({ block: "center" });
  }, [current, generation]);

  // ⌘/Ctrl+F opens the find bar instead of the webview's own, which does not exist.
  useEffect(() => {
    if (!canFind) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFind((f) => f ?? { query: "", current: 0 });
        searchField.current?.focus();
        searchField.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function step(delta: number) {
    if (matches === 0) return;
    setFind((f) => f && { ...f, current: (f.current + delta + matches) % matches });
  }

  function handleClick(event: React.MouseEvent<HTMLElement>) {
    const anchor = (event.target as HTMLElement).closest("a");
    const href = anchor?.getAttribute("href");
    if (!href) return;
    // Never let the webview navigate away from the app.
    event.preventDefault();
    const link = resolveDocLink(href, slug, page.url);
    if (link?.kind === "anchor") {
      inPage(body.current, link.id)?.scrollIntoView();
    } else if (link?.kind === "page") {
      onNavigate(link.path);
    } else if (link?.kind === "external") {
      openUrl(link.url);
    }
  }

  return (
    <article className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft /> {backLabel ?? t("page.back")}
        </Button>
        <div className="flex gap-2">
          {canFind && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFind((f) => (f ? null : { query: "", current: 0 }))}
              aria-pressed={!!find}
            >
              <Search /> {t("page.find")}
            </Button>
          )}
          {onToggleExpanded && (
            <Button variant="outline" size="sm" onClick={onToggleExpanded}>
              {expanded ? <Minimize2 /> : <Maximize2 />}
              {expanded ? t("page.exitFullScreen") : t("page.fullScreen")}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => openUrl(page.url)}>
            <ExternalLink /> {t("page.openWeb")}
          </Button>
        </div>
      </div>
      {find && (
        <div className="sticky top-0 z-10 flex items-center gap-1 rounded-md border bg-background p-1 shadow-sm">
          <Input
            ref={searchField}
            type="search"
            aria-label={t("page.findLabel")}
            placeholder={t("page.findPlaceholder")}
            className="h-8 flex-1"
            value={find.query}
            autoFocus
            onChange={(e) => setFind({ query: e.target.value, current: 0 })}
            onKeyDown={(e) => {
              if (e.key === "Enter") step(e.shiftKey ? -1 : 1);
              if (e.key === "Escape") {
                // Not also leaving full screen.
                e.stopPropagation();
                setFind(null);
              }
            }}
          />
          <span className="min-w-14 text-center text-muted-foreground text-xs" aria-live="polite">
            {find.query && (matches ? `${current + 1} / ${matches}` : t("page.noMatch"))}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("page.prevMatch")}
            onClick={() => step(-1)}
          >
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("page.nextMatch")}
            onClick={() => step(1)}
          >
            <ArrowDown />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("page.closeFind")}
            onClick={() => setFind(null)}
          >
            <X />
          </Button>
        </div>
      )}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: delegates clicks on links, which are keyboard-activatable themselves. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: same as above. */}
      <div
        className="prose prose-sm dark:prose-invert prose-pre:border prose-pre:bg-muted prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none max-w-none"
        ref={body}
        onClick={handleClick}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify above.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  );
}
