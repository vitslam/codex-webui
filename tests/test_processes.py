import ctypes
import errno
import fcntl
import json
import time
import os
import runpy
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

from lazyfish import processes


class DarwinProcessTests(unittest.TestCase):
    def setUp(self):
        self.backend = processes.DarwinProcesses.__new__(processes.DarwinProcesses)
        self.backend.libc = Mock()
        self.backend.libproc = Mock()

    def info(self, pid, flavor, argument, pointer, size):
        self.assertEqual(flavor, 3)
        value = ctypes.cast(pointer, ctypes.POINTER(processes._BsdInfo)).contents
        value.start_sec, value.start_usec, value.status = 123, 456, 2
        return size

    def test_identity_and_zombie(self):
        self.assertEqual(ctypes.sizeof(processes._BsdInfo), 136)
        self.backend.libproc.proc_pidinfo.side_effect = self.info
        with patch.object(processes.os, "getsid", return_value=42):
            self.assertEqual(self.backend.identity(43), (123000456, 42, "S"))
        def zombie(*args):
            size = self.info(*args)
            ctypes.cast(args[3], ctypes.POINTER(processes._BsdInfo)).contents.status = 5
            return size
        self.backend.libproc.proc_pidinfo.side_effect = zombie
        with patch.object(processes.os, "getsid", return_value=42):
            self.assertEqual(self.backend.identity(43)[2], "Z")

    def test_disappearing_or_reused_pid(self):
        self.backend.libproc.proc_pidinfo.return_value = 0
        with patch.object(processes.ctypes, "get_errno", return_value=errno.ESRCH):
            self.assertIsNone(self.backend.identity(43))
        calls = []
        def reused(*args):
            size = self.info(*args)
            ctypes.cast(args[3], ctypes.POINTER(processes._BsdInfo)).contents.start_usec += len(calls)
            calls.append(1)
            return size
        self.backend.libproc.proc_pidinfo.side_effect = reused
        with patch.object(processes.os, "getsid", return_value=42):
            self.assertIsNone(self.backend.identity(43))

    def test_boot_and_machine_api(self):
        def sysctl(name, pointer, size, new, length):
            self.assertEqual(name, b"kern.bootsessionuuid")
            ctypes.memmove(pointer, b"00000000-0000-4000-8000-000000000001\0", 37)
            return 0
        self.backend.libc.sysctlbyname.side_effect = sysctl
        self.assertEqual(self.backend.boot_id(), "00000000-0000-4000-8000-000000000001")
        self.assertEqual(self.backend.boot_id(), self.backend.boot_id())
        self.backend.libc.gethostuuid.side_effect = lambda value, timeout: (ctypes.memset(value, 7, 16) and 0)
        self.assertEqual(self.backend.machine_value(), bytes([7]) * 16)
        self.backend.libc.gethostuuid.side_effect = lambda value, timeout: 0
        with self.assertRaises(OSError):
            self.backend.machine_value()
        def malformed(name, pointer, size, new, length):
            ctypes.memmove(pointer, b"invalid\0", 8)
            return 0
        self.backend.libc.sysctlbyname.side_effect = malformed
        with self.assertRaises(OSError):
            self.backend.boot_id()
        self.backend.libc.sysctlbyname.side_effect = None
        self.backend.libc.sysctlbyname.return_value = -1
        with self.assertRaises(OSError):
            self.backend.boot_id()

    def test_pid_listing(self):
        def listed(kind, uid, pointer, size):
            self.assertEqual((kind, uid), (4, os.getuid()))
            if pointer is None:
                return 8
            pointer[0], pointer[1] = 42, 43
            return 8
        self.backend.libproc.proc_listpids.side_effect = listed
        self.assertEqual(self.backend.pids(), [42, 43])

    def test_session_members_and_reuse(self):
        self.backend.pids = Mock(return_value=[42, 43, 44, 45])
        identities = {42:(100,42,"S"),43:(101,42,"S"),44:(102,42,"Z"),45:(99,42,"S")}
        self.backend.identity = lambda pid: identities.get(pid)
        with patch.object(processes, "_backend", self.backend):
            self.assertEqual(processes.session_members(42, 100), [(42,100),(43,101)])
            self.assertEqual(processes.session_members(42, 99), [])

    def test_stop_machine_and_boot_mismatch(self):
        record = {"machine_id":"local", "boot_id":"old", "pid":42,"start_ticks":100}
        with patch.object(processes, "machine_id", return_value="other"):
            self.assertFalse(processes.stop_session(record))
        with patch.object(processes, "machine_id", return_value="local"), patch.object(processes, "boot_id", return_value="new"), patch.object(processes.os, "kill") as kill:
            self.assertTrue(processes.stop_session(record))
            kill.assert_not_called()


