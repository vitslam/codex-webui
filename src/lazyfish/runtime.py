"""Single instance per data directory. Stop via authenticated HTTP, never a stale PID."""

from __future__ import annotations

from datetime import datetime, timezone
import fcntl
import json
import os
import secrets
import signal
import time
import urllib.error
import urllib.request

from .codex import diagnose
from .execution import Manager
from .config import ConfigError, Settings, read_private, write_private
from .logging_setup import setup
from .storage import record_start, record_stop
from .web.server import Server


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def request(settings: Settings, method: str = "GET", body: dict | None = None) -> dict | None:
    """Runtime metadata is a hint, never authority to send a process signal."""
    try:
        metadata = json.loads(read_private(settings.runtime_dir / "service.json"))
        port = metadata["port"]
        if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
            return None
        path = "/api/shutdown" if method == "POST" else "/api/status"
        payload = {"instance": metadata["instance"]} if method == "POST" else body
        req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", method=method,
                                     data=json.dumps(payload).encode() if payload is not None else None,
                                     headers={"Authorization": "Bearer " + settings.token,
                                              "Content-Type": "application/json"})
        # Local lifecycle requests must not be forwarded to configured network proxies.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(req, timeout=2) as response:
            result = json.load(response)
        if method == "GET" and result.get("instance") != metadata.get("instance"):
            return None
        return result
    except urllib.error.HTTPError as exc:
        exc.close()
        return None
    except (ConfigError, OSError, ValueError, KeyError, TypeError, urllib.error.URLError):
        return None


def stop(settings: Settings) -> bool:
    if request(settings, "POST") is None:
        return False
    deadline = time.monotonic() + 20
    while (settings.runtime_dir / "service.json").exists() and time.monotonic() < deadline:
        time.sleep(0.05)
    return not (settings.runtime_dir / "service.json").exists()


def serve(settings: Settings) -> None:
    settings.prepare()
    lock = settings.runtime_dir / "service.lock"
    fd = os.open(lock, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ConfigError("This data directory already has a running Lazyfish instance.") from exc
        logger = setup(settings)
        logger.info("Starting local chat service")
        report = diagnose(settings)
        instance = secrets.token_hex(16)
        manager = Manager(settings,instance)
        server = Server(settings, report, instance,manager)
        metadata_path = settings.runtime_dir / "service.json"
        db = settings.data_dir / "lazyfish.db"
        previous_handlers = {}
        registered = False
        try:
            record_start(db, instance, timestamp())
            registered = True
            write_private(metadata_path, json.dumps({
                "instance": instance, "pid": os.getpid(), "port": server.server_port,
                "started_at": timestamp(),
            }))
            for signum in (signal.SIGINT, signal.SIGTERM):
                previous_handlers[signum] = signal.signal(signum, lambda *_: server.stop_async())
            print(f"Lazyfish: http://127.0.0.1:{server.server_port}", flush=True)
            print("Stage 3: local chat and conversation tools. Use `lazyfish token` to sign in.", flush=True)
            logger.info("Listening on loopback port %s (local checks ready=%s)", server.server_port, report["ready"])
            server.serve_forever(poll_interval=0.1)
        finally:
            for signum, handler in previous_handlers.items():
                signal.signal(signum, handler)
            server.server_close()
            manager.shutdown()
            if registered:
                record_stop(db, instance, timestamp())
            metadata_path.unlink(missing_ok=True)
            logger.info("Stopped cleanly")
            for handler in logger.handlers[:]:
                handler.close()
                logger.removeHandler(handler)
    finally:
        # Do not unlink the lock file: an inode replacement would break mutual exclusion.
        os.close(fd)
