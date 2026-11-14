# Extended features

These flows keep the reference UI while using one installed Codex CLI. Native APIs
are experimental: unsupported CLI/account/provider features show an error or
unavailable state. Normal tests use an isolated fake CLI, not real inference or
external authorization. Bounded native forks require Codex CLI 0.162.1 or newer.

## Conversations and execution

- **Edit:** hover a user bubble and choose Edit. Sending retires that message and
  its suffix from visible history and starts a replacement turn with the original
  inputs/model. Retained prefix context continues through a bounded native fork;
  editing the first message starts a fresh native thread. Retired records remain
  auditable by job ID. Workspace changes are never rolled back.
- **Selected passages:** select text within a user message or assistant response and choose Add to chat. Preview or remove the attached passages in the composer; selecting never sends automatically. References are isolated per chat draft and saved with sent messages, retries, edits and branches. Up to 8 passages are accepted (8,000 characters each, 24,000 total); they are passed as plain reference text.
- **Supplementary instruction:** while a turn runs, send text, selected passages and optional selected skills from the composer.
  It uses native `turn/steer`, with pending/delivered/failed state and idempotent
  request IDs, rather than creating another turn. Selected skills travel in the same native steering input. Images must wait
  for a regular message. A completed or cancelling turn cannot accept steering.
- **Questions:** native `item/tool/requestUserInput` opens the original choice/free
  text dialog; Both blocking and nonblocking questions appear automatically. Later dismisses
  without answering and is remembered for this browser session across refresh; the reply action reopens it. Blocking questions return answers to the native request; nonblocking answers
  use steering. Completion/cancellation expires outstanding questions. Secret
  fields are cleared on close and answers are not directly stored in app events;
  native history or a model reply may still contain text explicitly sent to Codex.
- **Plan:** enable Plan visibility in Settings. A completed Plan reply has an
  implementation action that sends an explicit default-mode turn and keeps the
  unsent composer draft. It does not execute automatically.
- **Reading:** the original composer handle folds/expands without losing drafts.
  Pinned chats can be dragged; server order survives reload. Number/MRU shortcuts
  follow that order and preserve the configured prefix behavior.

## Outputs and execution details

Typed native images, MCP image content and dynamic-tool image content share one
pipeline, independent of the skill name. PNG/JPEG/WebP/GIF are stored as authorized
artifacts, shown in the common image viewer and available after refresh/fork.
Binary fields are removed from normalized tool records instead of showing base64.
Unsupported tool types retain a bounded raw record under an explicit disclosure.

Local Markdown file links outside code are snapshotted from the conversation's
workspace or durable output directory. The browser receives an authenticated
`/api/jobs/<job>/artifacts/<hash>` URL, not a general filesystem endpoint. Generic
links cannot publish application configuration/data, native home, `.env` variants,
`auth.json` or `secrets.env`. Explicit native saved-image paths require a valid
raster signature. Each file is at most 15 MiB; each turn at most 16 unique artifacts
and 60 MiB total. A native JSONL message, including base64, is limited to 24 MiB. Other formats download as attachments, including SVG/HTML.
Deleting or changing a workspace file later does not change the saved snapshot.

The original grouped timeline includes commands, reasoning, collaboration, skills,
compaction and web operations. Web cards show queries/target pages, deduplicated
results, excerpts and expandable source details. Read-only bounded Git snapshots
provide file/line counts and diffs; unavailable/non-Git or truncated reports say so.
Only tracked and nonignored files are considered. The footer shows native input +
output tokens and cached-input/input hit rate when token events are available.
These are usage counts, not a billing estimate. Partial/completed task outputs and
reports persist in schema 6, including branch copies with rewritten output URLs.

## Project history

The sidebar shows pinned chats, projects grouped by the exact saved working directory,
and a recent-chat section that starts collapsed. The current project's history opens
by default; other projects load on expansion with pagination for older conversations.
Disclosure choices are remembered in the browser. Same-named folders keep distinct
full paths. Renaming, pinning and archiving remain available within each project.

## Working directories

Without a configured default, new chats start in the service user's home directory.
Settings → Default working directory for new chats saves a server-wide default
shared across browsers. Clear that field to restore the configured default, or
the home directory when unconfigured. Every chat keeps its own saved directory;
neither a global default change nor another chat's directory change rewrites it.
Any existing absolute directory can be selected while the chat is idle.

The directory determines the execution starting point, project skill discovery and
Git change tracking. It is not an access whitelist. Native sandbox permissions
and approvals still determine which reads and writes are allowed.

## Credentials and storage

