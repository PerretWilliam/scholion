import { openUrl } from "@tauri-apps/plugin-opener";
import DOMPurify from "dompurify";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import type { Page } from "@/lib/ipc";

interface DocPageProps {
  slug: string;
  page: Page;
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

export function DocPage({ slug, page, onBack, onNavigate }: DocPageProps) {
  // DevDocs HTML is third-party content rendered next to the IPC bridge: always sanitize.
  const html = useMemo(() => DOMPurify.sanitize(page.html), [page.html]);

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
          <ArrowLeft /> Results
        </Button>
        <Button variant="outline" size="sm" onClick={() => openUrl(page.url)}>
          <ExternalLink /> Open on devdocs.io
        </Button>
      </div>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: delegates clicks on links, which are keyboard-activatable themselves. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: same as above. */}
      <div
        className="prose prose-sm dark:prose-invert prose-code:before:content-none prose-code:after:content-none max-w-none"
        onClick={handleClick}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify above.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  );
}
