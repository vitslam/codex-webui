from dataclasses import replace
import json
import logging
import os
import time

from lazyfish.codex import diagnose, probe
from lazyfish.logging_setup import Redactor
from support import IsolatedTest


class CodexTests(IsolatedTest):
    def test_checks_and_probe_without_inference_or_account_output(self):
        report = diagnose(self.settings, protocol=True)
        self.assertTrue(report["ready"], report)
        self.assertTrue(report["protocol"])
        self.assertEqual(report["version"], "0.162.1")
        self.assertNotIn("simulated-account-secret", json.dumps(report))
        self.assertNotIn(self.settings.token, json.dumps(report))

    def test_missing_cli_is_degraded_not_an_exception(self):
        report = diagnose(replace(self.settings, codex_binary="/nonexistent/codex"))
        self.assertFalse(report["ready"])
        self.assertFalse(report["checks"]["codex"])

    def test_hanging_probe_is_bounded_and_reaped(self):
        pid_path = self.root / "probe.pid"
        self.binary.write_text(f"#!{os.sys.executable}\nimport os,time\nfrom pathlib import Path\n"
                               f"Path({str(pid_path)!r}).write_text(str(os.getpid()))\ntime.sleep(30)\n")
        started = time.monotonic()
        self.assertFalse(probe(str(self.binary), self.settings, timeout=0.2))
        self.assertLess(time.monotonic() - started, 4)
        pid = int(pid_path.read_text())
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)

    def test_version_timeout_does_not_block_doctor(self):
        self.binary.write_text(f"#!{os.sys.executable}\nimport time\ntime.sleep(30)\n")
        started = time.monotonic()
        report = diagnose(self.settings, timeout=0.1)
        self.assertFalse(report["ready"])
        self.assertEqual(report["error"], "codex_check_failed")
        self.assertLess(time.monotonic() - started, 4)

    def test_structured_and_pattern_secrets_redacted(self):
        record = logging.LogRecord("test", 20, "", 1, "token=%s key=sk-fake-test-key", (self.settings.token,), None)
        Redactor([self.settings.token]).filter(record)
        self.assertNotIn(self.settings.token, record.getMessage())
        self.assertNotIn("sk-fake-test-key", record.getMessage())
