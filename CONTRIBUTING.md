# Contributing

Please open a focused issue or pull request with the problem, expected behavior
and relevant checks. Keep the English and Chinese UI locales in sync. General documentation is English;
the Chinese README is maintained separately. See [AGENTS.md](AGENTS.md)
for coding-agent guidance and [architecture](docs/architecture.md) for boundaries.

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

Runtime dependencies should remain small and justified. Tests use fake Codex
executables and private temporary directories, never production credentials,
inference or a shared database. Build/install the wheel when changing packaging
or web assets. Keep secrets out of code, tests, logs, screenshots and Git history.

Use your own Git author identity. The project does not automatically deploy production services.
Contributions are licensed under the project's MIT license. Include attribution
and a compatible license before importing third-party code or assets.
