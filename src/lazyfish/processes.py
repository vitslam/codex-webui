"""Linux ownership checks for native execution sessions, including tool groups."""

from __future__ import annotations

import os
import hashlib
from pathlib import Path
import signal
import time


def boot_id() -> str:
    return Path("/proc/sys/kernel/random/boot_id").read_text().strip()


def machine_id() -> str:
    path = Path("/etc/machine-id")
    value = path.read_bytes() if path.exists() else b""
    return hashlib.sha256(value + os.uname().nodename.encode()).hexdigest()


def identity(pid: int) -> tuple[int, int, str] | None:
    try:
        # comm may contain spaces and parentheses. Fields after its final ')' start at state.
        fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
        return int(fields[19]), int(fields[3]), fields[0]  # starttime, session, state
    except (FileNotFoundError, ProcessLookupError):
        return None


def session_members(pid: int, born: int) -> list[tuple[int, int]]:
    root = identity(pid)
    if root and root[0] != born:
        return []  # PID/session number has been reused; never signal its new owner.
    result = []
    for path in Path("/proc").iterdir():
        if not path.name.isdecimal():
            continue
        try:
            if path.stat().st_uid != os.getuid():
                continue
            item = identity(int(path.name))
            if item and item[1] == pid and item[0] >= born and item[2] != "Z":
                result.append((int(path.name), item[0]))
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
    return result


def stop_session(record: dict, timeout: float = 3) -> bool:
    if record["machine_id"] != machine_id():
        return False  # A copied/shared data directory does not prove the remote executor stopped.
    if record["boot_id"] != boot_id():
        return True  # A machine reboot proves the old execution ended.
    pid, born = record["pid"], record["start_ticks"]
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 1 or not isinstance(born, int):
        return False
    deadline = time.monotonic() + timeout
    while True:
        members = session_members(pid, born)
        if not members:
            return True
        signum = signal.SIGTERM if time.monotonic() < deadline - 1 else signal.SIGKILL
        for child, expected in members:
            current = identity(child)
            if current and current[0] == expected and current[1] == pid:
                try:
                    os.kill(child, signum)
                except ProcessLookupError:
                    pass
        if time.monotonic() >= deadline:
            return not session_members(pid, born)
        time.sleep(0.04)
