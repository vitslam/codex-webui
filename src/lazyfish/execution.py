"""Durable turns with independent browser lifetime and confirmed executor cleanup."""

from __future__ import annotations

import fcntl
import queue
import shutil
import re
from datetime import datetime,timedelta,timezone
import json
import os
from pathlib import Path
import threading
import tempfile
import time

from .auth_sessions import AuthSessions
from .changes import ChangeTracker
from .outputs import Outputs,bounded
from .approvals import choices as approval_choices
from .capabilities import Capabilities
from .codex import stop_child, supports_bounded_fork
from .config import Settings, read_private
from .processes import boot_id, identity, stop_session
from .protocol import Client, ProtocolError
from .runtimes import Runtimes
from .telemetry import Timings
from contextlib import closing
from .storage import ACTIVE, Store, StoreError


class Cancelled(Exception):
    pass


def ownership(settings: Settings, job: str, owner: str) -> dict | None:
    path = settings.runtime_dir / "jobs" / (job + ".json")
    if not path.exists():
        return None
    record = json.loads(read_private(path))
    if record.get("job") != job or record.get("owner") != owner:
        raise ValueError("Invalid execution ownership")
    if not isinstance(record.get("pid"),int) or not isinstance(record.get("start_ticks"),int) or not isinstance(record.get("boot_id"),str) or not isinstance(record.get("machine_id"),str):
        raise ValueError("Invalid execution identity")
    return record


