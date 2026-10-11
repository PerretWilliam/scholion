import { useAui } from "@assistant-ui/react";
import { createContext, useContext, useId, useState } from "react";
import { DocIcon } from "@/components/DocIcon";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { ChatData } from "@/lib/chat-transport";
import { docTitle, formatBytes } from "@/lib/format";
import { t, useLanguage } from "@/lib/i18n";
import { installDoc } from "@/lib/ipc";

/** Lets cards in the chat update the doc picker of the chat screen. */
export const DocActions = createContext<{
  reloadDocs: () => Promise<void>;
  selectDoc: (slug: string) => void;
}>({ reloadDocs: async () => {}, selectDoc: () => {} });

/** Offers to install the doc a question names. Nothing is downloaded without a click. */
export function InstallDocCard({ data }: { data: ChatData["install"] }) {
  useLanguage();
  const { reloadDocs, selectDoc } = useContext(DocActions);
  const aui = useAui();
  const [slug, setSlug] = useState(data.versions[0]?.slug ?? "");
  const [percent, setPercent] = useState<number | null>(null);
  const [installed, setInstalled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const versionId = useId();
  const version = data.versions.find((v) => v.slug === slug);

  async function install() {
    setError(null);
    setPercent(0);
    try {
      await installDoc(slug, setPercent);
      await reloadDocs();
      selectDoc(slug);
      setInstalled(true);
      // Answer the original question now that its doc is here.
      if (data.question) aui.message().reload();
    } catch (e) {
      setError(`${t("install.error", { name: data.name })}: ${e}`);
    } finally {
      setPercent(null);
    }
  }

  if (installed) {
    return (
      <p className="text-sm">
        {t("install.done", { doc: version ? docTitle(version) : data.name })}
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-md border p-3 text-sm">
      <p className="flex items-center gap-2">
        {version && <DocIcon slug={version.slug} name={data.name} />}
        <span>{t("install.notInstalled", { name: data.name })}</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {data.versions.length > 1 && (
          <>
            <label htmlFor={versionId} className="sr-only">
              {t("install.version")}
            </label>
            <select
              id={versionId}
              className="h-8 rounded-md border bg-background px-2"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              disabled={percent !== null}
            >
              {data.versions.map((v) => (
                <option key={v.slug} value={v.slug}>
                  {docTitle(v)}
                </option>
              ))}
            </select>
          </>
        )}
        {percent === null ? (
          <Button size="sm" onClick={install} disabled={!version}>
            {version
              ? t("install.withSize", { size: formatBytes(version.db_size) })
              : t("common.install")}
          </Button>
        ) : (
          <Progress
            value={percent}
            className="w-40"
            aria-label={t("common.installing", { name: data.name })}
          />
        )}
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function UnknownDocNotice({ data }: { data: ChatData["unknown-doc"] }) {
  useLanguage();
  return (
    <p className="text-sm">
      {t("install.unknown", { name: data.name })}
      {data.suggestions.length > 0 &&
        ` ${t("install.didYouMean", { names: data.suggestions.join(", ") })}`}
    </p>
  );
}
