# Roadmap

This is a staged migration, not a copy of a private deployment. Each stage produces
a usable increment without importing personal configuration.

- **Stage 1 — foundation (done):** independent Git, package, installer,
  private configuration, diagnostics, lifecycle, English docs, a Chinese README and CI.
- **Stage 2 — single-machine chat (done):** native thread creation and
  resume, streaming, durable history, command/file approvals, cancellation,
  idempotent sends and confirmed orphan-task reconciliation without replay.
- **Stage 3 — conversation experience (done):** migrate clean rich UI components,
  Markdown, history pagination, branching, persistent scroll restoration and shortcuts.
  Native forks preserve the boundary before the selected user message; workspace
  files remain shared.
- **Stage 4 — attachments and skills (done):** image input, skill
  editing/selection/status and native account/quota/MCP/context panels are available.
  Generated outputs/downloads, native login/OAuth, questions, steering, editing and original execution UI are connected.
- **Stage 5 — distribution:** hardened deployment, reproducible releases,
  compatibility checks, optional service management and containers.

The current pre-alpha includes the reference single-owner conversation experience and generated outputs. Multi-user tenancy, Docker and public production deployment are deferred.
Only explicit sends start turns; recovery never automatically replays a task.
