# UI migration / 界面迁移核对

The original Lazyfish remains the visual and interaction reference. The open-source
adapter changes execution/configuration to one machine. A matching icon alone is
not migration: controls are wired to native APIs and persistent local state, with
English and Chinese labels. This checklist records the completed reference flows
and their actual limits; see [extended features](features.md) for behavior.

原版是视觉和交互基准，开源适配主要改变单机执行与配置。下列项目已迁入实际链路，
同时保留中英文；不是只做图标。行为及限制详见[扩展功能](features.md)。

| Component / 组件 | Connected behavior / 已迁入行为 | Boundary / 边界 |
| --- | --- | --- |
| Account menu and login / 账户及登录 | Original menu, identity; retained native device/browser/API-key login and sign-out / 原版菜单、身份、原生登录换号退出 | Native credentials; remote callbacks may need SSH forwarding / 原生保存凭据，远程回调可能需转发 |
| Weekly usage / 每周用量 | Native windows/reset, original activity calendar/token/streak and refresh / 额度重置、活动日历及统计刷新 | Depends on CLI/account/provider / 依赖版本及账户 |
| Settings / 设置 | Original groups, palettes, language, new-chat defaults, visibility, shortcuts and reset / 原版分组、主题语言及默认值、显示、快捷键和重置 | Browser defaults plus persisted per-conversation run choices / 浏览器默认值和持久对话运行设置 |
| Reasoning and Plan / 推理及计划 | Original slider/picker, native capabilities, speed, Plan input and explicit implementation action / 原版滑块、模型、速度、计划输入及执行按钮 | Native capability checks; no automatic implementation / 依赖原生能力，不自动执行 |
| Questions / 交互提问 | Original options/free-input dialog, later/reopen, blocking/nonblocking answers and expiry / 原版选项、自由输入、稍后、重开、答案和过期 | Experimental native request support / 依赖原生提问接口 |
| Permissions / 权限 | Original five presets and native sandbox/approval/reviewer mapping / 原版五项及原生权限映射 | Explicit choices affect subsequent tasks / 显式选择对后续任务生效 |
| + menu and uploads / 加号及上传 | Images/skills/workspace, paste/drop, cleanup of unused uploads / 图片技能目录、粘贴拖入及未用上传清理 | Seven days; saved references retained / 七天后清理无引用上传 |
| Context / 上下文 | Original hover/popup, tokens, manual compaction, mobile bounds and empty 0% / 原版悬浮弹窗、token、压缩、手机边界和初始 0% | Native automatic compaction, no app threshold / 自动压缩由原生管理 |
| Images and outputs / 图片及产物 | Shared viewer/actions; generated native/MCP/dynamic-tool images, authorized downloads / 共用预览菜单、生成图及授权下载 | Typed raster/size limits; no general filesystem endpoint / 类型与大小限制，无任意文件读取 |
| Skills / 技能 | Discovery, @/$ picker, project/personal create/edit, enable/disable, provided and observed load state / 发现选择、项目个人增改启停、提供及加载状态 | Other/system roots read-only / 系统和其他目录只读 |
| Search / 搜索 | Original modal, title/content search, snippets/highlights and conversation selection / 原版弹窗、标题全文搜索及摘要高亮、选择对话 | Reference behavior selects the chat; per-hit deep links are not claimed / 同原版选择对话，不宣称命中段落跳转 |
| Sidebar / 侧栏 | Groups/actions/status dots; persistent pin drag order and grouped numbered/MRU overlay / 分组操作状态、置顶拖动持久化及快捷浮层 | Browser/OS may reserve prefixes / 部分快捷键被系统占用 |
| User messages / 用户消息 | Original copy/edit/branch controls; prefix-retaining native edit fork / 原版复制编辑分支、保留前缀编辑续聊 | Retired suffix audit retained; files shared / 旧后缀保留审计，文件不回滚 |
| Active conversation / 执行中对话 | Supplementary text, delivery state, original folding composer and scroll anchors / 补充文字状态、原版输入框折叠及阅读锚点 | One running turn per conversation / 同一对话一轮执行 |
| Execution details / 执行详情 | Original grouped timeline, reasoning/collaboration, web cards with dedupe / 原版分组时间线、思考协作及去重网页卡片 | Bounded raw records for unsupported tools / 未知工具保留有限原始记录 |
| Diffs and usage / 变更及用量 | Original file counts/diffs and token/cache footer / 原版文件统计 diff 及 token 缓存信息 | Bounded read-only Git snapshots; native token events / 有界只读 Git 快照，原生 token 事件 |
| MCP / 工具与连接 | Existing server status/tools and retained OAuth session / 已配置服务的状态工具及持有 OAuth 会话 | Server configuration stays native / 服务配置仍由原生管理 |
| Diagnostics / 诊断 | Local checks, original slot cards, concurrency and interactive sampling chart / 本机检查、原版槽卡片、并发及采样请求图 | Local owned executors; no remote Worker heartbeat / 本机归属进程，不模拟双机心跳 |

