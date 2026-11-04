import os
import json
from pathlib import Path
import subprocess
import sys
from unittest.mock import patch

import lazyfish
from lazyfish.config import (ConfigError, config_path, default_config, initialize,
                             load, read_secrets, remember_config, write_private)
from lazyfish.codex import child_env
from support import IsolatedTest


class ConfigTests(IsolatedTest):
    def cli(self, *arguments):
        env = dict(os.environ, PYTHONPATH=str(Path(lazyfish.__file__).resolve().parents[1]))
        return subprocess.run([sys.executable, "-m", "lazyfish", *arguments],
                              cwd=self.workspace, env=env, capture_output=True, text=True, timeout=10)

    def test_init_without_workspace_uses_private_default(self):
        config = self.root / "empty/config.toml"
        data = self.root / "empty-data"
        result = self.cli("--config", str(config), "init", "--data-dir", str(data))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('workspace = ""', config.read_text())
        settings = load(config)
        self.assertFalse(settings.workspace_configured)
        self.assertEqual(settings.workspace, data.resolve() / "workspace")
        self.assert_private(settings.workspace, 0o700)
        self.assertEqual(self.cli("--config", str(config), "token").returncode, 0)
        self.assertEqual(load(self.config).workspace, self.workspace.resolve())
        from types import SimpleNamespace
        from lazyfish.web.server import Handler
        from lazyfish.storage import StoreError
        handler = Handler.__new__(Handler)
        handler.server = SimpleNamespace(settings=settings)
        self.assertEqual(handler._workspace(""), str(settings.workspace))
        self.assertEqual(handler._workspace(str(self.workspace)), str(self.workspace.resolve()))
        handler.server.settings = self.settings
        with self.assertRaises(StoreError):
            handler._workspace(str(data))

    def test_custom_init_remembers_path_for_commands_from_another_directory(self):
        before = self.config.read_bytes()
        result = self.cli("--config", str(self.config), "init", "--workspace", str(self.workspace))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("`lazyfish token`", result.stdout)
        result = self.cli("token")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result.stdout.strip() == self.settings.token)
        self.assertEqual(before, self.config.read_bytes())
        locator = default_config().parent / "installation.json"
        self.assert_private(locator, 0o600)
        self.assertEqual(json.loads(locator.read_text()), {"config": str(self.config)})

    def test_existing_custom_installation_is_remembered_after_successful_command(self):
        result = self.cli("--config", str(self.config), "token")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(config_path(), self.config)
        failed = self.cli("--config", str(self.root / "missing.toml"), "token")
        self.assertEqual(failed.returncode, 2)
        self.assertEqual(config_path(), self.config)

    def test_configuration_priority_and_no_silent_instance_switch(self):
        remember_config(self.config)
        other = self.root / "other/config.toml"
        initialize(other, str(self.workspace), str(self.root / "other-data"))
        remember_config(other)
        self.assertEqual(config_path(), self.config)
        with patch.dict(os.environ, {"LAZYFISH_CONFIG": str(other)}):
            self.assertEqual(config_path(), other)
            self.assertEqual(config_path(str(self.config)), self.config)
        initialize(default_config(), str(self.workspace), str(self.root / "default-data"))
        self.assertEqual(config_path(), default_config())
        self.assertTrue(self.cli("token").stdout.strip() == load(default_config()).token)

    def test_missing_or_unsafe_saved_path_fails_without_creating_another_configuration(self):
        remember_config(self.config)
        self.config.rename(self.config.with_suffix(".backup"))
        result = self.cli("token")
        self.assertEqual(result.returncode, 2)
        self.assertIn("Saved configuration is missing", result.stderr)
        self.assertNotIn("Traceback", result.stderr)
        self.assertFalse(default_config().exists())
        locator = default_config().parent / "installation.json"
        for value in ("{", "[]", '{"config": "relative/config.toml"}'):
            write_private(locator, value)
            self.assertEqual(self.cli("token").returncode, 2)
        write_private(locator, json.dumps({"config": str(self.config)}))
        locator.chmod(0o644)
        with self.assertRaises(ConfigError):
            config_path()
        locator.unlink()
        locator.symlink_to(self.config.with_suffix(".backup"))
        with self.assertRaises(ConfigError):
            config_path()
        self.assertEqual(config_path(str(self.config)), self.config)

    def test_default_config_remains_automatic_without_locator(self):
        self.assertEqual(config_path(), default_config())
        result = self.cli("init", "--workspace", str(self.workspace))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((default_config().parent / "installation.json").exists())
        self.assertEqual(self.cli("token").returncode, 0)

    def test_explicit_configuration_works_when_discovery_directory_is_unwritable(self):
        blocked = self.root / "blocked-config-root"
        blocked.write_text("not a directory")
        with patch.dict(os.environ, {"XDG_CONFIG_HOME": str(blocked)}):
            result = self.cli("--config", str(self.config), "token")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result.stdout.strip() == self.settings.token)
        self.assertIn("Could not remember", result.stderr)
        remember_config(self.config)
        locator = default_config().parent / "installation.json"
        write_private(locator, "invalid json")
        result = self.cli("--config", str(self.config), "init", "--workspace", str(self.workspace))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--config", result.stdout)

    def test_private_initialization_and_no_secret_repr(self):
        self.assert_private(self.config, 0o600)
        self.assert_private(self.config.parent / "secrets.env", 0o600)
        self.assert_private(self.settings.data_dir, 0o700)
        self.assert_private(self.settings.runtime_dir / "tmp", 0o700)
        self.assertGreaterEqual(len(self.settings.token), 32)
        self.assertNotIn(self.settings.token, repr(self.settings))
        self.assertNotIn(self.settings.token, self.config.read_text())

    def test_reinitialization_preserves_config_and_token(self):
        before = self.config.read_bytes()
        again = initialize(self.config, str(self.root), str(self.root / "other"), 1000)
        self.assertEqual(again.token, self.settings.token)
        self.assertEqual(before, self.config.read_bytes())

    def test_concurrent_initialization_uses_one_config_and_token(self):
        config = self.root / "concurrent/config.toml"
        command = [sys.executable, "-m", "lazyfish", "--config", str(config), "init",
                   "--workspace", str(self.workspace), "--data-dir", str(self.root / "concurrent-data")]
        processes = [subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE) for _ in range(3)]
        for process in processes:
            stdout, stderr = process.communicate(timeout=5)
            self.assertEqual(process.returncode, 0, stderr.decode())
        before = load(config).token
        self.assertEqual(load(config).token, before)

    def test_environment_precedence_and_relative_paths(self):
        with patch.dict(os.environ, {"LAZYFISH_PORT": "12345", "LAZYFISH_DATA_DIR": "relative"}):
            settings = load(self.config)
        self.assertEqual(settings.port, 12345)
        self.assertEqual(settings.data_dir, self.config.parent / "relative")

    def test_reject_public_bind_and_invalid_port(self):
        for overrides in ({"LAZYFISH_HOST": "0.0.0.0"}, {"LAZYFISH_PORT": "65536"},
                          {"LAZYFISH_PORT": "1.2"}, {"LAZYFISH_TOKEN": "short"}):
            with self.subTest(overrides=list(overrides)), patch.dict(os.environ, overrides):
                with self.assertRaises(ConfigError):
                    load(self.config)

    def test_reject_unknown_schema_and_unsafe_file(self):
        self.config.write_text(self.config.read_text() + '\n[unknown]\nkey = "secret"\n')
        with self.assertRaises(ConfigError):
            load(self.config)
        self.config.chmod(0o644)
        with self.assertRaisesRegex(ConfigError, "600"):
            load(self.config)

    def test_reject_symlink_config_and_private_dir(self):
        original = self.config.with_suffix(".original")
        self.config.rename(original)
        self.config.symlink_to(original)
        with self.assertRaises(ConfigError):
            load(self.config)
        data = self.settings.data_dir
        data.rename(self.root / "data-real")
        data.symlink_to(self.root / "data-real")
        with self.assertRaises(ConfigError):
            self.settings.prepare()

    def test_no_shell_expansion_or_workspace_dotenv_loading(self):
        secret_file = self.config.parent / "secrets.env"
        secret_file.write_text(secret_file.read_text() + '\nHTTPS_PROXY="$(touch never-run)"\n')
        self.assertEqual(read_secrets(secret_file)["HTTPS_PROXY"], "$(touch never-run)")
        self.assertFalse((self.config.parent / "never-run").exists())
        (self.workspace / ".env").write_text("LAZYFISH_TOKEN=untrusted\n")
        self.assertEqual(load(self.config).token, self.settings.token)

    def test_only_allowed_secrets_reach_child(self):
        with patch.dict(os.environ, {"UNRELATED_SERVICE_SECRET": "hidden", "LAZYFISH_TOKEN": "x" * 40,
                                    "OPENAI_API_KEY": "fake-key-for-test", "HTTPS_PROXY": "http://proxy.example:3128"}):
            settings = load(self.config)
            env = child_env(settings)
        self.assertNotIn("LAZYFISH_TOKEN", env)
        self.assertNotIn("UNRELATED_SERVICE_SECRET", env)
        self.assertEqual(env["OPENAI_API_KEY"], "fake-key-for-test")
        self.assertEqual(env["HTTPS_PROXY"], "http://proxy.example:3128")
        self.assertEqual(env["TMPDIR"], str(self.settings.runtime_dir / "tmp"))
