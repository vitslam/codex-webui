# Troubleshooting

| Symptom | Action |
| --- | --- |
| Python too old | Install/select Python 3.11+ with `PYTHON`; system Python is not modified |
| `venv` unavailable | Install your OS's Python venv package, then retry |
| CLI check fails | Install Codex using the official CLI documentation, or set `codex.binary` |
| Saved authentication check fails | Run `codex login status` and the native login command as the service user |
| Probe fails but CLI exists | Check installed CLI version and `codex app-server --help`; protocol compatibility is version-dependent |
| Port busy | Stop the matching instance, choose another `server.port`, or use `0` |
| Unsafe permissions | `chmod 600` the config/secrets file; do not use shared private directories |
| Sign-in rejected | Use `lazyfish token` from the same config, no OpenAI key; retry after a minute if rate-limited |
| CLI login changed but page unchanged | Use Installation → Check again; Web login/logout rechecks automatically |
| Sending is blocked after restart | Check `lazyfish status` and [recovery](recovery.md); never force-delete leases |
| Model turn fails | Verify CLI/account model support, native login and network; a successful doctor is not an inference test |
| LAN page cannot be reached | Set `[server].host` to `"0.0.0.0"` or a specific IPv4 in the local config, restart, use a printed URL, and check the firewall |
| `stop` reports no instance | It will not signal a stale PID. Inspect that config/data directory and your own process supervisor |

Look at `data_dir/logs/lazyfish.log` locally. Do not upload configuration, token,
API keys, native authentication files, databases or full logs in a public issue.
Include the Lazyfish/Python/Codex versions and **sanitized** reproduction steps.
`doctor --json` intentionally omits raw account output and credential values.
