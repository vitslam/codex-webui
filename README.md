<p align="center">
  <img src="docs/assets/lazyfish-logo.png" alt="Lazyfish — the relaxed orange fish" width="640">
</p>

<h1 align="center">Lazyfish</h1>

<p align="center"><strong>Your Codex. Your history. Your workspace.</strong></p>

<p align="center">A self-hosted Codex workspace with local history, side chats and context control.</p>

<p align="center">
  English · <a href="README.zh-CN.md">Simplified Chinese</a><br>
  <a href="#quick-start">Quick start</a> ·
  <a href="#why-lazyfish">Why Lazyfish</a> ·
  <a href="docs/configuration.md">Configuration</a> ·
  <a href="docs/troubleshooting.md">Troubleshooting</a>
</p>

Lazyfish turns your existing **Codex CLI** into a personal web workspace. Keep your conversation archive on a machine you control, explore ideas beside the main task, and decide when to compact a long-running chat. Open the same workspace from your laptop or phone while Codex works on your Linux or macOS host.

For developers choosing a Codex client, Lazyfish puts **self-hosting, control of your records and a browser-based workflow** first. The browsing device needs no CLI or desktop installation; Lazyfish itself has **zero third-party Python runtime dependencies**.

## Why Lazyfish

### Your history stays yours

Conversations, task records and saved attachments live in a **local SQLite database and files on your service host**. Reading your saved Lazyfish history does not depend on signing back into an OpenAI account. An expired login or loss of model access does not delete this archive; you control its backups and retention.

