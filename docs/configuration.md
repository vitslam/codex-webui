# Configuration / 配置

`lazyfish init` creates `config.toml` and
`secrets.env` under `$XDG_CONFIG_HOME/lazyfish` (default `~/.config/lazyfish`).
Re-running init preserves existing configuration, even if new arguments differ.
Edit the existing file explicitly to change it.

初始化生成配置及密钥文件；重复初始化不会修改旧配置。修改现有文件后需重启服务。
不要把填过的配置或密钥提交到仓库，私有文件权限必须是 `600`。

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

配置查找顺序：`--config` → `LAZYFISH_CONFIG` → 标准目录的 `config.toml` →
已记住的自定义配置。没有标准配置时，首次成功初始化或使用自定义配置会把绝对路径记入
`~/.config/lazyfish/installation.json`（遵循 `XDG_CONFIG_HOME`）。该私有文件只有路径，
不复制配置、密钥或聊天记录；后续命令可省略 `--config`，也不依赖当前所在目录。
使用其他实例不会悄悄替换已记住的选择；多实例仍可显式指定配置。

Existing custom installations are remembered on the first successful command
after upgrading. Missing or unsafe saved files produce an error rather than
creating a new token or selecting another instance. Restore the saved path, or
use an explicit override; to forget it, remove only `installation.json`.

已有自定义安装升级后，首次成功运行原来的命令就会自动记住路径。路径丢失或文件权限不安全
会报错，不会自动创建新令牌或切换到其他实例。可恢复原路径或显式覆盖；如需忘记保存的路径，
只删除 `installation.json` 即可，无需删除任何配置或数据。

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
Workspace is optional. An empty value uses a private `workspace/` under the data directory. An explicit workspace must exist and restricts directory selection to that tree. Port `0` asks the OS for an available port, shown at start.
The server binds to `127.0.0.1` by default. Set `server.host = "0.0.0.0"` (or `LAZYFISH_HOST=0.0.0.0`) to listen on all IPv4 interfaces; startup prints the available addresses. A specific unicast IPv4 (e.g. `192.168.1.10` or a public address) can bind just one interface. Token authentication is still required. Host checks reject requests whose Host header is not an address of this process; they are not a firewall. HTTP is unencrypted; use a firewall to limit who can connect, and use an SSH tunnel on untrusted networks. You choose the bind address and are responsible for who can reach it.
Unknown keys are rejected so spelling errors do not silently disable settings.

相对路径以配置文件目录为基准。工作目录可留空，执行时使用数据目录下的私有 `workspace/`；显式指定时目录必须已存在，且网页选择目录被限制在该目录内。端口 `0` 由系统分配。
默认从 PATH 查找 `codex`，找不到时请手动设置 `codex.binary` 或 `LAZYFISH_CODEX_BIN`。
默认绑定 `127.0.0.1`。设 `server.host = "0.0.0.0"`（或 `LAZYFISH_HOST=0.0.0.0`）后会监听所有 IPv4 网卡，启动时打印可用地址；也可指定单个 IPv4（例如 `192.168.1.10` 或公网地址）只绑定一个网卡。仍需令牌认证。Host 检查只拒绝 Host 不是本进程地址的请求，不能替代防火墙。HTTP 不加密，请用防火墙限制访问，不可信网络使用 SSH 隧道。绑定地址由你选择，谁能访问由你负责。未知配置键会报错。

| Environment variable / 环境变量 | Overrides / 覆盖项 |
| --- | --- |
| `LAZYFISH_CONFIG` | Configuration file / 配置文件路径 |
| `LAZYFISH_WORKSPACE` | `paths.workspace` |
| `LAZYFISH_DATA_DIR` | `paths.data_dir` |
| `LAZYFISH_CODEX_BIN` | `codex.binary` |
| `LAZYFISH_HOST`, `LAZYFISH_PORT` | `server.host`, `server.port` |
| `LAZYFISH_LOG_LEVEL` | `logging.level` |
| `LAZYFISH_TOKEN` | Generated Web token / 生成的 Web 令牌 |

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

密钥文件不作为 shell 脚本执行，不支持变量展开或 `export`。不会自动读取工作目录
里的 `.env`。只有允许列表中的网络、原生 Codex 配置和必要系统环境会传给 CLI，
不会传递 Web 令牌。API Key 是否启用仍取决于原生 Codex 的登录及提供方配置。

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

更换 Web 令牌时，先执行 `lazyfish stop`，再执行 `lazyfish token --rotate`，最后
`lazyfish serve`。新令牌输出到标准输出，确认信息输出到标准错误。命令以权限 `600`
原子更新配置指定的密钥文件，保留其他键和注释；实例运行时会拒绝更换，不会自动停服。
如果进程环境中设置了非空的 `LAZYFISH_TOKEN`，请先取消该变量，因为它会覆盖文件值。
三个命令必须使用同一配置；自定义实例可在每个子命令前加 `--config /path/to/config.toml`。
不带参数的 `lazyfish token` 仅显示当前令牌；初始化和安装程序不会更换已有令牌。

