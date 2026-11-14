# UI migration

The original Lazyfish remains the visual and interaction reference. The open-source
adapter changes execution/configuration to one machine. A matching icon alone is
not migration: controls are wired to native APIs and persistent local state, with
English and Chinese labels. This checklist records the completed reference flows
and their actual limits; see [extended features](features.md) for behavior.

| Component | Connected behavior | Boundary |
| --- | --- | --- |
| Account menu and login | Original menu, identity; retained native device/browser/API-key login and sign-out | Native credentials; remote callbacks may need SSH forwarding |
| Weekly usage | Native windows/reset, original activity calendar/token/streak and refresh | Depends on CLI/account/provider |
| Settings | Original groups, palettes, language, new-chat defaults, visibility, shortcuts and reset | Browser defaults plus persisted per-conversation run choices |
| Reasoning and Plan | Original slider/picker, native capabilities, speed, Plan input and explicit implementation action | Native capability checks; no automatic implementation |
| Questions | Original options/free-input dialog, later/reopen, blocking/nonblocking answers and expiry | Experimental native request support |
| Permissions | Original five presets and native sandbox/approval/reviewer mapping | Explicit choices affect subsequent tasks |
| + menu and uploads | Images/skills/workspace, paste/drop, cleanup of unused uploads | Seven days; saved references retained |
| Context | Original hover/popup, tokens, manual compaction, mobile bounds and empty 0% | Native automatic compaction, no app threshold |
| Images and outputs | Shared viewer/actions; generated native/MCP/dynamic-tool images, authorized downloads | Typed raster/size limits; no general filesystem endpoint |
| Skills | Discovery, @/$ picker, project/personal create/edit, enable/disable, provided and observed load state | Other/system roots read-only |
| Search | Original modal, title/content search, snippets/highlights and conversation selection | Reference behavior selects the chat; per-hit deep links are not claimed |
| Sidebar | Groups/actions/status dots; persistent pin drag order and grouped numbered/MRU overlay | Browser/OS may reserve prefixes |
| User messages | Original copy/edit/branch controls; prefix-retaining native edit fork | Retired suffix audit retained; files shared |
| Active conversation | Supplementary text, delivery state, original folding composer and scroll anchors | One running turn per conversation |
| Execution details | Original grouped timeline, reasoning/collaboration, web cards with dedupe | Bounded raw records for unsupported tools |
| Diffs and usage | Original file counts/diffs and token/cache footer | Bounded read-only Git snapshots; native token events |
| MCP | Existing server status/tools and retained OAuth session | Server configuration stays native |
| Diagnostics | Local checks, original slot cards, concurrency and interactive sampling chart | Local owned executors; no remote Worker heartbeat |

Validation uses fake native protocol tests and actual Chromium for bilingual
panels, media/downloads, timeline/web/diffs, edit/steer/questions/Plan, login-session
UI, pin dragging, composer folding, shortcuts and existing scroll/history behavior.
It does not claim a live external OAuth or model test for these newly added flows.
Quota/activity reopen from snapshots while refreshing in the background. Public static resources use versioned caching; startup reads run concurrently, terminal process data loads on disclosure, history queries are batched and six recent views retain DOM identity.

Packaged assets are checked from an installed wheel, without the source import path.

## Audit follow-through in 0.5.0a3

The 20 findings were checked against the reviewed reference snapshot. This table
records the actual implementation boundary and regression evidence, rather than
equating a copied button with a completed flow. Source/recovery behavior uses an
isolated fake CLI; browser checks use actual Chromium, including mobile emulation.
Safari hardware, external OAuth and real-model latency are separate acceptance work.

