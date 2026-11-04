from contextlib import closing
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import time

from lazyfish.execution import Manager
from lazyfish.processes import boot_id, identity, machine_id, session_members, stop_session
from lazyfish.storage import Store
from support import IsolatedTest


class RecoveryTests(IsolatedTest):
    def test_unknown_held_lease_blocks_then_recovers_without_replay(self):
        store = Store(self.settings.data_dir/"lazyfish.db")
        conversation = store.create_conversation(str(self.workspace))
        job,_ = store.reserve(conversation["id"],"old-owner","request-key","preserve me",None,None)
        lease = self.settings.runtime_dir/"jobs"/(job["id"]+".lock")
        with lease.open("w") as stream:
            fcntl.flock(stream.fileno(),fcntl.LOCK_EX)
            manager = Manager(self.settings,"new-owner")
            self.assertTrue(manager.blocked)
            self.assertEqual(store.state(job["id"]),"running")
        manager = Manager(self.settings,"next-owner")
        self.assertFalse(manager.blocked)
        restored = store.job(job["id"])
        self.assertEqual(restored["status"],"interrupted")
        self.assertEqual(restored["prompt"],"preserve me")
        self.assertFalse((self.settings.runtime_dir/"tmp/fake-methods.jsonl").exists())

    def test_reused_pid_is_never_signalled(self):
        born,_,_ = identity(os.getpid())
        record = {"pid":os.getpid(),"start_ticks":born+1,"boot_id":boot_id(),"machine_id":machine_id()}
        self.assertTrue(stop_session(record))
        self.assertEqual(identity(os.getpid())[0],born)

    def test_foreign_machine_is_not_assumed_to_have_rebooted(self):
        born,_,_ = identity(os.getpid())
        record = {"pid":os.getpid(),"start_ticks":born,"boot_id":"a-different-boot","machine_id":"another-machine"}
        self.assertFalse(stop_session(record))
        self.assertEqual(identity(os.getpid())[0],born)

    def test_owned_session_cleanup_includes_separate_tool_process_group(self):
        record_path = self.root/"child.json"
        program = ("import os,subprocess,sys,time,json\nfrom pathlib import Path\n"
                   "child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)'],process_group=0)\n"
                   f"Path({str(record_path)!r}).write_text(json.dumps({{'child':child.pid}}))\n"
                   "time.sleep(30)\n")
        with subprocess.Popen([sys.executable,"-c",program],start_new_session=True) as process:
            try:
                deadline = time.monotonic()+5
                while not record_path.exists() and time.monotonic()<deadline:
                    time.sleep(0.02)
                self.assertTrue(record_path.exists())
                born,session,_ = identity(process.pid)
                self.assertEqual(session,process.pid)
                self.assertGreaterEqual(len(session_members(process.pid,born)),2)
                self.assertTrue(stop_session({"pid":process.pid,"start_ticks":born,"boot_id":boot_id(),"machine_id":machine_id()}))
                process.wait(timeout=5)
                self.assertFalse(session_members(process.pid,born))
            finally:
                if process.poll() is None:
                    process.kill()
                process.wait(timeout=5)
