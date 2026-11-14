# Deployment

This preview supports a foreground Linux or macOS process, bound to loopback by default. The installer
creates a user command in `~/.local/bin` and, when needed, adds that directory
to PATH in the Bash/Zsh startup file (other shells use `.profile`). It requires no root,
installs no systemd units and starts no daemon. Install under the same dedicated OS user that owns the native Codex login.
Allow private access to the chosen workspace and persistent data directory.

```bash
bash scripts/install.sh
# If prompted, run the printed source command first.
lazyfish doctor --probe
lazyfish serve
```

To use a nondefault config with the installer, set `LAZYFISH_CONFIG` for installation.
If there is no standard config, its path is remembered; subsequent commands need
no config flag or environment variable. Other instances still require an explicit
override. Select a data directory using `--data-dir` at initialization.
Run `lazyfish --help` for available commands. This pre-alpha supports local chat; review its limitations before using it as a
primary client.

## Remote access

For a trusted LAN, edit `host` under `[server]` in your local
`~/.config/lazyfish/config.toml` (or selected config) to `"0.0.0.0"` and restart.
Startup prints localhost and detected IPv4 URLs, omitting common
container/bridge interfaces. Open a LAN URL and use `lazyfish token` to sign in.
A specific unicast IPv4 (for example `192.168.1.10` or a public address) binds only
that interface. You choose the bind address and are responsible for who can reach it.

`0.0.0.0` listens on all IPv4 interfaces. HTTP traffic and tokens are unencrypted;
Host checks are not a firewall. Use a firewall to limit who can connect.

Alternatively, keep `127.0.0.1` and use an encrypted SSH tunnel (recommended on
untrusted networks).

```bash
ssh -N -L 3210:127.0.0.1:3210 user@your-server
```

The browser connects to `http://127.0.0.1:3210`. If the local port is occupied,
forward a different local port (for example `-L 3211:127.0.0.1:3210`) and use that
URL. Do not publish the port using a public tunnel. Keep Web authentication enabled
unless deliberately opting into the [per-run bypass and its risks](configuration.md#optional-web-sign-in-bypass).
Public TLS/reverse proxy deployment and containers are deferred until their
authentication, credential storage and workspace isolation can be tested together.

## Upgrade and backup

Stop this installation before reinstalling. Back up its data directory and private
configuration together; protect backups as credentials. Re-run the installer to
install the current checkout; existing configuration is preserved. Versioned
database initialization rejects a newer schema instead of silently downgrading it.
No automatic production deployment, database transfer or update scheduler exists.

## Offline installation

On a compatible build machine with packaging tools available:

```bash
python -m pip install build
python -m build
```

Transfer the wheel to the server. Runtime installation needs no package download:

```bash
python3.11 -m venv .venv
.venv/bin/python -m pip install --no-index /path/to/lazyfish_web-0.5.0a6-py3-none-any.whl
.venv/bin/lazyfish init --workspace /path/to/projects
```

Never share one live data directory between machines or copy it while execution
is active. Stop the service before backup/migration and preserve native Codex
state separately if you need to continue native threads on the destination. A
foreign machine's ownership journal blocks automatic recovery; local process IDs
cannot establish what is still running remotely. See [recovery](recovery.md).
