import { LanguagePicker } from "@/components/LanguagePicker";
import { CloudManager } from "@/components/settings/CloudManager";
import { DocsManager } from "@/components/settings/DocsManager";
import { ModelsManager } from "@/components/settings/ModelsManager";
import { StorageUsage } from "@/components/settings/StorageUsage";
import { t, useLanguage } from "@/lib/i18n";

export function SettingsScreen() {
  useLanguage();
  return (
    <div className="mx-auto max-w-2xl space-y-10 p-6">
      <section className="space-y-3" aria-labelledby="language-heading">
        <h2 id="language-heading" className="font-semibold">
          {t("app.language")}
        </h2>
        <LanguagePicker />
      </section>
      <ModelsManager />
      <CloudManager />
      <DocsManager />
      <StorageUsage />
    </div>
  );
}
