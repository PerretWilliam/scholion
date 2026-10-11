import { openUrl } from "@tauri-apps/plugin-opener";
import DOMPurify from "dompurify";
import { ArrowLeft, ExternalLink, Maximize2, Minimize2 } from "lucide-react";
import { createContext, useEffect, useMemo, useRef } from "react";
import { codeToHtml } from "shiki";
import { Button } from "@/components/ui/button";
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
  backLabel = "Results",
  expanded,
  onToggleExpanded,
  onBack,
  onNavigate,
}: DocPageProps) {
  // DevDocs HTML is third-party content rendered next to the IPC bridge: always sanitize.
  const html = useMemo(() => DOMPurify.sanitize(page.html), [page.html]);

  const body = useRef<HTMLDivElement>(null);

  // An entry path can point into a long page: show that section. Highlighting changes the
  // height of the blocks above it, so the scroll waits for it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per page.
  useEffect(() => {
    let stale = false;
    const id = decodeURIComponent(new URL(page.url).hash.slice(1));
    const show = () => id && document.getElementById(id)?.scrollIntoView();
    show();
    if (body.current) highlightCode(body.current, () => stale).then(() => !stale && show());
    return () => {
      stale = true;
    };
  }, [html]);

  function handleClick(event: React.MouseEvent<HTMLElement>) {
    const anchor = (event.target as HTMLElement).closest("a");
    const href = anchor?.getAttribute("href");
    if (!href) return;
    // Never let the webview navigate away from the app.
    event.preventDefault();
    const link = resolveDocLink(href, slug, page.url);
    if (link?.kind === "anchor") {
      document.getElementById(link.id)?.scrollIntoView();
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
          <ArrowLeft /> {backLabel}
        </Button>
        <div className="flex gap-2">
          {onToggleExpanded && (
            <Button variant="outline" size="sm" onClick={onToggleExpanded}>
              {expanded ? <Minimize2 /> : <Maximize2 />}
              {expanded ? "Exit full screen" : "Full screen"}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => openUrl(page.url)}>
            <ExternalLink /> Open on devdocs.io
          </Button>
        </div>
      </div>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: delegates clicks on links, which are keyboard-activatable themselves. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: same as above. */}
      <div
        className="prose prose-sm dark:prose-invert prose-code:before:content-none prose-code:after:content-none max-w-none"
        ref={body}
        onClick={handleClick}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify above.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  );
}
