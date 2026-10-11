import { useEffect, useState } from "react";
import { formatBytes } from "@/lib/format";
import { t, useLanguage } from "@/lib/i18n";
import { getStorageUsage, type StorageUsage as Usage } from "@/lib/ipc";

/** Disk space taken by what the app stores. Read when Settings opens. */
export function StorageUsage() {
  useLanguage();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getStorageUsage()
      .then(setUsage)
      .catch((e) => setError(String(e)));
  }, []);

  const rows =
    usage &&
    ([
      [t("models.title"), usage.models],
      [t("common.documentation"), usage.docs],
      [t("storage.history"), usage.history],
    ] as const);

  return (
    <section className="space-y-3" aria-labelledby="storage-heading">
      <h2 id="storage-heading" className="font-semibold">
        {t("storage.title")}
      </h2>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {rows && (
        <dl className="divide-y rounded-md border text-sm">
          {rows.map(([label, bytes]) => (
            <div key={label} className="flex justify-between px-3 py-2">
              <dt>{label}</dt>
              <dd className="text-muted-foreground">{formatBytes(bytes)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
