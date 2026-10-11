# Architecture

Technical reference for Scholion. Product requirements live in [spec.md](spec.md).
Everything marked **Verified** was checked against the live services on 2026-10-11 (Phase 0).

## Overview

```
┌──────────────────────── Tauri webview (React) ────────────────────────┐
│ assistant-ui Thread ── useChat ── ChatTransport (src/lib/chat-transport.ts)
│                                      │  1. invoke: detect_doc, search   │
│                                      │  2. streamText → llama-server    │
└──────────────────────────────────────┼────────────────────────────────┘
                    IPC (invoke/Channel)│              HTTP 127.0.0.1:<port>
┌──────────────────────── Rust backend ─┼────────────────────────────────┐
│ docs/ (manifest, install, search, intent)  download.rs  settings.rs    │
│ llm.rs ── spawns ──► llama-server (bundled resource, random port)      │
└────────────────────────────────────────────────────────────────────────┘
        app_data_dir/: settings.json, manifest.json, docs/<slug>.sqlite, models/*.gguf, tmp/
```

- All network downloads (manifest, docs, models) run in Rust. The webview only talks to the local
  `llama-server` on `127.0.0.1`, which the CSP enforces (`connect-src`).
- No Node server: the AI SDK runs in the webview, with a custom `ChatTransport` that calls
  `streamText` directly and returns `result.toUIMessageStream()`.

## DevDocs (Verified)

### Manifest

- `GET https://devdocs.io/docs.json` answers **303** to a content-hashed asset,
  e.g. `https://devdocs.io/assets/docs-<sha256>.json` (`cache-control: immutable`, no ETag).
- **Update check**: request `docs.json` *without* following redirects and compare the `Location`
  header with the one stored. Same location means the manifest is unchanged. Only follow the
  redirect when it changed. This replaces ETag / If-Modified-Since.
- ~840 entries. Fields: `name`, `slug`, `type`, `version`, `release`, `mtime`, `db_size`,
  `attribution`, `links` (`home`, `code`), `alias`. Any string field may be `null` in practice
  (`alias` often, `type` at least once), so we parse `null` as empty.
- Versions are separate entries sharing `name`, with slugs like `python~3.15`, `python~3.14`.
- `attribution` is **HTML** (e.g. `&copy; 2001 Python Software Foundation<br>Licensed under the PSF
  License.`). Render it sanitized; never inject it raw.
- Largest `db_size` is ~280 MB (`ansible`); typical languages are 5–25 MB.

```json
{
  "name": "Python", "slug": "python~3.15", "type": "python",
  "version": "3.15", "release": "3.15.0", "mtime": 1791566664, "db_size": 22131109,
  "attribution": "&copy; 2001 Python Software Foundation<br>…", "alias": "py",
  "links": { "home": "https://www.python.org/", "code": "https://github.com/python/cpython" }
}
```

### Doc files

Base URL: `https://documents.devdocs.io/<slug>/`. Append `?<mtime>` to bust caches.

| File | Shape |
|---|---|
| `index.json` | `{ "entries": [{ "name", "path", "type" }], "types": [{ "name", "count", "slug" }] }` |
| `db.json` | `{ "<path>": "<html>" }`. Keys match `entries[].path` |
| `meta.json` | Manifest entry for this doc (without `attribution`) |

- Responses carry ETag, `accept-ranges: bytes`, and Brotli when requested.
- Public page URL for a source link: `https://devdocs.io/<slug>/<path>`.
- Page HTML keeps code in `<pre data-language="…">`, so the HTML-to-Markdown step keeps it.
- Be a good citizen: identifiable `User-Agent`, at most one manifest check per 24 h,
  never auto-download docs.

## Inference: llama.cpp (Verified)

