# Changelog

## Unreleased

- Support Linux and macOS with native process identity, ownership-safe session cleanup and parent-death protection; preserve Linux journal compatibility without adding runtime dependencies.
- Use portable `getifaddrs` interface discovery, retain VPN addresses and hide macOS wireless-direct interfaces only in the startup banner; update requirements and deployment documentation for both platforms.
- 支持 Linux 与 macOS 的原生进程身份、会话安全清理和父进程退出保护，保留 Linux 归属日志兼容性，不增加运行时依赖。
- 使用跨平台 `getifaddrs` 发现网卡，保留 VPN 地址，仅在启动提示中隐藏 macOS 无线直连接口；同步双平台安装要求和部署文档。

- Make the installer portable to macOS `chmod`, which rejects `--` and otherwise aborts with `chmod: --: No such file or directory`.
- 修复安装脚本在 macOS 上因 `chmod --` 无法识别而失败的问题。

- Add opt-in `0.0.0.0` or private IPv4 binding with startup LAN URLs; keep localhost as the default, require token authentication and reject public bind addresses.
- 支持显式开启 `0.0.0.0` 或内网 IPv4 绑定，启动时打印局域网地址；默认仍仅本机访问，保留令牌认证并拒绝公网绑定地址。

- Remember the first successfully used custom installation when no standard configuration exists; ordinary commands work from any directory without repeating `--config`.
- Preserve explicit/environment overrides, existing configuration, tokens and history; never silently switch instances or replace missing/unsafe configuration.

默认配置自动发现；自定义配置首次成功使用后记住路径，后续命令无需重复指定 `--config`。
保留多实例覆盖方式，配置、令牌和聊天历史均不迁移。

## 0.5.0a6 — unreleased

- Add a bilingual first-run terminal guide to the installer and `lazyfish setup`; reuse existing CLI/login, optionally install into private user data with npm, and verify without inference.
- Support native device-code, browser and stdin API-key sign-in, resumable/deferred setup and noninteractive checking without changing existing configuration or global installations.
- Add the Web Installation guide with live rechecks, account sign-in and browse-only access; block new tasks until local prerequisites pass.
- Update readiness after native login/logout and retire completed login-resumption records; preserve metadata snapshots when unchanged checks are refreshed.
- Remove the duplicate Diagnostics body refresh button and keep the header action wired to live checks.

增加首次部署安装、登录与验证向导，已有 CLI/登录自动跳过；网页可继续配置与重新检测。
中英文同步，不迁移原生凭据、不调用模型验证、不修改数据库结构。尚未发布。

## 0.5.0a5 — unreleased

- Remove the extra composer shortcut hint and duplicate global CSS that reintroduced textarea focus outlines and reset component typography.
- Restore single-line composer sizing, bounded viewport-aware growth and idle/steering placeholder text.
- Remove reference-style overrides for permission popovers, message spacing, image previews, approval details and mobile search bounds.
- Scope reduced-motion handle styling correctly and preserve pointer/keyboard editing, cached restoration and image dismissal.

清理输入区及常用弹层的迁移残留样式，中英文同步；新增浅色/暗色、桌面/手机和交互回归，无需数据库升级。尚未发布。

## 0.5.0a4 — unreleased

- Restore cached composer visibility together with reading position, without switch animations or transient folding.
- Remove extra focus outlines from sidebar conversation names and renaming fields while preserving keyboard editing.
- Add the bilingual Show reasoning summaries preference, off by default, with immediate cached/deferred timeline updates and grouping before hidden summaries.
- Preserve execution records and model settings; restoring defaults clears the display preference.

同步原版三项交互更新：对话切换无动画恢复输入框、侧栏改名焦点样式、默认隐藏思考摘要的双语开关。无需数据库升级，尚未发布。

## 0.5.0a3 — unreleased

- Complete the reference audit flows: conversation choices/read receipts, idle synchronization, optimistic sends/retry, stop feedback and unsaved new-chat drafts.
- Preserve full skill source with conflict checks; restore offered native approval choices, standalone Plan replies, supplementary skills and deferred questions.
- Restore suffix-release shortcuts, automatic older-history loading, image dimensions/early snapshots and lazy incremental command bodies.
- Add owned warm app-server slots, native-writer affinity, a bounded queue, persistent 1–16 concurrency and safe retirement/restart handling without automatic replay.
- Reuse the original local slot cards and request timing chart; retain only bounded sampling timing metadata from a loopback collector.
- Migrate schema 7 → 8 non-destructively and expand fake-native, actual Chromium and installed-package checks.

补迁审计列出的 20 项链路，复用原版交互并适配单机执行；中英文同步。新增链路使用隔离假 CLI 和 Chromium 验证，Safari 真机、真实模型及外部授权仍需单独验收。尚未发布。

## 0.5.0a2 — unreleased

- Restore content-versioned static assets with immutable caching and ETag revalidation.
- Restore persistent sanitized metadata snapshots, shared refreshes and cached quota/activity presentation.
- Parallelize authenticated bootstrap reads; batch history queries and defer terminal process payloads until disclosure.
- Retain six recent conversation views and reconcile fresh events/edits without replacing unchanged DOM.
- Preserve history with schema 6 → 7; invalidate account snapshots before authorization completion becomes visible.
- Verify delayed/failed refreshes, browser reloads, query volume, lazy processes and cross-tab edit reconciliation.