Here, “local” means the machine running Lazyfish, including a server you manage. Lazyfish does not use an OpenAI-hosted conversation archive as its history store. Prompts and relevant context still go to the configured model and tools; their data policies apply. Continuing model work requires valid access. See [data and access](#your-data-and-access) and [backup guidance](docs/deployment.md#upgrade-and-backup).

### Sign in your way, from the browser

Use an existing Codex login, sign in with ChatGPT, or enter an **API key in the Web account panel**. Device-code login makes a remote, headless host easy to set up. Native Codex manages credentials, while Lazyfish brings the supported sign-in flows into one interface.

<details>
<summary>API access and credits</summary>

API-key usage follows provider billing. OpenAI's desktop client also supports API keys; Lazyfish's benefit is the self-hosted Web workflow. The ChatGPT Pro/Business API-credit benefit currently **excludes Codex usage through API keys**. See [authentication](https://learn.chatgpt.com/docs/auth) and [credit eligibility](https://developers.openai.com/api/docs/guides/chatgpt-api-credits).

</details>

### Compact context on your schedule

See how much context a conversation uses and **trigger native compaction directly from its composer**. Prepare a frequently used chat for the next stretch of work without waiting for automatic compaction. The same control is available in side chats.

If your subscription quota is about to reset and you have capacity left, consider preparing long chats you plan to revisit: wait for the task to finish, open the context indicator and choose **Compact context**. Compaction can itself consume usage; the amount depends on the model and history. It does not roll unused quota forward or guarantee lower total cost. Availability follows your CLI and provider.

### Ask on the side. Keep the main task moving.

Select a passage and open a side discussion to question an assumption, unpack a result or compare another approach. **Multiple side-chat tabs** keep their own conversations, drafts and model settings. Bring a useful reply back into the main composer when you are ready.

Side discussions start from a snapshot of the parent transcript; later messages are not automatically synchronized. Separate conversations can still share workspace files. See the [feature guide](docs/features.md) for details.

### One workspace, across your devices

Start a task on your laptop, check it from your phone, and return to the same conversation. **Closing the browser does not stop the task**, as long as the host and service stay running. Use the same projects, files and CLI through local access or a secure remote connection.

## More to make daily work easier

- **Find the thread again.** Project grouping, full-text search, pinned chats, archive and restore. Edit a message or branch a conversation to explore a different approach; this does not undo workspace changes.
- **Steer work as it happens.** Add instructions to a running task, work across conversations in parallel, and handle native questions and approvals in the browser.
- **Read results first.** Streamed replies, image previews and downloadable outputs, with commands, web results and file diffs available in expandable execution details.
- **Bring your setup.** Model, reasoning, speed, permission and Plan controls; image attachments, project/personal skills and MCP connections. Inspect available quota, usage and context information from your CLI.
- **Make it feel right.** English and Chinese, eight palettes, light/dark/system appearance, resizable panels and configurable keyboard shortcuts.

## Interface preview

| Dark appearance · Chinese UI | Light appearance · English UI |
| --- | --- |
| ![Lazyfish dark appearance with conversation history and expandable execution details](docs/assets/screenshot-dark.png) | ![Lazyfish light appearance with streamed replies and reasoning controls](docs/assets/screenshot-light.png) |

## Requirements

- **Linux or macOS**, with Python **3.11–3.14**, `venv` and `pip`.
- **Codex CLI with `app-server` support**, installed separately and available to the same OS user as Lazyfish. Existing CLI authentication is reused; you can also sign in through the Web account panel.
- A modern browser. Install Git if you use the clone command below, or download and extract the repository instead.

Lazyfish is pre-alpha. Native features depend on your CLI version, account and provider; bounded conversation forks require Codex CLI **0.162.1+**. A working ChatGPT login does not require an additional API key. API-key usage is billed separately by the provider. See the [Codex CLI documentation](https://learn.chatgpt.com/docs/codex/cli) and [authentication guide](https://learn.chatgpt.com/docs/auth).

## Quick start

### 1. Install on the machine that runs Codex

```bash
git clone https://github.com/vitslam/codex-webui.git
cd codex-webui
bash scripts/install.sh
```

The installer creates an isolated Python environment and a `~/.local/bin/lazyfish` command. It initializes private configuration and a Web token, without installing Codex or starting a service. No `sudo` is needed. Keep the installation directory in place.

**If the installer prints a `source` command, run it before continuing**, or open a new terminal to pick up the updated PATH.

### 2. Start Lazyfish

```bash
lazyfish token
lazyfish serve
```

Open **http://127.0.0.1:3210** and paste the token from `lazyfish token`. This is your **Web sign-in token**, separate from your Codex/OpenAI credentials. The service runs in the foreground; keep its terminal open and use Ctrl+C to stop it.

### 3. Start your first conversation

1. Check the Web installation/account panel if Codex is not ready, and finish signing in.
2. Create a conversation and choose your project directory. With no default configured, new chats start in the service user's home directory.
3. Choose your model and permissions, then describe the task. For example: *“Review this project and propose one small improvement before changing files.”*
4. Follow the streamed response. Add instructions while a task runs, or select a passage and open a side discussion to explore a detail.

Set the default directory for new conversations in **Settings**. Each conversation keeps its own directory; changing the default does not move existing chats.

<details>
<summary>Need a different Python or Codex executable?</summary>

Choose an installed Python interpreter when running the installer:

```bash
PYTHON=/path/to/python3.14 bash scripts/install.sh
```

If Codex is not on PATH, provide its executable when starting the service:

```bash
LAZYFISH_CODEX_BIN=/path/to/codex lazyfish serve
```

You can also set `binary` under `[codex]` in `config.toml`. See [configuration](docs/configuration.md) for workspace defaults, custom installations and proxy settings.

</details>

## Remote access

The Web service and Codex run on the **same machine**. Your browser can connect from another device; no separate execution worker is needed.

**Through SSH:** keep the default `127.0.0.1` binding. On your browsing computer, run:

```bash
ssh -N -L 3210:127.0.0.1:3210 user@your-server
```

Keep the tunnel open, visit **http://127.0.0.1:3210** locally, and use the Web token from the server. If local port 3210 is occupied, use `-L 3211:127.0.0.1:3210` and open port 3211 instead.

**On a trusted LAN:** explicitly enable access by setting `host = "0.0.0.0"` under `[server]` in `~/.config/lazyfish/config.toml`, then restart. Startup prints the available IPv4 URLs; open one on your other device and sign in with the Web token.

`0.0.0.0` listens on all IPv4 interfaces, and HTTP does not encrypt traffic or tokens. Restrict access with a firewall; use SSH on untrusted networks. See [deployment](docs/deployment.md) for the supported setup and [configuration](docs/configuration.md) to bind a specific IPv4 address.

## Everyday commands

| Command | Use it to |
| --- | --- |
| `lazyfish serve` | Start the foreground service |
| `lazyfish token` | Show the Web sign-in token |
| `lazyfish status` | Check this installation's running instance |
| `lazyfish stop` | Stop it gracefully from another terminal |
| `lazyfish doctor` | Check the local CLI installation and saved login |
| `lazyfish doctor --probe` | Also check app-server initialization, without a model request |
| `lazyfish token --rotate` | Replace the Web token while the service is stopped |

These commands find the default or remembered installation automatically. Local checks do not verify network access, model availability or billing. For custom configuration and the optional per-run sign-in bypass, see [configuration](docs/configuration.md).

## Your data and access

By default, configuration lives in `~/.config/lazyfish/`, and conversations, task records, attachments and logs live in `~/.local/share/lazyfish/`. Native Codex manages its own credentials. Lazyfish ships no analytics or CDN resources; model requests and connected tools still use the services configured in Codex.

Web sign-in is required by default, with an HttpOnly browser session cookie. Treat the Web token as access to your Codex session and workspace. A working directory is an execution context, **not an OS sandbox**; native sandbox permissions and approvals govern file access. This is a single-machine, personal service, not a multi-user isolation boundary.

For backups, upgrades and access details, read [deployment](docs/deployment.md), [configuration](docs/configuration.md) and the [security policy](SECURITY.md).

## Development

```bash
python3.11 -m venv .venv
.venv/bin/python -m pip install -e .
.venv/bin/python -m unittest discover -s tests -v
```

Tests use isolated directories and fake Codex executables, with no real inference or credentials. See [CONTRIBUTING.md](CONTRIBUTING.md) for packaging and optional browser checks.

## Explore further

| Guide | What's inside |
| --- | --- |
| [Features](docs/features.md) | Side discussions, branches, files, skills and native integration limits |
| [Configuration](docs/configuration.md) | Paths, environment variables, proxies and execution settings |
| [Deployment](docs/deployment.md) | Remote access, upgrades, backups and offline installation |
| [Troubleshooting](docs/troubleshooting.md) | Installation, authentication and runtime problems |
| [Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md) · [Changelog](CHANGELOG.md) | How it works, what's planned and what's changed |

## License and attribution

Lazyfish is [MIT licensed](LICENSE). Contributions and focused bug reports are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

Lazyfish is an independent third-party project, not affiliated with, sponsored by or endorsed by OpenAI. OpenAI, Codex and ChatGPT are trademarks of their respective owners. Codex and connected services retain their own licenses and terms.
