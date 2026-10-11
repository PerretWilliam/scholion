import { Search } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { DocPage } from "@/components/chat/DocPage";
import { Input } from "@/components/ui/input";
import { t, useLanguage } from "@/lib/i18n";
import { type DocEntry, getPage, type Page, type SearchHit, searchDoc } from "@/lib/ipc";

/** Waits for a pause in typing before querying. */
const SEARCH_DELAY_MS = 150;

/** "Search only" mode: browse doc entries directly, no model involved. */
export function DocSearch({ docs, slug }: { docs: DocEntry[] | null; slug: string }) {
  useLanguage();
  const [query, setQuery] = useState("");
  // Results remember their query so "No results" only shows once the search really returned.
  const [results, setResults] = useState<{ query: string; hits: SearchHit[] }>({
    query: "",
    hits: [],
  });
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchId = useId();

  // A page belongs to one doc: close it when the doc changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on slug change only.
  useEffect(() => setPage(null), [slug]);

  useEffect(() => {
    if (!slug || !query.trim()) {
      setResults({ query, hits: [] });
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      searchDoc(slug, query)
        .then((hits) => {
          if (!stale) {
            setResults({ query, hits });
            setError(null);
          }
        })
        .catch((e) => !stale && setError(String(e)));
    }, SEARCH_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [slug, query]);

  async function openPage(path: string) {
    try {
      setPage(await getPage(slug, path));
      setError(null);
    } catch (e) {
      setError(`${t("chat.errOpenPage")}: ${e}`);
    }
  }

  if (docs?.length === 0) {
    return <p className="p-8 text-center text-muted-foreground text-sm">{t("search.noDocs")}</p>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <label htmlFor={searchId} className="sr-only">
            {t("search.label")}
          </label>
          <Input
            id={searchId}
            type="search"
            className="pl-8"
            placeholder={t("search.placeholder")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(null);
            }}
            autoFocus
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {page ? (
        <DocPage slug={slug} page={page} onBack={() => setPage(null)} onNavigate={openPage} />
      ) : (
        <ul className="divide-y" aria-label={t("search.results")}>
          {results.hits.map((hit) => (
            <li key={`${hit.path}|${hit.name}`}>
              <button
                type="button"
                className="flex w-full items-baseline justify-between gap-4 px-2 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                onClick={() => openPage(hit.path)}
              >
                <span className="font-mono text-sm">{hit.name}</span>
                <span className="shrink-0 text-muted-foreground text-xs">{hit.type}</span>
              </button>
            </li>
          ))}
          {query.trim() && results.query === query && results.hits.length === 0 && (
            <li className="px-2 py-2 text-muted-foreground text-sm">{t("search.none")}</li>
          )}
        </ul>
      )}
    </div>
  );
}