| # | Restored flow | Implementation and evidence |
| --- | --- | --- |
| 1 | Conversation choices | `run_settings.py`, storage and composer; save/restore, submit, branch and compaction regression |
| 2 | Native approvals | `approvals.py` and shared modal; offered decisions only, exact turn/session grants, rule options |
| 3 | Raw skill editor | Full UTF-8 source and hash; native validation rollback, metadata/conflict regressions |
| 4 | Idle sync and recovery | Conversation revision SSE, polling fallback, BFCache lifecycle, deletion reconciliation |
| 5 | Standalone Plan | Completed native `plan` becomes final assistant output; protocol and browser regression |
| 6 | Pending sends | Optimistic bubble, original ID retry, accepted-response reconciliation and next-draft preservation |
| 7 | Read receipts | Persist latest terminal job read marker; foreground read clears sidebar/overlay dots |
| 8 | Suffix-release shortcuts | Number/Tab/Backslash release commits; prefix-first cancels; edit/IME/focus guards |
| 9 | Warm app-server | `runtimes.py`, lasting spawn thread, owned runtime/task journals and native writer affinity |
| 10 | Independent command details | Light previews, version/offset/hash suffix retrieval and lightweight changes API |
| 11 | Immediate stop | Frozen local snapshot, confirmed backend cancellation and explicit failure retry |
| 12 | Image placeholders | Header-derived dimensions, old attachment backfill and aspect reservation |
| 13 | Early imageView capture | Capture on start; fake tool deletes temporary file before completion to verify retention |
| 14 | Supplementary skills/actions | Native steer skill inputs, delivery state and user-style copy action |
| 15 | Deferred questions | Blocking/nonblocking auto-show and session-persisted Later; refresh browser regression |
| 16 | Mobile viewport/focus | Scale=1 adaptation, keyboard marker, short-tap preventScroll focus; Safari pending |
| 17 | Automatic history pagination | Near-top scroll loads older page while preserving reading anchor; browser regression |
| 18 | New-chat/sidebar details | Unsaved drafts, remembered selection, double-click rename, unchanged-DOM skip, no quota timestamp |
| 19 | Request timings | Local collector and original interactive chart; bounded sampling metadata only, dedup/privacy regression |
| 20 | Local slots/queue | Original cards, persistent 1–16 target, bounded FIFO queue, drain on shrink and restart without replay |

`tests/test_reference_parity.py` covers the new durable/native boundaries, including
writer affinity, slot retirement and forced restart. `tests/parity_browser.cjs`
covers their connected UI flows. Existing cache, transcript, migration and browser
suites remain part of the full check; these changes do not replace those regressions.

## Reference updates through 5c646f5

Version 0.5.0a4 adapts `e9cd878` (composer restoration), `bf5c3c2` (sidebar focus
outlines) and `5c646f5` (reasoning visibility) to the single-machine frontend.
`scroll.js` explicitly settles programmatic restoration so it cannot trigger the
composer's user-scroll folding rule. Reasoning visibility participates in job-render
signatures and deferred step rendering, while keeping step data intact. These are
frontend changes; schema 8 and native execution policies remain unchanged.

## Input and popup style audit

Version 0.5.0a5 checks the input area, common popovers, image viewer, message actions
and sidebar against reference `5c646f5`. This is a focused source/computed-style and
interaction check, not a claim of pixel-identical UI across all browsers.

| Difference | Resolution |
| --- | --- |
| Extra Enter/Shift+Enter line | Remove markup, unused labels and styles; shortcuts remain configurable |
| Textarea focus outline | Remove repeated global CSS that overrode textarea exclusions; preserve caret and keyboard focus |
| Extra default input height | Restore one row and remove adapter min-height overrides; bound growth to 260px and 30% of viewport |
| Placeholder and steering text | Restore reference bilingual idle/active wording |
| Permission popover | Restore -35px local alignment instead of forcing left zero |
| User bubble spacing | Restore 35px bottom spacing |
| Image preview | Remove fullscreen width/height override; retain backdrop/Escape dismissal |
| Approval detail | Restore reference font, padding, border and 180px scroll limit |
| Composer handle animation | Put reduce-motion exclusion back inside its media query |
| Sidebar/mobile spacing | Restore caption margin and control gaps |
| Mobile search height | Use visual viewport bounds instead of full device height |

Deliberate single-machine differences remain: local token/installation controls,
manual model-ID configuration, header space reserved for local utility buttons, and
16px mobile input text to prevent focus zoom. These are not removed as styling debris.
Native defaults, authentication and execution controls remain installation-specific.
