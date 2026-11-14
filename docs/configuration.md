# Configuration

`lazyfish init` creates `config.toml` and
`secrets.env` under `$XDG_CONFIG_HOME/lazyfish` (default `~/.config/lazyfish`).
Re-running init preserves existing configuration, even if new arguments differ.
Edit the existing file explicitly to change it.
Restart the service after editing configuration. Keep configuration and secrets out of
Git, and retain owner-only file permissions (`600`).

Commands discover configuration in this order: explicit `--config`,
`LAZYFISH_CONFIG`, the standard `config.toml`, then a remembered custom installation.
When no standard configuration exists, the first successful `init` or command
using a custom configuration saves its absolute path in
`$XDG_CONFIG_HOME/lazyfish/installation.json` (default `~/.config/lazyfish`).
This private file contains only a path; configuration, secrets and history stay
where they are. Subsequent `lazyfish token`, `serve`, `status` and `stop`
work without `--config`, regardless of the current directory. Another custom
instance never silently replaces the remembered choice. Explicit `--config`
remains available for multiple instances and precedes the command.

Existing custom installations are remembered on the first successful command
after upgrading. Missing or unsafe saved files produce an error rather than
creating a new token or selecting another instance. Restore the saved path, or
use an explicit override; to forget it, remove only `installation.json`.

```toml
[server]
host = "127.0.0.1"
port = 3210

[paths]
workspace = ""
data_dir = "/path/to/private/lazyfish-data"

[codex]
binary = "codex"
model = ""
effort = ""
sandbox = "workspace-write"
approval_policy = "on-request"

[security]
secrets_file = "secrets.env"

[logging]
level = "INFO"
```

Relative paths are resolved against the configuration directory. A bare Codex
command is resolved through PATH; executable paths may also be absolute or relative.
Workspace is optional. An empty value uses the service user’s home directory without creating or changing permissions on that directory. An explicit workspace must exist and supplies only the default for new chats. Any existing absolute directory can be selected. Settings saves a shared server default in the private application database; clearing it restores the configured default (or the home directory when unconfigured). Changing a default never rewrites existing conversation directories. Port `0` asks the OS for an available port, shown at start.
The server binds to `127.0.0.1` by default. Set `server.host = "0.0.0.0"` (or `LAZYFISH_HOST=0.0.0.0`) to listen on all IPv4 interfaces; startup prints the available addresses. A specific unicast IPv4 (e.g. `192.168.1.10` or a public address) can bind just one interface. Token authentication remains required by default. Host checks reject requests whose Host header is not an address of this process; they are not a firewall. HTTP is unencrypted; use a firewall to limit who can connect, and use an SSH tunnel on untrusted networks. You choose the bind address and are responsible for who can reach it.
Unknown keys are rejected so spelling errors do not silently disable settings.

| Environment variable | Overrides |
| --- | --- |
| `LAZYFISH_CONFIG` | Configuration file |
| `LAZYFISH_WORKSPACE` | `paths.workspace` |
| `LAZYFISH_DATA_DIR` | `paths.data_dir` |
| `LAZYFISH_CODEX_BIN` | `codex.binary` |
| `LAZYFISH_HOST`, `LAZYFISH_PORT` | `server.host`, `server.port` |
| `LAZYFISH_LOG_LEVEL` | `logging.level` |
| `LAZYFISH_TOKEN` | Generated Web token |

