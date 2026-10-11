import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Chat } from "@/components/chat/Chat";
import { DocSearch } from "@/components/chat/DocSearch";
import { DocActions } from "@/components/chat/InstallDocCard";
import { Button } from "@/components/ui/button";
import type { ChatContext } from "@/lib/chat-transport";
import { docTitle } from "@/lib/format";
import { type DocEntry, getDocs, getModels } from "@/lib/ipc";

type Mode = "ask" | "search";

/** Main screen: doc picker, then the chat ("Ask") or the "Search only" mode. */
export function ChatScreen({ visible }: { visible: boolean }) {
  const [docs, setDocs] = useState<DocEntry[] | null>(null);
  const [slug, setSlug] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("ask");
  const [error, setError] = useState<string | null>(null);
  const docSelectId = useId();

  const reloadDocs = useCallback(async () => {
    const [{ installed }, { active }] = await Promise.all([getDocs(), getModels()]);
    const entries = installed.map((d) => d.entry);
    setDocs(entries);
    setSlug((current) =>
      entries.some((d) => d.slug === current) ? current : (entries[0]?.slug ?? ""),
    );
    setModel(active);
  }, []);

  // Docs and models change in Settings: refresh whenever the screen shows again.
  useEffect(() => {
    if (visible) reloadDocs().catch((e) => setError(String(e)));
  }, [visible, reloadDocs]);

  const context = useRef<ChatContext>({ slug, model, selectDoc: setSlug });
  context.current = { slug, model, selectDoc: setSlug };
  const actions = useMemo(() => ({ reloadDocs, selectDoc: setSlug }), [reloadDocs]);
  // Without a model, only Search works.
  const current: Mode = model ? mode : "search";

  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 px-6 pt-4">
        {docs && docs.length > 0 && (
          <>
            <label htmlFor={docSelectId} className="sr-only">
              Documentation
            </label>
            <select
              id={docSelectId}
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            >
              {docs.map((d) => (
                <option key={d.slug} value={d.slug}>
                  {docTitle(d)}
                </option>
              ))}
            </select>
          </>
        )}
        <fieldset className="ml-auto flex gap-1">
          <legend className="sr-only">Mode</legend>
          <Button
            size="sm"
            variant={current === "ask" ? "secondary" : "ghost"}
            aria-pressed={current === "ask"}
            disabled={!model}
            title={model ? undefined : "Download a model in Settings to get answers"}
            onClick={() => setMode("ask")}
          >
            Ask
          </Button>
          <Button
            size="sm"
            variant={current === "search" ? "secondary" : "ghost"}
            aria-pressed={current === "search"}
            onClick={() => setMode("search")}
          >
            Search only
          </Button>
        </fieldset>
      </div>
      {error && (
        <p role="alert" className="mx-auto w-full max-w-3xl px-6 pt-2 text-destructive text-sm">
          {error}
        </p>
      )}
      {/* Both stay mounted so the conversation survives switching modes. */}
      <div className="min-h-0 flex-1" hidden={current !== "ask"}>
        <DocActions value={actions}>
          <Chat context={context} />
        </DocActions>
      </div>
      <div className="min-h-0 flex-1 overflow-auto" hidden={current !== "search"}>
        <DocSearch docs={docs} slug={slug} />
      </div>
    </div>
  );
}
