import { Plus, X } from "lucide-react";
import { RemoveAllButton } from "@/components/settings/RemoveAllButton";
import { Button } from "@/components/ui/button";
import type { Conversation } from "@/lib/history";
import { cn } from "@/lib/utils";

interface SidebarProps {
  conversations: Conversation[];
  /** Id of the open conversation; it is not in the list until its first answer. */
  currentId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}

/** Past conversations, newest first, like in ChatGPT or Claude. Hidden on narrow windows. */
export function Sidebar({
  conversations,
  currentId,
  onSelect,
  onNew,
  onDelete,
  onClear,
}: SidebarProps) {
  const isNew = !conversations.some((c) => c.id === currentId);
  return (
    <aside
      aria-label="Conversations"
      className="hidden w-64 shrink-0 flex-col gap-2 border-r p-2 md:flex"
    >
      <Button variant="outline" size="sm" onClick={onNew} disabled={isNew}>
        <Plus /> New chat
      </Button>
      <nav aria-label="History" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {conversations.length === 0 && (
          <p className="px-2 py-1 text-muted-foreground text-xs">No conversations yet.</p>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
            className={cn(
              "group flex items-center rounded-md hover:bg-accent",
              c.id === currentId && "bg-accent",
            )}
          >
            <button
              type="button"
              className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-current={c.id === currentId ? "page" : undefined}
              onClick={() => onSelect(c.id)}
            >
              {c.title}
            </button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
              aria-label={`Delete ${c.title}`}
              onClick={() => onDelete(c.id)}
            >
              <X />
            </Button>
          </div>
        ))}
      </nav>
      {conversations.length > 0 && (
        <RemoveAllButton
          what="all conversations"
          size={`${conversations.length}`}
          onConfirm={onClear}
        />
      )}
    </aside>
  );
}