- Pinned release: **`b11552`** from `ggml-org/llama.cpp` (2026-10-10).
- Archives contain `llama-server` **plus shared libraries** (`@loader_path` / `$ORIGIN` rpath).
  A single `externalBin` sidecar is not enough. `pnpm fetch:llama` (`scripts/fetch-llama.mjs`)
  downloads the asset for the host, checks its sha256, and keeps only `llama-server`, the
  libraries under the names the loader asks for (symlinks become plain files), and the licenses,
  in `src-tauri/resources/llama/` (gitignored). Tauri bundles that folder as the `llama/`
  resource. Sizes: macOS 31 MB, Linux 93 MB, Windows 96 MB (the Vulkan backend is ~45 MB).
- We ship the **Vulkan** builds on Windows and Linux. They load the CPU backends dynamically,
  so they run on machines without a GPU too. The CPU-only assets below are kept for reference.
- The Linux build links `libssl.so.3` and `libvulkan.so.1` (Ubuntu 22.04+).
- Assets per platform (sha256 from the GitHub release `digest`):

| Target | Asset | sha256 |
|---|---|---|
| macOS arm64 (Metal) | `llama-b11552-bin-macos-arm64.tar.gz` | `f4b33fe40d098033fb1a19a8a4a84383c4ca84c37b6a60d9f9a253f349b48c07` |
| macOS x64 | `llama-b11552-bin-macos-x64.tar.gz` | `b7977620cf5c30b8905caa45d7dbcc08766b5d4a94b3cde66ecf0323a495096f` |
| Windows x64 (Vulkan) | `llama-b11552-bin-win-vulkan-x64.zip` | `83dc16325b532ba603034719e8377e28ca5093c5d4370141a6522f1a0250386c` |
| Windows x64 (CPU fallback) | `llama-b11552-bin-win-cpu-x64.zip` | `c00741179811ff903b515eae28bdeef1f47af6e81c49920c4e68b62954e056d6` |
| Linux x64 (Vulkan) | `llama-b11552-bin-ubuntu-vulkan-x64.tar.gz` | `c7bb933f3584b73296fbadea6e0d6273ddb7907699ec59ef08d0bb59e0a8b997` |
| Linux x64 (CPU fallback) | `llama-b11552-bin-ubuntu-x64.tar.gz` | `a45a6afda05d08028bd37998072ab602c96799bccde126835941623cb99bb727` |

- Lifecycle (`src-tauri/src/llm.rs`, command `start_llm`): one server at a time, spawned on a
  free port when a model is first needed, restarted when the model changes or the process died,
  killed on app exit. Output goes to `app_data_dir/llama-server.log`.
- Launch flags: `--host 127.0.0.1 --port <free> --model <path> --ctx-size 4096
  --n-gpu-layers 99 --reasoning-budget 0 --no-webui --cors-origins <app origin>
  --no-cors-credentials`.
  - `--reasoning-budget 0` disables "thinking" output on Qwen3.5-family models (verified).
  - CORS defaults to `*`. llama-server echoes `--cors-origins` **verbatim** in
    `Access-Control-Allow-Origin`, so we pass exactly one origin: `tauri://localhost`
    (macOS, Linux), `http://tauri.localhost` (Windows), `http://localhost:1420` (debug builds).
  - Readiness: poll `GET /health` (503 while loading, 200 when ready).
- Default context: **4096 tokens**. That fits about 3 passages of ~800 tokens plus the prompt and
  answer, on 8 GB RAM machines.

## Models (Verified)

All Apache-2.0, not gated, GGUF from Hugging Face. The sha256 is the LFS `oid`.

| Role | Repo / file | Size | sha256 |
|---|---|---|---|
| Default (fast) | `unsloth/Qwen3.5-4B-GGUF` / `Qwen3.5-4B-Q4_K_M.gguf` | 2.74 GB | `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4` |
| Accurate | `unsloth/Qwen3.5-9B-GGUF` / `Qwen3.5-9B-Q4_K_M.gguf` | 5.68 GB | `03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8` |
| Alternative | `google/gemma-4-E4B-it-qat-q4_0-gguf` / `gemma-4-E4B_q4_0-it.gguf` | 5.15 GB | `676c35070db6dbe52f93e9c864ee0fba4eddea94b9c875d9cb10daff453fbaee` |
| Tests only (not offered: loops and echoes the question) | `unsloth/Qwen3.5-0.8B-GGUF` / `Qwen3.5-0.8B-Q4_K_M.gguf` | 0.53 GB | `bd258782e35f7f458f8aced1adc053e6e92e89bc735ba3be89d38a06121dc517` |

