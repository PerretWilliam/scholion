# Changelog

## [0.1.0](https://github.com/PerretWilliam/scholion/compare/v0.0.1...v0.1.0) (2026-10-11)


### Features

* add DevDocs doc manager (manifest, install, update, remove) ([7995e80](https://github.com/PerretWilliam/scholion/commit/7995e8098b8a3949fd37edbe5483fbcaaaffe793))
* add first-launch screen, release workflow and third-party notices ([38efc76](https://github.com/PerretWilliam/scholion/commit/38efc76a6fe0fc7d8f8fe9885c558f406d54b319))
* add lexical doc search and search-only mode ([5b6ad03](https://github.com/PerretWilliam/scholion/commit/5b6ad032424d02be31774e038881d2c9d8572063))
* add model manager with resumable, verified downloads ([bf40eda](https://github.com/PerretWilliam/scholion/commit/bf40eda2e93291ae44473f957a398910f2ff2062))
* answer questions from the docs with sources and in-chat doc install ([78916a4](https://github.com/PerretWilliam/scholion/commit/78916a41c394e4c5438f7bd2f329cb8947972a94))
* answer sections adapt to the question instead of a fixed list ([7212f27](https://github.com/PerretWilliam/scholion/commit/7212f277b9a66de8fe5503d7dc0587955996343d))
* bundle llama-server and manage its lifecycle ([f7c92fe](https://github.com/PerretWilliam/scholion/commit/f7c92fefcb53267f0d0c9918e89beb612bf419a1))
* Claude-style doc and model pickers, doc logos, drop the 0.8B model ([1fe2bd2](https://github.com/PerretWilliam/scholion/commit/1fe2bd23d309724d2e68e42920885f328183a593))
* clickable citations, skip needless rewrites, stricter page sanitizing ([48d26d8](https://github.com/PerretWilliam/scholion/commit/48d26d86b9a992c5ae0183965485f2268add4d46))
* conversation history sidebar ([b806de3](https://github.com/PerretWilliam/scholion/commit/b806de37062e435f2714c39eaa4852bd7e1aac6e))
* documentation-style answers, syntax highlighting, follow-up questions, copy feedback ([a85192f](https://github.com/PerretWilliam/scholion/commit/a85192ffedf79ab7f6f307aac72da7e40a7ed44e))
* find in the displayed doc page ([247abd4](https://github.com/PerretWilliam/scholion/commit/247abd4f78e7050481fd1130bdf602317c7f6889))
* history in a file, doc kept per conversation, answers continue in background ([9ad5690](https://github.com/PerretWilliam/scholion/commit/9ad56904a38d724a93ccf7aeb6a0724e9dd7b68b))
* more complete answers with 4 passages, 8192-token context and a completeness prompt ([57ab46a](https://github.com/PerretWilliam/scholion/commit/57ab46a3ecc21481ab8e97a669311314b080cdb1))
* name the app Scholion, with its own logo ([1a5536f](https://github.com/PerretWilliam/scholion/commit/1a5536f01e312acae7a543925868310ff94f81d5))
* open cited sources in an in-app reader instead of devdocs.io ([8b92773](https://github.com/PerretWilliam/scholion/commit/8b92773d3f84dd973aec4bf58893b1b7353050b8))
* paginated doc lists, optional cloud provider (OpenRouter, OpenAI), drop sidebar remove-all ([743cc21](https://github.com/PerretWilliam/scholion/commit/743cc21c65a2d3a46b0c2e201bb27b8de40df78b))
* remove-all buttons for models and docs in settings ([a0fa307](https://github.com/PerretWilliam/scholion/commit/a0fa307868c757617126b0ca0afe28695a2cb5de))
* rerank full-text hits by title, standalone follow-up questions, numbered citations ([c7109e3](https://github.com/PerretWilliam/scholion/commit/c7109e3849a71e76c76cbc1c5af515c5ede7664e))
* sidebar search, rename, export and busy indicator; shortcuts; storage view; API key in the OS keychain ([55f18f5](https://github.com/PerretWilliam/scholion/commit/55f18f5004d5e39b9e94bede0693ad8dc589107f))
* syntax highlighting in doc pages, full-screen reader ([d5d3fee](https://github.com/PerretWilliam/scholion/commit/d5d3fee7470782ca2af7b3021d10dd6d5d8659fe))
* tile-less logo in the app header that follows light and dark mode ([5c0e049](https://github.com/PerretWilliam/scholion/commit/5c0e049f5e74cd19c0697f3489f3370d8b100af3))


### Bug Fixes

* doc code blocks follow the color scheme ([6bd2a8c](https://github.com/PerretWilliam/scholion/commit/6bd2a8c01b21fabb5a1f116267220110028a601d))
* keep answers in the language of the question ([ff62a2c](https://github.com/PerretWilliam/scholion/commit/ff62a2c99fbabeb22d8c37fcd07b42a6a827cf01))
* stop leftover llama-server, redraw current find match, scope anchors to the page ([#13](https://github.com/PerretWilliam/scholion/issues/13)) ([d894e04](https://github.com/PerretWilliam/scholion/commit/d894e045888a8762bef576ec5b96e920593f336e))
