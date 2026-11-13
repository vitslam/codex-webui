"""Bounded native metadata reads and workspace-local skill documents.

No account credentials, MCP configuration or arbitrary native RPC is exposed.
Each inspection owns a short-lived process; it never creates a native thread.
"""
from __future__ import annotations

import json
import hashlib
import os
from pathlib import Path
import re
import threading
import time
import uuid

from .codex import stop_child
from .config import write_private
from .protocol import Client, ProtocolError
from .storage import StoreError


def skill_discovery_error(error):
    """Expose a file and a known reason, never raw native/YAML contents."""
    message = str(error.get('message', ''))[:4096].casefold()
    if re.search(r'(missing|required|empty).*\bname\b|\bname\b.*(missing|required|empty)', message):
        reason = 'missing_name'
    elif re.search(r'(missing|required|empty).*\bdescription\b|\bdescription\b.*(missing|required|empty)', message):
        reason = 'missing_description'
    elif any(word in message for word in ('yaml', 'frontmatter', 'metadata', 'parse')):
        reason = 'invalid_metadata'
    elif any(word in message for word in ('permission', 'not found', 'read', 'utf-8')):
        reason = 'read_failed'
    else:
        reason = 'load_failed'
    path = error.get('path', '')
    if not isinstance(path, str) or len(path) > 4096 or any(ord(c) < 32 for c in path):
        path = ''
    return {'path': path, 'reason': reason}


