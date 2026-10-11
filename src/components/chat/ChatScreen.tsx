import { Settings } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chat } from "@/components/chat/Chat";
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
  upsert,
} from "@/lib/history";
import { type DocEntry, getDocs, getModels, type ModelStatus, setActiveModel } from "@/lib/ipc";

/** Select value of the "open Settings" item in both pickers. */
const MANAGE = "manage";

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
  const [error, setError] = useState<string | null>(null);

  const reloadDocs = useCallback(async () => {
    const [{ installed }, overview] = await Promise.all([getDocs(), getModels()]);
    const entries = installed.map((d) => d.entry);
    setDocs(entries);
    setSlug((current) =>
      entries.some((d) => d.slug === current) ? current : (entries[0]?.slug ?? ""),
    );
    setModels(overview.models.filter((m) => m.downloaded));
    setModel(overview.active);
  }, []);

  // Docs and models change in Settings: refresh whenever the screen shows again.
  useEffect(() => {
    if (visible) reloadDocs().catch((e) => setError(String(e)));
  }, [visible, reloadDocs]);

  async function selectModel(file: string) {
    try {
      await setActiveModel(file);
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
    persist(
      upsert(conversationsRef.current, {
        id,
        title: titleOf(messages),
        updatedAt: Date.now(),
        slug: chatSlug,
        messages,
      }),
    );
  }

  function deleteConversation(id: string) {
    persist(conversationsRef.current.filter((c) => c.id !== id));
    setOpened((ids) => ids.filter((x) => x !== id));
    if (id === currentId) open(crypto.randomUUID());
  }

  function clearConversations() {
    persist([]);
    const id = crypto.randomUUID();
    setOpened([id]);
    setCurrentId(id);
  }

  const context = useRef<ChatContext>({ slug, model: model ?? null, selectDoc: setSlug });
  context.current = { slug, model: model ?? null, selectDoc: setSlug };
  const actions = useMemo(() => ({ reloadDocs, selectDoc: setSlug }), [reloadDocs]);

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
      {model ? (
        <DocActions value={actions}>
          <div className="flex min-h-0 flex-1">
            <Sidebar
              conversations={conversations ?? []}
              currentId={currentId}
              onSelect={select}
              onNew={() => open(crypto.randomUUID())}
              onDelete={deleteConversation}
              onClear={clearConversations}
            />
            <div className="min-w-0 flex-1">
              {conversations &&
                opened.map((id) => (
                  <div key={id} className={id === currentId ? "h-full" : "hidden"}>
                    <Chat
                      context={context}
                      active={id === currentId}
                      initialMessages={conversations.find((c) => c.id === id)?.messages ?? []}
                      onMessages={(messages, chatSlug) => saveMessages(id, messages, chatSlug)}
                      leftTools={docPicker}
                      rightTools={
                        <Picker
                          label="Model"
                          value={model}
                          manageLabel="Other models…"
                          onChange={selectModel}
                          onManage={onOpenSettings}
                        >
                          {models.map((m) => (
                            <SelectItem key={m.file} value={m.file}>
                              {m.name}
                            </SelectItem>
                          ))}
                        </Picker>
                      }
                    />
                  </div>
                ))}
            </div>
          </div>
        </DocActions>
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