- The catalog is hard-coded in `src-tauri/src/models.rs` (exact byte sizes from `x-linked-size`).
- Download URL pattern: `https://huggingface.co/<repo>/resolve/main/<file>`. It answers 302 to a
  CDN that honors `Range` (verified), and `x-linked-etag` carries the sha256.
- Downloads go to `tmp/<file>.part`. Cancelling or quitting keeps the part; the next download
  resumes with `Range: bytes=<len>-`. Once complete, the sha256 is checked (a mismatch deletes the
  part) and the file is renamed into `models/`.
- The first model downloaded becomes active. Removing the model `llama-server` is running stops
  the server first (Windows cannot delete a file in use).

## Frontend libraries (Verified versions)

| Package | Version | Notes |
|---|---|---|
| `ai` | 7.0.x | `streamText` + `toUIMessageStream()` against llama-server: **verified streaming end to end** |
| `@ai-sdk/openai-compatible` | 3.0.x | `createOpenAICompatible({ baseURL: "http://127.0.0.1:<port>/v1" })` |
| `@assistant-ui/react` / `@assistant-ui/react-ai-sdk` | 0.15.x / 1.4.x | `useChatRuntime({ transport })` accepts a custom `ChatTransport` |
| `streamdown` | 2.7.x | Streaming Markdown. Code blocks get copy/download controls; syntax colors would need the `@streamdown/code` plugin (not installed) |
| `@tauri-apps/api` / CLI | 2.12.x | Tauri 3 is alpha only, so we stay on 2 |

Because llama-server sends `Access-Control-Allow-Origin`, the plain webview `fetch` works.
`@tauri-apps/plugin-http` is not needed.

## Search (`src-tauri/src/docs/search.rs`)

1. **Entry names**, scored in memory (docs have at most tens of thousands of entries, so this
   takes a few ms): exact, then prefix, then substring, then typo-tolerant (Jaro-Winkler ≥ 0.88,
   queries of 3+ chars). Ties go to the shorter name.
2. **Page full text** fills the remaining slots: FTS5 `porter unicode61`, contentless, over each
   page converted to Markdown at install time. The query becomes an `OR` of quoted words, so user
   input is never parsed as FTS syntax. Ranked by bm25.

Measured: installing Python 3.15 (22 MB of HTML) takes ~2 s and 27 MB on disk.

Pages render in the webview as DevDocs HTML **sanitized with DOMPurify**, plus the CSP. Link
clicks are intercepted: same-doc links open in the app, others in the system browser.

## Chat pipeline (`src/lib/chat-transport.ts`)

For each question, in the webview:

1. **Doc intent** (`detect_doc`, `src-tauri/src/docs/intent.rs`). Matched in code against the
   cached manifest and installed docs, never by the model: names, slugs, DevDocs aliases plus a few
   extra ones (`golang`, `nodejs`…), and typos (Jaro-Winkler ≥ 0.9). A name only counts in a doc
   position: after "in / with / using / en / avec / dans", or next to "docs / doc / documentation
   / install". Results:
   - another installed doc → switch the picker to it;
   - a doc that is not installed → `InstallDocCard` (newest version first, version picker,
     nothing downloaded without a click). After installing, the question is answered if it was
     more than a bare request ("I want the Rust docs");
   - "Foo docs" with no match → say so and suggest close names.
2. **Search terms**: a short non-streamed call (`temperature 0`, 40 tokens) turns the question into
   English names and words. One French → English example in the prompt makes Qwen3.5 4B reply
   with English API names for non-English questions (measured). A reply that echoes the question
   is dropped (the 0.8B model does this).