Validation uses fake native protocol tests and actual Chromium for bilingual
panels, media/downloads, timeline/web/diffs, edit/steer/questions/Plan, login-session
UI, pin dragging, composer folding, shortcuts and existing scroll/history behavior.
It does not claim a live external OAuth or model test for these newly added flows.
Quota/activity reopen from snapshots while refreshing in the background. Public static resources use versioned caching; startup reads run concurrently, terminal process data loads on disclosure, history queries are batched and six recent views retain DOM identity.

额度和日历先显示快照再后台刷新；静态资源版本缓存、首屏并行、执行详情按需读取、历史批量查询与六个最近对话视图复用均已接通。

Packaged assets are checked from an installed wheel, without the source import path.

验证使用隔离假 CLI 和真实 Chromium，覆盖中英文、产物下载、时间线、编辑补充提问计划、
授权界面、置顶拖动、折叠、快捷键及已有历史阅读行为。新增原生链路未进行真实外部 OAuth
或模型调用测试；安装包验证从 wheel 安装后运行，移除源码导入路径。

## Audit follow-through in 0.5.0a3 / 审计补迁

The 20 findings were checked against the reviewed reference snapshot. This table
records the actual implementation boundary and regression evidence, rather than
equating a copied button with a completed flow. Source/recovery behavior uses an
isolated fake CLI; browser checks use actual Chromium, including mobile emulation.
Safari hardware, external OAuth and real-model latency are separate acceptance work.

以下逐项记录 20 项差异的实际落点和验证，保留单机身份、租约及安全收尾，
不复制双机通信、私有配置或部署钩子。Safari 真机、外部授权和真实模型耗时需另行验收。

| # | Restored flow / 补迁链路 | Implementation and evidence / 落点与验证 |
| --- | --- | --- |
| 1 | Conversation choices / 对话运行设置 | `run_settings.py`, storage and composer; save/restore, submit, branch and compaction regression / 保存恢复、发送、分支、压缩回归 |
| 2 | Native approvals / 原生审批 | `approvals.py` and shared modal; offered decisions only, exact turn/session grants, rule options / 仅原生选项、精确本轮/会话授权及规则 |
| 3 | Raw skill editor / 技能原文编辑 | Full UTF-8 source and hash; native validation rollback, metadata/conflict regressions / 完整源码、哈希、原生校验回滚与元数据冲突回归 |
| 4 | Idle sync and recovery / 空闲同步及恢复 | Conversation revision SSE, polling fallback, BFCache lifecycle, deletion reconciliation / 修订流、轮询、页面恢复和删除同步 |
| 5 | Standalone Plan / 独立方案正文 | Completed native `plan` becomes final assistant output; protocol and browser regression / 原生 plan 最终正文，协议及浏览器验证 |
| 6 | Pending sends / 待发送与重试 | Optimistic bubble, original ID retry, accepted-response reconciliation and next-draft preservation / 即时气泡、原编号重试、丢响应核对及保留后续草稿 |
| 7 | Read receipts / 已读回执 | Persist latest terminal job read marker; foreground read clears sidebar/overlay dots / 持久已读编号、前台阅读清除圆点 |
| 8 | Suffix-release shortcuts / 松开后缀快捷键 | Number/Tab/Backslash release commits; prefix-first cancels; edit/IME/focus guards / 松数字或 Tab 或反斜杠执行、先松前缀取消及编辑保护 |
| 9 | Warm app-server / 预热复用 | `runtimes.py`, lasting spawn thread, owned runtime/task journals and native writer affinity / 长期创建线程、执行槽/任务归属日志与原生写入归属 |
| 10 | Independent command details / 命令独立详情 | Light previews, version/offset/hash suffix retrieval and lightweight changes API / 轻量预览、版本与哈希增量正文、独立变更接口 |
| 11 | Immediate stop / 即时停止 | Frozen local snapshot, confirmed backend cancellation and explicit failure retry / 本地冻结、后端确认取消与失败重试 |
| 12 | Image placeholders / 图片占位 | Header-derived dimensions, old attachment backfill and aspect reservation / 头部尺寸解析、旧数据回填及比例预占位 |
| 13 | Early imageView capture / 查看图片早期快照 | Capture on start; fake tool deletes temporary file before completion to verify retention / 开始时保存，模拟完成前删源文件验证 |
| 14 | Supplementary skills/actions / 补充技能及操作 | Native steer skill inputs, delivery state and user-style copy action / 原生补充技能输入、交付状态和复制操作 |
| 15 | Deferred questions / 稍后提问 | Blocking/nonblocking auto-show and session-persisted Later; refresh browser regression / 阻塞/非阻塞自动提示、会话保存稍后状态及刷新回归 |
| 16 | Mobile viewport/focus / 移动视口焦点 | Scale=1 adaptation, keyboard marker, short-tap preventScroll focus; Safari pending / 等比视口、键盘状态及轻点焦点，Safari 待真机验证 |
| 17 | Automatic history pagination / 触顶历史续载 | Near-top scroll loads older page while preserving reading anchor; browser regression / 触顶加载并保留阅读锚点，浏览器验证 |
| 18 | New-chat/sidebar details / 新对话侧栏细节 | Unsaved drafts, remembered selection, double-click rename, unchanged-DOM skip, no quota timestamp / 草稿、记住选择、双击改名、跳过重复渲染、移除用量时间 |
| 19 | Request timings / 请求耗时 | Local collector and original interactive chart; bounded sampling metadata only, dedup/privacy regression / 本机采集及原版图表，仅有界采样元数据与隐私去重验证 |
| 20 | Local slots/queue / 本机执行槽队列 | Original cards, persistent 1–16 target, bounded FIFO queue, drain on shrink and restart without replay / 原版卡片、持久并发、有界顺序队列、缩容收尾及重启不重跑 |

