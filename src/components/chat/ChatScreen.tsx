import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Settings } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chat } from "@/components/chat/Chat";
import { DocPage, OpenDocContext } from "@/components/chat/DocPage";
import { DocSearch } from "@/components/chat/DocSearch";
import { DocActions } from "@/components/chat/InstallDocCard";
import { Sidebar } from "@/components/chat/Sidebar";
import { DocIcon } from "@/components/DocIcon";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ChatContext, ChatMessage } from "@/lib/chat-transport";
import { docTitle } from "@/lib/format";
import {
  type Conversation,
  loadConversations,
  saveConversations,
  titleOf,
  toMarkdown,
  upsert,
} from "@/lib/history";
import {
  type Cloud,
  type DocEntry,
  getDocs,
  getModels,
  getPage,
  getSettings,
  type ModelStatus,
  type Page,
  saveExport,
  setActiveModel,
  setSettings,
} from "@/lib/ipc";
import { PROVIDERS, type ProviderId } from "@/lib/providers";

/** Select value of the "open Settings" item in both pickers. */
const MANAGE = "manage";
/** Select value of the cloud provider in the model picker. */
const CLOUD = "cloud";

interface Props {
  visible: boolean;
  onOpenSettings: () => void;
}

/**
 * Main screen: the chat, with the doc and model pickers under the question field. Without a
 * model, it falls back to searching the docs directly.
 */
