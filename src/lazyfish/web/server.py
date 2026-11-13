"""Authenticated local chat API and replayable, read-only event streams."""

from __future__ import annotations

from collections import deque
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import base64
import binascii
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import time
from urllib.parse import parse_qs, urlsplit, quote

from .. import __version__
from ..config import Settings
from ..network import local_ipv4s
from ..codex import diagnose
from ..storage import ACTIVE, StoreError
from .assets import assets


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, settings: Settings, report: dict, instance: str, manager=None, *, no_token: bool = False):
        self.settings = settings
        self.no_token = no_token
        self.report = report
        self.instance = instance
        self.manager = manager
        self.assets,self.asset_versions,self.html = assets()
        self.stream_slots = threading.BoundedSemaphore(16)
        self.sessions: dict[str, float] = {}
        self.attempts: deque = deque()
        self.state_lock = threading.Lock()
        self.check_lock = threading.Lock()
        super().__init__((settings.host, settings.port), Handler)

    def stop_async(self) -> None:
        if self.manager:
            with self.manager.lock:
                self.manager.stopping = True
        threading.Thread(target=self.shutdown, daemon=True).start()

    def handle_error(self, request, client_address):
        # No traceback containing native or user payloads in application logs.
        pass


class Handler(BaseHTTPRequestHandler):
    server: Server
    server_version = "Lazyfish"
    sys_version = ""

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *args) -> None:
        pass  # Do not log URLs, cookies, headers, payloads or authentication failures.

    def _send(self, code: int, value, content_type: str = "application/json", cookie: str = "", disposition: str = "", cache_control: str = "no-store", etag: str = "") -> None:
        body = value if isinstance(value, bytes) else json.dumps(value).encode()
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache_control)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self'; "
                         "style-src 'self'; connect-src 'self'; img-src 'self' data:; "
                         "frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        if etag:self.send_header("ETag",etag)
        if disposition:self.send_header("Content-Disposition",disposition)
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        self.wfile.write(body)

    def _host_ok(self) -> bool:
        hosts = self.headers.get_all("Host", [])
        if len(hosts) != 1:
            return False
        bind_host = self.server.settings.host
        if bind_host == "0.0.0.0":
            # Refresh on each request so interface changes need no restart.
            allowed = {"127.0.0.1", "localhost"}
            allowed.update(local_ipv4s())
            names = [re.escape(host) for host in allowed]
        else:
            names = [re.escape(bind_host)]
            if bind_host == "127.0.0.1":
                names.append("localhost")
        return bool(re.fullmatch(r"(?:%s)(?::[0-9]{1,5})?" % "|".join(names), hosts[0]))

    def _authorized(self) -> bool:
        return self.server.no_token or self._credential_authorized()

    def _credential_authorized(self) -> bool:
        """Lifecycle requests still require credentials when Web sign-in is disabled."""
        authorization = self.headers.get("Authorization", "")
        if authorization.startswith("Bearer "):
            return secrets.compare_digest(authorization[7:].encode(), self.server.settings.token.encode())
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except Exception:
            return False
        session = cookie.get("lazyfish_session")
        if not session:
            return False
        with self.server.state_lock:
            expires = self.server.sessions.get(session.value, 0)
            return expires > time.monotonic()

    def _origin_ok(self) -> bool:
        origins = self.headers.get_all("Origin", [])
        if origins:
            return origins == ["http://" + self.headers["Host"]]
        # Browser writes require same-origin. CLI uses an explicit bearer credential.
        return self.headers.get("Authorization", "").startswith("Bearer ")

    def do_GET(self) -> None:
        try:
            self._get()
        except StoreError as exc:
            self._send(404 if exc.code=="not_found" else 400 if exc.code=="invalid_cursor" else 409,{"error":exc.code})
        except (OSError,sqlite3.Error):
            self._send(503,{"error":"storage_unavailable"})

    def _cwd(self, identifier=None):
        if identifier:
            if not isinstance(identifier,str) or not re.fullmatch(r"[a-f0-9]{32}",identifier): raise StoreError("not_found")
            return self.server.manager.store.conversation(identifier)["workspace"]
        return str(self.server.settings.workspace)

    def _workspace(self, value):
        if not isinstance(value,str) or len(value)>4096 or "\x00" in value: raise StoreError("invalid_workspace")
        path = (self.server.settings.workspace/value).resolve()
        if (self.server.settings.workspace_configured and not path.is_relative_to(self.server.settings.workspace)) or not path.is_dir(): raise StoreError("invalid_workspace")
        return str(path)

    def _get(self) -> None:
        if not self._host_ok():
            return self._send(403, {"error": "invalid_host"})
        if self.path == "/healthz":
            return self._send(200, {"status": "alive", "version": __version__})
        if self.path == "/readyz":
            ready = self.server.report["ready"] and not (self.server.manager and self.server.manager.blocked)
            return self._send(200 if ready else 503, {"ready": ready})
        if self.path in ("/api/status", "/api/control/status"):
            authorized = self._credential_authorized() if self.path == "/api/control/status" else self._authorized()
            if not authorized:
                return self._send(401, {"error": "authentication_required"})
            return self._send(200, {
                "version": __version__, "stage": 4, "instance": self.server.instance,
                "web_auth_required": not self.server.no_token,
                "metadata_scope": self.server.manager.capabilities.scope if self.server.manager else "",
                "workspace": str(self.server.settings.workspace) if self.server.settings.workspace_configured else "",
                "data_dir": str(self.server.settings.data_dir), "codex": self.server.report,
                "execution": {"available":bool(self.server.manager) and not self.server.manager.blocked and self.server.report["ready"],
                              "recovery_blocked":bool(self.server.manager and self.server.manager.blocked),
                              "sandbox":self.server.settings.sandbox,
                              "approval_policy":self.server.settings.approval_policy,
                              "blocked_jobs":[{"id":job["id"],"conversation_id":job["conversation_id"],"status":job["status"]}
                                              for job in self.server.manager.store.active()] if self.server.manager and self.server.manager.blocked else [],
                              "model":self.server.settings.model,"effort":self.server.settings.effort},
            })
        if self.path.startswith("/api/"):
            if not self._authorized():
                return self._send(401,{"error":"authentication_required"})
            if not self.server.manager:
                return self._send(503,{"error":"execution_unavailable"})
            store = self.server.manager.store
            parsed = urlsplit(self.path)
            if parsed.path=='/api/runtime':return self._send(200,self.server.manager.runtime_status())
            if parsed.path=='/api/performance':return self._send(200,store.timings())
            query = parse_qs(parsed.query)
            try:
                limit = int(query.get("limit",["30" if parsed.path!="/api/conversations" else "50"])[0])
                if not 1 <= limit <= 100:
                    raise ValueError
            except ValueError:
                return self._send(400,{"error":"invalid_limit"})
            if parsed.path=='/api/native/sessions':
                return self._send(200,{'sessions':self.server.manager.auth.pending()})
            if match := re.fullmatch(r"/api/native/sessions/([a-f0-9]{32})",parsed.path):
                return self._send(200,self.server.manager.auth.get(match[1]))
            if match := re.fullmatch(r"/api/jobs/([a-f0-9]{32})/artifacts/([a-f0-9]{64})",parsed.path):
                artifact=store.output_artifact(match[1],match[2])
                download=query.get('download')==['1'] or artifact['mime'] not in ('image/png','image/jpeg','image/webp','image/gif')
                disposition=("attachment" if download else "inline")+"; filename*=UTF-8''"+quote(artifact['name'],safe='')
                return self._send(200,artifact['content'],artifact['mime'],disposition=disposition)
            if match := re.fullmatch(r"/api/jobs/([a-f0-9]{32})/steps",parsed.path):
                try:
                    offset=int(query.get('offset',['0'])[0]);through=int(query['through'][0]) if 'through' in query else None
                    if offset<0 or offset>1000000 or through is not None and not offset<=through<=1000000:raise ValueError()
                except ValueError:return self._send(400,{'error':'invalid_cursor'})
                return self._send(200,store.steps(match[1],offset,through,preview=query.get('view')==['summary']))
            if match := re.fullmatch(r"/api/jobs/([a-f0-9]{32})/(changes|steps/detail|steps/image)",parsed.path):
                if match[2]=='changes':return self._send(200,{'report':store.changes(match[1])})
                if match[2]=='steps/detail':
                    try:offset=int(query.get('offset',['0'])[0])
                    except ValueError:raise StoreError('invalid_cursor') from None
                    if not 0<=offset<=32*1024*1024:raise StoreError('invalid_cursor')
                    return self._send(200,store.command_detail(match[1],query.get('item_id',[''])[0],offset,query.get('prefix_hash',[''])[0],query.get('lang',['en'])[0]))
                job=store.job(match[1])
                item=next((i for i in job['items'] if i['id']==query.get('item_id',[''])[0]),None)
                if not item:raise StoreError('not_found')
                artifact=item['detail'].get('image_artifact')
                return self._send(200,{'state':'ready',**artifact} if artifact else {'state':'unavailable'})
            if match := re.fullmatch(r"/api/native/(account|usage|activity|skills|connections|models)",parsed.path):
                cwd = self._cwd(query.get("conversation",[None])[0])
                return self._send(200,self.server.manager.capabilities.snapshot(match[1],cwd,query.get("refresh")==["1"]))
            if parsed.path == "/api/skills/document":
                return self._send(200,self.server.manager.capabilities.skill_document(self._cwd(query.get("conversation",[None])[0]),query.get("path",[""])[0]))
            if match := re.fullmatch(r"/api/attachments/([a-f0-9]{32})",parsed.path):
                attachment = store.attachment(match[1],True)
                return self._send(200,attachment["content"],attachment["mime"])
            if parsed.path == "/api/conversations":
                cursor = query.get("cursor",[None])[0]
                if cursor and len(cursor)>1024:
                    return self._send(400,{"error":"invalid_cursor"})
                search = query.get("q",[""])[0].strip()
                if len(search)>200:
                    return self._send(400,{"error":"invalid_query"})
                return self._send(200,store.conversation_page(limit,cursor,search))
            if match := re.fullmatch(r'/api/conversations/([a-f0-9]{32})/(events|sync)',parsed.path):
                if match[2]=='events':return self._conversation_events(match[1],query.get('since',[''])[0])
                revision=store.revision(match[1])
                return self._send(200,{'revision':revision,'changed':str(revision)!=query.get('since',[''])[0]})
            if match := re.fullmatch(r"/api/conversations/([a-f0-9]{32})",parsed.path):
                anchors = {key:query[key][0] for key in ("before","after","anchor") if key in query}
                if len(anchors)>1 or any(not re.fullmatch(r"[a-f0-9]{32}",value) for value in anchors.values()):
                    return self._send(400,{"error":"invalid_cursor"})
                return self._send(200,store.history(match[1],limit,summary=query.get("view")==["summary"],**anchors))
            if match := re.fullmatch(r"/api/jobs/([a-f0-9]{32})(/events)?",parsed.path):
                if match[2]:
                    cursor = self.headers.get("Last-Event-ID") or parse_qs(parsed.query).get("after",["0"])[0]
                    if not cursor.isdecimal() or len(cursor)>16:
                        return self._send(400,{"error":"invalid_cursor"})
                    return self._events(match[1],int(cursor))
                return self._send(200,store.job(match[1]))
        parsed=urlsplit(self.path)
        if parsed.path=="/":return self._send(200,self.server.html,"text/html; charset=utf-8")
        name=parsed.path[1:]
        if name in self.server.assets:
            version=self.server.asset_versions[name];etag='"'+version+'"'
            immutable=parse_qs(parsed.query).get('v')==[version]
            cache="public, max-age=31536000, immutable" if immutable else "no-cache"
            mime="text/javascript; charset=utf-8" if name.endswith(".js") else "text/css; charset=utf-8"
            unchanged=etag in [v.strip() for v in self.headers.get('If-None-Match','').split(',')]
            return self._send(304 if unchanged else 200,b'' if unchanged else self.server.assets[name],mime,cache_control=cache,etag=etag)
        self._send(404, {"error": "not_found"})

    def _conversation_events(self, identifier, since):
        store=self.server.manager.store
        store.revision(identifier)
        if not self.server.stream_slots.acquire(blocking=False):return self._send(429,{'error':'too_many_streams'})
        try:
            self.send_response(200)
            for key,value in {'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no','Connection':'close'}.items():self.send_header(key,value)
            self.end_headers();self.close_connection=True
            deadline=time.monotonic()+120;heartbeat=0
            while time.monotonic()<deadline and not self.server.manager.stopping and self._authorized():
                try:revision=store.revision(identifier)
                except StoreError:
                    self.wfile.write(b'event: gone\ndata: {}\n\n');self.wfile.flush();break
                if str(revision)!=since:
                    self.wfile.write(('event: sync\ndata: '+json.dumps({'revision':revision})+'\n\n').encode());since=str(revision)
                if time.monotonic()>heartbeat:self.wfile.write(b': heartbeat\n\n');heartbeat=time.monotonic()+10
                self.wfile.flush();time.sleep(.2)
        except (OSError,sqlite3.Error):pass
        finally:self.server.stream_slots.release()

    def _events(self, job: str, cursor: int):
        manager = self.server.manager
        manager.store.state(job)  # Validate before starting an HTTP stream.
        if not self.server.stream_slots.acquire(blocking=False):
            return self._send(429,{"error":"too_many_streams"})
        try:
            self.send_response(200)
            for key,value in {"Content-Type":"text/event-stream; charset=utf-8", "Cache-Control":"no-store",
                              "X-Accel-Buffering":"no", "X-Content-Type-Options":"nosniff","Connection":"close"}.items():
                self.send_header(key,value)
            self.end_headers()
            self.close_connection = True
            deadline, heartbeat = time.monotonic()+120,0
            while time.monotonic()<deadline and not manager.stopping and self._authorized():
                events = manager.store.events(job,cursor)
                for event in events:
                    self.wfile.write((f"id: {event['id']}\ndata: "+json.dumps(event["data"])+"\n\n").encode())
                    cursor = event["id"]
                if not events and manager.store.state(job) not in ACTIVE:
                    self.wfile.write(b"event: done\ndata: {}\n\n")
                    self.wfile.flush()
                    break
                if time.monotonic()>heartbeat:
                    self.wfile.write(b": heartbeat\n\n")
                    heartbeat = time.monotonic()+10
                self.wfile.flush()
                time.sleep(0.12)
        except (OSError,sqlite3.Error,StoreError):
            pass  # A disconnect never cancels execution. The browser can replay by cursor.
        finally:
            self.server.stream_slots.release()

    def do_POST(self) -> None:
        if not self._host_ok() or not self._origin_ok():
            return self._send(403, {"error": "invalid_origin_or_host"})
        if self.headers.get("Transfer-Encoding") or self.headers.get_content_type() != "application/json":
            return self._send(400, {"error": "json_required"})
        sizes = self.headers.get_all("Content-Length", [])
        try:
            size = int(sizes[0]) if len(sizes) == 1 else -1
            limit = 256 * 1024 if self._authorized() and self.path.startswith("/api/conversations/") else 4096
            if self._authorized() and self.path == "/api/attachments": limit = 14*1024*1024
            if self._authorized() and (self.path == "/api/skills" or re.fullmatch(r"/api/jobs/[a-f0-9]{32}/(instructions|questions)",self.path)): limit = 256*1024
            if self._authorized() and self.path == "/api/native/login":limit=16*1024
            if not 0 < size <= limit:
                raise ValueError
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict):
                raise ValueError
        except (ValueError, OSError):
            return self._send(400, {"error": "invalid_body"})
        if self.path == "/api/session":
            if self.server.no_token:
                return self._send(200, {"authenticated": True})
            now = time.monotonic()
            with self.server.state_lock:
                while self.server.attempts and self.server.attempts[0] < now - 60:
                    self.server.attempts.popleft()
                if len(self.server.attempts) >= 10:
                    return self._send(429, {"error": "try_later"})
                token = body.get("token", "")
                if not isinstance(token, str) or not secrets.compare_digest(token.encode(), self.server.settings.token.encode()):
                    self.server.attempts.append(now)
                    return self._send(401, {"error": "invalid_token"})
                self.server.sessions = {key: expiry for key, expiry in self.server.sessions.items() if expiry > now}
                if len(self.server.sessions) >= 256:
                    self.server.sessions.pop(next(iter(self.server.sessions)))
                session = secrets.token_urlsafe(32)
                self.server.sessions[session] = now + 3600 * 12
            return self._send(200, {"authenticated": True}, cookie=
                              f"lazyfish_session={session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200")
        authorized = self._credential_authorized() if self.path == "/api/shutdown" else self._authorized()
        if not authorized:
            return self._send(401, {"error": "authentication_required"})
        if self.path == "/api/logout":
            cookie = SimpleCookie(self.headers.get("Cookie", ""))
            if "lazyfish_session" in cookie:
                with self.server.state_lock:
                    self.server.sessions.pop(cookie["lazyfish_session"].value, None)
            return self._send(200, {"authenticated": self.server.no_token}, cookie=
                              "lazyfish_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0")
        if self.path == "/api/shutdown":
            if body.get("instance") != self.server.instance:
                return self._send(409, {"error": "instance_changed"})
            self._send(200, {"stopping": True})
            self.server.stop_async()
            return
        if self.server.manager:
            try:
                return self._chat_post(body)
            except StoreError as exc:
                return self._send(404 if exc.code=="not_found" else 409,{"error":exc.code})
            except (OSError,sqlite3.Error):
                return self._send(503,{"error":"storage_unavailable"})
        self._send(404, {"error": "not_found"})

    def _chat_post(self, body: dict):
        manager = self.server.manager
        if manager.stopping:
            return self._send(503,{"error":"service_stopping"})
        if self.path=='/api/environment/check':
            if not self.server.check_lock.acquire(blocking=False):
                return self._send(409,{'error':'environment_check_busy'})
            try:
                report=diagnose(self.server.settings,protocol=True)
                changed=report['checks']!=self.server.report['checks']
                self.server.report=report
                if changed:manager.capabilities.invalidate()
                return self._send(200,{'codex':report})
            finally:
                self.server.check_lock.release()
        if (re.fullmatch(r'/api/conversations/[a-f0-9]{32}/(turns|compact)',self.path)
                and not self.server.report['ready']):
            return self._send(409,{'error':'codex_unavailable'})
        if self.path=='/api/runtime':
            return self._send(200,manager.resize(body.get('target_concurrency')))
        if self.path=='/api/conversations/read':
            receipts=body.get('receipts')
            if not isinstance(receipts,dict) or len(receipts)>500 or any(not isinstance(k,str) or not isinstance(v,str) or not re.fullmatch(r'[a-f0-9]{32}',k) or not re.fullmatch(r'[a-f0-9]{32}',v) for k,v in receipts.items()):raise StoreError('invalid_receipts')
            return self._send(200,manager.store.mark_read(receipts))
        if self.path=='/api/skills/source':
            return self._send(200,manager.capabilities.save_skill_source(self._cwd(body.get('conversation')),body.get('path'),body.get('hash'),body.get('content')))
        if self.path == '/api/native/login':
            kind=body.get('type')
            if kind not in ('chatgpt','chatgptDeviceCode','apiKey','logout'):return self._send(400,{'error':'invalid_login'})
            options={'type':kind}
            if kind=='apiKey':
                key=body.get('apiKey')
                if not isinstance(key,str) or not 8<=len(key)<=4096 or any(c.isspace() for c in key):return self._send(400,{'error':'invalid_login'})
                options['apiKey']=key
            return self._send(202,manager.auth.start('account',self._cwd(),options))
        if self.path == '/api/native/mcp/login':
            name=body.get('name');cwd=self._cwd(body.get('conversation'))
            if not isinstance(name,str) or not any(server['name']==name for server in manager.capabilities.read('connections',cwd)['servers']):raise StoreError('not_found')
            return self._send(202,manager.auth.start('mcp',cwd,{'name':name}))
        if match := re.fullmatch(r'/api/native/sessions/([a-f0-9]{32})/cancel',self.path):
            return self._send(200,manager.auth.cancel(match[1]))
        if self.path == '/api/conversations/reorder':
            identifiers=body.get('ids')
            if not isinstance(identifiers,list) or len(identifiers)>500 or any(not isinstance(i,str) or not re.fullmatch(r'[a-f0-9]{32}',i) for i in identifiers):return self._send(400,{'error':'invalid_conversation_settings'})
            return self._send(200,manager.store.reorder_pins(identifiers))
        if self.path == '/api/attachments/cleanup':
            from datetime import datetime,timedelta,timezone
            return self._send(200,{'removed':manager.store.cleanup_attachments((datetime.now(timezone.utc)-timedelta(days=7)).isoformat())})
        if match := re.fullmatch(r'/api/jobs/([a-f0-9]{32})/(instructions|questions)',self.path):
            if match[2]=='questions':return self._send(200,manager.answer(match[1],body.get('id'),body.get('answers')))
            key,text=body.get('client_request_id'),body.get('text')
            if not isinstance(key,str) or not re.fullmatch(r'[a-zA-Z0-9_-]{16,80}',key) or not isinstance(text,str) or not text.strip() or len(text)>64000:return self._send(400,{'error':'invalid_text'})
            skills=body.get('skills',[])
            if not isinstance(skills,list) or len(skills)>12 or any(not isinstance(s,dict) or not isinstance(s.get('name'),str) or not isinstance(s.get('path'),str) for s in skills):raise StoreError('invalid_inputs')
            return self._send(202,manager.steer(match[1],key,text,skills))
        if match := re.fullmatch(r'/api/conversations/([a-f0-9]{32})/edit',self.path):
            before,key,text=body.get('before_job_id'),body.get('client_request_id'),body.get('text')
            if not isinstance(before,str) or not re.fullmatch(r'[a-f0-9]{32}',before) or not isinstance(key,str) or not re.fullmatch(r'[a-zA-Z0-9_-]{16,80}',key) or not isinstance(text,str) or not text.strip() or len(text)>64000:return self._send(400,{'error':'invalid_text'})
            return self._send(202,manager.edit(match[1],before,key,text))
        if self.path == "/api/attachments":
            name, mime, value = body.get("name"),body.get("mime"),body.get("data")
            if not isinstance(name,str) or not name or len(name)>255 or not isinstance(value,str) or mime not in ("image/png","image/jpeg","image/webp"):
                return self._send(400,{"error":"invalid_image"})
            try: content = base64.b64decode(value,validate=True)
            except (ValueError,binascii.Error): return self._send(400,{"error":"invalid_image"})
            valid = {"image/png":content.startswith(b"\x89PNG\r\n\x1a\n"),"image/jpeg":content.startswith(b"\xff\xd8\xff"),"image/webp":content.startswith(b"RIFF") and content[8:12]==b"WEBP"}
            if not 0<len(content)<=10*1024*1024 or not valid[mime]: return self._send(400,{"error":"invalid_image"})
            return self._send(201,manager.store.add_attachment(Path(name).name,mime,content))
        if self.path == "/api/skills/enabled":
            return self._send(200,manager.capabilities.set_skill_enabled(self._cwd(body.get("conversation")),body.get("path"),body.get("enabled")))
        if self.path == "/api/skills":
            return self._send(200,manager.capabilities.save_skill(self._cwd(body.get("conversation")),body.get("name"),body.get("description"),body.get("body"),body.get("replace") is True,body.get("scope","project")))
        if self.path == "/api/workspace/validate":
            return self._send(200,{"workspace":self._workspace(body.get("workspace"))})
        if self.path == "/api/conversations":
            title = body.get("title", "")
            if not isinstance(title,str) or len(title)>100:
                return self._send(400,{"error":"invalid_title"})
            from ..run_settings import validate
            key=body.get('client_request_id')
            if key is not None and (not isinstance(key,str) or not re.fullmatch(r'[a-zA-Z0-9_-]{16,80}',key)):raise StoreError('invalid_request_key')
            return self._send(201,manager.store.create_conversation(self._workspace(body.get("workspace",str(self.server.settings.workspace))),title,validate(body.get('run_settings',{})),key))
        if match := re.fullmatch(r"/api/conversations/([a-f0-9]{32})/delete",self.path):
            return self._send(200,manager.store.archive(match[1]))
        if match := re.fullmatch(r"/api/conversations/([a-f0-9]{32})/compact",self.path):
            key=body.get("client_request_id")
            if not isinstance(key,str) or not re.fullmatch(r"[a-zA-Z0-9_-]{16,80}",key):return self._send(400,{"error":"invalid_request_key"})
            return self._send(202,manager.compact(match[1],key))
        if match := re.fullmatch(r"/api/conversations/([a-f0-9]{32})/(settings|branch)",self.path):
            if match[2]=="settings":
                if 'run_settings' in body:return self._send(200,manager.store.save_run_settings(match[1],body['run_settings']))
                if "workspace" in body:
                    return self._send(200,manager.store.workspace(match[1],self._workspace(body["workspace"])))
                title, pinned = body.get("title"),body.get("pinned")
                if (title is not None and (not isinstance(title,str) or not title.strip() or len(title)>100)) or (pinned is not None and type(pinned) is not bool):
                    return self._send(400,{"error":"invalid_conversation_settings"})
                return self._send(200,manager.store.update_conversation(match[1],title.strip() if title else None,pinned))
            job, key, title = body.get("before_job_id"),body.get("client_request_id"),body.get("title")
            if not isinstance(job,str) or not re.fullmatch(r"[a-f0-9]{32}",job) or not isinstance(key,str) or not re.fullmatch(r"[a-zA-Z0-9_-]{16,80}",key) or not isinstance(title,str) or not title.strip() or len(title)>100:
                return self._send(400,{"error":"invalid_branch"})
            return self._send(201,manager.store.branch(match[1],job,key,title.strip()))
        if match := re.fullmatch(r"/api/conversations/([a-f0-9]{32})/turns",self.path):
            prompt, key = body.get("text"), body.get("client_request_id")
            saved=json.loads(manager.store.conversation(match[1])['run_settings'])
            model = body.get("model",saved.get('model',self.server.settings.model)) or None
            effort = body.get("effort",saved.get('effort',self.server.settings.effort)) or None
            body={**{k:v for k,v in saved.items() if v is not None},**body}
            images, skills = body.get("images",[]),body.get("skills",[])
            if not isinstance(images,list) or len(images)>8 or not all(isinstance(i,str) and re.fullmatch(r"[a-f0-9]{32}",i) for i in images) or not isinstance(skills,list) or len(skills)>12 or not all(isinstance(i,dict) and isinstance(i.get("name"),str) and isinstance(i.get("path"),str) for i in skills):
                return self._send(400,{"error":"invalid_inputs"})
            inputs = {"images":[manager.store.attachment(i) for i in dict.fromkeys(images)],"skills":[{"name":s["name"],"path":s["path"]} for s in skills]}
            if "fast_mode" in body:
                if type(body["fast_mode"]) is not bool: return self._send(400,{"error":"invalid_fast_mode"})
                inputs["fast_mode"] = body["fast_mode"]
            for setting,allowed in {"permission_mode":{"ask","auto_review","full_access","read_only","custom"},"collaboration_mode":{"default","plan"}}.items():
                if setting in body:
                    if not isinstance(body[setting],str) or body[setting] not in allowed:return self._send(400,{"error":"invalid_run_settings"})
                    inputs[setting]=body[setting]
            if skills:
                available = manager.capabilities.read("skills",self._cwd(match[1]))["skills"]
                if any(not any(s["name"]==skill["name"] and s["path"]==skill["path"] and s.get("enabled") is not False for s in available) for skill in skills): raise StoreError("skill_unavailable")
            if not isinstance(prompt,str) or (not prompt.strip() and not images and not skills) or len(prompt)>64000 or "\x00" in prompt:
                return self._send(400,{"error":"invalid_text"})
            if not isinstance(key,str) or not re.fullmatch(r"[a-zA-Z0-9_-]{16,80}",key):
                return self._send(400,{"error":"invalid_request_key"})
            if model is not None and (not isinstance(model,str) or len(model)>120 or any(c.isspace() for c in model)):
                return self._send(400,{"error":"invalid_model"})
            if effort not in (None,"none","minimal","low","medium","high","xhigh","max","ultra"):
                return self._send(400,{"error":"invalid_effort"})
            return self._send(202,manager.submit(match[1],key,prompt,model,effort,inputs))
        if match := re.fullmatch(r"/api/jobs/([a-f0-9]{32})/(cancel|approvals)",self.path):
            if match[2]=="cancel":
                return self._send(200,manager.cancel(match[1]))
            identifier, decision = body.get("id"), body.get("decision")
            if not isinstance(identifier,str) or not re.fullmatch(r"[a-f0-9]{32}",identifier) or not (type(decision) is int or isinstance(decision,str) and decision in ("accept","decline")):
                return self._send(400,{"error":"invalid_decision"})
            manager.decide(match[1],identifier,decision)
            return self._send(200,{"decided":True})
        self._send(404,{"error":"not_found"})
