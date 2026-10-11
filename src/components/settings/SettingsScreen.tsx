import { CloudManager } from "@/components/settings/CloudManager";
import { DocsManager } from "@/components/settings/DocsManager";
import { ModelsManager } from "@/components/settings/ModelsManager";

export function SettingsScreen() {
  return (
    <div className="mx-auto max-w-2xl space-y-10 p-6">
      <ModelsManager />
      <CloudManager />
      <DocsManager />
    </div>
  );
}