class Manager:
    def __init__(self, settings: Settings, owner: str):
        self.settings, self.owner = settings, owner
        self.store = Store(settings.data_dir / "lazyfish.db")
        self.lock = threading.RLock()
        self.workers: dict[str, Worker] = {}
        self.stopping = False
        self.capabilities = Capabilities(self)
        self.auth = AuthSessions(self)
        self.store.cleanup_attachments((datetime.now(timezone.utc)-timedelta(days=7)).isoformat())
        self.blocked = False
        try:
            boot_id()
        except OSError:
            self.blocked = True
        if not self.blocked:
            self.recover()
        self.target=self.store.concurrency();self.pool=Runtimes(self);self.timings=Timings(self.store)
        self.schedule_stop=threading.Event();self.schedule_thread=threading.Thread(target=self.schedule,name='native-slots',daemon=True);self.schedule_thread.start()
        self.maintenance_stop=threading.Event()
        self.maintenance_thread=threading.Thread(target=self.maintain,name='attachment-cleanup',daemon=True);self.maintenance_thread.start()

    def maintain(self):
        while not self.maintenance_stop.wait(3600):
            try:self.store.cleanup_attachments((datetime.now(timezone.utc)-timedelta(days=7)).isoformat())
            except Exception:pass

    def lease(self, job: str) -> int:
        return os.open(self.settings.runtime_dir / "jobs" / (job + ".lock"),
                       os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW,0o600)

    def recover(self):
        # Caller owns the service lock. Nothing is resumed, enqueued or inferred here.
        for path in self.settings.runtime_dir.joinpath('jobs').glob('runtime-*.json'):
            fd=None
            try:
                raw=json.loads(read_private(path));identifier=path.stem
                if not re.fullmatch(r'runtime-[a-f0-9]{32}',identifier):raise ValueError()
                with closing(self.store.connect()) as db:
                    if not db.execute('SELECT 1 FROM service_runs WHERE id=?',(raw.get('owner'),)).fetchone():raise ValueError()
                record=ownership(self.settings,identifier,raw['owner']);fd=self.lease(identifier)
                if not stop_session(record):raise ValueError()
                fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);path.unlink(missing_ok=True)
            except (OSError,ValueError,KeyError):self.blocked=True
            finally:
                if fd is not None:os.close(fd)
        for job in self.store.active():
            fd = self.lease(job["id"])
            try:
                record = ownership(self.settings, job["id"], job["owner"])
                if record is not None and not stop_session(record):
                    self.blocked = True
                    continue
                try:
                    fcntl.flock(fd,fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    self.blocked = True  # Cannot prove an unjournaled executor stopped.
                    continue
                self.store.finish(job["id"],"interrupted","service_restarted")
                (self.settings.runtime_dir / "jobs" / (job["id"] + ".json")).unlink(missing_ok=True)
            except (OSError,ValueError,KeyError):
                self.blocked = True
            finally:
                os.close(fd)

        for path in self.settings.runtime_dir.joinpath('jobs').glob('auth-*.json'):
            fd=None
            try:
                raw=json.loads(read_private(path));identifier=path.stem
                if not re.fullmatch(r'auth-[a-f0-9]{32}',identifier):raise ValueError()
                with closing(self.store.connect()) as db:
                    if not db.execute('SELECT 1 FROM service_runs WHERE id=?',(raw.get('owner'),)).fetchone():raise ValueError()
                record=ownership(self.settings,identifier,raw['owner']);fd=self.lease(identifier)
                if not stop_session(record):raise ValueError()
                fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);path.unlink(missing_ok=True)
                path.with_suffix('.lock').unlink(missing_ok=True)
            except (OSError,ValueError,KeyError):self.blocked=True
            finally:
                if fd is not None:os.close(fd)

    def submit(self, conversation: str, key: str, prompt: str, model=None, effort=None, inputs=None) -> dict:
        with self.lock:
            if self.stopping:
                raise StoreError("service_stopping")
            if self.blocked:
                raise StoreError("recovery_blocked")
            if self.auth.pending_account():raise StoreError('account_busy')
            context = self.store.conversation(conversation)
            if not Path(context["workspace"]).is_dir():
                raise StoreError("workspace_missing")
            job, created = self.store.reserve(conversation,self.owner,key,prompt,model,effort,inputs,queued=True)
            if created:
                self.dispatch()
            return self.store.job(job['id'])

    def dispatch(self):
        if self.stopping or self.blocked:return
        if sum(slot.busy is not None and slot.index<self.target for slot in self.pool.slots)>=self.target:return
        for job in self.store.queued():
            context=self.store.conversation(job['conversation_id']);slot=self.pool.available(context['native_thread_id'])
            if not slot:continue
            if not self.store.claim(job['id']):continue
            job=self.store.job(job['id']);worker=Worker(self,job,context);worker.slot=slot
            slot.busy=job['id'];slot.started=time.time();slot.phase='prepare';self.workers[job['id']]=worker
            try:worker.thread.start()
            except RuntimeError:
                self.workers.pop(job['id']);slot.busy=None;self.store.finish(job['id'],'failed','execution_start_failed')

    def schedule(self):
        while not self.schedule_stop.wait(.2):
            try:
                with self.lock:
                    self.pool.drain();self.dispatch()
            except Exception:
                # No automatic replay or inference after a scheduler/ownership failure.
                self.blocked=True

    def resize(self,value):
        if type(value) is not int or not 1<=value<=16:raise StoreError('invalid_concurrency')
        with self.lock:self.target=self.store.concurrency(value);self.dispatch()
        return self.runtime_status()

    def runtime_status(self):
        with self.lock:
            jobs={j['id']:j for j in self.store.active()};slots=[]
            for index in range(max(self.target,max((s.index+1 for s in self.pool.slots if s.busy),default=0))):
                slot=next((s for s in self.pool.slots if s.index==index),None);job=jobs.get(slot.busy) if slot else None
                conversation=self.store.conversation(job['conversation_id']) if job else {}
                slots.append(dict(id=index,state='running' if job else 'idle',job_id=job['id'] if job else None,
                    conversation_id=job['conversation_id'] if job else None,title=conversation.get('title'),phase=slot.phase if slot else 'idle',
                    started_at=slot.started if slot and job else None,last_progress_at=slot.progress if slot else None,
                    retiring=index>=self.target,pid=slot.client.process.pid if slot and slot.client else None))
            return dict(target_concurrency=self.target,reported_target=self.target,slots=slots,queued=sum(j['status']=='queued' for j in jobs.values()),
                        received_at=time.time(),server_time=time.time(),reload_pending=False,blocked=self.blocked)

    def edit(self,conversation,before,key,text):
        with self.lock:
            if self.stopping or self.blocked:raise StoreError('service_stopping' if self.stopping else 'recovery_blocked')
            if self.auth.pending_account():raise StoreError('account_busy')
            if not supports_bounded_fork(self.settings):raise StoreError('unsupported_native_fork')
            job,created=self.store.edit_reserve(conversation,before,key,text,self.owner,queued=True)
            if created:self.dispatch()
            return self.store.job(job['id'])

    def steer(self,job,key,text,skills=None):
        with self.lock:
            worker=self.workers.get(job)
            if not worker or worker.cancel.is_set() or worker.finished:raise StoreError('instruction_expired')
            skills=skills or []
            if skills:
                available=self.capabilities.read('skills',worker.conversation['workspace'],True)['skills']
                if any(not any(s['name']==v['name'] and s['path']==v['path'] and s.get('enabled') is not False for s in available) for v in skills):raise StoreError('skill_unavailable')
            value,created=self.store.instruction(job,key,text,skills)
            if created:worker.outbound.put(('steer',value))
            return value

    def answer(self,job,identifier,answers):
        with self.lock:
            worker=self.workers.get(job)
            if not worker or worker.cancel.is_set() or worker.finished:raise StoreError('question_expired')
            question=next((q for q in self.store.job(job)['questions'] if q['id']==identifier),None)
            if not question or not isinstance(answers,dict):raise StoreError('invalid_answers')
            questions=question.get('questions',[])
            if set(answers)!={q['id'] for q in questions}:raise StoreError('invalid_answers')
            for value in answers.values():
                if not isinstance(value,dict) or not isinstance(value.get('answers'),list) or not 1<=len(value['answers'])<=10 or any(not isinstance(a,str) or not a.strip() or len(a)>8000 for a in value['answers']):raise StoreError('invalid_answers')
            row=self.store.question_answering(job,identifier)
            if question.get('blocking',True):worker.outbound.put(('answer',(identifier,json.loads(row['native_id']),answers)))
            else:worker.outbound.put(('question_steer',(identifier,'\n'.join(q['question']+'\n'+', '.join(answers[q['id']]['answers']) for q in questions))))
            return {'accepted':True}

    def compact(self, conversation: str, key: str):
        with self.lock:
            if not self.store.conversation(conversation)["native_thread_id"]: raise StoreError("native_history_unavailable")
            return self.submit(conversation,key,"",inputs={"operation":"compact"})

    def cancel(self, identifier: str) -> dict:
        with self.lock:
            job = self.store.job(identifier)
            if job["status"] in ACTIVE:
                if job['status']=='queued':
                    self.store.finish(identifier,'cancelled');return self.store.job(identifier)
                worker = self.workers.get(identifier)
                if not worker:
                    raise StoreError("recovery_blocked")
                self.store.cancelling(identifier)
                worker.cancel.set()
            return self.store.job(identifier)

    def decide(self, job: str, approval: str, decision: str):
        with self.lock:
            worker = self.workers.get(job)
            if not worker or worker.cancel.is_set():
                raise StoreError("approval_expired")
            self.store.decide(job,approval,decision)

    def shutdown(self):
        self.maintenance_stop.set();self.maintenance_thread.join(timeout=3)
        with self.lock:
            self.stopping = True
            workers = list(self.workers.values())
            for worker in workers:
                self.store.cancelling(worker.job["id"])
                worker.cancel.set()
            for job in self.store.active():
                if job['status']=='queued':self.store.finish(job['id'],'cancelled')
        self.schedule_stop.set();self.schedule_thread.join(timeout=3)
        self.auth.shutdown()
        self.capabilities.shutdown()
        if self.capabilities.lock.acquire(timeout=3):
            self.capabilities.lock.release()
        deadline = time.monotonic() + 12
        for worker in workers:
            worker.thread.join(timeout=max(0,deadline-time.monotonic()))
        if any(worker.thread.is_alive() for worker in workers):
            self.blocked = True
        self.pool.shutdown();self.timings.close()


