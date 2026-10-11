import { listen } from "@tauri-apps/api/event";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { DocIcon } from "@/components/DocIcon";
import { RemoveAllButton } from "@/components/settings/RemoveAllButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { docTitle, formatBytes, formatCheckedAt } from "@/lib/format";
import { t, useLanguage } from "@/lib/i18n";
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

const PAGE_SIZE = 8;

export function DocsManager() {
  useLanguage();
  const [overview, setOverview] = useState<DocsOverview | null>(null);
  const [settings, setLocalSettings] = useState<Settings | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [installedPage, setInstalledPage] = useState(0);
  const [availablePage, setAvailablePage] = useState(0);
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
      setError(`${t("docs.errCheck")}: ${e}`);
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
      setError(`${t("docs.errInstall", { name: docTitle(doc) })}: ${e}`);
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
      setError(`${t("docs.errRemove", { name: docTitle(doc) })}: ${e}`);
    }
  }

  async function removeAll() {
    setError(null);
    try {
      for (const { entry } of overview?.installed ?? []) {
        await removeDoc(entry.slug);
      }
    } catch (e) {
      setError(`${t("docs.errRemoveAll")}: ${e}`);
    }
    await reload();
  }

  async function toggleAutoUpdate(enabled: boolean) {
    setLocalSettings((s) => s && { ...s, auto_update_docs: enabled });
    try {
      // Read fresh settings: the model manager may have changed the active model.
      await setSettings({ ...(await getSettings()), auto_update_docs: enabled });
    } catch (e) {
      setError(`${t("docs.errSettings")}: ${e}`);
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
            {t("common.documentation")}
          </h2>
          <p className="text-muted-foreground text-xs">
            {t("docs.lastChecked", { when: formatCheckedAt(overview?.checked_at ?? 0) })}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={checkNow} disabled={checking}>
          <RefreshCw className={checking ? "animate-spin" : undefined} /> {t("docs.checkNow")}
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
        <Label htmlFor={autoUpdateId}>{t("docs.autoUpdate")}</Label>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium text-sm">{t("common.installed")}</h3>
          {overview?.installed.length ? (
            <RemoveAllButton
              confirm={t("docs.deleteAll", {
                size: formatBytes(overview.installed.reduce((sum, d) => sum + d.entry.db_size, 0)),
              })}
              onConfirm={removeAll}
            />
          ) : null}
        </div>
        {overview?.installed.length ? (
          <ul className="divide-y rounded-md border">
            {page(overview.installed, installedPage).map(
              ({ entry, update_available, newer_version }) => (
                <DocRow key={entry.slug} doc={entry} progress={progress[entry.slug]}>
                  {newer_version && (
                    <span className="text-muted-foreground text-xs">
                      {t("docs.newer", { name: entry.name, version: newer_version })}
                    </span>
                  )}
                  {update_available && (
                    <>
                      <Badge variant="secondary">{t("docs.updateAvailable")}</Badge>
                      <Button size="sm" onClick={() => install(entry)}>
                        {t("common.update")}
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => remove(entry)}>
                    {t("common.remove")}
                  </Button>
                </DocRow>
              ),
            )}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t("docs.none")}</p>
        )}
        <Pager
          page={installedPage}
          total={overview?.installed.length ?? 0}
          onChange={setInstalledPage}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={searchId}>{t("docs.available")}</Label>
        <Input
          id={searchId}
          type="search"
          placeholder={t("docs.searchPlaceholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAvailablePage(0);
          }}
        />
        {overview && overview.available.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("docs.listMissing")}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {page(matches, availablePage).map((doc) => (
              <DocRow key={doc.slug} doc={doc} progress={progress[doc.slug]}>
                <Button size="sm" variant="outline" onClick={() => install(doc)}>
                  {t("common.install")}
                </Button>
              </DocRow>
            ))}
          </ul>
        )}
        <Pager page={availablePage} total={matches.length} onChange={setAvailablePage} />
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
  useLanguage();
  const title = docTitle(doc);
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2">
      <DocIcon slug={doc.slug} name={doc.name} className="size-5" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">{title}</p>
        <p className="text-muted-foreground text-xs">{formatBytes(doc.db_size)}</p>
      </div>
      {progress === undefined ? (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      ) : (
        <Progress
          value={progress}
          className="w-32"
          aria-label={t("common.installing", { name: title })}
        />
      )}
    </li>
  );
}

const lastPage = (total: number) => Math.max(Math.ceil(total / PAGE_SIZE) - 1, 0);

/** Items of page `index`, clamped: removing the last doc of a page leaves it past the end. */
const page = <T,>(items: T[], index: number) => {
  const i = Math.min(index, lastPage(items.length));
  return items.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE);
};

interface PagerProps {
  page: number;
  total: number;
  onChange: (page: number) => void;
}

/** Previous/next buttons under a list; nothing when everything fits on one page. */
function Pager({ page, total, onChange }: PagerProps) {
  useLanguage();
  const last = lastPage(total);
  const current = Math.min(page, last);
  if (last === 0) return null;
  return (
    <nav aria-label={t("docs.pagination")} className="flex items-center justify-end gap-2 text-xs">
      <span className="text-muted-foreground">
        {t("docs.range", {
          from: current * PAGE_SIZE + 1,
          to: Math.min((current + 1) * PAGE_SIZE, total),
          total,
        })}
      </span>
      <Button
        size="icon-sm"
        variant="outline"
        aria-label={t("docs.prevPage")}
        disabled={current === 0}
        onClick={() => onChange(current - 1)}
      >
        <ChevronLeft />
      </Button>
      <Button
        size="icon-sm"
        variant="outline"
        aria-label={t("docs.nextPage")}
        disabled={current >= last}
        onClick={() => onChange(current + 1)}
      >
        <ChevronRight />
      </Button>
    </nav>
  );
}
