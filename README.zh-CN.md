# Lazyfish

<p align="center">
  <img src="docs/assets/lazyfish-logo.png" alt="Lazyfish logo" width="640">
</p>

[English](README.md) · [配置说明](docs/configuration.md) · [架构](docs/architecture.md) · [路线图](docs/roadmap.md)

为已经安装 **Codex CLI** 的机器提供轻量、自托管的 Web 界面。
Web 服务和 CLI 部署在**同一台机器**，通过本机浏览器、显式开启的可信局域网或 SSH 隧道访问，
不需要另一台执行机，也不需要安装桌面客户端。

在浏览器中管理对话、查看执行进度、处理文件与图片，并按自己的习惯选择模型、主题和快捷键。

Lazyfish 是独立开发的第三方项目，与 OpenAI 无隶属、赞助或认可关系。OpenAI、Codex、ChatGPT 等名称及相关商标归各自权利人所有。

## 界面预览

| 深色模式 · 中文 | 浅色模式 · English |
| --- | --- |
| ![Lazyfish 深色主题与中文界面](docs/assets/screenshot-dark.png) | ![Lazyfish 浅色主题与英文界面，展示推理强度选择](docs/assets/screenshot-light.png) |

## 为什么选择 Lazyfish

如果你希望通过浏览器使用 Codex，或在多台设备之间切换，Lazyfish 提供了一个轻量、自托管的入口。

