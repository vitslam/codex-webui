"""Exclusive warm native slots with journaled ownership and inherited leases."""
import fcntl
import json
import os
import queue
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from .config import read_private,write_private
from .codex import stop_child
from .processes import session_members,stop_session
from .protocol import Client,ProtocolError


class Slot:
    def __init__(self,index):
        self.index=index;self.token='runtime-'+uuid.uuid4().hex;self.client=None;self.fd=None
        self.busy=None;self.thread_id=None;self.threads=set();self.generation=None;self.phase='idle';self.started=None;self.progress=None


class Runtimes:
    def __init__(self,manager):
        self.manager=manager;self.slots=[]
        # Linux PDEATHSIG follows the creating thread. A per-turn thread exits
        # after completion, so warm processes must be spawned by a lasting owner.
        self.spawner=ThreadPoolExecutor(max_workers=1,thread_name_prefix='native-spawn')

    def available(self,thread_id):
        owner=next((s for s in self.slots if thread_id and thread_id in s.threads),None)
        if owner:
            if owner.busy:return None  # Never open a second writer while its native slot is borrowed.
            if owner.index<self.manager.target:return owner
            if not self.close(owner):return None
        allowed=[s for s in self.slots if s.index<self.manager.target and not s.busy]
        if allowed:return next((s for s in allowed if thread_id and s.thread_id==thread_id),allowed[0])
        for index in range(self.manager.target):
            if not any(s.index==index for s in self.slots):
                slot=Slot(index);self.slots.append(slot);return slot

    def acquire(self,worker):
        slot=worker.slot
        if slot.client and (slot.generation!=self.manager.capabilities.generation or slot.client.reader_failed.is_set()):
            if not self.close(slot):raise ProtocolError('execution_not_stopped')
        if not slot.client:
            slot.fd=self.manager.lease(slot.token);fcntl.flock(slot.fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            slot.client=self.spawner.submit(Client,worker.settings,slot.token,self.manager.owner,slot.fd,worker.conversation['workspace'],self.manager.timings.options).result()
            worker.client=slot.client;slot.phase='starting'
            slot.client.initialize(worker.receive,worker.tick,experimental=True)
            slot.generation=self.manager.capabilities.generation
        worker.client=slot.client
        record=json.loads(read_private(slot.client.record_path))
        if record.get('job')!=slot.token or record.get('owner')!=self.manager.owner:raise ProtocolError('execution_not_stopped')
        # The runtime record exists before native exec; the job alias exists before any turn RPC.
        write_private(worker.settings.runtime_dir/'jobs'/(worker.job['id']+'.json'),json.dumps({**record,'job':worker.job['id']}))
        slot.phase='running';slot.progress=time.time()
        return slot.client

    def release(self,worker,reusable):
        slot=worker.slot;slot.thread_id=worker.native_thread;slot.progress=time.time()
        if worker.native_thread:slot.threads.add(worker.native_thread)
        if reusable and slot.client and not slot.client.reader_failed.is_set():
            try:
                record=json.loads(read_private(slot.client.record_path))
                # Do not retain unknown background tool executors in a completed slot.
                reusable=len(session_members(record['pid'],record['start_ticks']))==1
            except (OSError,ValueError,KeyError):reusable=False
        return True if reusable else self.close(slot)

    def close(self,slot):
        stopped=True
        if slot.client:
            try:
                if slot.client.record_path.exists():
                    record=json.loads(read_private(slot.client.record_path))
                    stopped=record.get('job')==slot.token and record.get('owner')==self.manager.owner and stop_session(record)
                else:stop_child(slot.client.process)
                if stopped:slot.client.close_pipes();slot.client.record_path.unlink(missing_ok=True)
            except Exception:stopped=False
        if stopped:
            slot.client=None;slot.thread_id=None;slot.threads.clear()
            if slot.fd is not None:os.close(slot.fd);slot.fd=None
        else:self.manager.blocked=True
        return stopped

    def drain(self):
        for slot in self.slots:
            if slot.busy or not slot.client:continue
            if slot.index>=self.manager.target or slot.client.reader_failed.is_set() or time.time()-(slot.progress or time.time())>600:
                self.close(slot);continue
            for _ in range(32):
                try:value=slot.client.inbox.get_nowait()
                except queue.Empty:break
                if value.get('method') and 'id' in value:slot.client.send({'id':value['id'],'error':{'code':-32601,'message':'No active task'}})

    def shutdown(self):
        for slot in self.slots:self.close(slot)
        self.spawner.shutdown(wait=True,cancel_futures=True)
