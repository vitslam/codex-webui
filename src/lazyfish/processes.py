"""Platform-native ownership checks for native execution sessions, including tool groups."""

from __future__ import annotations

import os
import ctypes
import errno
import sys
import hashlib
from pathlib import Path
import signal
import time
import uuid


class LinuxProcesses:
    """Keep Linux journal values compatible with existing installations."""

    def boot_id(self) -> str:
        return Path("/proc/sys/kernel/random/boot_id").read_text().strip()

    def machine_value(self) -> bytes:
        path = Path("/etc/machine-id")
        return path.read_bytes() if path.exists() else b""

    def identity(self, pid: int) -> tuple[int, int, str] | None:
        try:
            fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
            return int(fields[19]), int(fields[3]), fields[0]
        except (FileNotFoundError, ProcessLookupError):
            return None

    def pids(self):
        for path in Path("/proc").iterdir():
            if path.name.isdecimal():
                try:
                    if path.stat().st_uid == os.getuid():
                        yield int(path.name)
                except (FileNotFoundError, ProcessLookupError, PermissionError):
                    continue


class _BsdInfo(ctypes.Structure):
    # Darwin proc_bsdinfo, PROC_PIDTBSDINFO (libproc.h).
    _fields_ = [(name, ctypes.c_uint32) for name in (
        "flags", "status", "xstatus", "pid", "ppid", "uid", "gid",
        "ruid", "rgid", "svuid", "svgid", "reserved")]+[
        ("comm", ctypes.c_char * 16), ("name", ctypes.c_char * 32)]+[
        (name, ctypes.c_uint32) for name in (
            "nfiles", "pgid", "pjobc", "tdev", "tpgid")]+[
        ("nice", ctypes.c_int32), ("start_sec", ctypes.c_uint64),
        ("start_usec", ctypes.c_uint64)]


class _Timespec(ctypes.Structure):
    _fields_ = [("seconds", ctypes.c_long), ("nanoseconds", ctypes.c_long)]


class DarwinProcesses:
    """Native macOS identities; start_ticks is microseconds since the epoch."""

    def __init__(self):
        self.libc = ctypes.CDLL(None, use_errno=True)
        self.libproc = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
        self.libproc.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int,
            ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
        self.libproc.proc_listpids.argtypes = [ctypes.c_uint32, ctypes.c_uint32,
            ctypes.c_void_p, ctypes.c_int]
        self.libc.sysctlbyname.argtypes = [ctypes.c_char_p, ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_size_t), ctypes.c_void_p, ctypes.c_size_t]
        self.libc.gethostuuid.argtypes = [ctypes.c_void_p, ctypes.POINTER(_Timespec)]

    def boot_id(self) -> str:
        # Unlike kern.boottime, the boot-session UUID cannot shift with NTP or
        # a manual wall-clock adjustment. An unreadable identity fails closed.
        value = ctypes.create_string_buffer(37)
        size = ctypes.c_size_t(ctypes.sizeof(value))
        if self.libc.sysctlbyname(b"kern.bootsessionuuid", value,
                                 ctypes.byref(size), None, 0) != 0:
            raise OSError(ctypes.get_errno(), "cannot read boot identity")
        try:
            identifier = uuid.UUID(value.value.decode("ascii"))
        except (ValueError, UnicodeError) as error:
            raise OSError("invalid boot identity") from error
        if not identifier.int:
            raise OSError("empty boot identity")
        return str(identifier)

    def machine_value(self) -> bytes:
        value = (ctypes.c_ubyte * 16)()
        timeout = _Timespec(1, 0)
        if self.libc.gethostuuid(value, ctypes.byref(timeout)) != 0:
            raise OSError(ctypes.get_errno(), "cannot read host UUID")
        if not any(value):
            raise OSError("empty host UUID")
        return bytes(value)

    def identity(self, pid: int) -> tuple[int, int, str] | None:
        value = _BsdInfo()
        size = ctypes.sizeof(value)
        result = self.libproc.proc_pidinfo(pid, 3, 0, ctypes.byref(value), size)
        if result != size:
            error = ctypes.get_errno()
            if error in (0, errno.ESRCH, errno.ENOENT):
                return None
            raise OSError(error, "cannot read process identity")
        try:
            session = os.getsid(pid)
        except ProcessLookupError:
            return None
        checked = _BsdInfo()
        if self.libproc.proc_pidinfo(pid, 3, 0, ctypes.byref(checked), size) != size:
            return None
        if (checked.start_sec, checked.start_usec) != (value.start_sec, value.start_usec):
            return None  # PID reuse between proc_pidinfo and getsid.
        return value.start_sec * 1_000_000 + value.start_usec, session, "Z" if value.status == 5 else "S"

    def pids(self):
        # Leave spare entries and retry if the list grew between size and data calls.
        size = self.libproc.proc_listpids(4, os.getuid(), None, 0)
        if size <= 0:
            raise OSError(ctypes.get_errno(), "cannot list processes")
        for _ in range(8):
            size += 128 * ctypes.sizeof(ctypes.c_int)
            values = (ctypes.c_int * ((size + 3) // 4))()
            result = self.libproc.proc_listpids(4, os.getuid(), values, ctypes.sizeof(values))
            if result <= 0:
                raise OSError(ctypes.get_errno(), "cannot list processes")
            if result < ctypes.sizeof(values):
                return [pid for pid in values[:result // 4] if pid > 0]
            size *= 2
        raise OSError("process list kept growing")


_backend = DarwinProcesses() if sys.platform == "darwin" else LinuxProcesses()


def boot_id() -> str:
    return _backend.boot_id()


def machine_id() -> str:
    return hashlib.sha256(_backend.machine_value() + os.uname().nodename.encode()).hexdigest()


def identity(pid: int) -> tuple[int, int, str] | None:
    return _backend.identity(pid)


def session_members(pid: int, born: int) -> list[tuple[int, int]]:
    root = identity(pid)
    if root and root[0] != born:
        return []  # PID/session number has been reused; never signal its new owner.
    result = []
    for child in _backend.pids():
        try:
            item = identity(child)
            if item and item[1] == pid and item[0] >= born and item[2] != "Z":
                result.append((child, item[0]))
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
