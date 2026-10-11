# Architecture

Technical reference for ai-doc. Product requirements live in [spec.md](spec.md).
Everything marked **Verified** was checked against the live services on 2026-10-11 (Phase 0).

## Overview

```
┌──────────────────────── Tauri webview (React) ────────────────────────┐
│ assistant-ui Thread ── useChat ── ChatTransport (src/lib/chat-transport.ts)
│                                      │  1. invoke("search", …)          │
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
- Archives contain `llama-server` **plus shared libraries** (`@loader_path` rpath on macOS).
  A single `externalBin` sidecar is not enough. We ship the `llama-server` executable and its
  libraries as a Tauri **resource folder** (`resources/llama/`) and spawn it from the resource dir.
  The unpacked macOS folder is ~31 MB, and we can drop the unused CLI tools.
- Assets per platform (sha256 from the GitHub release `digest`):

| Target | Asset | sha256 |
|---|---|---|
| macOS arm64 (Metal) | `llama-b11552-bin-macos-arm64.tar.gz` | `f4b33fe40d098033fb1a19a8a4a84383c4ca84c37b6a60d9f9a253f349b48c07` |
| macOS x64 | `llama-b11552-bin-macos-x64.tar.gz` | `b7977620cf5c30b8905caa45d7dbcc08766b5d4a94b3cde66ecf0323a495096f` |
| Windows x64 (Vulkan) | `llama-b11552-bin-win-vulkan-x64.zip` | `83dc16325b532ba603034719e8377e28ca5093c5d4370141a6522f1a0250386c` |
| Windows x64 (CPU fallback) | `llama-b11552-bin-win-cpu-x64.zip` | `c00741179811ff903b515eae28bdeef1f47af6e81c49920c4e68b62954e056d6` |
| Linux x64 (Vulkan) | `llama-b11552-bin-ubuntu-vulkan-x64.tar.gz` | `c7bb933f3584b73296fbadea6e0d6273ddb7907699ec59ef08d0bb59e0a8b997` |
| Linux x64 (CPU fallback) | `llama-b11552-bin-ubuntu-x64.tar.gz` | `a45a6afda05d08028bd37998072ab602c96799bccde126835941623cb99bb727` |

- Launch flags: `--host 127.0.0.1 --port <free> -m <model> -c 4096 -ngl 99 --reasoning-budget 0`.
  - `--reasoning-budget 0` disables "thinking" output on Qwen3.5-family models (verified).
  - CORS defaults to `*`. Restrict it with `--cors-origins` to the Tauri origin.
  - Readiness: poll `GET /health` until `{"status":"ok"}`.
- Default context: **4096 tokens**. That fits about 3 passages of ~800 tokens plus the prompt and
  answer, on 8 GB RAM machines.

## Models (Verified)

All Apache-2.0, not gated, GGUF from Hugging Face. The sha256 is the LFS `oid`.

| Role | Repo / file | Size | sha256 |
|---|---|---|---|
| Default (fast) | `unsloth/Qwen3.5-4B-GGUF` / `Qwen3.5-4B-Q4_K_M.gguf` | 2.74 GB | `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4` |
| Accurate | `unsloth/Qwen3.5-9B-GGUF` / `Qwen3.5-9B-Q4_K_M.gguf` | 5.68 GB | `03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8` |
| Alternative | `google/gemma-4-E4B-it-qat-q4_0-gguf` / `gemma-4-E4B_q4_0-it.gguf` | 5.15 GB | `676c35070db6dbe52f93e9c864ee0fba4eddea94b9c875d9cb10daff453fbaee` |

Download URL pattern: `https://huggingface.co/<repo>/resolve/main/<file>`.
Dev and test model: `unsloth/Qwen3.5-0.8B-GGUF` / `Qwen3.5-0.8B-Q4_K_M.gguf` (0.53 GB).

## Frontend libraries (Verified versions)

| Package | Version | Notes |
|---|---|---|
| `ai` | 7.0.x | `streamText` + `toUIMessageStream()` against llama-server: **verified streaming end to end** |
| `@ai-sdk/openai-compatible` | 3.0.x | `createOpenAICompatible({ baseURL: "http://127.0.0.1:<port>/v1" })` |
| `@assistant-ui/react` / `@assistant-ui/react-ai-sdk` | 0.15.x / 1.4.x | `useChatRuntime({ transport })` accepts a custom `ChatTransport` |
| `streamdown` | 2.7.x | Streaming Markdown |
| `@tauri-apps/api` / CLI | 2.12.x | Tauri 3 is alpha only, so we stay on 2 |

Because llama-server sends `Access-Control-Allow-Origin`, the plain webview `fetch` works.
`@tauri-apps/plugin-http` is not needed.

## Storage layout (`app_data_dir`)

| Path | Content |
|---|---|
| `settings.json` | Active model, selected doc per language, auto-update flag, last manifest check |
| `manifest.json` | Cached DevDocs manifest + stored redirect `Location` |
| `docs/<slug>.sqlite` | `entries`, `pages`, FTS5 (trigram) index, `meta` (mtime, attribution, version) |
| `models/<file>.gguf` | Downloaded models |
| `tmp/` | In-progress downloads and installs; swapped in atomically on success |