3. **Pages**: each term is searched by name (2 hits), then the question plus terms in full text.
   The first 3 distinct pages are kept.
4. **Passages** (`get_passage`): page HTML from the entry's `#anchor` on, converted to Markdown and
   cut at 3000 characters (`PASSAGE_CHARS`). Three passages, the prompt and a 1024-token answer
   fit the 4096-token context.
5. **Answer**: `streamText` at `temperature 0.2`, single turn (earlier messages are not sent: they
   would crowd out the passages). Sources (titles, `devdocs.io` URLs from the index, doc name,
   version, attribution) travel as a `data-sources` part, never through the model.

Measured with Qwen3.5 4B on an Apple Silicon Mac: about 5 s from question to finished answer once
the model is loaded. When the passages do not cover the question, it says so instead of guessing.
Qwen's suggested `presence_penalty 1.5` made answers loop, so it is not set.

Without a model, the chat screen falls back to "search only" (`DocSearch`): doc entries, opened
in the app, no model involved.

The doc picker (left) and model picker (right) sit under the question field. Each ends with an
item that opens Settings.

## Doc icons (`src/assets/doc-icons/`, `src/components/DocIcon.tsx`)

DevDocs' own 32×32 icons (`public/icons/docs/<name>/16@2x.png` in `freeCodeCamp/devdocs` at
commit `9e13e6369553ec8e1bba3d6be525417cbf016be0`), one per slug without its version, bundled so
they work offline (Vite inlines them, ~440 KB). Two docs use an icon with another name
(`ALIASES`); the 6 docs without one get their initial on a colored tile. In dark mode, logos sit
on a light tile, as many are dark.

## First launch (`src/components/Welcome.tsx`)

Shown when no model is downloaded and no doc is installed. It offers the recommended model and
the newest version of a few popular docs (Python, JavaScript, TypeScript, Rust, Go, HTML, CSS),
each with its size, next to the free space of the disk holding `app_data_dir` (`free_disk_space`,
via `fs4`). A download that does not fit is disabled. Everything is optional: "Skip for now" opens
the chat, which can search docs without a model.

## Releases (`.github/workflows/release.yml`)

- Pushing a `v*` tag builds installers with `tauri-apps/tauri-action` into a **draft** GitHub
  release: macOS arm64 and x64 (`.dmg`, `.app.tar.gz`), Windows x64 (`.msi`, NSIS `.exe`), Linux
  x64 (`.AppImage`, `.deb`, `.rpm`). Each job runs `pnpm fetch:llama <target>` first, so every
  installer bundles the `llama-server` build for its own platform. Keep the tag and the version in
  `tauri.conf.json`, `Cargo.toml` and `package.json` equal.
- `THIRD_PARTY_NOTICES.md` is bundled as a resource: it carries the llama.cpp license, which the
  Windows archive does not include.
- The `.deb` and `.rpm` depend on OpenSSL 3 and the Vulkan loader, which the Linux `llama-server`
  links.
- **Builds are unsigned.** macOS shows a Gatekeeper warning (right-click → Open, or
  `xattr -dr com.apple.quarantine /Applications/Scholion.app`), Windows a SmartScreen warning.
  To sign, add the secrets Tauri reads (`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` for macOS signing and
  notarization; a certificate in `bundle.windows` for Windows) and pass them to the
  `tauri-action` step. See https://v2.tauri.app/distribute/sign/.
- No auto-updater: users download new versions from the releases page.

## Storage layout (`app_data_dir`)

| Path | Content |
|---|---|
| `settings.json` | Active model, doc auto-update flag |
| `manifest.json` | Cached DevDocs manifest + stored redirect `Location` |
| `docs/<slug>.sqlite` | `meta` (manifest entry as JSON), `entries`, `pages` (HTML), `pages_fts` (FTS5) |
| `models/<file>.gguf` | Downloaded models |
| `llama-server.log` | Output of the last `llama-server` run |
| `tmp/` | In-progress doc installs and model downloads (`<file>.part`, kept to resume) |
