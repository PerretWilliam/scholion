import { useCallback, useEffect, useRef, useState } from "react";
import { RemoveAllButton } from "@/components/settings/RemoveAllButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/lib/format";
import { t, useLanguage } from "@/lib/i18n";
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
  useLanguage();
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
        setError(`${t("models.errDownload", { name: model.name })}: ${e}`);
      }
    } finally {
      setProgress(({ [model.file]: _, ...rest }) => rest);
      await reload();
    }
  }

  function cancel(model: ModelStatus) {
    cancelled.current.add(model.file);
    run(() => cancelModelDownload(model.file), t("models.errCancel", { name: model.name }));
  }

  // Downloaded models and partial downloads that are not running right now.
  const removable = (overview?.models ?? []).filter(
    (m) => (m.downloaded || m.partial_bytes > 0) && progress[m.file] === undefined,
  );
  const removableBytes = removable.reduce(
    (sum, m) => sum + (m.downloaded ? m.size : m.partial_bytes),
    0,
  );

  function removeAll() {
    run(async () => {
      for (const model of removable) {
        await removeModel(model.file);
      }
    }, t("models.errRemoveAll"));
  }

  return (
    <section className="space-y-4" aria-labelledby="models-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="models-heading" className="font-semibold">
            {t("models.title")}
          </h2>
          <p className="text-muted-foreground text-xs">{t("models.intro")}</p>
        </div>
        {removable.length > 0 && (
          <RemoveAllButton
            confirm={t("models.deleteAll", { size: formatBytes(removableBytes) })}
            onConfirm={removeAll}
          />
        )}
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
                  {model.recommended && (
                    <Badge variant="secondary">{t("models.recommended")}</Badge>
                  )}
                  {active && <Badge>{t("models.active")}</Badge>}
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
                      aria-label={t("common.downloading", { name: model.name })}
                    />
                  ) : (
                    <span className="text-muted-foreground text-xs">{t("common.verifying")}</span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => cancel(model)}
                    disabled={percent === 100}
                  >
                    {t("common.cancel")}
                  </Button>
                </div>
              ) : model.downloaded ? (
                <div className="flex items-center gap-2">
                  {!active && (
                    <Button
                      size="sm"
                      onClick={() =>
                        run(
                          () => setActiveModel(model.file),
                          t("models.errUse", { name: model.name }),
                        )
                      }
                    >
                      {t("models.use")}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      run(
                        () => removeModel(model.file),
                        t("models.errRemove", { name: model.name }),
                      )
                    }
                  >
                    {t("common.remove")}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {model.partial_bytes > 0 && (
                    <span className="text-muted-foreground text-xs">
                      {t("models.downloaded", { size: formatBytes(model.partial_bytes) })}
                    </span>
                  )}
                  <Button size="sm" variant="outline" onClick={() => download(model)}>
                    {model.partial_bytes > 0 ? t("models.resume") : t("common.download")}
                  </Button>
                  {model.partial_bytes > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        run(
                          () => removeModel(model.file),
                          t("models.errDiscard", { name: model.name }),
                        )
                      }
                    >
                      {t("models.discard")}
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
