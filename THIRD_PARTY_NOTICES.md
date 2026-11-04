# Third-party notices / 第三方说明

This foundation contains original application code and uses the Python standard
library at runtime. It does not bundle Codex CLI, its credentials, a private
deployment's database/history, or third-party UI assets. Codex is installed by the
user and retains its own license and service terms. Python and packaging tools
retain their respective licenses.

The visual layout, SVG icons, component and expanded-panel styles, composer dashboard/pointer controls, skill picker, image/quota components, palette registry/loader and
DOM Markdown renderer, execution-slot cards, request timing chart and image-header
dimension reader (`src/lazyfish/web/`, `src/lazyfish/image_sizes.py`) adapt original
Lazyfish application code supplied by the project owner for reuse in this independent
project. It contains no imported third-party parser, package, network asset or
private deployment integration. The adaptation is included under this project's
MIT license. Browser regression tests optionally use Playwright/Chromium installed
separately by developers/CI; they are not runtime dependencies or bundled assets.

Review ownership, license compatibility and attribution before importing any future
third-party component.

当前基础框架不捆绑 Codex、凭据、私有部署数据或外部 UI 资源。Codex 由用户自行安装，
遵循其许可证与服务条款。布局、SVG 图标、组件样式、配色注册表/加载器及 Markdown 组件
以及执行槽卡片、请求耗时图和图片头部尺寸解析器，改编自项目所有者授权复用的原 Lazyfish 自有代码，
采用本项目 MIT 许可证，无第三方解析器和私有部署接入。浏览器测试可选使用单独安装的
Playwright/Chromium，不作为运行时依赖或分发资源。后续引入外部组件前仍需审核许可。
