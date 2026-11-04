from __future__ import annotations

import http.client
from contextlib import closing
import json
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
import time

from lazyfish import runtime
from lazyfish.config import write_private
from support import IsolatedTest


class ServiceCase(IsolatedTest):
    def setUp(self):
        super().setUp()
        self.output_path = self.root / "service-output.txt"
        self.output = self.output_path.open("w+")
        self.addCleanup(self.output.close)
        self.process = subprocess.Popen(self.command("serve"), stdout=self.output, stderr=self.output,
                                        start_new_session=True)
        self.addCleanup(self.cleanup_process)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                self.fail(self.output_path.read_text())
            if runtime.request(self.settings):
                break
            time.sleep(0.03)
        else:
            self.fail("Service did not become available: " + self.output_path.read_text())
        self.metadata_path = self.settings.runtime_dir / "service.json"
        self.metadata = json.loads(self.metadata_path.read_text())
        self.port = self.metadata["port"]

    def command(self, *args):
        return [sys.executable, "-m", "lazyfish", "--config", str(self.config), *args]

    def cleanup_process(self):
        if self.process.poll() is None:
            self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(self.process.pid, signal.SIGKILL)
            self.process.wait(timeout=3)

    def http(self, path="/", method="GET", body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
        payload = json.dumps(body) if body is not None else None
        request_headers = {"Content-Type": "application/json"}
        request_headers.update(headers or {})
        connection.request(method, path, body=payload, headers=request_headers)
        response = connection.getresponse()
        data = response.read()
        result = response.status, dict(response.getheaders()), data
        connection.close()
        return result

class ServiceTests(ServiceCase):
    def test_saved_installation_status_and_stop_without_config_flag(self):
        command = [sys.executable, "-m", "lazyfish"]
        status = subprocess.run(command + ["status"], capture_output=True, text=True, timeout=10)
        self.assertEqual(status.returncode, 0, status.stderr)
        self.assertEqual(json.loads(status.stdout)["instance"], self.metadata["instance"])
        stopped = subprocess.run(command + ["stop"], capture_output=True, text=True, timeout=10)
        self.assertEqual(stopped.returncode, 0, stopped.stderr)
        self.process.wait(timeout=5)
        self.assertEqual(self.process.returncode, 0)

    def test_health_readiness_static_assets_and_private_status(self):
        self.assertEqual(self.http("/healthz")[0], 200)
        self.assertEqual(self.http("/readyz")[0], 200)
        self.assertEqual(self.http("/api/status")[0], 401)
        for path in ("/", "/app.js", "/app.css", "/markdown.js", "/scroll.js", "/shortcuts.js", "/themes.css", "/themes.js", "/panels.js", "/run-settings.js", "/features.js", "/skills.js", "/images.js", "/preferences.js", "/reference-i18n.js", "/activity.js", "/experience.js", "/steps.js", "/changes.js", "/artifacts.js", "/message-view.js", "/composer-dock.js", "/sidebar-order.js"):
            code, headers, body = self.http(path)
            self.assertEqual(code, 200)
            self.assertEqual(headers["Cache-Control"], "no-store" if path=="/" else "no-cache")
            self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
            self.assertNotIn(self.settings.token.encode(), body)
        self.assertEqual(self.http("/../secrets.env")[0], 404)

    def test_cookie_login_logout_and_bearer(self):
        headers = {"Origin": f"http://127.0.0.1:{self.port}"}
        code, response_headers, _ = self.http("/api/session", "POST", {"token": self.settings.token}, headers)
        self.assertEqual(code, 200)
        cookie = response_headers["Set-Cookie"]
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)
        headers["Cookie"] = cookie.split(";", 1)[0]
        self.assertEqual(self.http("/api/status", headers=headers)[0], 200)
        self.assertEqual(self.http("/api/logout", "POST", {}, headers)[0], 200)
        self.assertEqual(self.http("/api/status", headers=headers)[0], 401)
        bearer = {"Authorization": "Bearer " + self.settings.token}
        code, _, data = self.http("/api/status", headers=bearer)
        self.assertEqual(code, 200)
        self.assertNotIn(self.settings.token, data.decode())

    def test_host_origin_auth_and_body_rejection(self):
        self.assertEqual(self.http(headers={"Host": "attacker.example"})[0], 403)
        for origin in ("https://attacker.example", "null", ""):
            headers = {"Origin": origin} if origin else {}
            self.assertEqual(self.http("/api/session", "POST", {"token": self.settings.token}, headers)[0], 403)
        valid_origin = {"Origin": f"http://127.0.0.1:{self.port}"}
        self.assertEqual(self.http("/api/session", "POST", {"token": "bad"}, valid_origin)[0], 401)
        self.assertEqual(self.http("/api/session", "POST", {"token": "x" * 5000}, valid_origin)[0], 400)
        self.assertEqual(self.http("/api/shutdown", "POST", {}, valid_origin)[0], 401)
        for _ in range(9):
            self.assertEqual(self.http("/api/session", "POST", {"token": "bad"}, valid_origin)[0], 401)
        self.assertEqual(self.http("/api/session", "POST", {"token": "bad"}, valid_origin)[0], 429)

    def test_duplicate_start_rejected_and_clean_stop_recorded(self):
        duplicate = subprocess.run(self.command("serve"), capture_output=True, timeout=5)
        self.assertEqual(duplicate.returncode, 2)
        self.assertIn(b"already has a running", duplicate.stderr)
        self.assertIsNotNone(runtime.request(self.settings))
        self.assertTrue(runtime.stop(self.settings))
        self.process.wait(timeout=5)
        self.assertEqual(self.process.returncode, 0)
        self.assertFalse(self.metadata_path.exists())
        self.assertTrue((self.settings.runtime_dir / "service.lock").exists())
        with closing(sqlite3.connect(self.settings.data_dir / "lazyfish.db")) as connection:
            rows = connection.execute("SELECT outcome, stopped_at FROM service_runs").fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][0], "stopped")
        self.assertIsNotNone(rows[0][1])
        self.assertNotIn(self.settings.token, self.output_path.read_text())
        self.assertNotIn(self.settings.token, (self.settings.data_dir / "logs/lazyfish.log").read_text())

    def test_stale_metadata_does_not_stop_a_reused_port_or_pid(self):
        original = self.metadata_path.read_text()
        stale = dict(self.metadata, instance="an-old-instance", pid=os.getpid())
        write_private(self.metadata_path, json.dumps(stale))
        self.assertIsNone(runtime.request(self.settings))
        self.assertFalse(runtime.stop(self.settings))
        self.assertIsNone(self.process.poll())
        self.assertEqual(self.http("/healthz")[0], 200)
        write_private(self.metadata_path, original)

    def test_sigterm_cleanup(self):
        self.process.terminate()
        self.process.wait(timeout=5)
        self.assertEqual(self.process.returncode, 0)
        self.assertFalse(self.metadata_path.exists())


