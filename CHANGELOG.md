# Changelog

## Unreleased

- Add selected transcript passages to the current chat as removable reference context; retain references through history, retries, editing, branching and supplementary instructions.

- Keep general repository text in English, isolate Chinese UI strings in locale resources, preserve Unicode regression fixtures and maintain compatibility with saved localized change reports.

- Group sidebar history by saved project directory between pinned and recent chats, with on-demand pagination, remembered disclosures and recent chats initially collapsed.

- Use the service user's home when no working directory is configured; persist a server-wide new-chat default, allow any existing absolute directory, and keep conversation directories separate from sandbox and approval permissions.

- Search after 50 ms of settled input, defer loading feedback until requests take 300 ms, retain previous results, and support IME composition and explicit retry; restore conversations silently without a loading splash.

- Avoid welcome-screen flashes while restoring a conversation; show cached recent chats immediately in search, display up to 50 matches with relative timestamps, and label in-progress history loads.

- Keep skill discovery and selection aligned with the chosen directory, isolate delayed directory saves to their conversation, preserve question choices and ordinary answer drafts, and restore new-chat defaults instead of inheriting the previous conversation's run settings.

- Preserve unsent new-chat images and skills when sending in another conversation; support text copying on HTTP pages with a selection-based fallback and specific failure feedback.

- Exclude native user-message echoes from execution steps and hide previously saved echoes in timelines while preserving genuine tool activity.

- Use cryptographic request IDs on HTTP LAN origins where randomUUID is unavailable; explain missing conversation directories in the Skills panel and keep global metadata available.

- Replace the sidebar delete action with reversible chat archiving; add searchable, workspace-grouped archive management and restoration in Settings.

- Fold user-message text after 20 rendered lines, keeping attachments visible and preserving full-text copy/edit; show localized, bounded skill-loading diagnostics and catalog truncation notices.

- Add opt-in `lazyfish serve --no-token` to disable Web sign-in for one run, with a startup warning; retain Host/origin checks and authenticated status/stop.

- Add `lazyfish token --rotate` to atomically replace the Web token while stopped, preserving other secrets and comments; refuse running instances and environment token overrides.

- Allow an explicit unicast IPv4 bind, including public addresses; keep `127.0.0.1` as the default. Host checks still require an address of this process.

- Support Linux and macOS with native process identity, ownership-safe session cleanup and parent-death protection; preserve Linux journal compatibility without adding runtime dependencies.
- Use portable `getifaddrs` interface discovery, retain VPN addresses and hide macOS wireless-direct interfaces only in the startup banner; update requirements and deployment documentation for both platforms.

- Make the installer portable to macOS `chmod`, which rejects `--` and otherwise aborts with `chmod: --: No such file or directory`.

- Add opt-in `0.0.0.0` or a specific IPv4 binding with startup URLs; keep localhost as the default and require token authentication.

- Remember the first successfully used custom installation when no standard configuration exists; ordinary commands work from any directory without repeating `--config`.
- Preserve explicit/environment overrides, existing configuration, tokens and history; never silently switch instances or replace missing/unsafe configuration.

## 0.5.0a6 — unreleased

- Add a bilingual first-run terminal guide to the installer and `lazyfish setup`; reuse existing CLI/login, optionally install into private user data with npm, and verify without inference.
- Support native device-code, browser and stdin API-key sign-in, resumable/deferred setup and noninteractive checking without changing existing configuration or global installations.
- Add the Web Installation guide with live rechecks, account sign-in and browse-only access; block new tasks until local prerequisites pass.
- Update readiness after native login/logout and retire completed login-resumption records; preserve metadata snapshots when unchanged checks are refreshed.
- Remove the duplicate Diagnostics body refresh button and keep the header action wired to live checks.

## 0.5.0a5 — unreleased

- Remove the extra composer shortcut hint and duplicate global CSS that reintroduced textarea focus outlines and reset component typography.
- Restore single-line composer sizing, bounded viewport-aware growth and idle/steering placeholder text.
- Remove reference-style overrides for permission popovers, message spacing, image previews, approval details and mobile search bounds.
- Scope reduced-motion handle styling correctly and preserve pointer/keyboard editing, cached restoration and image dismissal.

## 0.5.0a4 — unreleased

- Restore cached composer visibility together with reading position, without switch animations or transient folding.
- Remove extra focus outlines from sidebar conversation names and renaming fields while preserving keyboard editing.
- Add the bilingual Show reasoning summaries preference, off by default, with immediate cached/deferred timeline updates and grouping before hidden summaries.
- Preserve execution records and model settings; restoring defaults clears the display preference.

## 0.5.0a3 — unreleased

- Complete the reference audit flows: conversation choices/read receipts, idle synchronization, optimistic sends/retry, stop feedback and unsaved new-chat drafts.
- Preserve full skill source with conflict checks; restore offered native approval choices, standalone Plan replies, supplementary skills and deferred questions.
- Restore suffix-release shortcuts, automatic older-history loading, image dimensions/early snapshots and lazy incremental command bodies.
- Add owned warm app-server slots, native-writer affinity, a bounded queue, persistent 1–16 concurrency and safe retirement/restart handling without automatic replay.
- Reuse the original local slot cards and request timing chart; retain only bounded sampling timing metadata from a loopback collector.
- Migrate schema 7 → 8 non-destructively and expand fake-native, actual Chromium and installed-package checks.

