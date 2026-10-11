import { useState } from "react";
import { Button } from "@/components/ui/button";
import { t, useLanguage } from "@/lib/i18n";

interface RemoveAllButtonProps {
  /** The confirmation question, e.g. "Delete all models (2.7 GB)?". */
  confirm: string;
  onConfirm: () => void;
}

/** Destructive button that needs a second click, since webview dialogs are not available. */
export function RemoveAllButton({ confirm, onConfirm }: RemoveAllButtonProps) {
  useLanguage();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button size="sm" variant="destructive" onClick={() => setConfirming(true)}>
        {t("common.removeAll")}
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs">{confirm}</span>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => {
          setConfirming(false);
          onConfirm();
        }}
      >
        {t("common.delete")}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        {t("common.cancel")}
      </Button>
    </div>
  );
}
