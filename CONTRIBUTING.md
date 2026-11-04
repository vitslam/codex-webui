# Contributing / 参与开发

Please open a focused issue or pull request with the problem, expected behavior
and relevant checks. Keep English/Chinese UI and docs in sync. See [AGENTS.md](AGENTS.md)
for coding-agent guidance and [architecture](docs/architecture.md) for boundaries.

反馈问题请说明现象、预期和复现步骤；提交改动时同步维护中英文文案，避免不相关修改。

Use Python 3.11+ in a virtual environment, install with `pip install -e .`, and run:

```bash
python -m unittest discover -s tests -v
python -m build
```

Optional real-browser checks use a fake CLI and an isolated service, never a model.
Install Playwright and its Chromium browser in a private tooling directory, then:

```bash
export LAZYFISH_BROWSER_NODE=/path/to/node
export LAZYFISH_BROWSER_MODULE=/path/to/node_modules/playwright
export LAZYFISH_BROWSER_EXECUTABLE=/path/to/chromium
export TMPDIR=/your/private/scratch TEMP=/your/private/scratch TMP=/your/private/scratch
python -m unittest discover -s tests -p test_browser.py -v
```

浏览器检查是可选开发依赖，使用模拟 CLI 和隔离服务，不调用模型。普通测试在缺少上述
三个浏览器变量时跳过此项；CI 单独安装浏览器运行。覆盖 Markdown 安全、分页锚点、
刷新和布局变化、快捷键预选/松开、分组状态、分支边界及中英文切换。
同时检查导入配色的切换与保存、手机侧栏遮罩、模型仪表盘、权限浮层、名称搜索及设置面板的可用性。

Runtime dependencies should remain small and justified. Tests use fake Codex
executables and private temporary directories, never production credentials,
inference or a shared database. Build/install the wheel when changing packaging
or web assets. Keep secrets out of code, tests, logs, screenshots and Git history.

测试使用模拟 CLI 和私有临时目录，不调用真实模型，不读取生产凭据或数据库。
修改打包、静态资源后验证 wheel。不得提交密钥、日志、截图中的私人信息或私有基础设施地址。

Use your own Git author identity. The project currently has no remote or release
automation; publication and repository ownership will be decided separately.
Contributions are licensed under the project's MIT license. Include attribution
and a compatible license before importing third-party code or assets.

使用自己的 Git 作者身份。当前没有远程仓库或自动发布，公开发布另行安排。
引入外部代码或资源前，确认许可证并补充归属说明。