Manual fallback: while stopped, replace `LAZYFISH_TOKEN` in the configured secrets
file with a random ASCII token of at least 32 non-whitespace characters, retain
mode `600`, and restart. Never put a token in a URL, Git commit or issue. Existing
browser sessions die on restart.

手动替代方式：停服后，在配置指定的密钥文件中将 `LAZYFISH_TOKEN` 替换为至少 32 字符、
不含空白的随机 ASCII 令牌，保持权限 `600`，再启动。不要把令牌放进 URL、Git 提交或
issue；重启后原有浏览器会话失效。

`PYTHON` and `VENV_DIR` apply to the installer only. It uses an isolated temporary
directory under `$XDG_CACHE_HOME/lazyfish` and removes that temporary directory
after installation. The `~/.local/bin/lazyfish` launcher remembers the absolute
virtual environment path, including a custom `VENV_DIR`. Normal service diagnostics use `data_dir/runtime/tmp`.

安装脚本的 `PYTHON`、`VENV_DIR` 只影响安装。`~/.local/bin/lazyfish` 命令入口会记录
虚拟环境的绝对路径，因此自定义 `VENV_DIR` 后也无需在日常运行时重复指定。安装临时目录位于用户缓存中并自动清理；
服务诊断的临时目录位于数据目录内部，不使用公共 `/tmp` 存放应用临时文件。

## Execution defaults / 执行默认值

Empty `codex.model` / `codex.effort` inherit native defaults. Installation sandbox
and approval settings are defaults, not a hard ceiling on the authenticated owner.
The original permission menu can explicitly select ask, auto-review, full access,
read-only or custom CLI configuration for subsequent tasks. Without a choice, the
server defaults apply. Full access maps to `danger-full-access` + `never`; only use
it when intended. Native capabilities and OS permissions still apply.

模型及推理留空沿用原生默认值。安装沙箱及审批配置是默认值，不是认证用户不可覆盖的上限。
原版权限菜单支持请求批准、帮我批准、完全访问、只读、自定义 CLI 配置，对后续任务生效。
未选择时沿用服务默认值。完全访问映射为 `danger-full-access` 与 `never`，应按实际意图选择；
原生能力及系统用户权限仍然生效。

Existing conversations retain their workspace when the global default changes;
the directory dialog can update it while idle. The data directory includes
`lazyfish.db` (schema 8), attachments, replayable events and owned execution journals.
Schema 5 → 6 adds typed outputs/reports, item details, pin order, supplementary instructions, native questions and edit audit records; history/native IDs remain unchanged.
Do not edit/remove running task rows, journals or lease files to unblock a session.

已有对话目录不随全局默认变化，空闲时可通过弹窗修改。数据库版本 8 保留对话、任务及
可重放事件；`runtime/jobs` 保存执行归属和锁。不要通过删任务行、归属文件或锁来解除阻塞。


Generated output bytes are snapshotted in SQLite. Per-turn scratch lives under
`data_dir/runtime/tmp/<job>` and is removed after confirmed turn completion/owned cancellation. Durable
model deliverables can live under `data_dir/outputs/<job>`; keep these when backing up.
The native credential directory is not migrated into Lazyfish. See [features](features.md).

生成产物快照保存在 SQLite。每轮临时目录位于 `data_dir/runtime/tmp/<任务>`，确认轮次完成或所属执行已取消后清理；持久交付目录 `data_dir/outputs/<任务>` 应随数据备份。原生凭据不迁入应用数据库。


## Display snapshots / 展示快照

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

schema 6 → 7 只增加展示快照表，不修改任务历史或原生编号。账户、用量等脱敏展示信息
在私有数据库保存，技能按工作目录区分；过期时先返回上次成功值、后台合并刷新，失败不
清空旧值。账户切换使旧快照与旧请求结果失效。浏览器只持久化按账户版本隔离的额度和
活动快照，不持久化聊天正文。最近六个对话的 DOM 仅在当前页面内复用，网页退出时清空，
并根据服务端状态和编辑版本校正。数据接口与下载不使用公开缓存，静态代码按内容版本缓存。

## Local execution slots / 本机执行槽

Diagnostics stores a concurrency target of 1–16 (default 4) in installation_settings.
It is not a remote-worker count. Up to 100 queued/running/cancelling tasks are accepted
in total, with one active task per conversation. Lowering the target drains busy slots
without interrupting them. Warm executors expire after ten idle minutes; failures and
cancellation close their owned sessions. Restart interrupts saved unfinished tasks
without automatic replay. See [architecture](architecture.md).

诊断页把并发目标保存在 installation_settings，范围 1–16，默认 4，指本机执行槽。
活动与排队合计最多 100 个，每个对话一个活动任务；缩容等待忙碌槽收尾。预热进程
空闲十分钟退出，失败或取消清理所属会话。重启只收尾，不自动重跑。
