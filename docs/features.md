# Extended features / 扩展功能

These flows keep the reference UI while using one installed Codex CLI. Native APIs
are experimental: unsupported CLI/account/provider features show an error or
unavailable state. Normal tests use an isolated fake CLI, not real inference or
external authorization. Bounded native forks require Codex CLI 0.162.1 or newer.

这些链路复用原版界面，执行端改为本机 Codex CLI。原生接口具有实验性质，不支持的
版本、账户或提供方明确报错或显示不可用。常规测试使用隔离假 CLI，不调用真实模型或
外部授权。带轮次边界的分支要求 CLI 0.162.1 或以上。

## Conversations and execution / 对话与执行

- **Edit:** hover a user bubble and choose Edit. Sending retires that message and
  its suffix from visible history and starts a replacement turn with the original
  inputs/model. Retained prefix context continues through a bounded native fork;
  editing the first message starts a fresh native thread. Retired records remain
  auditable by job ID. Workspace changes are never rolled back.
- **Supplementary instruction:** while a turn runs, send text and optional selected skills from the composer.
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

- **编辑消息：**悬浮用户气泡后编辑并发送，原消息及之后的记录退出可见历史，新任务
  沿用原输入和模型。从保留前缀的原生分支继续；编辑第一条则创建新原生会话。旧记录仍可
  通过任务编号审计，不回滚文件。
- **补充指令：**执行中从输入框发送文字及可选技能，通过原生 `turn/steer` 交付，展示等待、
  已送达或失败，并按请求编号去重。不会另开轮次，可同时提供选中的技能；图片应留给普通消息。
- **原生提问：**阻塞与非阻塞提问都会自动弹出；选项/自由输入弹窗可暂后处理、重新打开，
  本浏览器会话内刷新仍记住“稍后”；阻塞提问直接返回原生请求，
  非阻塞答案通过补充指令发送。任务结束后过期。秘密字段关闭即清空，答案不直接写入应用
  事件，但显式发给 Codex 的文字仍可能进入原生历史或回复。
- **执行计划：**设置里显示 Plan 后，已完成计划有执行按钮，显式发送默认模式的新一轮，
  保留草稿，不自动执行。
- **阅读交互：**输入框手柄复用原版折叠行为；置顶拖动顺序在服务端保存，快捷切换遵循
  对应顺序及用户前缀设置。

## Outputs and execution details / 产物与执行详情

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

原生图片、MCP 图片及动态工具图片共用类型化产物链路，不按技能名称逐个适配。
PNG/JPEG/WebP/GIF 保存成授权产物，复用图片查看器，刷新及分支后可查看；二进制字段从
规范化工具记录中移除，不展示 base64。未知工具仍可展开查看有大小限制的原始记录。

代码以外的本地 Markdown 文件链接从对话工作目录或持久产物目录取快照，转换为认证 URL，
不是任意文件读取接口。普通链接排除应用配置/数据、原生目录及常见凭据文件；原生明确
返回的图片路径需通过格式签名检查。每文件上限 15 MiB，每轮最多 16 个独立产物、总计
60 MiB；单条原生 JSONL 消息（包括 base64）上限 24 MiB。SVG/HTML 等格式强制下载。之后修改或删除源文件不会改变快照。

分组时间线复用原版命令、思考、协作、技能、压缩及网页操作。网页卡片包含查询/目标网页、
去重结果、摘要及可展开详情。Git 变更统计使用只读且有数量/大小上限的快照，非 Git、
不可用或截断时明确显示；只统计已跟踪及未被忽略的文件。页脚在原生数据可用时显示
输入加输出 token 及缓存输入命中比例，不代表费用。schema 6 持久化产物及报告，分支时
复制并改写授权链接。

## Credentials and storage / 凭据与存储

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

账户页支持设备码、浏览器及 API Key 登录；服务持有归属明确的 app-server 等待回调，
账户最长 20 分钟，MCP 为 120 秒。网页只接收授权尝试状态/编号、链接及设备码，提交后
清空 Key 输入，不返回原生令牌，凭据由 Codex 保存。运行任务期间禁止换号，待授权期间
禁止启动新轮次。退出网页不等于退出 Codex；取消或停服只清理本服务的授权进程，重启后
不自动重放授权。

MCP 只为已配置的原生 OAuth 服务发起授权。远程推荐设备码；浏览器/MCP 的独立本机
回调端口可能需要额外 SSH 转发，仅转发网页端口不够。不支持时可使用原生 CLI 登录。
项目技能与个人技能分别存放，系统/其他只读技能不改写。提供技能和观测到实际加载区分
显示，不能据此推断模型执行了全部技能内容。

启动时和每小时仅清理超过七天且没有保存消息引用的上传，已发送、编辑前历史及分支引用
均保留。确认执行退出后清理每轮临时目录，持久产物与数据库快照保留；不清理工作目录、
原生凭据或原生历史。

## Restored reference interactions / 补迁交互

Conversation model, reasoning, speed, permission and Plan choices persist on that
conversation and are inherited by branches. Opening New chat creates an unsaved
draft; only sending materializes an idempotent conversation. Failed sends retain
the original request ID for explicit retry and reconcile accepted-but-lost responses.
Stop freezes the local presentation immediately while confirmed backend cancellation
continues; transport failures expose Retry. Completed sidebar dots clear when read.

