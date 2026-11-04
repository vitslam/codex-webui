from __future__ import annotations

import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

from lazyfish.config import initialize


class IsolatedTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="lazyfish-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.root.chmod(0o700)
        self.environment = patch.dict(os.environ, {
            "LAZYFISH_CONFIG": "", "LAZYFISH_WORKSPACE": "", "LAZYFISH_DATA_DIR": "",
            "LAZYFISH_CODEX_BIN": "", "LAZYFISH_HOST": "", "LAZYFISH_PORT": "",
            "LAZYFISH_LOG_LEVEL": "", "LAZYFISH_TOKEN": "",
            "CODEX_HOME":str(self.root/"native-home"),
            "XDG_CONFIG_HOME": str(self.root / "config-root"),
            "XDG_DATA_HOME": str(self.root / "data-root"),
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.workspace = self.root / "projects"
        self.workspace.mkdir()
        self.binary = self.root / "codex-fake"
        self.binary.write_text(f"#!{sys.executable}\n" + Path(__file__).with_name("fake_codex.py").read_text())
        self.binary.chmod(0o700)
        self.config = self.root / "config" / "config.toml"
        self.settings = initialize(self.config, str(self.workspace), str(self.root / "data"),
                                   port=0, binary=str(self.binary))

    def assert_private(self, path: Path, mode: int):
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), mode)
