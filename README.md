# Scholion

Ask questions about a programming language and get short, sourced answers from its official
documentation, powered by a small language model running entirely on your machine.

- **Offline** once docs and a model are installed
- **Sourced**: every answer links to the documentation page it came from, with attribution
- **Cross-platform**: macOS, Windows, Linux
- **Self-contained**: no Ollama or other runtime to install; docs and models download on demand

> Status: early development. See [docs/spec.md](docs/spec.md) for the product spec and
> [docs/architecture.md](docs/architecture.md) for technical details.

## Install

Download the installer for your OS from the GitHub releases page. Builds are not signed yet: on
macOS, right-click the app and choose Open the first time; on Windows, choose "More info" → "Run
anyway" in the SmartScreen prompt.

On first launch, Scholion offers a model (about 3 GB) and a few docs to download. Everything else is
in Settings.

## Development

Requirements: Node 24+, pnpm 12, Rust (pinned by `rust-toolchain.toml`), and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
pnpm install
pnpm fetch:llama   # pinned llama.cpp build for this OS, into src-tauri/resources/llama/
pnpm tauri dev
```

Before pushing:

```bash
pnpm check
```

## Credits

- Documentation from [DevDocs](https://devdocs.io). Each doc keeps its own license and attribution,
  shown under every answer.
- Local inference by [llama.cpp](https://github.com/ggml-org/llama.cpp) (MIT).
- Full list in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE)