Optional `secrets.env` keys: `LAZYFISH_TOKEN`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`,
`CODEX_HOME`, `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` (also lowercase
proxy variants), `SSL_CERT_FILE`, `SSL_CERT_DIR`, `REQUESTS_CA_BUNDLE`,
`NODE_EXTRA_CA_CERTS`. Process environment values override nonempty file values.

```dotenv
# init generates LAZYFISH_TOKEN automatically. Retain its generated value.
# Only add keys you actually need:
HTTPS_PROXY=http://proxy.example:3128
NO_PROXY=localhost,127.0.0.1,::1
```

The parser supports `KEY=value`, comments and matching outer quotes. It performs
**no shell evaluation, expansion, interpolation or `export` statements**. It never
loads `.env` from an untrusted workspace. No unrelated environment credentials or
Web token are passed to Codex child processes. Native Codex still controls its own
authentication/provider setup; adding an API key here does not replace native login.

To rotate the Web token, stop the service first, then run:

```bash
lazyfish stop
lazyfish token --rotate
lazyfish serve
```

`--rotate` prints only the new token to stdout and a confirmation to stderr. It
atomically updates the configured secrets file with mode `600`, preserving other
keys and comments. It refuses while this data directory's instance is running;
it does not stop the service automatically. If a nonempty `LAZYFISH_TOKEN` is set
in the process environment, unset it first: environment values override the file.
Use the same configuration for all three commands; for a custom instance, put
`--config /path/to/config.toml` before each command. Plain `lazyfish token` only
reveals the current token; init and the installer never rotate existing tokens.

Manual fallback: while stopped, replace `LAZYFISH_TOKEN` in the configured secrets
file with a random ASCII token of at least 32 non-whitespace characters, retain
mode `600`, and restart. Never put a token in a URL, Git commit or issue. Existing
browser sessions die on restart.

`PYTHON` and `VENV_DIR` apply to the installer only. It uses an isolated temporary
directory under `$XDG_CACHE_HOME/lazyfish` and removes that temporary directory
after installation. The `~/.local/bin/lazyfish` launcher remembers the absolute
virtual environment path, including a custom `VENV_DIR`. Normal service diagnostics use `data_dir/runtime/tmp`.

## Optional Web sign-in bypass

`lazyfish serve --no-token` explicitly disables Web token authentication for that
run only. The default `lazyfish serve` still requires a token. There is no saved
configuration setting or environment switch for this mode; pass the flag on each
start where you intend to disable sign-in.

**Warning:** anyone who can reach the URL can use this Codex session, including
conversation history, accessible files, task execution and native account controls.
This applies to every supported bind, including `0.0.0.0` and public IPv4 addresses.
Host and same-origin checks remain enabled but are not authentication or a firewall.
HTTP remains unencrypted. Restrict reachability to people you trust with that access.
This flag does not bypass native Codex login or change its permissions.

The UI opens without a token or a Web session cookie. Web disconnect is hidden
because it cannot revoke open access. `lazyfish status` and `lazyfish stop` work
unchanged: the CLI still uses the private token for authenticated lifecycle requests
(the status probe uses `/api/control/status`), and stop still checks the instance ID.
The open Web API cannot shut down the service without valid credentials. Keep the
private configuration and token files even when Web sign-in is disabled.

`lazyfish token` still reveals the retained token deliberately; `token --rotate`
still requires stopping the instance first. Neither startup nor this flag prints
or rotates the token. Starting again without `--no-token` requires the current
(possibly rotated) token. Init and the installer preserve existing tokens.

## Execution defaults

Empty `codex.model` / `codex.effort` inherit native defaults. Installation sandbox
and approval settings are defaults, not a hard ceiling on the authenticated owner.
The original permission menu can explicitly select ask, auto-review, full access,
read-only or custom CLI configuration for subsequent tasks. Without a choice, the
server defaults apply. Full access maps to `danger-full-access` + `never`; only use
it when intended. Native capabilities and OS permissions still apply.

Existing conversations retain their workspace when the global default changes;
the directory dialog can update it while idle. The data directory includes
`lazyfish.db` (schema 9), attachments, replayable events and owned execution journals.
Schema 5 → 6 adds typed outputs/reports, item details, pin order, supplementary instructions, native questions and edit audit records; history/native IDs remain unchanged.
Do not edit/remove running task rows, journals or lease files to unblock a session.

Generated output bytes are snapshotted in SQLite. Per-turn scratch lives under
`data_dir/runtime/tmp/<job>` and is removed after confirmed turn completion/owned cancellation. Durable
model deliverables can live under `data_dir/outputs/<job>`; keep these when backing up.
The native credential directory is not migrated into Lazyfish. See [features](features.md).

## Display snapshots

Schema 6 → 7 adds only metadata_cache; it preserves task history and native IDs.
Sanitized native display metadata persists in the private database. Account and
quota metadata share a native-installation scope; skills retain their workspace
scope. TTLs are account 30 minutes, quota/MCP 60 seconds, activity/models/skills
5 minutes. Old values are served while a shared background inspection refreshes
those values; a failed refresh retains the last successful result. Web account
changes invalidate snapshots and reject late results from the old account epoch.

The browser persists only sanitized quota/activity snapshots, scoped to that native
account epoch. Chat body/DOM caches remain in memory (six recent conversations),
are cleared on Web disconnect and are reconciled with authoritative server state.
API responses and downloads remain no-store. Public code/style resources use
content-versioned immutable URLs, with ETag revalidation on unversioned URLs.

## Local execution slots

Diagnostics stores a concurrency target of 1–16 (default 4) in installation_settings.
It is not a remote-worker count. Up to 100 queued/running/cancelling tasks are accepted
in total, with one active task per conversation. Lowering the target drains busy slots
without interrupting them. Warm executors expire after ten idle minutes; failures and
cancellation close their owned sessions. Restart interrupts saved unfinished tasks
without automatic replay. See [architecture](architecture.md).
