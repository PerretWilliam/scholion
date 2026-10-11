import { listen } from "@tauri-apps/api/event";
import { Check } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { DocIcon } from "@/components/DocIcon";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { docTitle, formatBytes } from "@/lib/format";
import {
  DOCS_CHANGED_EVENT,
  type DocEntry,
  downloadModel,
  freeDiskSpace,
  getDocs,
  getModels,
  installDoc,
  type ModelStatus,
} from "@/lib/ipc";

/** Offered on first launch; any other doc is one search away in Settings or the chat. */
const SUGGESTED_DOCS = ["Python", "JavaScript", "TypeScript", "Rust", "Go", "HTML", "CSS"];

/** First launch: the recommended model and a few popular docs, with the disk space they take. */
export function Welcome({ onDone }: { onDone: () => void }) {
  const [model, setModel] = useState<ModelStatus | null>(null);
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [installed, setInstalled] = useState(new Set<string>());
  const [free, setFree] = useState<number | null>(null);
  /** Download percentage by model file or doc slug. */
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [models, overview, space] = await Promise.all([
        getModels(),
        getDocs(),
        freeDiskSpace(),
      ]);
      setModel(models.models.find((m) => m.recommended) ?? null);
      // The manifest lists the newest version of each doc first.
      setDocs(
        SUGGESTED_DOCS.flatMap((name) => overview.available.find((d) => d.name === name) ?? []),
      );
      setInstalled(new Set(overview.installed.map((d) => d.entry.slug)));
      setFree(space);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    reload();
    // On first launch the doc list arrives a moment after the window opens.
    const unlisten = listen(DOCS_CHANGED_EVENT, reload);
    return () => {
      unlisten.then((stop) => stop());
    };
  }, [reload]);

  async function download(
    key: string,
    label: string,
    run: (onProgress: (percent: number) => void) => Promise<void>,
  ) {
    setError(null);
    setProgress((p) => ({ ...p, [key]: 0 }));
    try {
      await run((percent) => setProgress((p) => ({ ...p, [key]: percent })));
    } catch (e) {
      setError(`Could not download ${label}: ${e}`);
    } finally {
      setProgress(({ [key]: _, ...rest }) => rest);
      await reload();
    }
  }

  const fits = (bytes: number) => free === null || bytes <= free;

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <div className="space-y-2">
        <h2 className="font-semibold text-xl">Welcome to ai-doc</h2>
        <p className="text-muted-foreground text-sm">
          ai-doc answers programming questions from documentation stored on this computer, with a
          language model that also runs here. Download both once; after that everything works
          offline.
        </p>
        {free !== null && (
          <p className="text-sm">
            Free disk space: <strong>{formatBytes(free)}</strong>
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <section className="space-y-2" aria-labelledby="welcome-model">
        <h3 id="welcome-model" className="font-medium">
          1. A model
        </h3>
        {model && (
          <ul className="rounded-md border">
            <Item
              title={model.name}
              detail={`${formatBytes(model.size)} · ${model.description}`}
              done={model.downloaded}
              progress={progress[model.file]}
              fits={fits(model.size - model.partial_bytes)}
              onDownload={() =>
                download(model.file, model.name, (onProgress) =>
                  downloadModel(model.file, onProgress),
                )
              }
            />
          </ul>
        )}
        <p className="text-muted-foreground text-xs">
          Larger and smaller models are in Settings. Without a model, the docs can still be
          searched.
        </p>
      </section>

      <section className="space-y-2" aria-labelledby="welcome-docs">
        <h3 id="welcome-docs" className="font-medium">
          2. One or two docs
        </h3>
        {docs.length > 0 ? (
          <ul className="divide-y rounded-md border">
            {docs.map((doc) => (
              <Item
                key={doc.slug}
                icon={<DocIcon slug={doc.slug} name={doc.name} className="size-5" />}
                title={docTitle(doc)}
                detail={formatBytes(doc.db_size)}
                done={installed.has(doc.slug)}
                progress={progress[doc.slug]}
                fits={fits(doc.db_size)}
                onDownload={() =>
                  download(doc.slug, docTitle(doc), (onProgress) =>
                    installDoc(doc.slug, onProgress),
                  )
                }
              />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            Loading the doc list… It needs an internet connection.
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          Hundreds more are in Settings, or ask for one in the chat: “I want the Ruby docs”.
        </p>
      </section>

      <Button onClick={onDone}>
        {model?.downloaded || installed.size > 0 ? "Start" : "Skip for now"}
      </Button>
    </div>
  );
}

interface ItemProps {
  icon?: ReactNode;
  title: string;
  detail: string;
  done: boolean;
  /** Download percentage while downloading, undefined otherwise. */
  progress: number | undefined;
  /** False when the disk does not have enough free space. */
  fits: boolean;
  onDownload: () => void;
}

function Item({ icon, title, detail, done, progress, fits, onDownload }: ItemProps) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm">{title}</p>
        <p className="text-muted-foreground text-xs">
          {detail}
          {!fits && !done && " · not enough free disk space"}
        </p>
      </div>
      {done ? (
        <span className="flex items-center gap-1 text-muted-foreground text-sm">
          <Check className="size-4" /> Installed
        </span>
      ) : progress === undefined ? (
        <Button size="sm" variant="outline" disabled={!fits} onClick={onDownload}>
          Download
        </Button>
      ) : progress < 100 ? (
        <Progress value={progress} className="w-32" aria-label={`Downloading ${title}`} />
      ) : (
        <span className="text-muted-foreground text-xs">Verifying…</span>
      )}
    </li>
  );
}
