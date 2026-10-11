# Scholion: local documentation assistant

A desktop app that answers questions about a programming language from its official
documentation, using a small language model that runs locally. Once docs and a model are
installed, everything works offline.

Name: **Scholion**. A scholion is an explanatory note written in the margin of a manuscript,
which is what the app writes for documentation.

## Goal

When you land on an unfamiliar language, you select it, ask a natural-language question
("copy a string in C"), and get a short answer with a code example. The answer is grounded in the
real documentation and links to the source page.

## Constraints

- Cross-platform: macOS, Windows, Linux. No dependency on Dash (paid) or Zeal (no macOS build).
- Nothing else to install: no Ollama. The inference engine ships inside the app.
- Lightweight: the installer contains neither models nor documentation. Both are downloaded on
  demand.
- Works offline once docs and a model are installed.
- Answers must cite their source and honor each doc's attribution.

## Stack

- App: Tauri 2 (Rust backend, React + Vite + TypeScript frontend).
- Chat UI: assistant-ui (message list, scrolling, streaming, copy, regenerate). Alternative:
  AI Elements (Vercel's shadcn/ui components).
- Model binding: Vercel AI SDK (`useChat`) wired to llama.cpp's local OpenAI-compatible server.
- Markdown rendering: Streamdown (built for streamed text). Fallback: react-markdown + remark-gfm
  + Shiki, with a "copy" button on code blocks.
- Local inference: bundled llama.cpp, run as a companion process. Model format: quantized GGUF
  (usually Q4).
- Documentation: DevDocs (devdocs.io), the only source at first.

Verified versions, URLs and formats: see [architecture.md](architecture.md).

## Architecture

### 1. Documentation manager

- Read the manifest `https://devdocs.io/docs.json`. Each entry has `name`, `slug`, `type`, `mtime`,
  `db_size`, `attribution`, and sometimes `version`, `release`, `links`, `alias`.
- List languages with their size. Install, Update and Remove buttons.
- Files per doc: `index.json` (entries: name, path, type) and `db.json` (page HTML keyed by path),
  under `https://documents.devdocs.io/<slug>/`.
- Store under the app data dir (Tauri `app_data_dir`). Download once, cache, compare `mtime` to
  offer updates. Never re-download on every launch: it is a free service.
- Keep each doc's `attribution` to display under answers.

#### Updates and versions

- Never check on every message. The manifest is checked at app launch, at most once every
  24 hours, in the background without blocking the UI. A "Check now" button lives in settings.
- Use a conditional request so the manifest is only re-downloaded when it changed.
- Compare the manifest `mtime` with the stored one for each installed doc. If different, show
  "Update available" on that doc. Settings option: auto-update, off by default.
- Offline or network error: fail silently and keep using installed docs.
- Atomic update: download to a temp folder, verify, then replace the old version. On failure the
  old version stays usable.
- Versions: DevDocs publishes several versions of a tool as separate manifest entries (`version`
  and `release` fields). The user picks the version per language. If a newer version exists,
  say so without switching automatically.
- Show the doc name and version used in answers.

### 1b. Installing docs from the conversation

- If the user asks for a doc that is not installed ("I want the Rust docs", "how do I do X in Go"
  while Go is not installed), the assistant offers to install it right in the chat: a card with
  name, version, size and an "Install" button. On click the doc is downloaded, added to the
  language menu and selected.
- The assistant never generates URLs. It only searches the already-loaded DevDocs manifest (name,
  slug, alias, version). A URL invented by a small model would be unreliable.
- Intent and language detection happen in code (matching against the manifest, tolerant to typos
  and aliases like "js" or "golang"), not through model tool calls, which are unreliable on small
  models. The model only steps in afterwards, to answer.
- Several versions available: the card defaults to the most recent, with a selector for the others.
- No doc is downloaded without a confirming click.
- If the language is not in the manifest, say so clearly and suggest close matches, without
  inventing a source.
- After installing, answer the original question if it contained one.

### 2. Searching the docs

- No embedding model at first. Lexical search over `index.json`: exact name match, prefix, then
  fuzzy match, with simple ranking.
- For a natural-language question, two steps: the model extracts keywords or candidate function
  names, search finds entries, and the top 2–3 pages are pulled from `db.json`.
- Convert page HTML to clean text (keep code blocks, signature, description) and truncate to fit
  the model context.
- Follow-up questions ("and with a dict?") are first rewritten into standalone questions from the
  last turns, so the search sees what they mean.
- Possible later improvement: lightweight embeddings for semantic search.

### 3. Model manager

- Settings screen: list of suggested models with size, quantization and recommendation. Install,
  Remove, Set active.
- Download with a progress bar, resume after interruption, integrity check (checksum).
- Stored in the app data dir.
- Default model: 3–4B parameters, quantized (~2–3 GB). More accurate option: 7–9B (~4–6 GB).
  Prefer code-oriented models and check their license.
- The user can switch models at any time if answers are not precise enough.

### 4. Answer generation

- System prompt: answer only from the provided passages, in the language of the question, as
  documentation, with sections adapted to the question (signature, behavior, examples, pitfalls,
  alternatives...). Complexity only when it applies (standard knowledge, marked as such). If the passages do not contain the answer, say so instead
  of inventing.
- After the answer, the model proposes up to 3 follow-up questions, shown as buttons that ask the
  question when clicked.
- Statements taken from a passage carry its number in square brackets (`[1]`); a click opens that
  page in the reader. Anything else is left out or marked "(general knowledge)".
- Streamed answer in the UI, via llama.cpp's local OpenAI-compatible server and the AI SDK.
- Do not rebuild generic chat pieces (scrolling, message list, Markdown rendering, copy code):
  the libraries above handle them.
- Always show under the answer: the source page(s) (numbered, opening in the in-app reader) and
  the doc attribution.

### 5. Interface

- Main screen: answers with their sources, then the question field. Under it, like in Claude: the
  doc picker on the left (with each doc's logo), the model picker on the right.
- In-app reader: cited pages and search results open next to the chat, fully offline, with syntax
  highlighting, find in page, full screen, and a link to devdocs.io.
- History: conversations are saved locally, searchable, renamable, exportable to Markdown.
  Shortcuts: ⌘/Ctrl+N new chat, +K question field, +D next doc.
- Settings screen: doc manager, model manager, storage usage, optional cloud provider (API key in
  the OS keychain).
- First launch: offer to install a model and one or two docs, showing disk space.
- Without a model, the main screen falls back to searching doc entries directly ("search only"),
  with a link to download a model. There is no mode switch: asking is the point of the app.

## Milestones

0. Pre-coding verification (formats, URLs, binaries, models, library compatibility).
1. Project foundation: tooling, CI, docs, app shell.
2. Doc manager: manifest, download, storage, removal.
3. Lexical search and "search only" mode.
4. llama.cpp integration: model loading, streamed generation.
5. Model manager with downloads.
6. Assembly: question → search → passages → sourced answer.
7. Polish: first launch, error handling, theme, packaging for all three platforms.

## Out of scope for v1

Web search, non-DevDocs docs (Dash, Zeal, custom docs), embeddings.
