// The chat pipeline, run in the webview: question → doc intent → search → passages → streamed
// answer from the local llama-server. See docs/architecture.md, "Overview".
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  type ChatTransport,
  createUIMessageStream,
  generateText,
  streamText,
  type UIMessage,
  type UIMessageStreamWriter,
} from "ai";
import { docTitle } from "@/lib/format";
import {
  type Cloud,
  type DocEntry,
  type DocIntent,
  detectDoc,
  getDocs,
  getPassage,
  searchDoc,
  startLlm,
} from "@/lib/ipc";
import {
  answerInstructions,
  answerPrompt,
  followUpInstructions,
  followUpPrompt,
  keywordInstructions,
  keywordMessages,
  MAX_PASSAGES,
  parseFollowUps,
  parseKeywords,
  pickPages,
} from "@/lib/prompts";
import { PROVIDERS, type ProviderId } from "@/lib/providers";

/** Shown under an answer: built from the manifest and entry paths, never by the model. */
export interface Sources {
  /** Doc title, with its version. */
  doc: string;
  slug: string;
  name: string;
  /** HTML from DevDocs: sanitize before rendering. */
  attribution: string;
  pages: { title: string; url: string }[];
}

/** Custom parts of an assistant message, rendered by the chat screen. */
export interface ChatData {
  [key: string]: unknown;
  /** Progress shown until the answer starts. */
  status: { text: string };
  sources: Sources;
  /** Clickable follow-up questions, shown under the answer. */
  suggestions: { questions: string[] };
  /** The question names a doc that is not installed: offer to install it. */
  install: Extract<DocIntent, { kind: "available" }>;
  /** The question asks for a doc DevDocs does not have. */
  "unknown-doc": Extract<DocIntent, { kind: "unknown" }>;
}

export type ChatMessage = UIMessage<unknown, ChatData>;

export interface ChatContext {
  /** Selected doc slug, "" if none. */
  slug: string;
  /** Active model file, null if none is downloaded. */
  model: string | null;
  /** Cloud provider to answer with instead of the local model, null to stay local. */
  cloud: Cloud | null;
  /** Called when the question names another installed doc. */
  selectDoc: (slug: string) => void;
}

type Writer = UIMessageStreamWriter<ChatMessage>;

/** `context` is read once per question, so it always reflects the latest selection. */
export function createChatTransport(context: () => ChatContext): ChatTransport<ChatMessage> {
  return {
    sendMessages: async ({ messages, abortSignal }) =>
      createUIMessageStream<ChatMessage>({
        execute: ({ writer }) => answer(writer, lastQuestion(messages), context(), abortSignal),
        onError: (e) => (e instanceof Error ? e.message : String(e)),
      }),
    // Answers are generated locally and not resumable.
    reconnectToStream: async () => null,
  };
}

function lastQuestion(messages: ChatMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  return (last?.parts ?? [])
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n")
    .trim();
}

function writeText(writer: Writer, text: string) {
  const id = "text";
  writer.write({ type: "text-start", id });
  writer.write({ type: "text-delta", id, delta: text });
  writer.write({ type: "text-end", id });
}

// ponytail: single-turn. Only the last question is sent: the 8192-token context holds the
// passages; earlier turns would crowd them out.
async function answer(
  writer: Writer,
  question: string,
  context: ChatContext,
  abortSignal: AbortSignal | undefined,
) {
  const status = (text: string) =>
    writer.write({ type: "data-status", id: "status", data: { text } });

  status("Searching the docs…");
  const [intent, { installed }] = await Promise.all([detectDoc(question), getDocs()]);
  const docs = installed.map((d) => d.entry);
  if (intent?.kind === "available") {
    writer.write({ type: "data-install", data: intent });
    return;
  }
  if (intent?.kind === "unknown") {
    writer.write({ type: "data-unknown-doc", data: intent });
    return;
  }
  let doc = docs.find((d) => d.slug === context.slug) ?? docs[0];
  if (intent?.kind === "installed" && intent.name !== doc?.name) {
    doc = docs.find((d) => d.slug === intent.slug) ?? doc;
    context.selectDoc(intent.slug);
  }
  if (!doc) {
    writeText(
      writer,
      'No documentation is installed yet. Name one in your question ("I want the Python docs") or install it in Settings.',
    );
    return;
  }
  if (intent?.kind === "installed" && !intent.question) {
    writeText(writer, `Now using ${docTitle(doc)}. Ask your question.`);
    return;
  }
  if (!context.model && !context.cloud) {
    writeText(writer, "No model is installed. Download one in Settings, or use Search mode.");
    return;
  }

  status(context.cloud ? "Contacting the provider…" : "Loading the model…");
  const model = context.cloud
    ? createOpenAICompatible({
        name: context.cloud.provider,
        baseURL: PROVIDERS[context.cloud.provider as ProviderId].baseURL,
        apiKey: context.cloud.api_key,
      }).chatModel(context.cloud.model)
    : createOpenAICompatible({
        name: "llama-server",
        baseURL: `http://127.0.0.1:${await startLlm(context.model as string)}/v1`,
      }).chatModel("local");

  status("Searching the docs…");
  const title = docTitle(doc);
  const { text } = await generateText({
    model,
    instructions: keywordInstructions(title),
    messages: [...keywordMessages(question)],
    maxOutputTokens: 40,
    temperature: 0,
    abortSignal,
  });
  const pages = await findPages(doc, parseKeywords(text, question), question);
  if (pages.length === 0) {
    writeText(
      writer,
      `Nothing in the ${title} documentation matches this question. Try other words, or browse it in Search mode.`,
    );
    return;
  }
  const passages = await Promise.all(
    pages.map(async (p) => ({ title: p.name, text: await getPassage(doc.slug, p.path) })),
  );
  writer.write({
    type: "data-sources",
    data: {
      doc: title,
      slug: doc.slug,
      name: doc.name,
      attribution: doc.attribution,
      pages: pages.map((p) => ({ title: p.name, url: p.url })),
    },
  });

  status("Writing the answer…");
  const result = streamText({
    model,
    instructions: answerInstructions(title),
    prompt: answerPrompt(question, passages),
    maxOutputTokens: 1536,
    temperature: 0.2,
    abortSignal,
  });
  // No finish chunk here: the follow-ups below still belong to the same message.
  writer.merge(result.toUIMessageStream({ sendFinish: false }));
  // A failure is already reported by the merged stream; follow-ups are optional.
  const reply = await Promise.resolve(result.text).catch(() => "");
  if (reply && !abortSignal?.aborted) {
    try {
      const { text: questions } = await generateText({
        model,
        instructions: followUpInstructions(title),
        prompt: followUpPrompt(question, reply),
        maxOutputTokens: 100,
        temperature: 0.4,
        abortSignal,
      });
      const list = parseFollowUps(questions);
      if (list.length) writer.write({ type: "data-suggestions", data: { questions: list } });
    } catch (e) {
      console.warn("Could not generate follow-up questions", e);
    }
  }
}

/** Exact names from the model's keywords first, then full-text matches of the whole question. */
async function findPages(doc: DocEntry, keywords: string[], question: string) {
  const lists = await Promise.all([
    ...keywords.map((k) => searchDoc(doc.slug, k, 2)),
    searchDoc(doc.slug, [question, ...keywords].join(" "), MAX_PASSAGES),
  ]);
  return pickPages(lists.flat());
}
