import os
import fcntl
import json
from pathlib import Path
import subprocess
import sys
from unittest.mock import patch

import lazyfish
from lazyfish.config import (ConfigError, config_path, default_config, initialize,
                             load, read_secrets, remember_config, rotate_token, write_private)
from lazyfish.codex import child_env
from support import IsolatedTest


class ConfigTests(IsolatedTest):
    def cli(self, *arguments):
        env = dict(os.environ, PYTHONPATH=str(Path(lazyfish.__file__).resolve().parents[1]))
        return subprocess.run([sys.executable, "-m", "lazyfish", *arguments],
                              cwd=self.workspace, env=env, capture_output=True, text=True, timeout=10)

    def test_init_without_workspace_uses_home_without_changing_permissions(self):
        config=self.root/'empty/config.toml';data=self.root/'empty-data'
        home=self.root/'user-home';home.mkdir();home.chmod(0o755)
        with patch.dict(os.environ,{'HOME':str(home)}):
            result=self.cli('--config',str(config),'init','--data-dir',str(data))
            self.assertEqual(result.returncode,0,result.stderr)
            settings=load(config);settings.prepare()
            self.assertFalse(settings.workspace_configured)
            self.assertEqual(settings.workspace,home.resolve())
            self.assertEqual(home.stat().st_mode & 0o777,0o755)
            self.assertFalse((data/'workspace').exists())
        self.assertEqual(load(self.config).workspace,self.workspace.resolve())
        from types import SimpleNamespace
        from lazyfish.web.server import Handler
        from lazyfish.storage import Store,StoreError
        handler=Handler.__new__(Handler)
        handler.server=SimpleNamespace(settings=self.settings,manager=SimpleNamespace(store=Store(self.settings.data_dir/'lazyfish.db')))
        self.assertEqual(handler._workspace(''),str(self.workspace.resolve()))
        self.assertEqual(handler._workspace(str(data)),str(data.resolve()))
        with self.assertRaises(StoreError):handler._workspace('../')

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

    def test_token_without_flags_does_not_rotate(self):
        secret_file = self.config.parent / "secrets.env"
        before = secret_file.read_bytes()
        result = self.cli("--config", str(self.config), "token")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, self.settings.token + "\n")
        self.assertEqual(result.stderr, "")
        self.assertEqual(secret_file.read_bytes(), before)

    def test_rotate_preserves_other_secrets_comments_and_custom_path(self):
        secret_file = self.config.parent / "private" / "credentials.env"
        original = ("# Keep these credentials private.\n\nOPENAI_API_KEY='test-key'\n"
                    "  LAZYFISH_TOKEN = \"" + self.settings.token + "\"\n"
                    "HTTPS_PROXY=http://proxy.example:3128\n# Token override\n"
                    "LAZYFISH_TOKEN=" + self.settings.token)
        write_private(secret_file, original)
        self.config.write_text(self.config.read_text().replace('secrets.env', 'private/credentials.env'))
        config_before = self.config.read_bytes()
        token = rotate_token(self.config)
        self.assertNotEqual(token, self.settings.token)
        self.assertGreaterEqual(len(token), 32)
        self.assertTrue(token.isascii())
        self.assertFalse(any(c.isspace() for c in token))
        expected = original.replace('\"' + self.settings.token + '\"', token).replace(self.settings.token, token)
        self.assertEqual(secret_file.read_text(), expected)
        self.assert_private(secret_file, 0o600)
        self.assertEqual(self.config.read_bytes(), config_before)
        settings = load(self.config)
        self.assertEqual(settings.token, token)
        self.assertEqual(settings.secret_env["OPENAI_API_KEY"], "test-key")
        self.assertEqual(settings.secret_env["HTTPS_PROXY"], "http://proxy.example:3128")
        self.assertEqual(initialize(self.config).token, token)

    def test_rotate_cli_prints_only_new_token_on_stdout(self):
        result = self.cli("--config", str(self.config), "token", "--rotate")
        self.assertEqual(result.returncode, 0, result.stderr)
        token = load(self.config).token
        self.assertNotEqual(token, self.settings.token)
        self.assertEqual(result.stdout, token + "\n")
        self.assertEqual(result.stderr, "Web sign-in token rotated; the previous token is no longer valid. "
                         "Run `lazyfish serve` to start the service.\n")
        self.assertNotIn(self.settings.token, result.stdout + result.stderr)
        self.assertEqual(self.cli("token").stdout, token + "\n")

    def test_rotate_refuses_environment_override_without_writing(self):
        secret_file = self.config.parent / "secrets.env"
        before = secret_file.read_bytes()
        for value in ("x" * 48, "short"):
            with self.subTest(valid=len(value) >= 32), patch.dict(os.environ, {"LAZYFISH_TOKEN": value}):
                with self.assertRaisesRegex(ConfigError, "unset it before rotating"):
                    rotate_token(self.config)
                result = self.cli("--config", str(self.config), "token", "--rotate")
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout, "")
                self.assertIn("LAZYFISH_TOKEN is set in the environment", result.stderr)
                self.assertEqual(secret_file.read_bytes(), before)

    def test_rotate_help_does_not_load_configuration(self):
        result = self.cli("--config", str(self.root / "missing.toml"), "token", "--help")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--rotate", result.stdout)
        self.assertIn("Generate a new Web sign-in token; stop the service first", result.stdout)
        self.assertEqual(result.stderr, "")

    def test_rotate_refuses_locked_service_even_without_metadata(self):
        secret_file = self.config.parent / "secrets.env"
        before = secret_file.read_bytes()
        with (self.settings.runtime_dir / "service.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.cli("--config", str(self.config), "token", "--rotate")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertIn("Run `lazyfish stop`, then `lazyfish token --rotate`, then `lazyfish serve`.", result.stderr)
        self.assertEqual(secret_file.read_bytes(), before)

    def test_rotate_refuses_authenticated_instance_even_without_service_lock(self):
        secret_file = self.config.parent / "secrets.env"
        before = secret_file.read_bytes()
        with patch("lazyfish.runtime.request", return_value={"instance": "matching-instance"}) as request:
            with self.assertRaisesRegex(ConfigError, "Cannot rotate the token while this instance is running"):
                rotate_token(self.config)
        request.assert_called_once()
        self.assertEqual(request.call_args.args[0].data_dir, self.settings.data_dir)
        self.assertEqual(secret_file.read_bytes(), before)

    def test_rotate_write_failure_preserves_token_and_releases_locks(self):
        secret_file = self.config.parent / "secrets.env"
        before = secret_file.read_bytes()
        with patch("lazyfish.config.os.replace", side_effect=OSError("write failed")):
            with self.assertRaises(OSError):
                rotate_token(self.config)
        self.assertEqual(secret_file.read_bytes(), before)
        self.assertFalse(list(secret_file.parent.glob(".lazyfish-*")))
        token = rotate_token(self.config)
        self.assertEqual(load(self.config).token, token)
        self.assertNotEqual(token, self.settings.token)

    def test_rotate_ignores_stale_pid_metadata(self):
        write_private(self.settings.runtime_dir / "service.json",
                      json.dumps({"pid": os.getpid(), "port": 0, "instance": "stale-instance"}))
        token = rotate_token(self.config)
        self.assertNotEqual(token, self.settings.token)
        self.assertEqual(load(self.config).token, token)

    def test_rotate_refuses_unsafe_secrets(self):
        secret_file = self.config.parent / "secrets.env"
        before = secret_file.read_bytes()
        secret_file.chmod(0o644)
        with self.assertRaisesRegex(ConfigError, "600"):
            rotate_token(self.config)
        secret_file.chmod(0o600)
        target = secret_file.with_suffix(".original")
        secret_file.rename(target)
        secret_file.symlink_to(target)
        with self.assertRaises(ConfigError):
            rotate_token(self.config)
        self.assertEqual(target.read_bytes(), before)
        self.assertTrue(secret_file.is_symlink())

    def test_concurrent_rotation_and_initialization_preserve_secrets(self):
        secret_file = self.config.parent / "secrets.env"
        write_private(secret_file, secret_file.read_text() + "OPENAI_API_KEY=test-key\n")
        command = [sys.executable, "-m", "lazyfish", "--config", str(self.config)]
        processes = [subprocess.Popen(command + ["token", "--rotate"],
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE) for _ in range(3)]
        processes.append(subprocess.Popen(command + ["init"], stdout=subprocess.PIPE, stderr=subprocess.PIPE))
        tokens = []
        for index, process in enumerate(processes):
            stdout, stderr = process.communicate(timeout=10)
            self.assertEqual(process.returncode, 0, stderr.decode())
            if index < 3:
                tokens.append(stdout.decode().strip())
        self.assertEqual(len(set(tokens)), 3)
        self.assertNotIn(self.settings.token, tokens)
        settings = load(self.config)
        self.assertIn(settings.token, tokens)
        self.assertEqual(settings.secret_env["OPENAI_API_KEY"], "test-key")
        self.assert_private(secret_file, 0o600)

    def test_environment_precedence_and_relative_paths(self):
        with patch.dict(os.environ, {"LAZYFISH_PORT": "12345", "LAZYFISH_DATA_DIR": "relative"}):
            settings = load(self.config)
        self.assertEqual(settings.port, 12345)
        self.assertEqual(settings.data_dir, self.config.parent / "relative")

    def test_reject_invalid_port_and_token(self):
        for overrides in ({"LAZYFISH_PORT": "65536"}, {"LAZYFISH_PORT": "1.2"},
                          {"LAZYFISH_TOKEN": "short"}):
            with self.subTest(overrides=list(overrides)), patch.dict(os.environ, overrides):
                with self.assertRaises(ConfigError):
                    load(self.config)

    def test_allow_unicast_bind_host(self):
        for host in ("0.0.0.0", "127.0.0.1", "127.0.0.2", "10.0.0.8", "172.16.0.8",
                     "192.168.1.10", "8.8.8.8", "192.0.2.1", "169.254.1.2", "240.0.0.1"):
            with self.subTest(host=host), patch.dict(os.environ, {"LAZYFISH_HOST": host}):
                self.assertEqual(load(self.config).host, host)
        for host in ("localhost", "255.255.255.255", "224.0.0.1", "::1", "not-an-ip"):
            with self.subTest(host=host), patch.dict(os.environ, {"LAZYFISH_HOST": host}):
                with self.assertRaises(ConfigError):
                    load(self.config)

    def test_reject_empty_bind_setting(self):
        self.config.write_text(self.config.read_text().replace('host = "127.0.0.1"', 'host = ""'))
        with self.assertRaises(ConfigError):
            load(self.config)

    def test_wildcard_bind_from_config(self):
        self.assertEqual(load(self.config).host, "127.0.0.1")
        self.config.write_text(self.config.read_text().replace('host = "127.0.0.1"', 'host = "0.0.0.0"'))
        self.assertEqual(load(self.config).host, "0.0.0.0")
        with patch.dict(os.environ, {"LAZYFISH_HOST": "10.0.0.8"}):
            self.assertEqual(load(self.config).host, "10.0.0.8")

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