class Worker:
    def __init__(self, manager: Manager, job: dict, conversation: dict):
        self.manager, self.store, self.settings = manager, manager.store, manager.settings
        self.job, self.conversation = job, conversation
        self.cancel = threading.Event()
        self.thread = threading.Thread(target=self.run,name="codex-turn-"+job["id"][:8],daemon=True)
        self.client = None
        self.turn = None
        self.native_thread = conversation["native_thread_id"]
        self.starting = False
        self.finished = None
        self.cancel_at = None
        self.interrupt_sent = False
        self.replied = set()
        self.sizes = {}
        self.outbound=queue.Queue(maxsize=100);self.pending_steers={};self.pending_questions={};self.usage_baseline=None
        self.tracker=None;self.outputs=None;self.image_snapshots={}

    def tick(self):
        if self.client and self.starting and self.turn and not self.finished and not self.cancel.is_set():
            while not self.outbound.empty():
                kind,value=self.outbound.get_nowait()
                if kind=='steer':
                    self.client.sequence+=1;request_id=self.client.sequence;self.pending_steers[request_id]=value['id']
                    content=[{'type':'text','text':value['text']}]+[{'type':'skill','name':s['name'],'path':s['path']} for s in value.get('skills',[])]
                    self.client.send({'id':request_id,'method':'turn/steer','params':{'threadId':self.native_thread,'expectedTurnId':self.turn,'input':content}})
                    for s in value.get('skills',[]):
                        sid='instruction-skill-'+value['id']+'-'+s['name'];self.item(sid,'skill',s['name'],'completed')
                        self.store.detail(self.job['id'],sid,dict(id=sid,type='skill_invocation',name=s['name'],path=s['path'],status='provided',eventStatus='completed'))
                elif kind=='question_steer':
                    identifier,text=value;self.client.sequence+=1;request_id=self.client.sequence;self.pending_questions[request_id]=identifier
                    self.client.send({'id':request_id,'method':'turn/steer','params':{'threadId':self.native_thread,'expectedTurnId':self.turn,'input':[{'type':'text','text':text}]}})
                else:
                    identifier,native,answers=value;self.client.send({'id':native,'result':{'answers':answers}})
                    self.store.question_state(self.job['id'],identifier,'answered')
        if self.cancel.is_set():
            self.cancel_at = self.cancel_at or time.monotonic()
            if not self.starting or time.monotonic() - self.cancel_at > 5:
                raise Cancelled
            if self.turn and not self.interrupt_sent:
                self.interrupt_sent = True
                self.client.send({"id":"cancel","method":"turn/interrupt",
                                  "params":{"threadId":self.native_thread,"turnId":self.turn}})
        for row in self.store.decisions(self.job["id"]):
            if row["id"] not in self.replied:
                self.client.send({"id":json.loads(row["native_id"]),"result":json.loads(row['response']) if row.get('response') else {"decision":row["state"]}})
                self.replied.add(row["id"])

    def item(self, identifier, kind, text, status="running", delta=False):
        if not isinstance(identifier,str) or not isinstance(text,str):
            raise ProtocolError("invalid_native_event")
        self.sizes[identifier] = (self.sizes.get(identifier,0) if delta else 0) + len(text)
        if sum(self.sizes.values()) > 2_000_000:
            raise ProtocolError("output_limit_reached")
        self.store.item(self.job["id"],identifier,kind,text,status,delta)

    def native_item(self, item: dict, complete: bool):
        kind,identifier=item.get('type'),item.get('id')
        if not isinstance(identifier,str):return
        state='completed' if complete else 'running'
        if item.get('status') in ('failed','cancelled','canceled'):state='failed' if item['status']=='failed' else 'cancelled'
        payload=bounded(item);payload['type']=re.sub(r'(?<!^)(?=[A-Z])','_',kind or 'unknown').lower();payload['eventStatus']=state
        if kind=='commandExecution':payload.update(aggregated_output=item.get('aggregatedOutput') or '',exit_code=item.get('exitCode'))
        if kind=='reasoning':payload['text']='\n\n'.join(v for v in item.get('summary',[]) if isinstance(v,str))
        if kind in ('agentMessage','plan'):
            text=item.get('text','')
            if complete:text=self.outputs.rewrite(text)
            self.item(identifier,'commentary' if item.get('phase')=='commentary' or kind=='plan' and not complete else 'assistant',text,state)
            payload['text']=text
        elif kind=='reasoning':self.item(identifier,'reasoning',payload.get('text',''),state)
        elif kind=='commandExecution':self.item(identifier,'command',str(item.get('command',''))[:4000]+'\n'+str(item.get('aggregatedOutput',''))[:24000],state)
        elif kind=='fileChange':self.item(identifier,'file','\n'.join(str(c.get('path','')) for c in item.get('changes',[]) if isinstance(c,dict))[:24000],state)
        else:
            artifacts=self.outputs.capture(item,complete)
            if artifacts:
                payload.update(type='image_generation',artifacts=artifacts,artifact_state='ready')
            elif kind=='imageGeneration':payload.update(artifacts=[],artifact_state='failed' if complete else 'pending',artifact_error='outputs.image.invalid' if complete else None)
            if kind=='imageView' and isinstance(item.get('path'),str):
                try:
                    if identifier not in self.image_snapshots:
                        raw,name=self.outputs.read(item['path'],True);self.image_snapshots[identifier]=self.outputs.save(raw,name,True)
                    payload.update(image_artifact=self.image_snapshots[identifier])
                except (OSError,ValueError):pass
            self.item(identifier,'compact' if kind=='contextCompaction' else 'tool',str(item.get('tool') or kind)[:4000],state)
        self.store.detail(self.job['id'],identifier,payload)
        if kind=='commandExecution' and re.search(r'\b(cat|sed|head|tail|read)\b',str(item.get('command',''))) and 'SKILL.md' in str(item.get('command','')):
            try:skills=self.manager.capabilities.read('skills',self.conversation['workspace'])['skills']
            except StoreError:skills=[]
            for skill in skills:
                if skill['path'] in item.get('command',''):
                    sid='skill-read-'+skill['name']+'-'+identifier
                    status='loaded' if complete and item.get('exitCode')==0 else 'failed' if complete and item.get('exitCode') not in (None,0) else 'loading'
                    self.item(sid,'skill',skill['name'],state)
                    self.store.detail(self.job['id'],sid,{'id':sid,'type':'skill_invocation','name':skill['name'],'path':skill['path'],'status':status,'eventStatus':state})


    def receive(self, message: dict):
        if hasattr(self,'slot'):self.slot.progress=time.time()
        method, params = message.get("method"), message.get("params",{})
        if method=='serverRequest/resolved' and isinstance(params,dict):
            self.store.expire_approval(self.job['id'],params.get('requestId'));return
        if not method and message.get('id') in self.pending_questions:
            identifier=self.pending_questions.pop(message['id']);self.store.question_state(self.job['id'],identifier,'failed' if 'error' in message else 'answered');return
        if not method and message.get('id') in self.pending_steers:
            identifier=self.pending_steers.pop(message['id']);self.store.instruction_state(self.job['id'],identifier,'failed' if 'error' in message else 'delivered');return
        if not isinstance(params,dict):
            raise ProtocolError("invalid_native_event")
        if "id" in message and method:
            if method in ('item/tool/requestUserInput','tool/requestUserInput') and params.get('threadId')==self.native_thread and params.get('turnId') in (None,self.turn) and not self.cancel.is_set():
                questions=[]
                for question in (params.get('questions') or [])[:10]:
                    if not isinstance(question,dict) or not isinstance(question.get('id'),str) or not isinstance(question.get('question'),str):continue
                    questions.append({'id':question['id'][:200],'header':str(question.get('header',''))[:200],'question':question['question'][:8000],'isSecret':question.get('isSecret') is True,'options':[{'label':str(o.get('label',''))[:2000],'description':str(o.get('description',''))[:4000]} for o in (question.get('options') or [])[:12] if isinstance(o,dict)]})
                if questions:
                    self.store.question(self.job['id'],message['id'],{'questions':questions,'blocking':params.get('isBlocking',True)})
                    if params.get('isBlocking') is False:self.client.send({'id':message['id'],'result':{'answers':{}}})
                    return
            known = {"item/commandExecution/requestApproval":"command", "item/fileChange/requestApproval":"file",'item/permissions/requestApproval':'permissions'}
            if method in known and params.get("threadId")==self.native_thread and params.get('turnId') in (None,self.turn) and self.starting and not self.cancel.is_set():
                descriptions = [key+': '+(params[key] if isinstance(params[key],str) else json.dumps(params[key],ensure_ascii=False)) for key in ("command","cwd","reason","grantRoot","networkApprovalContext","additionalPermissions","permissions") if params.get(key)]
                related = next((item["text"] for item in self.store.job(self.job["id"])["items"]
                                if item["id"]==params.get("itemId")),None)
                if related and known[method]=="file":
                    descriptions.append(related)
                description = "\n".join(descriptions) or known[method]
                self.store.approval(self.job["id"],message["id"],known[method],description,approval_choices(method,params))
            else:
                self.client.send({"id":message["id"],"error":{"code":-32601,"message":"Request unsupported by Lazyfish"}})
            return
        if method == "thread/tokenUsage/updated" and params.get("threadId")==self.native_thread:
            usage = params.get("tokenUsage") or {}
            last = usage.get("last") or {}
            used = last.get("totalTokens")
            window = usage.get("modelContextWindow")
            if type(used) is int and type(window) is int and used >= 0 and window > 0:
                self.store.context_usage(self.conversation["id"],self.job["id"],used,window)
            fields={'input_tokens':'inputTokens','cached_input_tokens':'cachedInputTokens','output_tokens':'outputTokens'}
            total=usage.get('total') or {}
            if all(type(total.get(key)) is int and type(last.get(key)) is int for key in fields.values()):
                if not self.starting or params.get('turnId') not in (None,self.turn):self.usage_baseline={key:total[key] for key in fields.values()}
                else:
                    if self.usage_baseline is None:self.usage_baseline={key:max(0,total[key]-last[key]) for key in fields.values()}
                    self.store.report(self.job['id'],{'token_usage':{name:max(0,total[key]-self.usage_baseline[key]) for name,key in fields.items()}})
            return
        if params.get("threadId") != self.native_thread or not self.starting:
            return
        if method == "thread/compacted":
            self.finished="completed"
        elif method == "turn/started":
            turn = params.get("turn",{}).get("id")
            if not isinstance(turn,str):
                raise ProtocolError("invalid_native_event")
            self.turn = turn
            self.store.native_turn(self.job["id"],turn)
        elif self.turn and params.get("turnId") not in (None,self.turn):
            return
        elif method in {"item/started","item/completed"}:
            self.native_item(params.get("item",{}),method=="item/completed")
        elif method == "item/agentMessage/delta":
            self.item(params.get("itemId"),"assistant",params.get("delta"),delta=True)
        elif method == 'item/plan/delta':
            self.item(params.get('itemId'),'commentary',params.get('delta'),delta=True)
        elif method == 'item/commandExecution/outputDelta':
            # Append to the running command snapshot; final item replaces this stream.
            self.item(params.get('itemId'),'command',params.get('delta'),delta=True)
        elif method == "item/reasoning/summaryTextDelta":
            self.item(params.get("itemId"),"reasoning",params.get("delta"),delta=True)
        elif method == "turn/completed":
            turn = params.get("turn",{})
            if self.turn and turn.get("id") != self.turn:
                return
            for item in turn.get("items",[]):
                self.native_item(item,True)
            self.finished = {"completed":"completed","interrupted":"cancelled","failed":"failed"}.get(turn.get("status"),"failed")

    def run(self):
        fd, terminal, error = None, "failed", None
        scratch=None
        stopped = True
        try:
            if not self.native_thread and self.conversation.get("fork_source_thread_id") and not supports_bounded_fork(self.settings):
                raise ProtocolError("unsupported_native_fork")
            scratch=self.settings.runtime_dir/'tmp'/self.job['id'];scratch.mkdir(mode=0o700,exist_ok=True)
            output=self.settings.data_dir/'outputs'/self.job['id'];output.mkdir(mode=0o700,parents=True,exist_ok=True)
            protected=[self.settings.config.parent,self.settings.data_dir,self.settings.secret_env.get('CODEX_HOME',str(Path.home()/'.codex'))]
            # Per-job output directories are explicitly authorized, unlike private app data.
            self.outputs=Outputs(self.store,self.job['id'],self.conversation['workspace'],output,protected)
            if (self.job.get('inputs') or {}).get('operation')!='compact':self.tracker=ChangeTracker(self.conversation['workspace'],excluded=protected)
            fd = self.manager.lease(self.job["id"])
            fcntl.flock(fd,fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.client = self.manager.pool.acquire(self)
            overrides = {"cwd":self.conversation["workspace"],"approvalPolicy":self.settings.approval_policy,
                         "sandbox":self.settings.sandbox}
            inputs = self.job.get("inputs") or {}
            presets = {"ask":("workspace-write","on-request","user"),"auto_review":("workspace-write","on-request","auto_review"),"full_access":("danger-full-access","never","user"),"read_only":("read-only","on-request","user")}
            permission = inputs.get("permission_mode")
            if permission in presets:
                sandbox, policy, reviewer = presets[permission]
                overrides.update(sandbox=sandbox,approvalPolicy=policy,approvalsReviewer=reviewer)
            elif permission == "custom":
                config = self.client.call("config/read",{"cwd":self.conversation["workspace"],"includeLayers":False},self.receive,self.tick).get("config") or {}
                overrides.update(approvalPolicy=config.get("approval_policy") or self.settings.approval_policy,approvalsReviewer=config.get("approvals_reviewer") or "user")
                if config.get("default_permissions"):
                    overrides.pop("sandbox",None);overrides["permissions"]=config["default_permissions"]
                else: overrides["sandbox"]=config.get("sandbox_mode") or self.settings.sandbox
            if overrides.get('sandbox')=='workspace-write':overrides['config']={'sandbox_workspace_write.writable_roots':[str(scratch),str(output)]}
            if self.job["model"]:
                overrides["model"] = self.job["model"]
            if self.native_thread:
                result = self.client.call("thread/resume",{"threadId":self.native_thread,"excludeTurns":True,**overrides},self.receive,self.tick)
                if (result.get("thread",{}).get("status") or {}).get("type")=="active":
                    raise ProtocolError("native_thread_busy")
            else:
                source = self.conversation.get("fork_source_thread_id")
                if source:
                    result = self.client.call("thread/fork",{"threadId":source,
                        "lastTurnId":self.conversation["fork_last_turn_id"],"excludeTurns":True,
                        "ephemeral":False,**overrides},self.receive,self.tick)
                else:
                    result = self.client.call("thread/start",overrides,self.receive,self.tick)
                self.native_thread = result.get("thread",{}).get("id")
                if not isinstance(self.native_thread,str) or not self.native_thread:
                    raise ProtocolError("invalid_native_event")
                self.store.native_thread(self.conversation["id"],self.native_thread)
            with closing(self.store.connect()) as db, db:
                self.store.event(db,self.job["id"],{"type":"native_thread","id":self.native_thread})
            self.tick()
            if inputs.get("operation")=="compact":
                self.store.clear_context(self.conversation["id"],self.job["id"])
                self.item("compaction","compact","","running")
                self.starting=True
                self.client.call("thread/compact/start",{"threadId":self.native_thread},self.receive,self.tick)
                while self.finished is None:
                    self.tick()
                    message=self.client.next()
                    if message is not None:self.receive(message)
                self.item("compaction","compact","",self.finished)
                terminal=self.finished
                error="native_turn_failed" if terminal=="failed" else None
                return
            resolved_model=self.job["model"] or result.get("model")
            inputs = self.job.get("inputs") or {}
            content = [{"type":"text","text":self.job["prompt"]}] if self.job["prompt"].strip() else []
            for image in inputs.get("images",[]):
                attachment = self.store.attachment(image["id"],True)
                extension = {"image/png":".png","image/jpeg":".jpg","image/webp":".webp"}[attachment["mime"]]
                path = self.settings.data_dir/"attachments"/(image["id"]+extension)
                fd_image, temporary = tempfile.mkstemp(prefix=".image-",dir=path.parent)
                try:
                    with os.fdopen(fd_image,"wb") as stream:
                        stream.write(attachment["content"])
                        stream.flush(); os.fsync(stream.fileno())
                    os.replace(temporary,path)
                finally: Path(temporary).unlink(missing_ok=True)
                content.append({"type":"localImage","path":str(path)})
            content.append({'type':'text','text':f'Temporary workspace: {scratch}\nUse this private directory for disposable scratch files; do not create scratch files in public /tmp. Use umask 077. Keep final deliverables under {output} or the project workspace and link them in your reply.'})
            selected = inputs.get("skills",[])
            if selected:
                available = self.manager.capabilities.read("skills",self.conversation["workspace"],True)["skills"]
                if any(not any(s["name"]==skill["name"] and s["path"]==skill["path"] and s.get("enabled") is not False for s in available) for skill in selected):
                    raise ProtocolError("skill_unavailable")
                content.extend({"type":"skill","name":s["name"],"path":s["path"]} for s in selected)
            params = {"threadId":self.native_thread,"input":content,
                      "cwd":self.conversation["workspace"],"approvalPolicy":overrides["approvalPolicy"]}
            if self.job["model"]:
                params["model"] = self.job["model"]
            if self.job["effort"]:
                params["effort"] = self.job["effort"]
            if "collaboration_mode" in inputs:
                if not resolved_model:
                    config=self.client.call("config/read",{"cwd":self.conversation["workspace"],"includeLayers":False},self.receive,self.tick).get("config") or {}
                    resolved_model=config.get("model")
                if not resolved_model:raise ProtocolError("native_model_unavailable")
                params["collaborationMode"]={"mode":inputs["collaboration_mode"],"settings":{"model":resolved_model,"reasoning_effort":self.job["effort"],"developer_instructions":None}}
            if "fast_mode" in inputs:
                params["serviceTierForTurn"] = "fast" if inputs["fast_mode"] else "default"
            self.tick()
            self.starting = True
            result = self.client.call("turn/start",params,self.receive,self.tick)
            turn = result.get("turn",{}).get("id")
            if not isinstance(turn,str) or (self.turn and self.turn != turn):
                raise ProtocolError("invalid_native_event")
            self.turn = turn
            self.store.native_turn(self.job["id"],turn)
            for i,skill in enumerate(selected):
                self.item("selected-skill-"+str(i),"skill",skill["name"],"completed")
                self.store.detail(self.job['id'],"selected-skill-"+str(i),{'id':"selected-skill-"+str(i),'type':'skill_invocation','name':skill['name'],'path':skill['path'],'status':'provided','eventStatus':'completed'})
            while self.finished is None:
                self.tick()
                message = self.client.next()
                if message is not None:
                    self.receive(message)
            terminal = self.finished
            error = "native_turn_failed" if terminal=="failed" else None
        except Cancelled:
            terminal = "cancelled"
        except ProtocolError as exc:
            error = exc.code
            terminal = "cancelled" if self.cancel.is_set() else "failed"
        except Exception:
            error = "execution_failed"  # Never log native payloads, prompts or exception values.
        finally:
            try:
                if hasattr(self,'slot'):
                    stopped=self.manager.pool.release(self,terminal=='completed' and not self.cancel.is_set())
                elif self.client:
                    record = ownership(self.settings,self.job["id"],self.manager.owner)
                    if record is None:
                        # Guard has not reached exec; no native program could have started.
                        stop_child(self.client.process)
                    else:
                        stopped = stop_session(record)
                    if stopped:
                        self.client.close_pipes()
            except Exception:
                stopped = False
            try:
                if stopped:
                    try:
                        if self.tracker:self.store.report(self.job['id'],{'changes':self.tracker.report()})
                    except Exception:pass
                    if scratch:shutil.rmtree(scratch,ignore_errors=True)
                    self.store.finish(self.job["id"],terminal,error)
                    (self.settings.runtime_dir / "jobs" / (self.job["id"] + ".json")).unlink(missing_ok=True)
            except Exception:
                stopped = False
            finally:
                if fd is not None:
                    os.close(fd)
                with self.manager.lock:
                    self.manager.blocked = self.manager.blocked or not stopped
                    self.manager.workers.pop(self.job["id"],None)
                    if hasattr(self,'slot'):self.slot.busy=None;self.slot.phase='idle'