export function ChatScreen({ visible, onOpenSettings }: Props) {
  const [docs, setDocs] = useState<DocEntry[] | null>(null);
  const [slug, setSlug] = useState("");
  const [models, setModels] = useState<ModelStatus[]>([]);
  /** Active model file; undefined until loaded. */
  const [model, setModel] = useState<string | null | undefined>(undefined);
  /** Configured cloud provider, and whether it answers instead of the local model. */
  const [cloudConfig, setCloudConfig] = useState<Cloud | null>(null);
  const [useCloud, setUseCloud] = useState(false);
  const cloud = useCloud ? cloudConfig : null;
  const [error, setError] = useState<string | null>(null);
  /** Path of the last exported file, until dismissed. */
  const [exported, setExported] = useState<string | null>(null);
  /** Doc page open in the reader next to the chat. */
  const [reader, setReader] = useState<{ slug: string; page: Page } | null>(null);
  /** Conversations answering right now. */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  const reloadDocs = useCallback(async () => {
    const [{ installed }, overview, settings] = await Promise.all([
      getDocs(),
      getModels(),
      getSettings(),
    ]);
    const entries = installed.map((d) => d.entry);
    setDocs(entries);
    setSlug((current) =>
      entries.some((d) => d.slug === current) ? current : (entries[0]?.slug ?? ""),
    );
    setModels(overview.models.filter((m) => m.downloaded));
    setModel(overview.active);
    setCloudConfig(settings.cloud);
    setUseCloud(settings.use_cloud);
  }, []);

  // Docs and models change in Settings: refresh whenever the screen shows again.
  useEffect(() => {
    if (visible) reloadDocs().catch((e) => setError(String(e)));
  }, [visible, reloadDocs]);

  async function selectModel(file: string) {
    try {
      // Read fresh settings: the active model is saved in them too.
      if (file === CLOUD) {
        const settings = await getSettings();
        await setSettings({ ...settings, use_cloud: true });
        setUseCloud(true);
        return;
      }
      await setActiveModel(file);
      const settings = await getSettings();
      if (settings.use_cloud) await setSettings({ ...settings, use_cloud: false });
      setUseCloud(false);
      setModel(file);
    } catch (e) {
      setError(`Could not switch models: ${e}`);
    }
  }

  /** Saved conversations; null until the history file is read. */
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  const [currentId, setCurrentId] = useState<string>(() => crypto.randomUUID());
  /**
   * Conversations shown so far. They all stay mounted, hidden when not current, so a running
   * answer is not interrupted by a switch.
   */
  const [opened, setOpened] = useState<string[]>([currentId]);

  useEffect(() => {
    loadConversations()
      .then((list) => {
        conversationsRef.current = list;
        setConversations(list);
      })
      .catch((e) => {
        setError(`Could not read the history: ${e}`);
        setConversations([]);
      });
  }, []);

  function persist(next: Conversation[]) {
    conversationsRef.current = next;
    setConversations(next);
    saveConversations(next).catch((e) => setError(`Could not save the history: ${e}`));
  }

  function open(id: string) {
    setCurrentId(id);
    setOpened((ids) => (ids.includes(id) ? ids : [...ids, id]));
  }

  function select(id: string) {
    const slugOfChat = conversationsRef.current.find((c) => c.id === id)?.slug;
    if (slugOfChat && docs?.some((d) => d.slug === slugOfChat)) setSlug(slugOfChat);
    open(id);
  }

  /** `id` is fixed per mounted chat, so this never saves to the wrong conversation. */
  function saveMessages(id: string, messages: ChatMessage[], chatSlug: string) {
    if (messages.length === 0) return;
    const saved = conversationsRef.current.find((c) => c.id === id);
    persist(
      upsert(conversationsRef.current, {
        id,
        title: saved?.renamed ? saved.title : titleOf(messages),
        renamed: saved?.renamed,
        updatedAt: Date.now(),
        slug: chatSlug,
        messages,
      }),
    );
  }

  function renameConversation(id: string, title: string) {
    persist(
      conversationsRef.current.map((c) => (c.id === id ? { ...c, title, renamed: true } : c)),
    );
  }

  async function exportConversation(id: string) {
    const saved = conversationsRef.current.find((c) => c.id === id);
    if (!saved) return;
    try {
      setExported(await saveExport(`${saved.title}.md`, toMarkdown(saved)));
    } catch (e) {
      setError(`Could not export the conversation: ${e}`);
    }
  }

  const openDoc = useCallback(async (docSlug: string, path: string) => {
    try {
      setReader({ slug: docSlug, page: await getPage(docSlug, path) });
    } catch (e) {
      setError(`Could not open the page: ${e}`);
    }
  }, []);

  function setChatBusy(id: string, running: boolean) {
    setBusy((ids) => {
      if (ids.has(id) === running) return ids;
      const next = new Set(ids);
      if (running) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function deleteConversation(id: string) {
    persist(conversationsRef.current.filter((c) => c.id !== id));
    setOpened((ids) => ids.filter((x) => x !== id));
    if (id === currentId) open(crypto.randomUUID());
  }

  // Shortcuts: ⌘/Ctrl+N new chat, +K question field, +D next doc (with Shift: previous).
  useEffect(() => {
    if (!visible) return;
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "n") {
        if (conversationsRef.current.some((c) => c.id === currentId)) open(crypto.randomUUID());
      } else if (key === "k") {
        const fields = document.querySelectorAll<HTMLTextAreaElement>(
          'textarea[aria-label="Question"]',
        );
        [...fields].find((f) => f.offsetParent !== null)?.focus();
      } else if (key === "d" && docs && docs.length > 1) {
        const at = docs.findIndex((d) => d.slug === slug);
        setSlug(docs[(at + (e.shiftKey ? -1 : 1) + docs.length) % docs.length]?.slug ?? slug);
      } else {
        return;
      }
      e.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const context = useRef<ChatContext>({ slug, model: model ?? null, cloud, selectDoc: setSlug });
  context.current = { slug, model: model ?? null, cloud, selectDoc: setSlug };
  const actions = useMemo(() => ({ reloadDocs, selectDoc: setSlug }), [reloadDocs]);

  const cloudOption = cloudConfig
    ? `${PROVIDERS[cloudConfig.provider as ProviderId]?.name ?? cloudConfig.provider} · ${cloudConfig.model}`
    : null;

  const docPicker = (
    <Picker
      label="Documentation"
      value={slug}
      placeholder="No docs installed"
      manageLabel="Add or remove docs…"
      onChange={setSlug}
      onManage={onOpenSettings}
    >
      {docs?.map((d) => (
        <SelectItem key={d.slug} value={d.slug}>
          <DocIcon slug={d.slug} name={d.name} />
          {docTitle(d)}
        </SelectItem>
      ))}
    </Picker>
  );

  return (
    <div className="flex h-full flex-col">
      {error && (
        <p role="alert" className="mx-auto w-full max-w-3xl px-6 pt-4 text-destructive text-sm">
          {error}
        </p>
      )}
      {exported && (
        <p
          role="status"
          className="mx-auto flex w-full max-w-3xl items-center gap-2 px-6 pt-4 text-sm"
        >
          <span className="min-w-0 truncate">Saved to {exported}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => revealItemInDir(exported).catch((e) => setError(String(e)))}
          >
            Show in folder
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setExported(null)}>
            Dismiss
          </Button>
        </p>
      )}
      {model || cloud ? (
        <OpenDocContext.Provider value={openDoc}>
          <DocActions value={actions}>
            <div className="flex min-h-0 flex-1">
              <Sidebar
                conversations={conversations ?? []}
                currentId={currentId}
                busy={busy}
                onRename={renameConversation}
                onExport={exportConversation}
                onSelect={select}
                onNew={() => open(crypto.randomUUID())}
                onDelete={deleteConversation}
              />
              <div className="min-w-0 flex-1">
                {conversations &&
                  opened.map((id) => (
                    <div key={id} className={id === currentId ? "h-full" : "hidden"}>
                      <Chat
                        context={context}
                        active={id === currentId}
                        onBusy={(running) => setChatBusy(id, running)}
                        initialMessages={conversations.find((c) => c.id === id)?.messages ?? []}
                        onMessages={(messages, chatSlug) => saveMessages(id, messages, chatSlug)}
                        leftTools={docPicker}
                        rightTools={
                          <Picker
                            label="Model"
                            value={cloud ? CLOUD : (model ?? "")}
                            manageLabel="Other models…"
                            onChange={selectModel}
                            onManage={onOpenSettings}
                          >
                            {models.map((m) => (
                              <SelectItem key={m.file} value={m.file}>
                                {m.name}
                              </SelectItem>
                            ))}
                            {cloudOption && <SelectItem value={CLOUD}>{cloudOption}</SelectItem>}
                          </Picker>
                        }
                      />
                    </div>
                  ))}
              </div>
              {reader && (
                <aside
                  key={reader.page.url}
                  aria-label="Documentation page"
                  className="fixed inset-0 z-20 overflow-y-auto bg-background p-4 lg:static lg:z-auto lg:w-[32rem] lg:shrink-0 lg:border-l"
                >
                  <DocPage
                    slug={reader.slug}
                    page={reader.page}
                    backLabel="Close"
                    onBack={() => setReader(null)}
                    onNavigate={(path) => openDoc(reader.slug, path)}
                  />
                </aside>
              )}
            </div>
          </DocActions>
        </OpenDocContext.Provider>
      ) : (
        model === null && (
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 px-6 pt-4 text-sm">
              <span className="text-muted-foreground">
                No model installed: search the docs directly, or
              </span>
              <Button size="sm" variant="outline" onClick={onOpenSettings}>
                <Settings /> Download a model
              </Button>
              <div className="ml-auto">{docPicker}</div>
            </div>
            <DocSearch docs={docs} slug={slug} />
          </div>
        )
      )}
    </div>
  );
}

interface PickerProps {
  label: string;
  value: string;
  placeholder?: string;
  /** Last item, opens Settings. */
  manageLabel: string;
  onChange: (value: string) => void;
  onManage: () => void;
  children: ReactNode;
}

/** A borderless select for the composer, ending with a link to Settings. */
function Picker({
  label,
  value,
  placeholder,
  manageLabel,
  onChange,
  onManage,
  children,
}: PickerProps) {
  return (
    <Select
      value={value || undefined}
      onValueChange={(v) => (v === MANAGE ? onManage() : onChange(v))}
    >
      <SelectTrigger
        size="sm"
        aria-label={label}
        className="max-w-60 border-0 bg-transparent shadow-none hover:bg-accent dark:bg-transparent"
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" side="top" align="start">
        {children}
        <SelectSeparator />
        <SelectItem value={MANAGE}>
          <Settings /> {manageLabel}
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