Account sign-in supports device code, browser ChatGPT and API key. The Web service
retains an owned app-server for the callback, up to 20 minutes (MCP: 120 seconds).
Only attempt ID/state, authorization URL and device user-code go to the browser;
API-key input is cleared after submission and native tokens are never returned.
Native Codex owns credential persistence. Account changes are blocked while any
model turn runs; pending account authorization blocks new turns. Disconnecting the
Web UI does not sign out of Codex. Cancellation/shutdown stops only the owned
login session; interrupted login attempts are not resumed after service restart.

MCP OAuth is offered for existing native OAuth servers, not arbitrary URLs or new
server configuration. On a remote machine, device-code login is usually simplest.
Browser ChatGPT/MCP OAuth may listen on a separate native localhost callback port:
forward that port through SSH as required by the native login flow; forwarding
only Lazyfish's port is not sufficient for such callbacks. The native CLI remains
a fallback for providers/versions whose Web flow is unsupported.

Project skills are created under `.agents/skills`; personal skills under
`CODEX_HOME/skills` (default `~/.codex/skills`). Other discovered/system skills remain
read-only. Selected skills show “provided”; matching successful SKILL.md reads or
native events separately show loading/loaded/failure. This is observed activity,
not an assertion that the model followed every instruction inside the skill.

The service removes only uploads older than seven days that have no saved job
input reference. Checks run on startup and hourly. Used/retired/branched references
remain protected. Per-turn scratch is removed after native process exit is
confirmed; durable output directories and database snapshots remain. No workspace
files or native credentials/history are removed by upload cleanup.

## Restored reference interactions

Conversation model, reasoning, speed, permission and Plan choices persist on that
conversation and are inherited by branches. Opening New chat creates an unsaved
draft; only sending materializes an idempotent conversation. Failed sends retain
the original request ID for explicit retry and reconcile accepted-but-lost responses.
Stop freezes the local presentation immediately while confirmed backend cancellation
continues; transport failures expose Retry. Completed sidebar dots clear when read.

Holding the configured prefix shows grouped conversation hints; pressing a number
or Tab previews the target. Releasing that suffix while still holding the prefix
commits the selection; releasing the prefix first cancels it. Arrow keys remain
unbound. Editing, IME composition, dialogs and focus/visibility loss cancel or
suppress switching. Scrolling to the loaded history's top automatically loads older
turns. Mobile touch focus and viewport handling preserve pinch zoom; Safari requires
real-device acceptance beyond the Chromium checks.

Existing managed skills are edited as full UTF-8 SKILL.md source, preserving custom
frontmatter; a hash prevents overwriting a document changed since opening. Native
validation failure rolls back this editor's write. Read-only roots stay protected.
Approvals show only native-offered choices, including turn/session permissions and
command/network amendments; the server validates the chosen index before replying.

Uploaded images reserve their known aspect ratio before decoding. Native imageView
items capture the file at start so later temporary-file deletion does not lose it.
Native standalone Plan output remains a final answer. Diagnostics reuses the reference
slot cards and timing chart, adapted to local owned executors and configurable queues.

## Recent display parity

HTTP LAN access does not require the browser's secure-context randomUUID API for
sending or editing messages. Missing saved conversation directories are reported
explicitly in Skills, with a shortcut to choose a new directory; history paths are
never changed automatically.

The sidebar archives chats with a box-shaped action. Settings → Data management
lists archived chats by workspace, with search, workspace filtering and pagination.
Unarchive returns a chat to the sidebar with its history, native thread, settings
and pin state intact. Active or queued chats must finish before archiving.

User-message text keeps the first 20 rendered lines visible, with Show more / Show
less for overflow, including wrapped lines. Images and skill labels remain visible.
Copy and Edit always use the full text. Expansion survives cached conversation
switches while this page stays open; a reload starts collapsed again.

The Skills panel distinguishes an empty catalog from loading failures. It shows
affected files and localized reasons without exposing raw native errors or skill
contents. Lists are bounded to 300 skills and 20 loading issues, with explicit
truncation notices. Refresh checks the catalog again and clears resolved issues.

Settings → Conversation display → Show reasoning summaries is off by default. It
only controls the execution timeline: hiding summaries before grouping lets adjacent
commands form one group; actual progress messages remain in chronological order.
The preference applies immediately to loaded and deferred history, persists in this
browser and clears on Restore defaults. It does not change reasoning effort, run
settings or saved execution records.

The six recent cached conversation views also retain composer visibility. Switching
back restores the draft, reading position and collapsed/expanded state synchronously
without a fold animation; uncached conversations start expanded. Restoration and
subsequent anchored reflow are not treated as user scroll gestures. Sidebar naming
controls keep keyboard/caret behavior without an additional focus outline.
