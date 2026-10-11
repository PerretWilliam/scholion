# Contributing to Scholion

Thanks for helping! Bug reports, ideas, docs fixes and code are all welcome. By taking part you
agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Contributions are released under the
[MIT license](LICENSE).

## Ways to contribute

- **Report a bug** or **suggest a feature** with an
  [issue](https://github.com/PerretWilliam/scholion/issues/new/choose). For a bug, include your OS, the Scholion
  version, the model and documentation involved, and `llama-server.log` if the model fails to start.
- **Ask a question** or float an idea in
  [Discussions](https://github.com/PerretWilliam/scholion/discussions).
- **Pick up an issue** labelled `good first issue` or `help wanted`. Say so in a comment first, so
  nobody works twice on the same thing.
- **Report a vulnerability** privately: see [SECURITY.md](SECURITY.md).

For anything bigger than a small fix, open an issue to agree on the approach before writing code.

## Set up

Requirements: Node 24+, pnpm 12, Rust (pinned by `rust-toolchain.toml`) and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
pnpm install
pnpm fetch:llama   # pinned llama.cpp build, needed before any cargo command
pnpm tauri dev
```

A tour of the code is in [CLAUDE.md](CLAUDE.md) (layout and conventions, useful for humans too),
[docs/spec.md](docs/spec.md) (what the app does) and [docs/architecture.md](docs/architecture.md)
(how, with verified URLs and formats).

## Make a change

1. Fork the repository and create a branch from `main`.
2. Make the change. Keep it small and focused: no abstraction with a single user, no new
   dependency when a few lines or an installed one will do (justify any new dependency in the PR).
3. Add or update tests: Vitest next to the code (`*.test.ts`), Rust unit tests in `#[cfg(test)]`
   modules. Tests never touch the network.
4. Run everything CI runs:

   ```bash
   pnpm check
   ```

   `pnpm format` and `pnpm format:rust` fix formatting (Biome and rustfmt; do not hand-format).
5. Open a pull request. Fill in the template and link the issue.

### Rules that matter

- **Everything in the repository is in English**: code, comments, commit messages, docs, UI
  strings, errors. Only the model's answer follows the language of the question.
- **Network access lives in Rust.** The webview only reaches the local `llama-server` and the
  cloud providers listed in the CSP.
- **The model never produces URLs.** Source links are built from the manifest and entry paths.
- **DevDocs HTML is sanitized** before it is rendered.
- **No `unwrap()` / `expect()`** in Rust outside tests and app startup.
- **Keep the UI accessible**: labeled controls, keyboard reachable, visible focus, both color
  schemes.
- Changed behavior means updated docs (`docs/spec.md`, `docs/architecture.md`, README).
- Live tests against real services are `#[ignore]`d. After touching network code, run
  `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored`.

## Commits and releases

Commits and PR titles follow [Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`, `ci:`, `perf:`. Pull requests are
squash-merged, and the PR title becomes the commit message (a check enforces its format).

Versions are automatic. From the commits on `main`, [release-please](https://github.com/googleapis/release-please)
keeps a release PR open that bumps the version everywhere and updates `CHANGELOG.md`: `fix:` makes
a patch, `feat:` a minor (while below 1.0), `feat!:` or a `BREAKING CHANGE:` footer a breaking
change. When a maintainer merges that PR, a GitHub release is created and installers for macOS,
Windows and Linux are built and attached. Never bump versions by hand.
