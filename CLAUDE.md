# CLAUDE.md

Guidance for AI agents working in this repository.

## Language rule

**Everything in this repository is written in English**: code, identifiers, comments, commit
messages, docs, UI strings, error messages, logs, CI config. The user may chat in French; the
repository stays English. The only non-English output allowed is the model's answer to the end
user, which follows the language of the question.

## What this is

Scholion is a Tauri 2 desktop app that answers programming questions from locally installed
DevDocs documentation, using a local GGUF model served by a bundled `llama-server` (llama.cpp).

- Product spec: [docs/spec.md](docs/spec.md)
- Technical reference (verified URLs, formats, versions, checksums): [docs/architecture.md](docs/architecture.md)

## Commands

```bash
pnpm install          # install JS deps
pnpm fetch:llama      # download the pinned llama-server build (needed before any cargo command)
pnpm tauri dev        # run the app
pnpm check            # everything CI runs: lint, typecheck, tests (TS + Rust)
pnpm format           # Biome format + safe fixes (TS/JSON/CSS)
pnpm format:rust      # cargo fmt
pnpm lint             # Biome
pnpm lint:rust        # cargo fmt --check + clippy -D warnings
pnpm test             # Vitest
pnpm test:rust        # cargo test
```

Live tests against real services are `#[ignore]`d. Run them with
`cargo test --manifest-path src-tauri/Cargo.toml -- --ignored` after touching network code.

Run `pnpm check` before declaring work done.

## Layout

- `src/`: React frontend. `@/` aliases `src/`.
  - `components/ui/`: shadcn/ui primitives (generated with `pnpm dlx shadcn add`; edit sparingly).
  - `components/chat/`, `components/settings/`: app screens.
  - `lib/`: IPC wrappers, chat transport, prompts, utilities.
- `src-tauri/`: Rust backend. All `#[tauri::command]` functions live in `commands.rs`.
- `docs/`: spec and architecture.

## Conventions

- **Keep it small.** No abstraction with a single implementation, no speculative config, no new
  dependency when a few lines or an installed one will do. Justify every new dependency in the PR.
- **Network in Rust only.** The webview may only reach `llama-server` on `127.0.0.1` and the optional
  cloud providers listed in the CSP (`src/lib/providers.ts`). Downloads (manifest, docs, models) go through Rust.
- **Never re-download** DevDocs data on launch; manifest checks are limited to one per 24 h.
- **Never let the model produce URLs.** Source links are built from the manifest and entry paths.
- **Attribution** from DevDocs is HTML: sanitize before rendering.
- **Errors (Rust):** one `AppError` enum, serialized to the frontend. No `unwrap()` / `expect()` outside
  tests and app startup.
- **Errors (TS):** surface them to the user; never swallow them silently, except the documented
  offline manifest check.
- **Atomic writes:** download into `tmp/`, verify, then rename into place.
- **Tests:** Vitest next to the code (`*.test.ts`), Rust unit tests in `#[cfg(test)]` modules,
  fixtures under `src-tauri/tests/fixtures/`. Do not hit the network in tests.
  The live `llama-server` test also needs `SCHOLION_LIVE_MODEL=/path/to/model.gguf`.
- **Formatting:** Biome (2 spaces, 100 cols) and rustfmt defaults. Do not hand-format.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`, `ci:`).
- **UI:** follows the OS light/dark scheme via `prefers-color-scheme` (see `src/index.css`).
  Keep it accessible: labeled controls, keyboard reachable, visible focus.

## Pinned external versions

llama.cpp release, model files and their sha256 are pinned in `docs/architecture.md`. Update the
doc and the code together.
