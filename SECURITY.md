# Security policy

## Supported versions

Only the latest release receives fixes.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through
[GitHub security advisories](https://github.com/PerretWilliam/scholion/security/advisories/new).
You will get an answer within a few days.

Scholion runs a local model and downloads documentation and models on your behalf, so these are
of particular interest: sanitizing of DevDocs HTML, the webview's content security policy, the
handling of the cloud API key (kept in the OS keychain), and the integrity checks on downloads.