补齐原版缓存与按需加载优化，中英文同步，尚未发布。

## 0.5.0a1 — unreleased

- Complete remaining reference UI flows: grouped execution, web cards, diffs, token/cache footer and folding composer.
- Add native questions, text-only steering, Plan implementation and prefix-preserving message edits.
- Add skill-independent generated images/files, authorized downloads and seven-day unused-upload cleanup.
- Add personal skills, observed skill-load activity and persistent pinned-chat drag ordering.
- Add retained native account/MCP OAuth sessions with owned-process cleanup and credential-safe responses.
- Preserve schema 5 history/native IDs in schema 6; verify fake-native behavior, actual Chromium and installed assets.

补齐剩余原版功能及单机链路，中英文同步；原生外部授权及新能力使用模拟协议验证，尚未发布。

## 0.4.0a3 — unreleased

- Restore original context hover/popup, native manual compaction, and mobile anchoring.
- Restore full settings sections, directory dialog, permission presets and Plan inputs.
- Reuse original image actions and activity calendar; support pasted/dropped images.
- Add message-content search/snippets, sidebar rename/delete, independent sidebar shortcut.
- Preserve history with schema 4 → 5; document verified parity and remaining gaps.

按原版逐项补齐展开交互及后端链路，中英文同步，尚未发布。

## 0.4.0a2 — unreleased

- Port original reasoning control: named models, capability-driven levels, thumb dragging/cancel, model-list keyboard selection and reset.
- Restore the original fast toggle, Ultra visuals and per-turn native speed parameter.
- Persist run preferences in this browser and preserve speed in durable inputs/forks/idempotency.

迁入原版推理选择按钮及展开交互，中英文同步，尚未发布。

## 0.4.0a1 — unreleased

- Restore account, weekly quota, skills and MCP panels with sanitized native metadata.
- Restore + menu, image upload/paste/preview, native image/skill inputs and workspace selection.
- Reuse the original @/$ skill picker; create/edit local SKILL.md and native enable/disable.
- Persist attachment references and native context usage across history, refresh and forks.
- Migrate schema 3 → 4 without changing history/native IDs; preserve execution ownership.

补齐原版菜单和输入框背后的数据链路，中英文同步，尚未发布。

## 0.3.0a3 — unreleased

- Reuse original two-column settings/diagnostics and mobile panel navigation.
- Match the composer reasoning dashboard, model picker and nearby policy popover.
- Move language selection into Settings and pin controls alongside sidebar entries.
- Add the original search dialog backed by bounded, literal title search.
- Preserve popup dismissal/focus and adapt to the mobile visual viewport.

继续对齐原版展开界面、按钮位置与交互，并补齐名称搜索；尚未发布。

## 0.3.0a2 — unreleased

- Reuse original Lazyfish layout, SVG icons, message/composer styles and eight palettes.
- Move settings/checks/disconnect into the sidebar menu; retain bilingual accessible labels.
- Center the welcome/composer view and add a mobile sidebar drawer with backdrop dismissal.
- Show reply copy/model/status/time metadata; keep pinned groups ordered on new chat.
- Validate and package the theme registry, with persistent system/manual appearance selection.

迁入原项目视觉组件与 8 套配色，统一桌面/移动布局、菜单、消息及输入框；尚未发布。

## 0.3.0a1 — unreleased

- Safe DOM Markdown with nested emphasis/links, lists, tables, code copy and quotes.
- Pinned/recent conversation pages and cursor-based transcript pagination/anchor loading.
- Branch before a user message, with isolated native forks on the first explicit send.
- Persistent message/offset scroll anchors, bottom intent and expanded-tool state.
- Configurable prefix + digits/release, prefix + Tab (MRU) and prefix + B; no arrow capture.
- Bilingual UI/docs, browser regression suite and transactional schema 2 → 3 migration.

第三阶段预览版：富文本、分页、分支、阅读位置恢复及可配置快捷键；尚未发布。

## 0.2.0a1 — unreleased

- Local native thread creation/resume, streamed replies and durable conversation history.
- One active turn per conversation, four concurrent conversations, idempotent sends.
- Command/file approval decisions, cancellation and retained partial output.
- Journal-before-exec ownership, verified cleanup and orphan reconciliation without replay.
- Bilingual chat UI, reconnectable SSE events and configurable native execution defaults.
- SQLite migration from version 1 to 2, preserving service audit records.

第二阶段预览版：单机对话、流式回复、审批、取消及安全异常收尾；不自动重跑。

## 0.1.0a1 — unreleased

- Independent, single-machine project with an MIT license and clean configuration.
- Python package/CLI, local installer, private data directories and versioned store.
- Local Codex diagnostics and optional app-server initialize probe without inference.
- Bilingual diagnostics page, Web token/session authentication, health/readiness.
- Instance locking, authenticated shutdown, private rotating logs and CI checks.
- Chat, attachments, skills and task execution are deferred to subsequent stages.

首个基础框架预览版，尚未发布；暂不包含聊天、附件、技能及任务执行。
