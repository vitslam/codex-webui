# Security / 安全说明

This pre-alpha supports one trusted owner and loopback/SSH access. It is not a
multi-user execution sandbox and must not be exposed directly to the internet.
Authenticated chat endpoints start real local Codex turns. The selected workspace
is not an OS sandbox. Native sandbox/approval settings and the OS user permissions
control execution; use a dedicated OS account.

当前预览版用于可信单用户、本机或 SSH 访问，不是多租户执行沙箱，不应直接暴露公网。
认证后的聊天接口会执行真实任务。工作目录不构成 OS 隔离，执行仍受原生沙箱、审批与系统权限控制。

Web tokens and native Codex credentials are separate. Private directories/files
use owner-only permissions. Requests validate loopback Host and same-origin browser
writes, use HttpOnly/SameSite session cookies, and do not load third-party assets.
Sessions expire after 12 hours and are discarded at restart. Stop requests require
authentication and an instance ID; no stale PID is killed.

Web 令牌与原生凭据独立；目录和文件仅属主可访问。请求校验 Host、来源和认证，
Cookie 为 HttpOnly/SameSite，会话最长 12 小时且重启失效。停服需匹配实例，不会按遗留 PID 杀进程。

No credentials, filled-in `.env`, auth files, databases or private logs belong in
issues or pull requests. Rotate any exposed credential immediately; deleting a
file from the latest commit does not remove it from Git history.

不要公开上传凭据、配置、数据库或私有日志。泄露后立即轮换，仅删除最新文件不能清除 Git 历史。

## Reporting / 报告漏洞

Before a public repository and private reporting channel exist, do not publish
sensitive exploit details. When published, use the repository's private security
advisory/reporting feature, if enabled, or a private channel explicitly documented
by its owner. A real contact must be added before the first public release.
There is currently no security support SLA; only the latest pre-alpha is maintained.

公开仓库和私密报告渠道尚未建立，不公开敏感利用细节。发布前需补充真实安全联系人；
发布后优先使用仓库私密安全报告功能或维护者明确公布的私密渠道。目前不提供安全响应 SLA。

## Task lifetime / 任务生命周期

A browser disconnect does not cancel a task. Native process ownership is journaled
before exec, with a lease, machine/boot identity and Linux process start time.
Shutdown/recovery acts on verified owned process sessions, not arbitrary stale
PIDs. Interrupted tasks are never automatically replayed. Sessions that cannot be
confirmed stopped remain blocked. Code that intentionally detaches into another
OS session or delegates to external services is outside this local process-session
cleanup guarantee; do not treat a Web UI as an isolation boundary.

网页断开不会取消任务。原生程序执行前记录租约、机器/启动标识及进程出生时间，退出与
恢复只操作可验证归属的进程会话，不按遗留 PID 直接杀进程。不自动重跑任务，无法确认
停止时保持阻塞。主动脱离 OS 会话的进程或外部服务不在本机进程会话清理保证内。

## Native authorization and outputs / 原生授权与产物

Native login sessions use the same owned-process journal/lease as executions.
Only authorization URL/device code/status are returned; submitted API keys are
forwarded to Codex, not stored in app history, browser storage or logs. Treat the
Web token as control of the native account, including sign-in/out. Web disconnect
is separate from native sign-out. Native question answers are sent to Codex; even
when secret fields are not directly persisted by Lazyfish, native history or model
output can contain the submitted text.

Output downloads require authentication. Generic file links snapshot only permitted
workspace/output paths, excluding app/native configuration and common credential
files. Raster outputs are signature-checked; SVG/HTML download as attachments.
This is not a secret detector or isolation boundary: the authenticated owner and
Codex can read files allowed by their OS/native permissions. Diff/Markdown/output
content may include workspace data; keep the data directory and backups private.

原生授权使用同样的进程归属及租约，网页只返回链接、设备码和状态，不保存提交的 Key。
Web 令牌具有操作原生账户的能力，退出网页和原生退出独立。秘密答案仍然是显式发给
Codex 的内容，可能出现在原生历史或模型输出。

下载需认证，普通文件链接限制路径并排除应用/原生配置和常见凭据，栅格图检查签名，
SVG/HTML 强制下载。这不是秘密检测器或隔离边界；diff、回复及产物可能包含工作目录
内容，应保护数据目录与备份。
