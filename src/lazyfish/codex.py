"""Read-only local checks and a bounded, owned app-server handshake."""

from __future__ import annotations

import json
import os
from pathlib import Path
import queue
import re
import shutil
import signal
import subprocess
import threading
import time

from .config import Settings
from . import __version__


def executable(settings: Settings) -> str | None:
    """Locate the user-installed CLI by command name or configured path."""
    return shutil.which(settings.codex_binary)


def child_env(settings: Settings) -> dict[str, str]:
    allowed = {
        "PATH", "HOME", "USER", "LOGNAME", "LANG", "SHELL", "TERM", "SSH_AUTH_SOCK",
        "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME",
    }
    env = {key: value for key, value in os.environ.items()
           if key in allowed or key.startswith("LC_")}
    env.update({key: value for key, value in settings.secret_env.items() if key != "LAZYFISH_TOKEN"})
    for key in ("TMPDIR", "TEMP", "TMP"):
        env[key] = str(settings.runtime_dir / "tmp")
    return env


def stop_child(process: subprocess.Popen) -> None:
    """Only signal the new session we started; always reap the direct child."""
    if process.poll() is None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=2)
    finally:
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream:
                stream.close()


def _run(binary: str, args: list[str], settings: Settings, timeout: float) -> tuple[int, bytes]:
    with subprocess.Popen([binary, *args], cwd=settings.workspace, env=child_env(settings),
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          start_new_session=True) as process:
        try:
            # CLI status/version output is small. Do not include it in errors or logs.
            output, _ = process.communicate(timeout=timeout)
            return process.returncode, output[:8192]
        finally:
            stop_child(process)


def probe(binary: str, settings: Settings, timeout: float = 5) -> bool:
    """Initialize the protocol only. Never create a thread or request inference."""
    messages: queue.Queue = queue.Queue(maxsize=16)
    with subprocess.Popen([binary, "app-server"], cwd=settings.workspace,
                          env=child_env(settings), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL, start_new_session=True) as process:
        def reader() -> None:
            try:
                while line := process.stdout.readline(1024 * 1024 + 1):
                    if len(line) > 1024 * 1024:
                        break
                    messages.put_nowait(json.loads(line))
            except (ValueError, OSError, queue.Full):
                pass
            finally:
                try:
                    messages.put_nowait(None)
                except queue.Full:
                    pass

        thread = threading.Thread(target=reader, daemon=True)
        thread.start()
        try:
            request = {"id": 1, "method": "initialize", "params": {
                "clientInfo": {"name": "lazyfish", "version": __version__},
                "capabilities": {"experimentalApi": False},
            }}
            process.stdin.write(json.dumps(request).encode() + b"\n")
            process.stdin.flush()
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                message = messages.get(timeout=max(0.01, deadline - time.monotonic()))
                if message is None:
                    return False
                if isinstance(message, dict) and message.get("id") == 1:
                    if "result" not in message or "error" in message:
                        return False
                    process.stdin.write(b'{"method":"initialized"}\n')
                    process.stdin.flush()
                    return True
            return False
        except (queue.Empty, OSError):
            return False
        finally:
            stop_child(process)
            thread.join(timeout=1)


def diagnose(settings: Settings, protocol: bool = False, timeout: float = 5) -> dict:
    settings.prepare()
    binary = executable(settings)
    checks = {"workspace": settings.workspace.is_dir(), "codex": bool(binary),
              "authentication": False, "app_server": False}
    report = {"checks": checks, "version": None, "protocol": None,
              "scope": "local_only_no_inference", "ready": False}
    if not binary:
        return report
    try:
        code, output = _run(binary, ["--version"], settings, timeout)
        version = re.search(rb"\bcodex(?:-cli)?\s+(\d+\.\d+\.\d+(?:[-.][a-zA-Z0-9.]+)?)", output)
        if code == 0 and version:
            report["version"] = version[1].decode("ascii")
        checks["authentication"] = _run(binary, ["login", "status"], settings, timeout)[0] == 0
        checks["app_server"] = _run(binary, ["app-server", "--help"], settings, timeout)[0] == 0
        if protocol:
            report["protocol"] = checks["app_server"] and probe(binary, settings, timeout)
    except (OSError, subprocess.SubprocessError):
        report["error"] = "codex_check_failed"  # No raw account, path or subprocess output.
    report["ready"] = all(checks.values()) and report["protocol"] is not False
    return report


def supports_bounded_fork(settings: Settings) -> bool:
    """Conservative baseline: old servers may silently ignore lastTurnId.

    Do not risk copying later history when the known boundary protocol is absent.
    Check at fork time as the executable can change after service startup.
    """
    binary = executable(settings)
    if not binary:
        return False
    try:
        code, output = _run(binary,["--version"],settings,5)
    except (OSError,subprocess.SubprocessError):
        return False
    version = re.search(rb"\bcodex(?:-cli)?\s+(\d+)\.(\d+)\.(\d+)(?:\s|$)",output)
    return code == 0 and version is not None and tuple(int(value) for value in version.groups()) >= (0,162,1)
