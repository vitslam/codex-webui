# Security

This pre-alpha supports one trusted owner. The default bind is loopback; you may also
bind a specific IPv4 address or `0.0.0.0`. It is not a multi-user execution sandbox.
Chat endpoints start real local Codex turns (token-authenticated by default). The selected workspace
is not an OS sandbox. Native sandbox/approval settings and the OS user permissions
control execution; use a dedicated OS account.

Web tokens and native Codex credentials are separate. Private directories/files
use owner-only permissions. Requests validate Host against the bind address (local interface addresses for wildcard binds) and same-origin browser
writes, use HttpOnly/SameSite session cookies in the default token-required mode, and do not load third-party assets.
Sessions expire after 12 hours and are discarded at restart. Stop requests require
authentication and an instance ID; no stale PID is killed.

No credentials, filled-in `.env`, auth files, databases or private logs belong in
issues or pull requests. Rotate any exposed credential immediately; deleting a
file from the latest commit does not remove it from Git history. For the Web token,
run `lazyfish stop`, `lazyfish token --rotate`, then `lazyfish serve`; see
[configuration](docs/configuration.md) for environment overrides.

`127.0.0.1` is the default. Opting into `0.0.0.0` listens on all IPv4 interfaces,
including any public-facing interface; a specific unicast IPv4 binds only that
address. Host validation is not a network access control: a client can supply an
allowed Host header from any reachable network. Use a firewall as needed. HTTP
does not encrypt the Web token, session cookie or conversation data.

`lazyfish serve --no-token` is an explicit, per-run opt-in to disable Web sign-in.
Anyone who can reach the URL gets the same Codex access as the token owner,
including downloads, native account controls and task execution. Host/same-origin
checks stay enabled; they do not replace authentication. HTTP stays unencrypted.
No Web session cookie or sign-out can restrict access in this mode. The CLI still
uses the retained private token for status/stop; shutdown requires credentials and
the matching instance ID. Restart without the flag to restore Web sign-in; token
rotation still requires stopping first. See [configuration](docs/configuration.md).

## Reporting

Before a public repository and private reporting channel exist, do not publish
sensitive exploit details. When published, use the repository's private security
advisory/reporting feature, if enabled, or a private channel explicitly documented
by its owner. A real contact must be added before the first public release.
There is currently no security support SLA; only the latest pre-alpha is maintained.

## Task lifetime

A browser disconnect does not cancel a task. Native process ownership is journaled
before exec, with a lease, machine/boot identity and platform-native process start time (Linux ticks or macOS epoch microseconds).
Shutdown/recovery acts on verified owned process sessions, not arbitrary stale
PIDs. Interrupted tasks are never automatically replayed. Sessions that cannot be
confirmed stopped remain blocked. Code that intentionally detaches into another
OS session or delegates to external services is outside this local process-session
cleanup guarantee; do not treat a Web UI as an isolation boundary.

## Native authorization and outputs

Native login sessions use the same owned-process journal/lease as executions.
Only authorization URL/device code/status are returned; submitted API keys are
forwarded to Codex, not stored in app history, browser storage or logs. Treat the
Web token as control of the native account, including sign-in/out. Web disconnect
is separate from native sign-out. Native question answers are sent to Codex; even
when secret fields are not directly persisted by Lazyfish, native history or model
output can contain the submitted text.

Output downloads require authentication by default. Generic file links snapshot only permitted
workspace/output paths, excluding app/native configuration and common credential
files. Raster outputs are signature-checked; SVG/HTML download as attachments.
This is not a secret detector or isolation boundary: the authenticated owner and
Codex can read files allowed by their OS/native permissions. Diff/Markdown/output
content may include workspace data; keep the data directory and backups private.
