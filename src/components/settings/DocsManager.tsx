import { listen } from "@tauri-apps/api/event";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { docTitle, formatBytes, formatCheckedAt } from "@/lib/format";
import {
  checkDocUpdates,
  DOCS_CHANGED_EVENT,
  type DocEntry,
  type DocsOverview,
  getDocs,
  getSettings,
  installDoc,
  removeDoc,
  type Settings,
  setSettings,
} from "@/lib/ipc";

/** Keeps the available list short; users narrow it with the search box. */
const MAX_VISIBLE = 50;

export function DocsManager() {
  const [overview, setOverview] = useState<DocsOverview | null>(null);
  const [settings, setLocalSettings] = useState<Settings | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchId = useId();
  const autoUpdateId = useId();

  const reload = useCallback(async () => {
    try {
      setOverview(await getDocs());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    reload();
    getSettings()
      .then(setLocalSettings)
      .catch((e) => setError(String(e)));
    const unlisten = listen(DOCS_CHANGED_EVENT, reload);
    return () => {
      unlisten.then((stop) => stop());
    };
  }, [reload]);

  async function checkNow() {
    setChecking(true);
    setError(null);
    try {
      setOverview(await checkDocUpdates());
    } catch (e) {
      setError(`Could not check for updates: ${e}`);
    } finally {
      setChecking(false);
    }
  }

  async function install(doc: DocEntry) {
    setError(null);
    setProgress((p) => ({ ...p, [doc.slug]: 0 }));
    try {
      await installDoc(doc.slug, (percent) => setProgress((p) => ({ ...p, [doc.slug]: percent })));
      await reload();
    } catch (e) {
      setError(`Could not install ${docTitle(doc)}: ${e}`);
    } finally {
      setProgress(({ [doc.slug]: _, ...rest }) => rest);
    }
  }

  async function remove(doc: DocEntry) {
    setError(null);
    try {
      await removeDoc(doc.slug);
      await reload();
    } catch (e) {
      setError(`Could not remove ${docTitle(doc)}: ${e}`);
    }
  }

  async function toggleAutoUpdate(enabled: boolean) {
    setLocalSettings((s) => s && { ...s, auto_update_docs: enabled });
    try {
      // Read fresh settings: the model manager may have changed the active model.
      await setSettings({ ...(await getSettings()), auto_update_docs: enabled });
    } catch (e) {
      setError(`Could not save settings: ${e}`);
    }
  }

  const installedSlugs = useMemo(
    () => new Set(overview?.installed.map((d) => d.entry.slug)),
    [overview],
  );
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (overview?.available ?? []).filter(
      (d) =>
        !installedSlugs.has(d.slug) &&
        (!q ||
          d.name.toLowerCase().includes(q) ||
          d.slug.includes(q) ||
          d.alias?.toLowerCase() === q ||
          (d.release ?? d.version).includes(q)),
    );
  }, [overview, installedSlugs, query]);

  return (
    <section className="space-y-6" aria-labelledby="docs-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="docs-heading" className="font-semibold">
            Documentation
          </h2>
          <p className="text-muted-foreground text-xs">
            Doc list from DevDocs, last checked {formatCheckedAt(overview?.checked_at ?? 0)}.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={checkNow} disabled={checking}>
          <RefreshCw className={checking ? "animate-spin" : undefined} /> Check now
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Switch
          id={autoUpdateId}
          checked={settings?.auto_update_docs ?? false}
          disabled={!settings}
          onCheckedChange={toggleAutoUpdate}
        />
        <Label htmlFor={autoUpdateId}>Install doc updates automatically</Label>
      </div>

      <div className="space-y-2">
        <h3 className="font-medium text-sm">Installed</h3>
        {overview?.installed.length ? (
          <ul className="divide-y rounded-md border">
            {overview.installed.map(({ entry, update_available, newer_version }) => (
              <DocRow key={entry.slug} doc={entry} progress={progress[entry.slug]}>
                {newer_version && (
                  <span className="text-muted-foreground text-xs">
                    {entry.name} {newer_version} is available
                  </span>
                )}
                {update_available && (
                  <>
                    <Badge variant="secondary">Update available</Badge>
                    <Button size="sm" onClick={() => install(entry)}>
                      Update
                    </Button>
                  </>
                )}
                <Button size="sm" variant="ghost" onClick={() => remove(entry)}>
                  Remove
                </Button>
              </DocRow>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No docs installed yet.</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor={searchId}>Available</Label>
        <Input
          id={searchId}
          type="search"
          placeholder="Search languages, e.g. python, js, rust"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {overview && overview.available.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            The doc list has not been downloaded yet. Connect to the internet and click Check now.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {matches.slice(0, MAX_VISIBLE).map((doc) => (
              <DocRow key={doc.slug} doc={doc} progress={progress[doc.slug]}>
                <Button size="sm" variant="outline" onClick={() => install(doc)}>
                  Install
                </Button>
              </DocRow>
            ))}
          </ul>
        )}
        {matches.length > MAX_VISIBLE && (
          <p className="text-muted-foreground text-xs">
            Showing {MAX_VISIBLE} of {matches.length}. Refine your search to see more.
          </p>
        )}
      </div>
    </section>
  );
}

interface DocRowProps {
  doc: DocEntry;
  /** Download percentage while installing, undefined otherwise. */
  progress: number | undefined;
  /** Actions, hidden while installing. */
  children: React.ReactNode;
}

function DocRow({ doc, progress, children }: DocRowProps) {
  const title = docTitle(doc);
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">{title}</p>
        <p className="text-muted-foreground text-xs">{formatBytes(doc.db_size)}</p>
      </div>
      {progress === undefined ? (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      ) : (
        <Progress value={progress} className="w-32" aria-label={`Installing ${title}`} />
      )}
    </li>
  );
}
