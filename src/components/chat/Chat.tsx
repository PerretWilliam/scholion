import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { code } from "@streamdown/code";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ChatTransport } from "ai";
import DOMPurify from "dompurify";
import { ArrowUp, Check, Copy, RotateCcw, Square } from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { type Components, Streamdown } from "streamdown";
import { entryPath, OpenDocContext } from "@/components/chat/DocPage";
import { InstallDocCard, UnknownDocNotice } from "@/components/chat/InstallDocCard";
import { DocIcon } from "@/components/DocIcon";
import { Button } from "@/components/ui/button";
import {
  type ChatContext,
  type ChatData,
  type ChatMessage,
  createChatTransport,
  type Sources,
} from "@/lib/chat-transport";
import { t, useLanguage } from "@/lib/i18n";
import { linkCitations } from "@/lib/prompts";

interface ChatProps {
  context: RefObject<ChatContext>;
  /** Shown under the question field, on the left and on the right of the send button. */
  leftTools: ReactNode;
  rightTools: ReactNode;
  /** Messages of a saved conversation; read once, so remount (`key`) to switch conversations. */
  initialMessages: ChatMessage[];
  /** Called when this conversation starts or stops answering. */
  onBusy: (busy: boolean) => void;
  /** False while another conversation is shown: this one keeps answering in the background. */
  active: boolean;
  /**
   * Called with the whole conversation and the doc it uses, when a question is sent and after
   * each answer (also a stopped one).
   */
  onMessages: (messages: ChatMessage[], slug: string) => void;
}