class Capabilities:
    def __init__(self, manager):
        self.manager = manager
        self.lock = threading.Lock()
        self.skill_lock = threading.Lock()
        self.cache = {}
        self.state=threading.RLock()
        self.inflight={}
        self.failures={}
        self.generation=0
        self.revisions={}
        saved=manager.store.metadata('_epoch','')
        self.epoch=saved[0] if saved else uuid.uuid4().hex
        manager.store.save_metadata('_epoch','',self.epoch,time.time())
        native=str(Path(manager.settings.secret_env.get('CODEX_HOME',str(Path.home()/'.codex'))).expanduser().resolve())
        self.identity=hashlib.sha256((native+'|'+str(manager.settings.codex_binary)).encode()).hexdigest()
        self.scope=hashlib.sha256((self.identity+self.epoch).encode()).hexdigest()

    def tick(self):
        if self.manager.stopping:
            raise ProtocolError("service_stopping")

    ttls={'account':1800,'usage':60,'activity':300,'models':300,'skills':300,'connections':60}

    def key(self, section, cwd):
        return (section,cwd if section=='skills' else '')

    def cached(self, key):
        with self.state:
            if key not in self.cache:
                saved=self.manager.store.metadata(key[0],self.scope+'|'+key[1])
                if saved:self.cache[key]=(saved[1],saved[0])
            return self.cache.get(key)

    def request(self, section, cwd, force=False):
        key=self.key(section,cwd)
        with self.state:
            self.tick()
            if key in self.inflight:return self.inflight[key][1]
            if len(self.inflight)>=16:return None
            failure=self.failures.get(key)
            if failure and not force and time.time()-failure<30:return None
            done=threading.Event();generation=self.generation;revision=self.revisions.get(key,0)
            def run():
                acquired=False
                try:
                    while not acquired:
                        self.tick();acquired=self.lock.acquire(timeout=.1)
                    self.tick();value=self.query(section,cwd);stamp=time.time();value['updated_at']=stamp
                    with self.state:
                        if generation==self.generation and revision==self.revisions.get(key,0) and not self.manager.stopping:
                            self.manager.store.save_metadata(section,self.scope+'|'+key[1],value,stamp)
                            self.cache[key]=(stamp,value);self.failures.pop(key,None)
                except Exception:
                    with self.state:
                        if generation==self.generation and revision==self.revisions.get(key,0):self.failures[key]=time.time()
                finally:
                    if acquired:self.lock.release()
                    with self.state:
                        if self.inflight.get(key,(None,None))[1] is done:self.inflight.pop(key,None)
                    done.set()
            thread=threading.Thread(target=run,name='native-metadata-'+section,daemon=True)
            self.inflight[key]=(thread,done);thread.start()
            return done

    def read(self, section, cwd, refresh=False):
        if section=='skills' and not Path(cwd).is_dir():raise StoreError('workspace_missing')
        key=self.key(section,cwd);cached=self.cached(key);self.tick()
        if cached and not refresh and time.time()-cached[0]<self.ttls.get(section,60):return cached[1]
        done=self.request(section,cwd,refresh)
        if done is None or not done.wait(25):raise StoreError('native_metadata_unavailable')
        cached=self.cached(key)
        with self.state:
            if key in self.failures or not cached:raise StoreError('native_metadata_unavailable')
        return cached[1]

    def snapshot(self, section, cwd, refresh=False):
        """Return saved sanitized values immediately; refresh without blanking the UI."""
        if section=='skills' and not Path(cwd).is_dir():raise StoreError('workspace_missing')
        key=self.key(section,cwd)
        for _ in range(3):
            with self.state:
                generation=self.generation;scope=self.scope;cached=self.cached(key)
            self.tick()
            if not cached:value=self.read(section,cwd,refresh)
            else:
                value=cached[1]
                if refresh or time.time()-cached[0]>=self.ttls.get(section,60):self.request(section,cwd,refresh)
            with self.state:
                if generation!=self.generation:continue
                return {**value,'cache_scope':scope,'refreshing':key in self.inflight,
                        'error':'native_metadata_unavailable' if key in self.failures else ''}
        raise StoreError('metadata_busy')

    def invalidate_section(self, section):
        with self.state:
            for key in set(self.cache)|set(self.inflight)|set(self.revisions):
                if key[0]==section:
                    self.revisions[key]=self.revisions.get(key,0)+1
                    self.cache.pop(key,None);self.failures.pop(key,None);self.inflight.pop(key,None)
            self.manager.store.clear_metadata(section)

    def invalidate(self):
        # Native account changes must not reuse old snapshots or late RPC results.
        with self.state:
            self.generation+=1;self.epoch=uuid.uuid4().hex
            self.scope=hashlib.sha256((self.identity+self.epoch).encode()).hexdigest()
            self.cache.clear();self.failures.clear();self.inflight.clear()
            self.manager.store.clear_metadata()
            self.manager.store.save_metadata('_epoch','',self.epoch,time.time())

    def shutdown(self):
        with self.state:threads=[entry[0] for entry in self.inflight.values()]
        deadline=time.monotonic()+5
        for thread in threads:thread.join(max(0,deadline-time.monotonic()))

    def query(self, section, cwd, options=None):
        if section!='skills' and not Path(cwd).is_dir():cwd=str(self.manager.settings.workspace)
        identifier = "inspect-"+uuid.uuid4().hex
        fd = self.manager.lease(identifier)
        client = None
        try:
            client = Client(self.manager.settings, identifier, self.manager.owner, fd, cwd)
            def receive(message):
                if message.get("method") and "id" in message:
                    client.send({"id":message["id"],"error":{"code":-32601,"message":"Read-only inspection"}})
            client.initialize(receive, self.tick)
            def call(method, params):
                return client.call(method, params, receive, self.tick, timeout=8)
            if section == "account":
                value = call("account/read", {"refreshToken":False})
                account = value.get("account") or {}
                return {"account":{k:account.get(k) for k in ("type","email","planType")}}
            if section == "usage":
                value = call("account/rateLimits/read", {})
                limits = (value.get("rateLimitsByLimitId") or {}).get("codex") or value.get("rateLimits") or {}
                windows = []
                for name in ("primary", "secondary"):
                    window = limits.get(name) or {}
                    used = window.get("usedPercent")
                    if type(used) in (int,float) and 0 <= used <= 100:
                        windows.append({"name":name,"remaining_percent":100-used,
                                        "window_minutes":window.get("windowDurationMins"),"resets_at":window.get("resetsAt")})
                return {"windows":windows}
            if section == "activity":
                value=call("account/usage/read",{})
                daily=[]
                for item in (value.get("dailyUsageBuckets") or [])[-366:]:
                    date,tokens=item.get("startDate"),item.get("tokens")
                    if isinstance(date,str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}",date) and type(tokens) is int and tokens>=0:
                        daily.append({"date":date,"tokens":tokens})
                summary={k:v for k,v in (value.get("summary") or {}).items() if k in ("lifetimeTokens","currentStreakDays","peakDailyTokens") and type(v) is int and v>=0}
                return {"daily":daily,"summary":summary}
            if section == "skills":
                value = call("skills/list", {"cwds":[cwd],"forceReload":True})
                skills, errors = [], []
                truncated = errors_truncated = False
                for group in value.get("data",[]):
                    for error in group.get('errors', []):
                        if not isinstance(error, dict): continue
                        if len(errors) >= 20:
                            errors_truncated = True
                        else:
                            errors.append(skill_discovery_error(error))
                    for skill in group.get("skills",[]):
                        if not isinstance(skill.get("path"),str) or not isinstance(skill.get("name"),str): continue
                        if len(skills)>=300:
                            truncated = True
                            continue
                        row = {k:skill.get(k) for k in ("name","description","path","enabled","scope")}
                        row["path"]=str(Path(row["path"]).expanduser().resolve())
                        row["editable"] = self.editable(cwd, row["path"])
                        if row["editable"]:
                            personal=Path(self.manager.settings.secret_env.get('CODEX_HOME',str(Path.home()/'.codex'))).expanduser().resolve()/'skills'
                            row['scope']='user' if Path(row['path']).resolve().is_relative_to(personal) else 'project'
                        skills.append(row)
                return {"skills":skills, "errors":errors, "truncated":truncated,
                        "errors_truncated":errors_truncated}
            if section == "connections":
                servers, cursor = [], None
                for _ in range(3):
                    value = call("mcpServerStatus/list", {"detail":"toolsAndAuthOnly","limit":100,"cursor":cursor})
                    for item in value.get("data",[]):
                        tools = item.get("tools") or {}
                        names = list(tools) if isinstance(tools,dict) else [tool.get("name","") for tool in tools]
                        servers.append({"name":str(item.get("name", ""))[:200],"auth_status":str(item.get("authStatus", ""))[:100],
                                        "tools":[str(name)[:200] for name in names[:100]],"tool_count":len(tools)})
                    cursor = value.get("nextCursor")
                    if not cursor: break
                return {"servers":servers,"truncated":bool(cursor)}
            if section == "skill_enabled":
                call("skills/config/write",options)
                return {"ok":True}
            if section == "models":
                value = call("model/list", {"limit":100})
                rows = []
                efforts = {"none","minimal","low","medium","high","xhigh","max","ultra"}
                for row in value.get("data",[])[:100]:
                    identifier = row.get("model") or row.get("id")
                    if not isinstance(identifier,str): continue
                    supported = [level.get("reasoningEffort") for level in row.get("supportedReasoningEfforts",[]) if isinstance(level,dict) and level.get("reasoningEffort") in efforts]
                    rows.append({"id":identifier,"name":row.get("displayName"),"levels":list(dict.fromkeys(supported)),
                                 "default_effort":row.get("defaultReasoningEffort"),"is_default":row.get("isDefault") is True})
                defaults = {}
                try:
                    config = call("config/read",{"includeLayers":False,"cwd":cwd}).get("config") or {}
                    defaults = {"model":config.get("model"),"effort":config.get("model_reasoning_effort")}
                except ProtocolError:
                    pass  # Older CLIs still provide a usable model catalog.
                return {"models":rows,"defaults":defaults}
            raise StoreError("not_found")
        finally:
            if client:
                client.closing.set()
                stop_child(client.process)
                client.thread.join(timeout=1)
                client.record_path.unlink(missing_ok=True)
            os.close(fd)
            (self.manager.settings.runtime_dir/"jobs"/(identifier+".lock")).unlink(missing_ok=True)

    def editable(self, cwd, value):
        path = Path(value).expanduser().resolve()
        candidates=[Path(cwd).resolve()/'.agents'/'skills',Path(self.manager.settings.secret_env.get('CODEX_HOME',str(Path.home()/'.codex'))).expanduser().resolve()/'skills']
        root=next((root for root in candidates if path.is_relative_to(root)),candidates[0])
        try:
            relative = path.relative_to(root)
            if len(relative.parts)!=2 or relative.name!="SKILL.md" or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}",relative.parts[0]): return False
            return all(not p.is_symlink() for p in (root.parent,root,path.parent,path))
        except ValueError:
            return False

    def skill_document(self, cwd, path):
        skills = self.read("skills",cwd)["skills"]
        match = next((s for s in skills if s["path"]==path),None)
        if not match: raise StoreError("skill_unavailable")
        try:
            fd = os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
            with os.fdopen(fd,'rb') as file:
                content = file.read(65537)
            if len(content)>65536: raise ValueError
            content=content.decode('utf-8')
        except (OSError,ValueError):
            raise StoreError("skill_unavailable") from None
        return {**match,"content":content,"hash":hashlib.sha256(content.encode()).hexdigest()}

    def save_skill_source(self, cwd, path, digest, content):
        if not isinstance(path,str) or not isinstance(content,str) or not 1<=len(content.encode())<=65536 or '\0' in content:
            raise StoreError('invalid_skill')
        with self.skill_lock:
            before=self.skill_document(cwd,path)
            if not before['editable']:raise StoreError('skill_readonly')
            if digest!=before['hash']:raise StoreError('skill_conflict')
            normalized=content.replace('\r\n','\n')
            if not normalized.startswith('---\n') or '\n---' not in normalized[4:]:raise StoreError('invalid_skill')
            if not self.lock.acquire(timeout=2):raise StoreError('metadata_busy')
            try:
                # Recheck immediately before replacing; all managed writes share this lock.
                current=Path(path).read_bytes()
                if hashlib.sha256(current).hexdigest()!=digest:raise StoreError('skill_conflict')
                write_private(Path(path),content)
                try:
                    found=self.query('skills',cwd)['skills']
                    if not any(s['path']==path for s in found):raise StoreError('invalid_skill')
                except (ProtocolError,StoreError):
                    if Path(path).read_bytes()==content.encode():write_private(Path(path),before['content'])
                    raise StoreError('invalid_skill') from None
                self.invalidate_section('skills')
                return {'path':path,'content':content,'hash':hashlib.sha256(content.encode()).hexdigest()}
            finally:self.lock.release()

    def set_skill_enabled(self, cwd, path, enabled):
        if type(enabled) is not bool or not any(s["path"]==path for s in self.read("skills",cwd)["skills"]): raise StoreError("skill_unavailable")
        if not self.lock.acquire(timeout=2): raise StoreError("metadata_busy")
        try:
            self.tick()
            result = self.query("skill_enabled",cwd,{"path":path,"enabled":enabled})
            self.invalidate_section('skills')
            return result
        except ProtocolError:
            raise StoreError("native_metadata_unavailable") from None
        finally: self.lock.release()

    def save_skill(self, cwd, name, description, body, replace=False,scope="project"):
        with self.skill_lock:
            return self._save_skill(cwd,name,description,body,replace,scope)

    def _save_skill(self, cwd, name, description, body, replace=False,scope="project"):
        if not isinstance(name,str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}",name): raise StoreError("invalid_skill")
        if not isinstance(description,str) or not description.strip() or len(description)>1024 or not isinstance(body,str) or not body.strip() or len(body)>60000:
            raise StoreError("invalid_skill")
        if scope not in ('project','user'):raise StoreError('invalid_skill')
        home=Path(self.manager.settings.secret_env.get('CODEX_HOME',str(Path.home()/'.codex'))).expanduser().resolve()
        root=Path(cwd).resolve()/'.agents'/'skills' if scope=='project' else home/'skills'
        if not root.parent.exists():root.parent.mkdir(mode=0o700,parents=True)
        for path in (root.parent,root,root/name):
            if path.is_symlink(): raise StoreError("skill_readonly")
            path.mkdir(mode=0o700,exist_ok=True)
        target = root/name/"SKILL.md"
        if not self.editable(cwd,str(target)): raise StoreError("skill_readonly")
        if target.exists() and not replace: raise StoreError("skill_exists")
        if replace:raise StoreError('skill_conflict')  # Existing documents require source + hash.
        content = f"---\nname: {json.dumps(name)}\ndescription: {json.dumps(description.strip(),ensure_ascii=False)}\n---\n\n{body.strip()}\n"
        if len(content.encode())>65536:raise StoreError('invalid_skill')
        write_private(target,content)
        self.invalidate_section('skills')
        return {"name":name,"path":str(target),"content":content,"editable":True,"scope":scope}