class GuardTests(unittest.TestCase):
    def test_parent_already_gone_exits_before_journal(self):
        guard = Path(processes.__file__).with_name("exec_guard.py")
        with tempfile.TemporaryDirectory() as directory:
            record = Path(directory) / "record.json"
            result = subprocess.run([sys.executable, str(guard), str(record), "job", "owner", "1", "0", "/not-executed"], capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 125, result.stderr)
            self.assertFalse(record.exists())

    def test_guardian_registration_failure_never_acknowledges(self):
        guard = Path(processes.__file__).with_name("exec_guard.py")
        with patch.dict(sys.modules, {"processes": processes}):
            guard_functions = runpy.run_path(str(guard))
        with patch.object(os, "setsid"), patch("select.kqueue", create=True, side_effect=OSError("unavailable")), patch.object(os, "write") as write:
            guard_functions["_watch_parent"](42, 43, 4)
            write.assert_not_called()

    def test_native_identity_and_boot_stability(self):
        self.assertEqual(processes.boot_id(), processes.boot_id())
        self.assertEqual(len(processes.machine_id()), 64)
        current = processes.identity(os.getpid())
        self.assertGreater(current[0], 0)
        self.assertEqual(current[1], os.getsid(0))

    @unittest.skipUnless(sys.platform == "darwin", "native macOS kqueue guardian")
    def test_parent_death_cleans_stubborn_worker_tools_and_lease(self):
        guard = Path(processes.__file__).with_name("exec_guard.py")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary, record, ready, lease_path = [root / name for name in ("worker", "record.json", "ready", "lease")]
            binary.write_text(f"#!{sys.executable}\n" +
                "import os,signal,subprocess,sys,time\nfrom pathlib import Path\n" +
                "signal.signal(signal.SIGTERM,signal.SIG_IGN)\n" +
                "subprocess.Popen([sys.executable,'-c','import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(30)'],process_group=0)\n" +
                f"Path({str(ready)!r}).touch()\ntime.sleep(30)\n")
            binary.chmod(0o700)
            program = (
                "import os,subprocess,sys,time\nfrom pathlib import Path\n"
                f"lease=os.open({str(lease_path)!r},os.O_CREAT|os.O_RDWR,0o600)\n"
                "import fcntl\nfcntl.flock(lease,fcntl.LOCK_EX)\n"
                f"child=subprocess.Popen([sys.executable,{str(guard)!r},{str(record)!r},'job','owner',str(os.getpid()),str(lease),{str(binary)!r}],start_new_session=True,pass_fds=(lease,))\n"
                "deadline=time.monotonic()+5\n"
                f"while not Path({str(ready)!r}).exists() and child.poll() is None and time.monotonic()<deadline:time.sleep(.02)\n"
                f"os._exit(0 if Path({str(ready)!r}).exists() else 1)\n")
            parent = subprocess.Popen([sys.executable, "-c", program])
            owned = None
            try:
                self.assertEqual(parent.wait(timeout=10), 0)
                owned = json.loads(record.read_text())
                deadline = time.monotonic() + 6
                while processes.session_members(owned["pid"], owned["start_ticks"]) and time.monotonic() < deadline:
                    time.sleep(.04)
                self.assertFalse(processes.session_members(owned["pid"], owned["start_ticks"]))
                with lease_path.open("r+") as lease:
                    fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                if parent.poll() is None:
                    parent.kill()
                    parent.wait(timeout=5)
                if owned is None and record.exists():
                    owned = json.loads(record.read_text())
                if owned:
                    processes.stop_session(owned)
