# Troubleshooting / 排障

| Symptom / 现象 | Action / 处理 |
| --- | --- |
| Python too old | Install/select Python 3.11+ with `PYTHON`; system Python is not modified / 指定新解释器，不替换系统 Python |
| `venv` unavailable | Install your OS's Python venv package, then retry / 安装对应版本 venv 组件 |
| CLI check fails | Install Codex using the official CLI documentation, or set `codex.binary` / 按官方文档安装 Codex，或配置 `codex.binary` 路径 |
| Saved authentication check fails | Run `codex login status` and the native login command as the service user / 用服务运行用户完成原生登录 |
| Probe fails but CLI exists | Check installed CLI version and `codex app-server --help`; protocol compatibility is version-dependent / 检查版本及命令支持 |
| Port busy | Stop the matching instance, choose another `server.port`, or use `0` / 停止对应实例或更换端口 |
| Unsafe permissions | `chmod 600` the config/secrets file; do not use shared private directories / 修正私有文件权限 |
| Sign-in rejected | Use `lazyfish token` from the same config, no OpenAI key; retry after a minute if rate-limited / 使用同一配置的 Web 令牌 |
| CLI login changed but page unchanged | Use Installation → Check again; Web login/logout rechecks automatically / 在“本机安装”重新检测，网页登录或退出后会自动检查 |
| Sending is blocked after restart | Check `lazyfish status` and [recovery](recovery.md); never force-delete leases / 查看恢复说明，不要强删锁 |
| Model turn fails | Verify CLI/account model support, native login and network; a successful doctor is not an inference test / 检查模型权限、登录与网络 |
| LAN page cannot be reached | Set `[server].host` to `"0.0.0.0"` or a specific IPv4 in the local config, restart, use a printed URL, and check the firewall / 修改本地绑定配置并重启，使用启动时打印的地址，并检查防火墙 |
| `stop` reports no instance | It will not signal a stale PID. Inspect that config/data directory and your own process supervisor / 不会误杀遗留 PID，请确认配置和进程管理器 |

Look at `data_dir/logs/lazyfish.log` locally. Do not upload configuration, token,
API keys, native authentication files, databases or full logs in a public issue.
Include the Lazyfish/Python/Codex versions and **sanitized** reproduction steps.
`doctor --json` intentionally omits raw account output and credential values.

日志在数据目录下。公开反馈只提供版本及脱敏复现步骤，不上传配置、令牌、Key、原生凭据、
数据库或完整日志。`doctor --json` 不会展示原生登录输出或凭据值。