export function Chat({
  context,
  leftTools,
  rightTools,
  initialMessages,
  active,
  onBusy,
  onMessages,
}: ChatProps) {
  useLanguage();
  // Refs, because the runtime keeps the callbacks it was created with.
  const save = useRef(onMessages);
  save.current = onMessages;
  const isActive = useRef(active);
  isActive.current = active;
  /** Doc of this conversation: the picker's at each question, or the one the question names. */
  const slug = useRef(context.current.slug);

  const transport = useMemo<ChatTransport<ChatMessage>>(() => {
    const base = createChatTransport(() => ({
      ...context.current,
      // A background conversation must not move the picker of the one on screen.
      selectDoc: (name) => {
        slug.current = name;
        if (isActive.current) context.current.selectDoc(name);
      },
    }));
    return {
      ...base,
      sendMessages: (options) => {
        slug.current = context.current.slug;
        save.current(options.messages, slug.current);
        return base.sendMessages(options);
      },
    };
  }, [context]);
  const runtime = useChatRuntime<ChatMessage>({
    transport,
    messages: initialMessages,
    onFinish: ({ messages }) => save.current(messages, slug.current),
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <BusyReporter onBusy={onBusy} />
      <ThreadPrimitive.Root className="flex h-full flex-col">
        <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-6 p-6">
            <AuiIf condition={(s) => s.thread.isEmpty}>
              <p className="pt-12 text-center text-muted-foreground text-sm">
                {t("chat.empty")}
                <br />
                {t("chat.shortcuts")}
              </p>
            </AuiIf>
            <ThreadPrimitive.Messages>
              {({ message }) => (message.role === "user" ? <UserMessage /> : <AssistantMessage />)}
            </ThreadPrimitive.Messages>
          </div>
        </ThreadPrimitive.Viewport>
        <Composer leftTools={leftTools} rightTools={rightTools} />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

/** Tells the sidebar whether this conversation is answering. */
function BusyReporter({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const running = useAuiState((s) => s.thread.isRunning);
  const report = useRef(onBusy);
  report.current = onBusy;
  useEffect(() => {
    report.current(running);
    return () => report.current(false);
  }, [running]);
  return null;
}

function Composer({ leftTools, rightTools }: Pick<ChatProps, "leftTools" | "rightTools">) {
  useLanguage();
  return (
    <ComposerPrimitive.Root className="mx-auto w-full max-w-3xl px-6 pb-6">
      <div className="rounded-xl border bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring/50">
        <ComposerPrimitive.Input
          aria-label={t("chat.question")}
          data-question-field
          placeholder={t("chat.placeholder")}
          className="block max-h-40 min-h-12 w-full resize-none bg-transparent px-4 pt-3 text-sm outline-none"
          autoFocus
        />
        <div className="flex items-center gap-1 p-2">
          {leftTools}
          <div className="ml-auto flex items-center gap-1">
            {rightTools}
            <AuiIf condition={(s) => !s.thread.isRunning}>
              <ComposerPrimitive.Send asChild>
                <Button size="icon-sm" aria-label={t("chat.send")}>
                  <ArrowUp />
                </Button>
              </ComposerPrimitive.Send>
            </AuiIf>
            <AuiIf condition={(s) => s.thread.isRunning}>
              <ComposerPrimitive.Cancel asChild>
                <Button size="icon-sm" variant="outline" aria-label={t("chat.stop")}>
                  <Square />
                </Button>
              </ComposerPrimitive.Cancel>
            </AuiIf>
          </div>
        </div>
      </div>
    </ComposerPrimitive.Root>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end">
      <div className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm">
        <MessagePrimitive.Parts components={{ Text: ({ text }) => text }} />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  useLanguage();
  return (
    <MessagePrimitive.Root className="space-y-3">
      <StatusLine />
      <MessagePrimitive.Parts
        components={{
          Text: ({ text, status }) => (
            <AnswerText text={text} running={status.type === "running"} />
          ),
          data: {
            by_name: {
              // Rendered once by StatusLine, whatever the number of status updates.
              status: () => null,
              suggestions: () => null,
              install: ({ data }) => <InstallDocCard data={data as ChatData["install"]} />,
              "unknown-doc": ({ data }) => (
                <UnknownDocNotice data={data as ChatData["unknown-doc"]} />
              ),
              // Rendered after the answer by SourcesFooter.
              sources: () => null,
            },
          },
        }}
      />
      <MessagePrimitive.Error>
        <ErrorPrimitive.Root role="alert" className="text-destructive text-sm">
          <ErrorPrimitive.Message />
        </ErrorPrimitive.Root>
      </MessagePrimitive.Error>
      <SourcesFooter />
      <ActionBarPrimitive.Root hideWhenRunning className="flex gap-1">
        <ActionBarPrimitive.Copy asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t("chat.copy")}>
            <AuiIf condition={(s) => s.message.isCopied}>
              <Check />
            </AuiIf>
            <AuiIf condition={(s) => !s.message.isCopied}>
              <Copy />
            </AuiIf>
          </Button>
        </ActionBarPrimitive.Copy>
        <ActionBarPrimitive.Reload asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t("chat.again")}>
            <RotateCcw />
          </Button>
        </ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
      <FollowUps />
    </MessagePrimitive.Root>
  );
}

/** Latest progress of the pipeline, until the answer text starts. */
function StatusLine() {
  const text = useAuiState((s) => {
    if (s.message.status?.type !== "running") return null;
    if (s.message.parts.some((p) => p.type === "text" && p.text)) return null;
    const last = s.message.parts.filter((p) => p.type === "data" && p.name === "status").at(-1);
    return (last as { data: ChatData["status"] } | undefined)?.data.text ?? null;
  });
  return text ? <p className="animate-pulse text-muted-foreground text-sm">{text}</p> : null;
}

/** Questions to ask next; a click sends the question. Only under the latest answer. */
function FollowUps() {
  const questions = useAuiState((s) => {
    if (!s.message.isLast || s.message.status?.type === "running") return undefined;
    const part = s.message.parts.find((p) => p.type === "data" && p.name === "suggestions");
    return (part as { data: ChatData["suggestions"] } | undefined)?.data.questions;
  });
  if (!questions?.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {questions.map((question) => (
        <ThreadPrimitive.Suggestion key={question} prompt={question} send asChild>
          <Button variant="outline" size="sm" className="h-auto whitespace-normal py-1.5 text-left">
            {question}
          </Button>
        </ThreadPrimitive.Suggestion>
      ))}
    </div>
  );
}

/** Sources of the current message, once the pipeline has found them. */
function useSources(): Sources | undefined {
  return useAuiState(
    (s) =>
      s.message.parts.find((p) => p.type === "data" && p.name === "sources") as
        | { data: Sources }
        | undefined,
  )?.data;
}

/** The answer text; a `[n]` citation opens the n-th source in the reader. */
function AnswerText({ text, running }: { text: string; running: boolean }) {
  const openDoc = useContext(OpenDocContext);
  const sources = useSources();
  const components = useMemo(
    () =>
      ({
        a: ({ href, children }: ComponentProps<"a">) => {
          const page = href?.startsWith("#cite-") ? sources?.pages[+href.slice(6) - 1] : undefined;
          if (!sources || !page) return <ExternalLink href={href}>{children}</ExternalLink>;
          return (
            <button
              type="button"
              title={page.title}
              className="align-baseline text-primary hover:underline"
              onClick={() => openDoc(sources.slug, entryPath(sources.slug, page.url))}
            >
              {children}
            </button>
          );
        },
      }) as Components,
    [sources, openDoc],
  );
  return (
    <Streamdown
      className="text-sm"
      isAnimating={running}
      plugins={{ code }}
      components={components}
    >
      {linkCitations(text, sources?.pages.length ?? 0)}
    </Streamdown>
  );
}

function SourcesFooter() {
  useLanguage();
  const openDoc = useContext(OpenDocContext);
  const sources = useSources();
  // DevDocs attribution is HTML from a third party: always sanitize.
  const attribution = useMemo(
    () => (sources ? DOMPurify.sanitize(sources.attribution) : ""),
    [sources],
  );
  if (!sources) return null;
  return (
    <footer className="space-y-1 border-t pt-2 text-muted-foreground text-xs">
      <p className="flex flex-wrap items-center gap-x-1">
        <DocIcon slug={sources.slug} name={sources.name} className="size-3.5" />
        {t("chat.sources", { doc: sources.doc })}{" "}
        {sources.pages.map((page, i) => (
          <span key={page.url}>
            {i > 0 && " · "}[{i + 1}]{" "}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() => openDoc(sources.slug, entryPath(sources.slug, page.url))}
            >
              {page.title}
            </button>
          </span>
        ))}
      </p>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify above. */}
      <p dangerouslySetInnerHTML={{ __html: attribution }} />
    </footer>
  );
}

/** Links in answers open in the system browser; the webview never navigates away. */
function ExternalLink({ href, children }: ComponentProps<"a">) {
  return (
    <a
      href={href}
      className="underline underline-offset-2"
      onClick={(e) => {
        e.preventDefault();
        if (href?.startsWith("https://") || href?.startsWith("http://")) openUrl(href);
      }}
    >
      {children}
    </a>
  );
}
