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
import { openUrl } from "@tauri-apps/plugin-opener";
import DOMPurify from "dompurify";
import { Copy, RotateCcw, Send, Square } from "lucide-react";
import { type ComponentProps, type RefObject, useMemo } from "react";
import { type Components, Streamdown } from "streamdown";
import { InstallDocCard, UnknownDocNotice } from "@/components/chat/InstallDocCard";
import { Button } from "@/components/ui/button";
import {
  type ChatContext,
  type ChatData,
  type ChatMessage,
  createChatTransport,
  type Sources,
} from "@/lib/chat-transport";

export function Chat({ context }: { context: RefObject<ChatContext> }) {
  const transport = useMemo(() => createChatTransport(() => context.current), [context]);
  const runtime = useChatRuntime<ChatMessage>({ transport });
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
        <Composer />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function Composer() {
  return (
    <ComposerPrimitive.Root className="mx-auto flex w-full max-w-3xl items-end gap-2 px-6 pb-6">
      <ComposerPrimitive.Input
        aria-label="Question"
        placeholder="Ask about the docs…"
        className="max-h-40 min-h-9 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        autoFocus
      />
      <AuiIf condition={(s) => !s.thread.isRunning}>
        <ComposerPrimitive.Send asChild>
          <Button aria-label="Send">
            <Send />
          </Button>
        </ComposerPrimitive.Send>
      </AuiIf>
      <AuiIf condition={(s) => s.thread.isRunning}>
        <ComposerPrimitive.Cancel asChild>
          <Button variant="outline" aria-label="Stop">
            <Square />
          </Button>
        </ComposerPrimitive.Cancel>
      </AuiIf>
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
      <MessagePrimitive.Parts
        components={{
          Text: ({ text, status }) => (
            <Streamdown
              className="text-sm"
              isAnimating={status.type === "running"}
              components={markdownComponents}
            >
              {text}
            </Streamdown>
          ),
          data: {
            by_name: {
              status: ({ data }) => <StatusLine text={(data as ChatData["status"]).text} />,
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
            <Copy />
          </Button>
        </ActionBarPrimitive.Copy>
        <ActionBarPrimitive.Reload asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Answer again">
            <RotateCcw />
          </Button>
        </ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

/** Progress of the pipeline, until the answer text starts. */
function StatusLine({ text }: { text: string }) {
  const waiting = useAuiState(
    (s) =>
      s.message.status?.type === "running" &&
      !s.message.parts.some((p) => p.type === "text" && p.text),
  );
  return waiting ? <p className="animate-pulse text-muted-foreground text-sm">{text}</p> : null;
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
      <p>
        Sources ({sources.doc}):{" "}
        {sources.pages.map((page, i) => (
          <span key={page.url}>
            {i > 0 && " · "}
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
