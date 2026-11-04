"""Bounded stdio RPC transport. Native events never depend on a browser socket."""

from __future__ import annotations

import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time

from . import __version__
from .codex import child_env, executable
from .config import Settings


class ProtocolError(RuntimeError):
    def __init__(self, code: str = "native_connection_failed"):
        self.code = code
        super().__init__(code)


class Client:
    def __init__(self, settings: Settings, job: str, owner: str, lease: int, cwd: str, options=()):
        binary = executable(settings)
        if not binary:
            raise ProtocolError("codex_not_found")
        self.record_path = settings.runtime_dir / "jobs" / (job + ".json")
        env=child_env(settings)
        if options:
            env['NO_PROXY']=env['no_proxy']=','.join(filter(None,[env.get('NO_PROXY') or env.get('no_proxy'),'127.0.0.1','localhost']))
            env['OTEL_BSP_SCHEDULE_DELAY']='1000'
        self.process = subprocess.Popen(
            [sys.executable,str(Path(__file__).with_name("exec_guard.py")),str(self.record_path),
             job,owner,str(os.getpid()),str(lease),binary,*options],
            cwd=cwd,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,start_new_session=True,pass_fds=(lease,))
        self.inbox = queue.Queue(maxsize=16)
        self.reader_failed = threading.Event()
        self.closing = threading.Event()
        self.sequence = 0
        self.thread = threading.Thread(target=self._read, name="codex-jsonl",daemon=True)
        self.thread.start()

    def _read(self):
        try:
            while line := self.process.stdout.readline(24 * 1024 * 1024 + 1):
                if len(line) > 24 * 1024 * 1024:
                    raise ValueError
                message = json.loads(line)
                if not isinstance(message,dict):
                    raise ValueError
                while not self.closing.is_set():
                    try:
                        self.inbox.put(message,timeout=.1)
                        break
                    except queue.Full:
                        continue
                if self.closing.is_set():break
        except (OSError, ValueError, queue.Full):
            pass
        finally:
            self.reader_failed.set()

    def send(self, message: dict):
        try:
            self.process.stdin.write(json.dumps(message).encode() + b"\n")
            self.process.stdin.flush()
        except (OSError, ValueError) as exc:
            raise ProtocolError() from exc

    def next(self, timeout: float = 0.1) -> dict | None:
        try:
            return self.inbox.get(timeout=timeout)
        except queue.Empty:
            if self.reader_failed.is_set():
                raise ProtocolError()
            return None

    def call(self, method: str, params: dict, receive, tick=lambda: None, timeout: float = 30) -> dict:
        self.sequence += 1
        request_id = self.sequence
        self.send({"id":request_id,"method":method,"params":params})
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            tick()
            message = self.next()
            if message is None:
                continue
            if message.get("id") == request_id and "method" not in message:
                if "error" in message or not isinstance(message.get("result"),dict):
                    raise ProtocolError("native_request_rejected")
                return message["result"]
            receive(message)
        raise ProtocolError("native_request_timeout")

    def initialize(self, receive, tick, experimental=False):
        self.call("initialize",{"clientInfo":{"name":"lazyfish","version":__version__},
                                "capabilities":{"experimentalApi":experimental}},receive,tick,timeout=10)
        self.send({"method":"initialized"})

    def close_pipes(self):
        self.closing.set()
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            raise ProtocolError("execution_not_stopped")
        for stream in (self.process.stdin,self.process.stdout):
            stream.close()
        self.thread.join(timeout=2)
