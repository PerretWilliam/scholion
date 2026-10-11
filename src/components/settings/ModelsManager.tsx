import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/lib/format";
import {
  cancelModelDownload,
  downloadModel,
  getModels,
  type ModelStatus,
  type ModelsOverview,
  removeModel,
  setActiveModel,
} from "@/lib/ipc";

export function ModelsManager() {
  const [overview, setOverview] = useState<ModelsOverview | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  /** Downloads stopped by the user: their "cancelled" error is expected. */
  const cancelled = useRef(new Set<string>());

  const reload = useCallback(async () => {
    try {
      setOverview(await getModels());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function run(action: () => Promise<void>, failure: string) {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(`${failure}: ${e}`);
    }
    await reload();
  }

  async function download(model: ModelStatus) {
    setError(null);
    cancelled.current.delete(model.file);
    setProgress((p) => ({ ...p, [model.file]: 0 }));
    try {
      await downloadModel(model.file, (percent) =>
        setProgress((p) => ({ ...p, [model.file]: percent })),
      );
    } catch (e) {
      if (!cancelled.current.has(model.file)) {
        setError(`Could not download ${model.name}: ${e}`);
      }
    } finally {
      setProgress(({ [model.file]: _, ...rest }) => rest);
      await reload();
    }
  }

  function cancel(model: ModelStatus) {
    cancelled.current.add(model.file);
    run(() => cancelModelDownload(model.file), `Could not cancel ${model.name}`);
  }

  return (
    <section className="space-y-4" aria-labelledby="models-heading">
      <div>
        <h2 id="models-heading" className="font-semibold">
          Models
        </h2>
        <p className="text-muted-foreground text-xs">
          The model writes answers from the docs. It runs on this computer, offline.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <ul className="divide-y rounded-md border">
        {overview?.models.map((model) => {
          const percent = progress[model.file];
          const active = overview.active === model.file;
          return (
            <li key={model.file} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium text-sm">
                  {model.name}
                  {model.recommended && <Badge variant="secondary">Recommended</Badge>}
                  {active && <Badge>Active</Badge>}
                </p>
                <p className="text-muted-foreground text-xs">
                  {formatBytes(model.size)} · {model.description}
                </p>
              </div>
              {percent !== undefined ? (
                <div className="flex items-center gap-2">
                  {percent < 100 ? (
                    <Progress
                      value={percent}
                      className="w-32"
                      aria-label={`Downloading ${model.name}`}
                    />
                  ) : (
                    <span className="text-muted-foreground text-xs">Verifying…</span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => cancel(model)}
                    disabled={percent === 100}
                  >
                    Cancel
                  </Button>
                </div>
              ) : model.downloaded ? (
                <div className="flex items-center gap-2">
                  {!active && (
                    <Button
                      size="sm"
                      onClick={() =>
                        run(() => setActiveModel(model.file), `Could not use ${model.name}`)
                      }
                    >
                      Use
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      run(() => removeModel(model.file), `Could not remove ${model.name}`)
                    }
                  >
                    Remove
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {model.partial_bytes > 0 && (
                    <span className="text-muted-foreground text-xs">
                      {formatBytes(model.partial_bytes)} downloaded
                    </span>
                  )}
                  <Button size="sm" variant="outline" onClick={() => download(model)}>
                    {model.partial_bytes > 0 ? "Resume" : "Download"}
                  </Button>
                  {model.partial_bytes > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        run(() => removeModel(model.file), `Could not discard ${model.name}`)
                      }
                    >
                      Discard
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