## 0.5.0a2 — unreleased

- Restore content-versioned static assets with immutable caching and ETag revalidation.
- Restore persistent sanitized metadata snapshots, shared refreshes and cached quota/activity presentation.
- Parallelize authenticated bootstrap reads; batch history queries and defer terminal process payloads until disclosure.
- Retain six recent conversation views and reconcile fresh events/edits without replacing unchanged DOM.
- Preserve history with schema 6 → 7; invalidate account snapshots before authorization completion becomes visible.
- Verify delayed/failed refreshes, browser reloads, query volume, lazy processes and cross-tab edit reconciliation.

## 0.5.0a1 — unreleased

- Complete remaining reference UI flows: grouped execution, web cards, diffs, token/cache footer and folding composer.
- Add native questions, text-only steering, Plan implementation and prefix-preserving message edits.
- Add skill-independent generated images/files, authorized downloads and seven-day unused-upload cleanup.
- Add personal skills, observed skill-load activity and persistent pinned-chat drag ordering.
- Add retained native account/MCP OAuth sessions with owned-process cleanup and credential-safe responses.
- Preserve schema 5 history/native IDs in schema 6; verify fake-native behavior, actual Chromium and installed assets.

## 0.4.0a3 — unreleased

- Restore original context hover/popup, native manual compaction, and mobile anchoring.
- Restore full settings sections, directory dialog, permission presets and Plan inputs.
- Reuse original image actions and activity calendar; support pasted/dropped images.
- Add message-content search/snippets, sidebar rename/delete, independent sidebar shortcut.
- Preserve history with schema 4 → 5; document verified parity and remaining gaps.

## 0.4.0a2 — unreleased

- Port original reasoning control: named models, capability-driven levels, thumb dragging/cancel, model-list keyboard selection and reset.
- Restore the original fast toggle, Ultra visuals and per-turn native speed parameter.
- Persist run preferences in this browser and preserve speed in durable inputs/forks/idempotency.

## 0.4.0a1 — unreleased

- Restore account, weekly quota, skills and MCP panels with sanitized native metadata.
- Restore + menu, image upload/paste/preview, native image/skill inputs and workspace selection.
- Reuse the original @/$ skill picker; create/edit local SKILL.md and native enable/disable.
- Persist attachment references and native context usage across history, refresh and forks.
- Migrate schema 3 → 4 without changing history/native IDs; preserve execution ownership.

## 0.3.0a3 — unreleased

- Reuse original two-column settings/diagnostics and mobile panel navigation.
- Match the composer reasoning dashboard, model picker and nearby policy popover.
- Move language selection into Settings and pin controls alongside sidebar entries.
- Add the original search dialog backed by bounded, literal title search.
- Preserve popup dismissal/focus and adapt to the mobile visual viewport.

## 0.3.0a2 — unreleased

- Reuse original Lazyfish layout, SVG icons, message/composer styles and eight palettes.
- Move settings/checks/disconnect into the sidebar menu; retain bilingual accessible labels.
- Center the welcome/composer view and add a mobile sidebar drawer with backdrop dismissal.
- Show reply copy/model/status/time metadata; keep pinned groups ordered on new chat.
- Validate and package the theme registry, with persistent system/manual appearance selection.

## 0.3.0a1 — unreleased

- Safe DOM Markdown with nested emphasis/links, lists, tables, code copy and quotes.
- Pinned/recent conversation pages and cursor-based transcript pagination/anchor loading.
- Branch before a user message, with isolated native forks on the first explicit send.
- Persistent message/offset scroll anchors, bottom intent and expanded-tool state.
- Configurable prefix + digits/release, prefix + Tab (MRU) and prefix + B; no arrow capture.
- Bilingual UI/docs, browser regression suite and transactional schema 2 → 3 migration.

## 0.2.0a1 — unreleased

- Local native thread creation/resume, streamed replies and durable conversation history.
- One active turn per conversation, four concurrent conversations, idempotent sends.
- Command/file approval decisions, cancellation and retained partial output.
- Journal-before-exec ownership, verified cleanup and orphan reconciliation without replay.
- Bilingual chat UI, reconnectable SSE events and configurable native execution defaults.
- SQLite migration from version 1 to 2, preserving service audit records.

## 0.1.0a1 — unreleased

- Independent, single-machine project with an MIT license and clean configuration.
- Python package/CLI, local installer, private data directories and versioned store.
- Local Codex diagnostics and optional app-server initialize probe without inference.
- Bilingual diagnostics page, Web token/session authentication, health/readiness.
- Instance locking, authenticated shutdown, private rotating logs and CI checks.
- Chat, attachments, skills and task execution are deferred to subsequent stages.
