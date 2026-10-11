import { useState } from "react";
import { Button } from "@/components/ui/button";

interface RemoveAllButtonProps {
  /** What is deleted, e.g. "all models"; shown in the confirmation. */
  what: string;
  /** Total size on disk, already formatted. */
  size: string;
  onConfirm: () => void;
}

/** Destructive button that needs a second click, since webview dialogs are not available. */
export function RemoveAllButton({ what, size, onConfirm }: RemoveAllButtonProps) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button size="sm" variant="destructive" onClick={() => setConfirming(true)}>
        Remove all
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs">
        Delete {what} ({size})?
      </span>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => {
          setConfirming(false);
          onConfirm();
        }}
      >
        Delete
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </div>
  );
}