模型、推理、速度、权限及 Plan 按对话保存，分支继承。新聊天先保留未发送草稿，
发送时才创建去重记录。失败重试沿用原请求编号，并核对服务端已接收但响应丢失的发送。
停止立即冻结当前显示，后端继续确认取消；传输失败可重试。完成状态圆点在阅读后清除。

Holding the configured prefix shows grouped conversation hints; pressing a number
or Tab previews the target. Releasing that suffix while still holding the prefix
commits the selection; releasing the prefix first cancels it. Arrow keys remain
unbound. Editing, IME composition, dialogs and focus/visibility loss cancel or
suppress switching. Scrolling to the loaded history's top automatically loads older
turns. Mobile touch focus and viewport handling preserve pinch zoom; Safari requires
real-device acceptance beyond the Chromium checks.

按住配置的前缀显示分组提示，数字或 Tab 预选；前缀仍按住时松开数字或 Tab 才切换，
先松前缀则取消。方向键不绑定，编辑、输入法组合、弹窗及失焦时保护或取消切换。
滚到当前历史顶部自动加载更早轮次。移动端保留缩放手势，Safari 需另做真机验收。

Existing managed skills are edited as full UTF-8 SKILL.md source, preserving custom
frontmatter; a hash prevents overwriting a document changed since opening. Native
validation failure rolls back this editor's write. Read-only roots stay protected.
Approvals show only native-offered choices, including turn/session permissions and
command/network amendments; the server validates the chosen index before replying.

已有可编辑技能以完整 UTF-8 SKILL.md 源码保存，自定义头部保留；哈希校验避免覆盖打开后
已变化的文档，原生校验失败回滚本次写入，只读目录仍受保护。审批按原生提供的选项
展示本轮/会话权限及命令/网络规则，后端验证所选编号后回复。

Uploaded images reserve their known aspect ratio before decoding. Native imageView
items capture the file at start so later temporary-file deletion does not lose it.
Native standalone Plan output remains a final answer. Diagnostics reuses the reference
slot cards and timing chart, adapted to local owned executors and configurable queues.

上传图片解码前按已知比例占位；原生 imageView 开始时就取快照，避免临时文件删除后失图。
独立 Plan 输出作为最终回复保留。诊断页复用原版执行槽及耗时图，改为本机归属进程与可配置队列。

## Recent display parity / 最近显示更新

HTTP LAN access does not require the browser's secure-context randomUUID API for
sending or editing messages. Missing saved conversation directories are reported
explicitly in Skills, with a shortcut to choose a new directory; history paths are
never changed automatically.

通过内网 HTTP 地址访问时，发送和编辑消息不依赖浏览器安全上下文专属的 randomUUID。
历史会话的工作目录失效时，技能页明确提示并提供目录选择入口，不自动修改历史路径。

The sidebar archives chats with a box-shaped action. Settings → Data management
lists archived chats by workspace, with search, workspace filtering and pagination.
Unarchive returns a chat to the sidebar with its history, native thread, settings
and pin state intact. Active or queued chats must finish before archiving.

侧栏通过箱形图标归档聊天。设置 → 数据管理按工作目录分组展示归档记录，支持搜索、
目录筛选和分页。取消归档后会话重新进入侧栏，保留历史、原生会话、设置及置顶状态。
执行中或排队中的聊天需先结束任务再归档。

User-message text keeps the first 20 rendered lines visible, with Show more / Show
less for overflow, including wrapped lines. Images and skill labels remain visible.
Copy and Edit always use the full text. Expansion survives cached conversation
switches while this page stays open; a reload starts collapsed again.

用户消息正文显示前 20 行，超出部分可展开、收起，自动换行也计入行数。
图片和技能标签保持显示，复制和编辑始终使用全文。同一页面内切换缓存对话时保留
展开状态，刷新页面后重新默认折叠。

The Skills panel distinguishes an empty catalog from loading failures. It shows
affected files and localized reasons without exposing raw native errors or skill
contents. Lists are bounded to 300 skills and 20 loading issues, with explicit
truncation notices. Refresh checks the catalog again and clears resolved issues.

技能页区分“未发现技能”和“加载失败”，展示失败文件及本地化原因，不透传原生报错
正文或技能内容。最多显示 300 个技能、20 项加载问题，超出时明确提示；刷新后重新
检查，并清除已解决的问题。

Settings → Conversation display → Show reasoning summaries is off by default. It
only controls the execution timeline: hiding summaries before grouping lets adjacent
commands form one group; actual progress messages remain in chronological order.
The preference applies immediately to loaded and deferred history, persists in this
browser and clears on Restore defaults. It does not change reasoning effort, run
settings or saved execution records.

设置 → 对话显示 → 显示思考摘要默认关闭。分组前先隐藏摘要，相邻命令因此可以合并，
实际进度消息仍按时间顺序展示。开关即时作用于已加载和懒加载历史，在本浏览器保存，
恢复默认时清除；不会修改模型思考深度、运行设置或原始执行记录。

The six recent cached conversation views also retain composer visibility. Switching
back restores the draft, reading position and collapsed/expanded state synchronously
without a fold animation; uncached conversations start expanded. Restoration and
subsequent anchored reflow are not treated as user scroll gestures. Sidebar naming
controls keep keyboard/caret behavior without an additional focus outline.

六个最近缓存对话同时保存输入框状态。切回时同步恢复草稿、阅读位置及展开/折叠状态，
不播放折叠动画；未缓存的对话默认展开。位置恢复及后续锚点重排不作为用户滚动手势。
侧栏名称和改名输入框去掉额外焦点轮廓，保留键盘操作和编辑光标。
