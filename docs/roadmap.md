# Roadmap / 路线图

This is a staged migration, not a copy of a private deployment. Each stage produces
a usable increment without importing personal configuration.

按阶段迁入可复用能力，不整体复制私有部署或个人配置。

- **Stage 1 — foundation / 基础框架 (done):** independent Git, package, installer,
  private configuration, diagnostics, lifecycle, bilingual docs and CI.
- **Stage 2 — single-machine chat / 单机聊天 (done):** native thread creation and
  resume, streaming, durable history, command/file approvals, cancellation,
  idempotent sends and confirmed orphan-task reconciliation without replay.
- **Stage 3 — conversation experience / 对话体验 (done):** migrate clean rich UI components,
  Markdown, history pagination, branching, persistent scroll restoration and shortcuts.
  Native forks preserve the boundary before the selected user message; workspace
  files remain shared. / 分支边界位于选中用户消息之前，文件目录仍共用。
- **Stage 4 — attachments and skills / 附件与技能 (done):** image input, skill
  editing/selection/status and native account/quota/MCP/context panels are available.
  Generated outputs/downloads, native login/OAuth, questions, steering, editing and original execution UI are connected.
- **Stage 5 — distribution / 分发:** hardened deployment, reproducible releases,
  compatibility checks, optional service management and containers.

The current pre-alpha includes the reference single-owner conversation experience and generated outputs. Multi-user tenancy, Docker and public production deployment are deferred.
Only explicit sends start turns; recovery never automatically replays a task.

当前已迁入原版单用户对话交互、附件、产物下载、技能及原生信息/授权面板；多用户、
Docker 及公网生产部署尚未接入。只有显式发送才启动新轮次，恢复不会自动重跑任务。