- **轻装上阵，打开网页就能用**：无需为每台访问设备下载和维护独立的桌面客户端，也不用额外安装一套桌面运行环境。服务端使用 Python 标准库，Lazyfish 本身没有额外的 Python 运行时依赖。
- **电脑、手机及配备兼容浏览器的嵌入式设备，都能成为工作入口**：界面适配不同屏幕，在电脑浏览器中处理项目，也可以从手机查看进度、补充指令。配备兼容现代网页功能的浏览器的平板、嵌入式设备，也可以作为访问终端；Codex 与任务仍在服务机器上运行，访问设备无需安装 CLI。
- **让等待尽量少一点**：静态资源缓存、首屏请求并行、最近对话视图缓存，让刷新与切换少做重复加载。长对话分页读取，执行详情按需展开，用量面板先显示已有记录再后台更新，让界面及时呈现可用内容。
- **任务留在服务端，操作不局限于一台设备**：通过安全的远程访问方式连接同一服务，继续查看保存在服务端的对话、文件产物和任务进度。关闭浏览器不打断任务，重新打开后仍可继续跟进。
- **ChatGPT 登录与 API Key 都能用**：通过 Codex CLI，既可使用 ChatGPT 账户登录，也可使用自己的 OpenAI API Key，在浏览器中继续工作。API Key 用量按 API 规则单独计费，支持的功能取决于账户与 CLI。参见[官方认证说明](https://learn.chatgpt.com/docs/auth)。
- **自己的机器，自己的工作空间**：自行选择运行环境和项目目录，复用已有 Codex 登录与配置，对话和附件保存在自己的服务机器上。主题、语言与快捷键也可以按使用习惯调整。

Lazyfish 优化的是网页加载、交互和访问方式；模型生成速度仍取决于所选模型、服务提供方与网络。

## 环境要求

- Linux 或 macOS、Python **3.11–3.14**、`venv` 和 `pip`。运行时没有额外 Python 依赖。
- 同一系统用户下可运行支持 `app-server` 的 Codex CLI；需自行安装和登录，项目直接复用已有安装。
- 聊天前完成原生 CLI 登录，也可在网页账户面板发起登录。
  参考 [Codex 登录说明](https://learn.chatgpt.com/docs/auth)。
- 工作目录可留空，无需在安装时指定。

项目不捆绑或自动安装 Codex。
默认复用 CLI 的登录状态；原生登录可用时，不需要额外填写
OpenAI API Key。API Key 登录方式和网络代理均由用户自行配置，没有内置地址或密钥。

## 快速开始

在下载或克隆的项目目录中运行：

```bash
bash scripts/install.sh
# 如有提示，先执行安装器输出的 source 命令。
lazyfish token
lazyfish serve
```

访问 **http://127.0.0.1:3210**，输入 `lazyfish token` 显示的 **Web 登录令牌**。
它与 Codex/OpenAI 凭据相互独立，由安装程序自动生成，安装日志不会显示令牌。
页面可以切换中英文。
默认绑定 `127.0.0.1`，仅限本机访问。跨设备访问见下方[远程访问](#远程访问)；
局域网访问需要显式开启，仍需 Web 登录令牌。

安装器会创建 `~/.local/bin/lazyfish`，Python 虚拟环境仅作为内部运行环境。
如果该目录不在 PATH 中，会自动配置 Bash/Zsh 启动文件，并提示在当前终端执行一次
`source` 命令；请先执行提示的命令，再使用 `lazyfish`（也可重新打开终端）。
重复安装会更新命令入口，不会重复添加 PATH 配置，也不会覆盖其他已有的同名命令。
请保留安装目录。
工作目录配置默认留空；未选择目录的任务使用数据目录下的 `workspace/`。
也可在网页选择项目目录，或在安装时用 `--workspace /项目路径` 限定工作范围。

安装脚本仅安装 Lazyfish、初始化配置和数据。Codex 请按照[官方 CLI 文档](https://learn.chatgpt.com/docs/codex/cli)自行安装并登录。
找不到 `codex` 命令时，可手动指定路径：

```bash
LAZYFISH_CODEX_BIN=/实际路径/codex lazyfish serve
```

也可在 `config.toml` 的 `[codex]` 下填写 `binary`，无需重复登录已有 Codex 账户。

不需要 `sudo`，不注册系统服务，也不会自动启动后台进程。
`serve` 在前台运行，Ctrl+C 可退出，也可在另一终端执行：

```bash
lazyfish status
lazyfish stop
```

系统 Python 版本过低时，可以指定其他已安装的解释器：

```bash
PYTHON=/path/to/python3.14 bash scripts/install.sh
```

## 远程访问

**可信局域网：** 在本地 `~/.config/lazyfish/config.toml`（或你选用的配置文件）中，
将 `[server]` 下的 `host` 改为 `"0.0.0.0"`，然后重启服务：

```toml
[server]
host = "0.0.0.0"
```

启动时会打印本机地址和探测到的 IPv4 地址。在另一台设备打开其中一个地址，
使用 `lazyfish token` 显示的令牌登录。启动信息会省略常见容器和网桥接口；
如果只想绑定一个网卡，也可指定该网卡的 IPv4（例如 `192.168.1.10`）。详见[配置说明](docs/configuration.md)。

`0.0.0.0` 会监听**所有 IPv4 网卡**，不只局域网；也可以绑定某个公网或内网 IPv4。
HTTP 不会加密令牌和传输内容，请用防火墙限制谁可以连接。Host 检查只拒绝 Host
不是本进程地址的请求，**不能替代防火墙**。绑定地址由你选择，谁能访问由你负责。
不可信网络应使用 SSH。

**SSH 备选方式：** 保留默认的 `127.0.0.1` 绑定，并转发端口：

```bash
ssh -N -L 3210:127.0.0.1:3210 user@your-server
```

然后在自己的浏览器打开 `http://127.0.0.1:3210`，使用 Web 令牌登录。
工作目录是执行时的起点，**不是操作系统沙箱**；建议使用独立系统用户，
只授予希望 Agent 访问的文件权限。

## 功能特色

- **在浏览器中使用 Codex**：连接同一台机器上已安装的 Codex CLI，直接使用已有登录状态和项目目录。无需额外安装桌面客户端，也无需单独部署执行节点。
- **多对话与历史搜索**：创建、重命名、置顶和拖动排序对话，按标题或消息正文搜索历史。切换对话或刷新页面后，恢复之前的阅读位置。
- **编辑消息与对话分支**：修改已发送的消息，或从历史消息之前创建分支，尝试不同思路。分支会保留原对话供后续查看；编辑和分支不会回滚工作目录中的文件。
- **多任务并行与执行控制**：不同对话可以同时执行任务，并发数量可在诊断面板中设置为 1–16。刷新页面、切换对话或关闭标签页不会停止任务；执行中可补充指令，也可随时停止并保留已收到的回复。
- **清晰的执行过程与结果**：流式展示回复，支持 Markdown、表格、代码复制和可折叠执行详情。查看命令、网页搜索结果、文件变更与 diff，预览生成的图片，并下载回复中的文件。Markdown 中的本地绝对路径会显示为名称链接，点击可复制服务端路径，或在浏览器所在设备的 VS Code 中打开；支持空格、括号和行号，远程路径需要对应的远程工作区。 图片产物以紧凑缩略图展示，点击可放大；正文已显示的图片不再重复展示；文字链接对应的图片仍保留缩略图。
- **模型、推理与权限选择**：在输入框中选择模型、调整推理强度和快速/标准速度，按任务需要选择权限模式。支持 Plan 模式，先查看方案，再决定是否执行；需要确认或补充信息时，可直接在页面中回答。
- **图片、技能与工具连接**：通过选择、粘贴或拖放添加图片。使用 `@`、`$` 或添加菜单选择技能，创建和编辑项目或个人技能；查看 MCP 工具与连接状态，并为支持 OAuth 的服务完成授权。
- **账户、用量与上下文管理**：支持设备码、浏览器和 API Key 登录。查看可用的额度、重置时间和使用记录，了解当前上下文占用，并按需手动压缩。功能及数据是否可用取决于 CLI 版本、账户和服务提供方。
- **多主题、多语言与快捷操作**：中英文界面自由切换，提供 8 套配色、明暗外观及跟随系统选项。自定义发送、换行和对话切换快捷键；按住快捷键前缀即可查看切换提示，侧栏收起时也能快速找到目标对话。

详细操作与功能限制见[功能说明](docs/features.md)，安装及运行选项见[配置说明](docs/configuration.md)。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `lazyfish init [--workspace PATH]` | 初始化；已有配置和令牌不会被覆盖 |
| `lazyfish doctor` | 检查可执行文件、已保存的登录状态、工作目录和 app-server 命令 |
| `lazyfish doctor --probe --json` | 额外启动并关闭独立 app-server，只做初始化握手，不调用模型 |
| `lazyfish serve` | 前台启动聊天服务，默认需要 Web 令牌 |
| `lazyfish serve --no-token` | 显式关闭本次运行的 Web 登录认证，风险见下方说明 |
| `lazyfish status` | 通过认证接口查看当前数据目录对应的实例 |
| `lazyfish stop` | 安全停止该实例，不会根据遗留 PID 文件直接结束进程 |
| `lazyfish token [--rotate]` | 在终端显示 Web 登录令牌；`--rotate` 在停服后更换令牌 |

**警告：**`serve --no-token` 允许任何能访问该 URL 的人使用此 Codex 会话，
包括其可访问的文件和原生账户。此选项只对本次运行生效，普通 `serve` 仍需令牌。
Host 检查不是访问控制，HTTP 仍不加密。详见[配置说明](docs/configuration.md#optional-web-sign-in-bypass--可选的免-web-登录模式)。

普通命令自动查找默认配置；没有默认配置时，会记住首次成功初始化或使用的自定义配置，
以后切换目录也无需反复指定 `--config`。仅操作其他实例等高级场景，才需要用
`lazyfish --config /path/to/config.toml 命令` 或 `LAZYFISH_CONFIG` 覆盖自动选择。
修改配置后需重启服务。安装 CLI 或改变登录状态后，可在“本机安装 → 重新检测”或
“诊断与性能”右上角重新检查，无需重启；网页账户登录或退出后会自动更新检查。
账户、用量、技能或连接面板的刷新会启动并关闭
归属于本服务的短期 CLI 进程读取信息，不创建原生对话、不调用模型。

`doctor` 通过只代表本机环境及原生 CLI 保存的登录状态正常。
即使 `--probe` 握手成功，也**不等于**网络、模型调用、余额和所有后续聊天接口都已验证。

## 数据与隐私

| 默认位置（遵循 XDG） | 用途 |
| --- | --- |
| `~/.config/lazyfish/config.toml` | 工作目录、数据目录、CLI 路径、端口、日志级别 |
| `~/.config/lazyfish/secrets.env` | 自动生成的 Web 令牌及可选私有环境配置 |
| `~/.local/share/lazyfish/` | SQLite 对话/任务/事件、日志、执行归属记录、上传图片、附件文件及上下文用量快照 |
| 原有 Codex home / 系统凭据存储 | 原生登录，Lazyfish 不复制或修改凭据文件 |

应用目录权限为 `700`，配置、密钥及数据文件为 `600`，权限不安全的配置及密钥文件会被拒绝。
Git 默认忽略填写过的环境文件、数据库、日志和运行数据。
不包含统计服务、外部 CDN、账号凭据或私有部署钩子。
默认模式下浏览器使用 HttpOnly Cookie 保存会话，不将令牌写入 localStorage；重启后需重新登录。
localStorage 仅保存语言、外观、快捷键、侧边栏偏好，以及数量受限的消息 ID、滚动几何信息和
工具展开状态，不保存消息正文和令牌。

详见[配置](docs/configuration.md)、[部署](docs/deployment.md)、
[排障](docs/troubleshooting.md)和[安全说明](SECURITY.md)。

## 开发

```bash
python3.11 -m venv .venv
.venv/bin/python -m pip install -e .
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m pip install build
.venv/bin/python -m build
```

测试使用隔离目录和模拟 Codex，不需要真实凭据，也不消耗模型额度。
CI 覆盖 Python 3.11–3.14、隔离 Chromium 界面检查，以及 wheel 构建和安装。
本地可选浏览器测试命令见 [CONTRIBUTING.md](CONTRIBUTING.md)。
参考 [CONTRIBUTING.md](CONTRIBUTING.md)。项目代码采用 MIT 许可证；
Codex 及第三方服务保留各自的许可证与使用条款。