`tests/test_reference_parity.py` covers the new durable/native boundaries, including
writer affinity, slot retirement and forced restart. `tests/parity_browser.cjs`
covers their connected UI flows. Existing cache, transcript, migration and browser
suites remain part of the full check; these changes do not replace those regressions.

新协议用例覆盖写入归属、缩容及强制重启；新增浏览器用例覆盖实际页面链路。
既有缓存、历史、升级和界面测试仍一并运行，不以新增用例替代旧回归。

## Reference updates through 5c646f5 / 最近三项同步

Version 0.5.0a4 adapts `e9cd878` (composer restoration), `bf5c3c2` (sidebar focus
outlines) and `5c646f5` (reasoning visibility) to the single-machine frontend.
`scroll.js` explicitly settles programmatic restoration so it cannot trigger the
composer's user-scroll folding rule. Reasoning visibility participates in job-render
signatures and deferred step rendering, while keeping step data intact. These are
frontend changes; schema 8 and native execution policies remain unchanged.

0.5.0a4 同步上述三个原版提交。位置恢复显式同步输入框滚动基准，避免被误认为用户滚动；
思考摘要开关接入轮次渲染签名和懒加载步骤，不删除原始记录。仅修改前端，无数据库升级。
新增浏览器用例覆盖桌面/手机尺寸下的无动画恢复、草稿和位置、打断动画、摘要分组、
缓存切换、刷新、恢复默认、中英文及改名焦点；Safari 真机仍需单独验收。

## Input and popup style audit / 输入区与弹层样式核查

Version 0.5.0a5 checks the input area, common popovers, image viewer, message actions
and sidebar against reference `5c646f5`. This is a focused source/computed-style and
interaction check, not a claim of pixel-identical UI across all browsers.

0.5.0a5 对照原版核查输入区、常用弹层、图片预览、消息动作区和侧栏，检查源码、计算
样式及交互；不把这一范围的核查宣称为全部界面在所有浏览器下逐像素一致。

| Difference / 差异 | Resolution / 处理 |
| --- | --- |
| Extra Enter/Shift+Enter line / 多出的快捷键提示行 | Remove markup, unused labels and styles; shortcuts remain configurable / 删除结构、闲置文案和样式，快捷键仍在设置管理 |
| Textarea focus outline / 文本框聚焦框 | Remove repeated global CSS that overrode textarea exclusions; preserve caret and keyboard focus / 清理重复全局规则，保留光标和键盘焦点 |
| Extra default input height / 默认输入框偏高 | Restore one row and remove adapter min-height overrides; bound growth to 260px and 30% of viewport / 恢复单行，移除额外最小高度，按视口限高 |
| Placeholder and steering text / 占位及补充指令文案 | Restore reference bilingual idle/active wording / 对齐中英文空闲和执行中文案 |
| Permission popover / 权限菜单 | Restore -35px local alignment instead of forcing left zero / 移除强制左对齐，恢复原版局部偏移 |
| User bubble spacing / 用户气泡间距 | Restore 35px bottom spacing / 恢复下方 35px 留白 |
| Image preview / 图片预览 | Remove fullscreen width/height override; retain backdrop/Escape dismissal / 移除强制全屏尺寸，保留空白处及 ESC 关闭 |
| Approval detail / 审批详情 | Restore reference font, padding, border and 180px scroll limit / 对齐字号、内边距、边框及滚动高度 |
| Composer handle animation / 输入框手柄动画 | Put reduce-motion exclusion back inside its media query / 恢复减少动画的媒体条件 |
| Sidebar/mobile spacing / 侧栏和手机间距 | Restore caption margin and control gaps / 恢复标题留白和控件间距 |
| Mobile search height / 手机搜索高度 | Use visual viewport bounds instead of full device height / 按可视视口限制弹窗高度 |

Deliberate single-machine differences remain: local token/installation controls,
manual model-ID configuration, header space reserved for local utility buttons, and
16px mobile input text to prevent focus zoom. These are not removed as styling debris.
Native defaults, authentication and execution controls remain installation-specific.

明确保留的适配包括本机令牌/安装入口、手填模型 ID、顶部本机操作按钮的避让空间，以及
防止聚焦缩放的手机 16px 输入字号。原生默认值、认证和执行配置仍由本机安装决定，
不作为残留样式直接删除。Safari 真机需另行验收。