class CliTests(IsolatedTest):
    def test_sigterm_during_startup_reaps_owned_diagnostic(self):
        pid_path = self.root / "owned.pid"
        self.binary.write_text(f"#!{sys.executable}\nimport os,time\nfrom pathlib import Path\n"
                               f"Path({str(pid_path)!r}).write_text(str(os.getpid()))\ntime.sleep(30)\n")
        command = [sys.executable, "-m", "lazyfish", "--config", str(self.config), "serve"]
        with subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) as process:
            try:
                deadline = time.monotonic() + 5
                while not pid_path.exists() and time.monotonic() < deadline:
                    time.sleep(0.02)
                self.assertTrue(pid_path.exists())
                pid = int(pid_path.read_text())
                process.terminate()
                process.wait(timeout=5)
                self.assertEqual(process.returncode, 130)
                with self.assertRaises(ProcessLookupError):
                    os.kill(pid, 0)
            finally:
                if process.poll() is None:
                    process.kill()
                process.wait(timeout=5)

    def test_doctor_output_and_token_are_explicit(self):
        command = [sys.executable, "-m", "lazyfish", "--config", str(self.config)]
        result = subprocess.run([*command, "doctor", "--json", "--probe"], capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertTrue(json.loads(result.stdout)["ready"])
        self.assertNotIn(self.settings.token.encode(), result.stdout + result.stderr)
        result = subprocess.run([*command, "token"], capture_output=True, timeout=5)
        self.assertEqual(result.stdout.decode().strip(), self.settings.token)

    def test_degraded_service_still_has_health(self):
        env = dict(os.environ, LAZYFISH_CODEX_BIN="/nonexistent/codex")
        command = [sys.executable, "-m", "lazyfish", "--config", str(self.config), "serve"]
        with subprocess.Popen(command, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) as process:
            try:
                deadline = time.monotonic() + 5
                report = None
                while time.monotonic() < deadline and not report:
                    report = runtime.request(self.settings)
                    time.sleep(0.03)
                self.assertIsNotNone(report)
                self.assertFalse(report["codex"]["ready"])
                port = json.loads((self.settings.runtime_dir / "service.json").read_text())["port"]
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
                connection.request("GET", "/readyz")
                response = connection.getresponse()
                self.assertEqual(response.status, 503)
                response.read()
                connection.close()
            finally:
                process.terminate()
                process.wait(timeout=5)
