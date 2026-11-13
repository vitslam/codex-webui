# Deployment / 部署

This preview supports a foreground Linux or macOS process, bound to loopback by default. The installer
creates a user command in `~/.local/bin` and, when needed, adds that directory
to PATH in the Bash/Zsh startup file (other shells use `.profile`). It requires no root,
installs no systemd units and starts no daemon. Install under the same dedicated OS user that owns the native Codex login.
Allow private access to the chosen workspace and persistent data directory.

当前预览版支持 Linux 或 macOS 前台进程，默认只监听本机。安装器会创建 `~/.local/bin/lazyfish`，
并按需为 Bash/Zsh 配置 PATH（其他 Shell 使用 `.profile`），提示执行对应的 source 命令。
不需要 root，不安装系统服务，也不会自动后台运行。
建议使用独立系统用户，并让 Codex 与 Web 服务使用同一用户的登录环境。

```bash
bash scripts/install.sh
# If prompted, run the printed source command first. / 如有提示，先执行输出的 source 命令。
lazyfish doctor --probe
lazyfish serve
```

To use a nondefault config with the installer, set `LAZYFISH_CONFIG` for installation.
If there is no standard config, its path is remembered; subsequent commands need
no config flag or environment variable. Other instances still require an explicit
override. Select a data directory using `--data-dir` at initialization.
Run `lazyfish --help` for available commands. This pre-alpha supports local chat; review its limitations before using it as a
primary client.

安装时可通过 `LAZYFISH_CONFIG` 指定自定义配置路径；没有标准配置时会自动记住，
后续命令无需再传配置参数或环境变量。操作其他实例时仍显式指定。
初始化可用 `--data-dir` 选择持久数据位置。当前支持本机聊天，作为主力客户端前请先了解预览版限制。

## Remote access / 远程访问

For a trusted LAN, edit `host` under `[server]` in your local
`~/.config/lazyfish/config.toml` (or selected config) to `"0.0.0.0"` and restart.
Startup prints localhost and detected IPv4 URLs, omitting common
container/bridge interfaces. Open a LAN URL and use `lazyfish token` to sign in.
A specific unicast IPv4 (for example `192.168.1.10` or a public address) binds only
that interface. You choose the bind address and are responsible for who can reach it.

`0.0.0.0` listens on all IPv4 interfaces. HTTP traffic and tokens are unencrypted;
Host checks are not a firewall. Use a firewall to limit who can connect.

可信局域网可在本地 `~/.config/lazyfish/config.toml`（或选用的配置文件）的 `[server]` 下，
将 `host` 改为 `"0.0.0.0"` 后重启。启动时打印本机及探测到的 IPv4 地址，省略常见容器和网桥接口。
使用打印出的地址访问，仍需 `lazyfish token` 显示的令牌。也可指定一个 IPv4，只绑定对应网卡。
`0.0.0.0` 监听所有 IPv4 网卡，HTTP 不加密内容和令牌；Host 检查不能替代防火墙。
绑定地址由你选择，谁能访问由你负责，请按需要用防火墙限制访问。

Alternatively, keep `127.0.0.1` and use an encrypted SSH tunnel (recommended on
untrusted networks). / 也可保留默认本机绑定，使用加密 SSH 隧道（不可信网络推荐）：

```bash
ssh -N -L 3210:127.0.0.1:3210 user@your-server
```

The browser connects to `http://127.0.0.1:3210`. If the local port is occupied,
forward a different local port (for example `-L 3211:127.0.0.1:3210`) and use that
URL. Do not publish the port using a public tunnel or disable authentication.
Public TLS/reverse proxy deployment and containers are deferred until their
authentication, credential storage and workspace isolation can be tested together.

本地端口被占用时可以改用 `3211` 等端口。不要将当前服务通过公开隧道暴露给公网。
TLS/反向代理和容器部署会在认证、凭据和工作目录隔离验证完成后加入。

## Upgrade and backup / 升级与备份

Stop this installation before reinstalling. Back up its data directory and private
configuration together; protect backups as credentials. Re-run the installer to
install the current checkout; existing configuration is preserved. Versioned
database initialization rejects a newer schema instead of silently downgrading it.
No automatic production deployment, database transfer or update scheduler exists.

升级前停服，备份数据和私有配置，妥善保护备份。重新运行安装程序不会覆盖旧配置。
数据库有版本标识，拒绝错误降级。不提供自动部署、数据库搬运或后台更新。

## Offline installation / 离线安装

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

可以在构建机生成 wheel 后拷贝至服务器离线安装。Codex CLI 及其网络环境单独准备。


Never share one live data directory between machines or copy it while execution
is active. Stop the service before backup/migration and preserve native Codex
state separately if you need to continue native threads on the destination. A
foreign machine's ownership journal blocks automatic recovery; local process IDs
cannot establish what is still running remotely. See [recovery](recovery.md).

不要跨机器共享运行中的数据目录，也不要在执行期间复制。迁移前停止服务，并单独妥善
处理原生 Codex 会话数据。异机执行记录无法靠本机 PID 确认，会阻止自动收尾，见异常恢复说明。
