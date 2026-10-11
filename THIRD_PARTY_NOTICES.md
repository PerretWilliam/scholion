# Third-party notices

Scholion is released under the [MIT License](LICENSE). It bundles, or downloads at the user's
request, the following third-party software and content.

## Bundled

### llama.cpp (`llama-server` and its libraries)

Bundled in every installer, from release `b11552` of
[ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp).

```
MIT License

Copyright (c) 2023-2026 The ggml authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Rust crates and npm packages

The app is compiled from open-source Rust crates and npm packages, under MIT, Apache-2.0 and
similar permissive licenses. Their notices ship with their sources: see `src-tauri/Cargo.lock` and
`pnpm-lock.yaml` for the exact versions.

### DevDocs icons

The doc logos in `src/assets/doc-icons/` come from [DevDocs](https://github.com/freeCodeCamp/devdocs)
(Mozilla Public License 2.0, © Thibaut Courouble and other contributors). Each logo is a trademark
of its owner; the source of each is listed in the DevDocs repository.

## Downloaded at the user's request

### Language models

Downloaded from Hugging Face from the Settings or first-launch screen, never bundled. All models
offered are released under the Apache License 2.0 by their authors (Qwen team, Google).

### Documentation

Downloaded from [DevDocs](https://devdocs.io), never bundled. Each doc keeps its own copyright and
license, shown under every answer that uses it and listed in the DevDocs manifest.
