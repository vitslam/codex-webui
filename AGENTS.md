# Development

This is an independent, single-machine open-source project. Do not copy the
private deployment's Git history, credentials, account information, infrastructure
addresses, databases, logs, generated files, or deployment hooks into this repo.
There is no automatic production deployment. Do not add a remote or publish
without an explicit request.

Stage 4 also adds native account/quota/MCP panels, image inputs, workspace skills
and persisted context usage. Keep schema 3 → 4 → 5 → 6 → 7 → 8 migrations non-destructive.
Keep native Codex integration behind the adapter boundary. Never run a real model
in normal tests. Use fake executables and isolated configuration/data directories.

Use Python 3.11+ and the standard library for runtime code. Run relevant checks:
`python -m unittest discover -s tests -v`, and build/install a wheel when packaging
changes. Preserve English and Chinese documentation/UI together.

Keep disposable scripts, test output, build artifacts and screenshots in the
task's private temporary directory. Set TMPDIR, TEMP, TMP and browser cache paths
there; use umask 077. Never clean or modify native Codex credentials or another
service's data. Use only processes and process groups started by this project.
