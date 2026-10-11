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
import { type ComponentProps, type ReactNode, type RefObject, useMemo, useRef } from "react";
import { type Components, Streamdown } from "streamdown";
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

interface ChatProps {
  context: RefObject<ChatContext>;
  /** Shown under the question field, on the left and on the right of the send button. */
  leftTools: ReactNode;
  rightTools: ReactNode;
  /** Messages of a saved conversation; read once, so remount (`key`) to switch conversations. */
  initialMessages: ChatMessage[];
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
  onMessages,
}: ChatProps) {
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
      <ThreadPrimitive.Root className="flex h-full flex-col">
        <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-6 p-6">
            <AuiIf condition={(s) => s.thread.isEmpty}>
              <p className="pt-12 text-center text-muted-foreground text-sm">
                Ask a question about the selected documentation, for example “how do I copy a
                string?”
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

function Composer({ leftTools, rightTools }: Pick<ChatProps, "leftTools" | "rightTools">) {
  return (
    <ComposerPrimitive.Root className="mx-auto w-full max-w-3xl px-6 pb-6">
      <div className="rounded-xl border bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring/50">
        <ComposerPrimitive.Input
          aria-label="Question"
          placeholder="Ask about the docs…"
          className="block max-h-40 min-h-12 w-full resize-none bg-transparent px-4 pt-3 text-sm outline-none"
          autoFocus
        />
        <div className="flex items-center gap-1 p-2">
          {leftTools}
          <div className="ml-auto flex items-center gap-1">
            {rightTools}
            <AuiIf condition={(s) => !s.thread.isRunning}>
              <ComposerPrimitive.Send asChild>
                <Button size="icon-sm" aria-label="Send">
                  <ArrowUp />
                </Button>
              </ComposerPrimitive.Send>
            </AuiIf>
            <AuiIf condition={(s) => s.thread.isRunning}>
              <ComposerPrimitive.Cancel asChild>
                <Button size="icon-sm" variant="outline" aria-label="Stop">
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
  return (
    <MessagePrimitive.Root className="space-y-3">
      <StatusLine />
      <MessagePrimitive.Parts
        components={{
          Text: ({ text, status }) => (
            <Streamdown
              className="text-sm"
              isAnimating={status.type === "running"}
              plugins={{ code }}
              components={markdownComponents}
            >
              {text}
            </Streamdown>
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
          <Button variant="ghost" size="icon-sm" aria-label="Copy the answer">
            <AuiIf condition={(s) => s.message.isCopied}>
              <Check />
            </AuiIf>
            <AuiIf condition={(s) => !s.message.isCopied}>
              <Copy />
            </AuiIf>
          </Button>
        </ActionBarPrimitive.Copy>
        <ActionBarPrimitive.Reload asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Answer again">
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

function SourcesFooter() {
  const sources = useAuiState(
    (s) =>
      s.message.parts.find((p) => p.type === "data" && p.name === "sources") as
        | { data: Sources }
        | undefined,
  )?.data;
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
        Sources ({sources.doc}):{" "}
        {sources.pages.map((page, i) => (
          <span key={page.url}>
            {i > 0 && " · "}[{i + 1}]{" "}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() => openUrl(page.url)}
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

// Streamdown's index signature rejects the precise `a` props type.
const markdownComponents = { a: ExternalLink } as Components;
