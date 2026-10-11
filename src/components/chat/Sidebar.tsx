import { Download, Loader2, Pencil, Plus, Search, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type Conversation, matches } from "@/lib/history";
import { t, useLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface SidebarProps {
  conversations: Conversation[];
  /** Id of the open conversation; it is not in the list until its first answer. */
  currentId: string;
  /** Ids of conversations still answering, possibly in the background. */
  busy: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onExport: (id: string) => void;
}

/** Past conversations, newest first, like in ChatGPT or Claude. Hidden on narrow windows. */
export function Sidebar({
  conversations,
  currentId,
  busy,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onExport,
}: SidebarProps) {
  useLanguage();
  const isNew = !conversations.some((c) => c.id === currentId);
  const [query, setQuery] = useState("");
  /** Conversation being renamed, and the title typed so far. */
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const shown = conversations.filter((c) => matches(c, query));

  function commitRename() {
    const title = editing?.title.trim();
    if (editing && title) onRename(editing.id, title);
    setEditing(null);
  }

  return (
    <aside
      aria-label={t("sidebar.conversations")}
      className="hidden w-64 shrink-0 flex-col gap-2 border-r p-2 md:flex"
    >
      <Button
        variant="outline"
        size="sm"
        onClick={onNew}
        disabled={isNew}
        title={t("sidebar.newTitle")}
      >
        <Plus /> {t("sidebar.new")}
      </Button>
      <div className="relative">
        <Search
          className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 size-3.5 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          aria-label={t("sidebar.search")}
          placeholder={t("sidebar.searchPlaceholder")}
          className="h-8 pl-7 text-sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <nav aria-label={t("sidebar.history")} className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {shown.length === 0 && (
          <p className="px-2 py-1 text-muted-foreground text-xs">
            {conversations.length === 0 ? t("sidebar.none") : t("sidebar.noMatch")}
          </p>
        )}
        {shown.map((c) => (
          <div
            key={c.id}
            className={cn(
              "group flex items-center rounded-md hover:bg-accent",
              c.id === currentId && "bg-accent",
            )}
          >
            {editing?.id === c.id ? (
              <Input
                aria-label={t("sidebar.titleLabel")}
                className="h-8 flex-1 text-sm"
                value={editing.title}
                autoFocus
                onChange={(e) => setEditing({ id: c.id, title: e.target.value })}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setEditing(null);
                }}
              />
            ) : (
              <>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  aria-current={c.id === currentId ? "page" : undefined}
                  onClick={() => onSelect(c.id)}
                  onDoubleClick={() => setEditing({ id: c.id, title: c.title })}
                >
                  {busy.has(c.id) && (
                    <Loader2
                      className="size-3.5 shrink-0 animate-spin text-muted-foreground"
                      role="img"
                      aria-label={t("sidebar.answering")}
                    />
                  )}
                  <span className="truncate">{c.title}</span>
                </button>
                <RowButton
                  label={t("sidebar.rename", { title: c.title })}
                  onClick={() => setEditing({ id: c.id, title: c.title })}
                >
                  <Pencil />
                </RowButton>
                <RowButton
                  label={t("sidebar.export", { title: c.title })}
                  onClick={() => onExport(c.id)}
                >
                  <Download />
                </RowButton>
                <RowButton
                  label={t("sidebar.delete", { title: c.title })}
                  onClick={() => onDelete(c.id)}
                >
                  <X />
                </RowButton>
              </>
            )}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function RowButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="size-7 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
