import { Search } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { DocPage } from "@/components/chat/DocPage";
import { Input } from "@/components/ui/input";
import { docTitle } from "@/lib/format";
import { type DocEntry, getDocs, getPage, type Page, type SearchHit, searchDoc } from "@/lib/ipc";

/** Waits for a pause in typing before querying. */
const SEARCH_DELAY_MS = 150;

/** "Search only" mode: browse doc entries directly, no model involved. */
export function DocSearch() {
  const [docs, setDocs] = useState<DocEntry[] | null>(null);
  const [slug, setSlug] = useState("");
  const [query, setQuery] = useState("");
  // Results remember their query so "No results" only shows once the search really returned.
  const [results, setResults] = useState<{ query: string; hits: SearchHit[] }>({
    query: "",
    hits: [],
  });
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const docSelectId = useId();
  const searchId = useId();

  useEffect(() => {
    getDocs()
      .then(({ installed }) => {
        const entries = installed.map((d) => d.entry);
        setDocs(entries);
        setSlug((current) => current || entries[0]?.slug || "");
      })
      .catch((e) => setError(String(e)));
  }, []);

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
      setError(`Could not open the page: ${e}`);
    }
  }

  if (docs?.length === 0) {
    return (
      <p className="p-8 text-center text-muted-foreground text-sm">
        No docs installed yet. Install one in Settings to start searching.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex flex-wrap gap-2">
        <label htmlFor={docSelectId} className="sr-only">
          Documentation
        </label>
        <select
          id={docSelectId}
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            setPage(null);
          }}
        >
          {docs?.map((d) => (
            <option key={d.slug} value={d.slug}>
              {docTitle(d)}
            </option>
          ))}
        </select>
        <div className="relative min-w-48 flex-1">
          <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <label htmlFor={searchId} className="sr-only">
            Search the documentation
          </label>
          <Input
            id={searchId}
            type="search"
            className="pl-8"
            placeholder="Search, e.g. strcpy or copy a string"
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
        <ul className="divide-y" aria-label="Search results">
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
            <li className="px-2 py-2 text-muted-foreground text-sm">No results.</li>
          )}
        </ul>
      )}
    </div>
  );
}
