# Third-party notices

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
