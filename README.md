# Scholion

[![CI](https://github.com/PerretWilliam/scholion/actions/workflows/ci.yml/badge.svg)](https://github.com/PerretWilliam/scholion/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/PerretWilliam/scholion)](https://github.com/PerretWilliam/scholion/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Ask a programming question and get a sourced answer from the official documentation, written by a
small language model that runs entirely on your machine.

- **Offline** once docs and a model are installed. Nothing leaves your computer.
- **Sourced**: statements carry `[1]`-style citations. A click opens the exact documentation page
  in the built-in reader, with attribution under every answer.
- **A real documentation browser**: syntax highlighting, find in page, full screen, working links.
  Without a model, search the docs directly.
- **Conversations that remember**: follow-up questions ("and with a dict?") are understood.
  History is saved locally, searchable, renamable and exportable to Markdown.
- **Cross-platform**: macOS, Windows, Linux.
- **Self-contained**: no Ollama or other runtime to install. Docs ([DevDocs](https://devdocs.io))
  and models download on demand.
- **Optional cloud model**: bring an OpenRouter or OpenAI key (kept in your OS keychain) if you
  prefer a bigger model over staying offline.

> Status: early development (0.x). Expect rough edges; issues and feedback are very welcome.

## Install

Download the installer for your OS from the
[releases page](https://github.com/PerretWilliam/scholion/releases/latest).

Builds are not signed yet. On macOS, right-click the app and choose Open the first time (or run
`xattr -dr com.apple.quarantine /Applications/Scholion.app`). On Windows, choose "More info" →
"Run anyway" in the SmartScreen prompt.

On first launch, Scholion guides you through downloading a model (about 3 GB for the default,
Qwen3.5 4B) and a few docs. Everything else is in Settings.

## Using it

Ask in your language: the answer follows it, while the docs stay in English. Name a doc in the
question ("in Rust, how do I read a file?") to switch to it or to be offered its installation.

| Shortcut | Action |
|---|---|
| ⌘/Ctrl + N | New conversation |
| ⌘/Ctrl + K | Focus the question field |
| ⌘/Ctrl + D | Next documentation |
| ⌘/Ctrl + F | Find in the open doc page |
| Esc | Leave full screen, close find |

## How it works

question → the doc you mean → search terms → full-text search of the installed docs → the best
pages → a streamed answer from the local `llama-server` (llama.cpp). The model only sees the
passages it is given and is told to say so when they do not cover the question. Details in
[docs/architecture.md](docs/architecture.md).

## Contributing

Contributions of every size are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) for the setup,
the conventions and how releases work. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md),
and report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

```bash
pnpm install
pnpm fetch:llama   # pinned llama.cpp build for this OS
pnpm tauri dev
pnpm check         # lint, typecheck and tests (TS + Rust): what CI runs
```

Requirements: Node 24+, pnpm 12, Rust (pinned by `rust-toolchain.toml`) and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Product spec:
[docs/spec.md](docs/spec.md).

## Credits

- Documentation from [DevDocs](https://devdocs.io). Each doc keeps its own license and attribution,
  shown under every answer.
- Local inference by [llama.cpp](https://github.com/ggml-org/llama.cpp) (MIT).
- Built with [Tauri](https://tauri.app), React, [assistant-ui](https://www.assistant-ui.com) and
  the [AI SDK](https://ai-sdk.dev).
- Full list in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE) © William Perret
