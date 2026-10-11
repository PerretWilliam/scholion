import { DocsManager } from "@/components/settings/DocsManager";

export function SettingsScreen() {
  return (
    <div className="mx-auto max-w-2xl space-y-10 p-6">
      <DocsManager />
      {/* Model manager lands in Phase 5. */}
      <section aria-labelledby="models-heading">
        <h2 id="models-heading" className="font-semibold">
          Models
        </h2>
        <p className="text-muted-foreground text-sm">No models installed yet.</p>
      </section>
    </div>
  );
}
