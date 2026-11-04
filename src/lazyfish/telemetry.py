"""Loopback-only native sampling timings. Never retain prompts or span attributes."""
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import json
import secrets
import threading


class Timings:
    def __init__(self,store):
        self.store=store;self.route='/'+secrets.token_hex(24)+'/v1/traces'
        collector=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(self):
                self.connection.settimeout(3)
                try:
                    if self.path!=collector.route:return self.send_error(404)
                    if self.headers.get('Transfer-Encoding'):return self.send_error(400)
                    size=int(self.headers.get('Content-Length','0'))
                    if not 0<size<=8*1024*1024:return self.send_error(413)
                    collector.record(json.loads(self.rfile.read(size)))
                except Exception:return self.send_error(400)
                self.send_response(200);self.send_header('Content-Length','2');self.end_headers();self.wfile.write(b'{}')
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler);self.server.daemon_threads=True
        self.thread=threading.Thread(target=self.server.serve_forever,kwargs={'poll_interval':.1},name='native-timings',daemon=True);self.thread.start()

    @property
    def options(self):
        endpoint='http://127.0.0.1:'+str(self.server.server_port)+self.route
        return ['-c','otel.trace_exporter={otlp-http={endpoint='+json.dumps(endpoint)+',protocol="json"}}']

    def record(self,payload):
        rows=[]
        for resource in payload.get('resourceSpans',[])[:50]:
            for scope in resource.get('scopeSpans',[])[:50]:
                for span in scope.get('spans',[])[:500]:
                    if len(rows)>=500:break
                    if span.get('name')!='codex.sampling':continue
                    attrs={a['key']:a.get('value',{}).get('stringValue') for a in span.get('attributes',[])[:100] if isinstance(a,dict) and 'key' in a}
                    turn,trace,sid=attrs.get('turn.id'),span.get('traceId'),span.get('spanId')
                    if not all(isinstance(v,str) and 0<len(v)<=200 for v in (turn,trace,sid)):continue
                    start,end=int(span['startTimeUnixNano']),int(span['endTimeUnixNano'])
                    if not 0<start<=end<2**63 or end-start>86400*10**9:continue
                    status=(span.get('status') or {}).get('code')
                    rows.append((trace,sid,turn,(end-start)/1e6,end/1e9,int(status in (2,'STATUS_CODE_ERROR'))))
        if rows:self.store.record_timings(rows)

    def close(self):
        self.server.shutdown();self.server.server_close();self.thread.join(timeout=2)
