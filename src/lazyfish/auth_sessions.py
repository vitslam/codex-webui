"""Owned, bounded native login sessions; no auth tokens are persisted by the web app."""
from __future__ import annotations
import fcntl
import json
import os
import threading
import time
import uuid
from urllib.parse import urlsplit
from .codex import stop_child
from .config import read_private
from .processes import stop_session
from .protocol import Client,ProtocolError
from .storage import StoreError


class AuthSessions:
    def __init__(self,manager):
        self.manager=manager;self.lock=threading.RLock();self.sessions={}

    def pending_account(self):
        with self.lock:return any(s['kind']=='account' and s['state'] in ('starting','pending') for s in self.sessions.values())

    def start(self,kind,cwd,options):
        with self.manager.lock,self.lock:
            if self.manager.stopping:raise StoreError('service_stopping')
            if kind=='account' and self.manager.store.active():raise StoreError('account_busy')
            for key,session in list(self.sessions.items()):
                if time.monotonic()-session['created']>1500 and session['state'] not in ('starting','pending') and not session['thread'].is_alive():self.sessions.pop(key,None)
            existing=next((s for s in self.sessions.values() if s['kind']==kind and s['state'] in ('starting','pending') and (kind=='account' or s['server']==options.get('name'))),None)
            if existing:return self.get(existing['id'])
            if len(self.sessions)>=8:
                terminal=next((key for key,value in self.sessions.items() if value['state'] not in ('starting','pending') and not value['thread'].is_alive()),None)
                if terminal:self.sessions.pop(terminal)
                else:raise StoreError('metadata_busy')
            identifier=uuid.uuid4().hex;session=dict(id=identifier,kind=kind,server=options.get('name'),state='starting',created=time.monotonic(),ready=threading.Event(),cancel=threading.Event())
            self.sessions[identifier]=session
            thread=threading.Thread(target=self.run,args=(session,cwd,dict(options)),name='native-login-'+identifier[:8],daemon=True);session['thread']=thread;thread.start()
        session['ready'].wait(12)
        return self.get(identifier)

    def get(self,identifier):
        with self.lock:
            value=self.sessions.get(identifier)
            if not value:raise StoreError('not_found')
            return {k:value[k] for k in ('id','kind','state','url','user_code','error','server') if k in value}

    def pending(self):
        with self.lock:
            return [self.get(s['id']) for s in reversed(list(self.sessions.values())) if s['state'] in ('starting','pending')]

    def cancel(self,identifier):
        with self.lock:
            session=self.sessions.get(identifier)
            if not session:raise StoreError('not_found')
            session['cancel'].set()
        return self.get(identifier)

    def shutdown(self):
        with self.lock:
            sessions=list(self.sessions.values())
            for session in sessions:session['cancel'].set()
        for session in sessions:session['thread'].join(timeout=6)

    def run(self,session,cwd,options):
        identifier='auth-'+session['id'];fd=self.manager.lease(identifier);fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);client=None;invalidated=False
        def update(**values):
            with self.lock:session.update(values)
        deadline=time.monotonic()+(120 if session['kind']=='mcp' else 1200)
        def tick():
            if self.manager.stopping or session['cancel'].is_set():raise ProtocolError('login_cancelled')
            if time.monotonic()>deadline:raise ProtocolError('login_expired')
        def receive(message):
            nonlocal invalidated
            method,params=message.get('method'),message.get('params') or {}
            if method in ('account/login/completed','mcpServer/oauthLogin/completed'):
                expected='account/login/completed' if session['kind']=='account' else 'mcpServer/oauthLogin/completed'
                if method!=expected:return
                if session.get('login_id') and params.get('loginId') not in (None,session['login_id']):return
                if session['kind']=='mcp' and params.get('name') not in (None,session['server']):return
                if params.get('success',False) and not invalidated:
                    self.manager.capabilities.invalidate();invalidated=True
                update(state='completed' if params.get('success',False) else 'failed',**({} if params.get('success',False) else {'error':'native_login_failed'}))
            elif method and 'id' in message:client.send({'id':message['id'],'error':{'code':-32601,'message':'Unsupported login request'}})
        try:
            client=Client(self.manager.settings,identifier,self.manager.owner,fd,cwd);client.initialize(receive,tick,True)
            if session['kind']=='mcp':method,params='mcpServer/oauth/login',{'name':options['name'],'timeoutSecs':120}
            elif options['type']=='logout':method,params='account/logout',{}
            else:method,params='account/login/start',options
            result=client.call(method,params,receive,tick,timeout=10)
            # Drop in-memory API-key material immediately after the native request.
            options.clear();params.clear()
            if method=='account/logout' or result.get('type')=='apiKey':update(state='completed')
            else:
                url=result.get('authorizationUrl') or result.get('verificationUrl') or result.get('authUrl')
                parsed=urlsplit(url or '')
                if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password:raise ProtocolError('invalid_login_url')
                update(url=url,login_id=result.get('loginId'),user_code=result.get('userCode'))
                with self.lock:
                    if session['state']=='starting':session['state']='pending'
            if session['state']=='completed' and not invalidated:
                self.manager.capabilities.invalidate();invalidated=True
            session['ready'].set()
            while session['state'] in ('starting','pending'):
                tick();message=client.next()
                if message:receive(message)
            if not invalidated:self.manager.capabilities.invalidate()
        except ProtocolError as error:
            update(state='cancelled' if error.code=='login_cancelled' else 'failed',error=error.code if error.code in ('login_cancelled','login_expired') else 'native_login_failed')
        except Exception: update(state='failed',error='native_login_failed')
        finally:
            options.clear()
            try:
                if client:
                    if client.record_path.exists():
                        record=json.loads(read_private(client.record_path))
                        stopped=record.get('job')==identifier and record.get('owner')==self.manager.owner and stop_session(record)
                        if not stopped:self.manager.blocked=True
                    else:stop_child(client.process);stopped=True
                    if stopped:
                        client.close_pipes();client.record_path.unlink(missing_ok=True)
            except Exception:
                self.manager.blocked=True
            finally:
                os.close(fd);session['ready'].set()
                (self.manager.settings.runtime_dir/'jobs'/(identifier+'.lock')).unlink(missing_ok=True)
