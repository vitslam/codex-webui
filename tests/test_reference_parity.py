"""Reference migration regressions with isolated native fixtures, never a real model."""
import base64
from contextlib import closing
import hashlib
import http.client
import json
import time
import subprocess
import uuid
from pathlib import Path
from urllib.parse import quote

from test_service import ServiceCase
from lazyfish.storage import Store


class ReferenceParityTests(ServiceCase):
    def call(self,path,data=None,expected=200):
        code,_,body=self.http(path,'GET' if data is None else 'POST',data,{'Authorization':'Bearer '+self.settings.token})
        value=json.loads(body);self.assertEqual(code,expected,value);return value

    def chat(self):return self.call('/api/conversations',{},201)['id']

    def send(self,chat,text,**values):
        return self.call('/api/conversations/'+chat+'/turns',{'text':text,'client_request_id':uuid.uuid4().hex,**values},202)

    def wait(self,job,predicate=None):
        predicate=predicate or (lambda row:row['status'] not in ('queued','running','cancelling'))
        deadline=time.monotonic()+8
        while time.monotonic()<deadline:
            row=self.call('/api/jobs/'+job['id'])
            if predicate(row):return row
            time.sleep(.025)
        self.fail('Fixture did not reach the expected state: '+json.dumps(row))

    def methods(self):
        return [json.loads(line) for line in (self.settings.runtime_dir/'tmp/fake-methods.jsonl').read_text().splitlines()]

    def test_conversation_settings_survive_refresh_submit_and_branch(self):
        a,b=self.chat(),self.chat()
        values={'model':'fixture-model','effort':'low','fast_mode':True,'permission_mode':'read_only','collaboration_mode':'plan'}
        self.call('/api/conversations/'+a+'/settings',{'run_settings':values})
        self.call('/api/conversations/'+b+'/settings',{'run_settings':{**values,'effort':'high','fast_mode':False}})
        self.assertEqual(json.loads(self.call('/api/conversations/'+a)['run_settings']),values)
        first=self.wait(self.send(a,'[plan-only]'))
        self.assertEqual(first['status'],'completed');self.assertEqual(first['model'],'fixture-model');self.assertEqual(first['effort'],'low')
        self.assertEqual(first['items'][-1]['kind'],'assistant')
        self.assertTrue(first['inputs']['fast_mode'])
        second=self.wait(self.send(a,'another plan'))
        branch=self.call('/api/conversations/'+a+'/branch',{'before_job_id':second['id'],'title':'Branch','client_request_id':uuid.uuid4().hex},201)
        self.assertEqual(json.loads(branch['run_settings']),values)
        # A native-only compaction does not replace the conversation's saved choices.
        self.wait(self.call('/api/conversations/'+a+'/compact',{'client_request_id':uuid.uuid4().hex},202))
        self.assertEqual(json.loads(self.call('/api/conversations/'+a)['run_settings']),values)

    def test_skill_source_preserves_frontmatter_and_rejects_stale_writes(self):
        skill=self.call('/api/skills',{'name':'source-check','description':'Read source','body':'Original instructions'})
        url='/api/skills/document?path='+quote(skill['path'])
        old=self.call(url)
        content=old['content'].replace('\n---\n','\nlicense: MIT\nmetadata:\n  author: fixture\n---\n',1)
        saved=self.call('/api/skills/source',{'path':skill['path'],'hash':old['hash'],'content':content})
        self.assertIn('license: MIT',Path(skill['path']).read_text())
        self.call('/api/skills/source',{'path':skill['path'],'hash':old['hash'],'content':old['content']},409)
        latest=self.call(url);self.assertEqual(latest['hash'],saved['hash'])
        Path(skill['path']).write_text(content+'\nChanged externally\n')
        self.call('/api/skills/source',{'path':skill['path'],'hash':latest['hash'],'content':content},409)
        self.assertIn('Changed externally',Path(skill['path']).read_text())

    def test_native_offered_permission_choices_are_enforced(self):
        chat=self.chat()
        job=self.send(chat,'[permissions-approval]');waiting=self.wait(job,lambda row:bool(row['approvals']))
        approval=waiting['approvals'][0];self.assertEqual(approval['kind'],'permissions')
        self.assertEqual(len(approval['choices']),3)
        path='/api/jobs/'+job['id']+'/approvals'
        self.call(path,{'id':approval['id'],'decision':'accept'},409)
        self.call(path,{'id':approval['id'],'decision':1})
        self.assertEqual(self.wait(job)['status'],'completed')
        with closing(Store(self.settings.data_dir/'lazyfish.db').connect()) as db:
            response=json.loads(db.execute('SELECT response FROM approvals WHERE id=?',(approval['id'],)).fetchone()[0])
        self.assertEqual(response,{'permissions':{'network':{'enabled':True}},'scope':'session'})
        job=self.send(chat,'[restricted-approval]');approval=self.wait(job,lambda row:bool(row['approvals']))['approvals'][0]
        self.assertEqual(len(approval['choices']),1)
        path='/api/jobs/'+job['id']+'/approvals';self.call(path,{'id':approval['id'],'decision':'accept'},409)
        self.call(path,{'id':approval['id'],'decision':0});self.assertEqual(self.wait(job)['status'],'completed')

    def test_queue_resize_warm_reuse_and_cancel_before_execution(self):
        self.call('/api/runtime',{'target_concurrency':1})
        a,b=self.chat(),self.chat();running=self.send(a,'[approval]');waiting=self.wait(running,lambda row:bool(row['approvals']))
        pending=self.send(b,'must not run');self.assertEqual(pending['status'],'queued')
        state=self.call('/api/runtime');self.assertEqual(state['queued'],1);self.assertEqual(len(state['slots']),1)
        self.call('/api/jobs/'+pending['id']+'/cancel',{});self.assertEqual(self.wait(pending)['status'],'cancelled')
        approval=waiting['approvals'][0];self.call('/api/jobs/'+running['id']+'/approvals',{'id':approval['id'],'decision':0});self.assertEqual(self.wait(running)['status'],'completed')
        self.assertEqual(self.wait(self.send(a,'reuse warm connection'))['status'],'completed')
        methods=self.methods();self.assertEqual(sum(row['method']=='initialize' for row in methods),1,[(row['method'],row.get('pid')) for row in methods])
        self.assertEqual(sum(row['method']=='turn/start' for row in methods),2)
        self.assertEqual(Store(self.settings.data_dir/'lazyfish.db').concurrency(),1)

    def test_read_receipt_and_conversation_events(self):
        chat=self.chat();before=self.call('/api/conversations/'+chat)['revision']
        connection=http.client.HTTPConnection('127.0.0.1',self.port,timeout=5)
        try:
            connection.request('GET','/api/conversations/'+chat+'/events?since='+str(before),headers={'Authorization':'Bearer '+self.settings.token})
            response=connection.getresponse();self.assertEqual(response.status,200)
            self.call('/api/conversations/'+chat+'/settings',{'run_settings':{'effort':'high'}})
            deadline=time.monotonic()+4;event=False
            while time.monotonic()<deadline:
                line=response.readline()
                if line.startswith(b'event: sync'):event=True;break
            self.assertTrue(event)
        finally:connection.close()
        self.assertTrue(self.call('/api/conversations/'+chat+'/sync?since='+str(before))['changed'])
        job=self.wait(self.send(chat,'unread result'));self.call('/api/conversations/read',{'receipts':{chat:job['id']}})
        row=next(c for c in self.call('/api/conversations')['conversations'] if c['id']==chat)
        self.assertEqual(row['read_job_id'],job['id']);self.assertEqual(row['last_job_id'],job['id'])

    def test_command_bodies_are_deferred_and_offsets_reset_after_replacement(self):
        store=Store(self.settings.data_dir/'lazyfish.db');chat=self.chat();job,_=store.reserve(chat,'fixture',uuid.uuid4().hex,'Inspect commands',None,None)
        body='saved output '*10000;store.item(job['id'],'cmd','command','echo fixture\n'+body,'completed')
        store.detail(job['id'],'cmd',{'type':'command_execution','command':'echo fixture','aggregated_output':body,'exit_code':0})
        store.finish(job['id'],'completed')
        summary=self.call('/api/jobs/'+job['id']+'/steps?view=summary');self.assertLess(len(json.dumps(summary)),1000)
        detail=summary['items'][0]['detail'];self.assertTrue(detail['details_deferred'])
        self.assertNotIn(body,json.dumps(store.events(job['id'],0)))
        url='/api/jobs/'+job['id']+'/steps/detail?item_id=cmd'
        initial=self.call(url);self.assertIn(body,initial['text'])
        unchanged=self.call(url+'&offset='+str(initial['next_offset'])+'&prefix_hash='+initial['prefix_hash']);self.assertEqual(unchanged['text'],'')
        store.detail(job['id'],'cmd',{'type':'command_execution','command':'echo changed','aggregated_output':'replacement'})
        reset=self.call(url+'&offset='+str(initial['next_offset'])+'&prefix_hash='+initial['prefix_hash']);self.assertTrue(reset['reset']);self.assertIn('replacement',reset['text'])

    def test_ephemeral_image_snapshot_and_supplemental_skill(self):
        chat=self.chat();job=self.wait(self.send(chat,'[ephemeral-image]'))
        image=next(item for item in job['items'] if item['id']=='view-ephemeral')['detail']['image_artifact']
        code,_,content=self.http(image['url'],headers={'Authorization':'Bearer '+self.settings.token});self.assertEqual(code,200);self.assertTrue(content.startswith(b'\x89PNG'))
        self.assertFalse((self.workspace/'ephemeral-fixture.png').exists())
        skill=self.call('/api/skills',{'name':'steer-skill','description':'For supplementary instructions','body':'Keep it short.'})
        job=self.send(chat,'[slow]');self.wait(job,lambda row:bool(row['native_turn_id']))
        selected=[{'name':skill['name'],'path':skill['path']}]
        self.call('/api/jobs/'+job['id']+'/instructions',{'text':'Shorter please','skills':selected,'client_request_id':uuid.uuid4().hex},202)
        done=self.wait(job);self.assertEqual(done['instructions'][0]['skills'],selected)
        steer=next(row for row in self.methods() if row['method']=='turn/steer')
        self.assertTrue(any(item['type']=='skill' for item in steer['params']['input']))

    def test_local_timing_collector_keeps_only_sampling_measurements(self):
        # Use the isolated Manager collector directly to avoid any external exporter.
        from lazyfish.telemetry import Timings
        store=Store(self.settings.data_dir/'lazyfish.db');chat=self.chat();job=self.wait(self.send(chat,'Measured task'))
        collector=Timings(store);self.addCleanup(collector.close)
        end=time.time_ns();span={'name':'codex.sampling','traceId':'fixture-trace','spanId':'fixture-span','startTimeUnixNano':str(end-1250000000),'endTimeUnixNano':str(end),'attributes':[{'key':'turn.id','value':{'stringValue':job['native_turn_id']}},{'key':'prompt','value':{'stringValue':'private content must not be stored'}}],'status':{'code':'STATUS_CODE_ERROR'}}
        payload={'resourceSpans':[{'scopeSpans':[{'spans':[span,{**span,'name':'unrelated','spanId':'other'}]}]}]}
        collector.record(payload);collector.record(payload)
        rows=self.call('/api/performance')['requests'];self.assertEqual(len(rows),1);self.assertEqual(rows[0]['duration_ms'],1250);self.assertTrue(rows[0]['failed'])
        with closing(store.connect()) as db:self.assertNotIn('private content',str([tuple(r) for r in db.execute('SELECT * FROM request_timings')]))

    def test_creation_retry_does_not_make_duplicate_empty_chats(self):
        key=uuid.uuid4().hex;body={'client_request_id':key,'run_settings':{'effort':'high'}}
        first=self.call('/api/conversations',body,201);second=self.call('/api/conversations',body,201)
        self.assertEqual(first['id'],second['id']);self.assertEqual(len(self.call('/api/conversations')['conversations']),1)

    def test_native_writer_affinity_does_not_block_unrelated_queued_work(self):
        self.call('/api/runtime',{'target_concurrency':2})
        a,b,c=self.chat(),self.chat(),self.chat()
        self.assertEqual(self.wait(self.send(a,'first context'))['status'],'completed')
        busy=self.send(b,'[approval]');approval=self.wait(busy,lambda row:bool(row['approvals']))['approvals'][0]
        queued=self.send(a,'[remember]');self.assertEqual(queued['status'],'queued')
        unrelated=self.send(c,'unrelated conversation');self.assertEqual(self.wait(unrelated)['status'],'completed')
        self.assertEqual(self.call('/api/jobs/'+queued['id'])['status'],'queued')
        self.call('/api/jobs/'+busy['id']+'/approvals',{'id':approval['id'],'decision':0})
        done=self.wait(queued);self.assertIn('first context',done['items'][-1]['text'])
        self.assertEqual(sum(row['method']=='initialize' for row in self.methods()),2)

    def test_reducing_concurrency_drains_busy_slots_without_interrupting_them(self):
        self.call('/api/runtime',{'target_concurrency':2})
        running=[self.send(self.chat(),'[approval]') for _ in range(2)]
        approvals=[self.wait(job,lambda row:bool(row['approvals']))['approvals'][0] for job in running]
        resized=self.call('/api/runtime',{'target_concurrency':1});self.assertEqual(len(resized['slots']),2)
        self.assertTrue(resized['slots'][1]['retiring'])
        queued=self.send(self.chat(),'run after an eligible slot frees');self.assertEqual(queued['status'],'queued')
        self.assertFalse(any(row['method']=='turn/interrupt' for row in self.methods()))
        for job,approval in zip(running,approvals):self.call('/api/jobs/'+job['id']+'/approvals',{'id':approval['id'],'decision':0})
        self.assertEqual(self.wait(queued)['status'],'completed')
        deadline=time.monotonic()+4
        while time.monotonic()<deadline:
            if len(self.call('/api/runtime')['slots'])==1:break
            time.sleep(.03)
        self.assertEqual(len(self.call('/api/runtime')['slots']),1)

    def test_restart_recovers_running_and_queued_jobs_without_automatic_replay(self):
        from lazyfish import runtime
        self.call('/api/runtime',{'target_concurrency':1})
        a=self.chat();saved=self.wait(self.send(a,'saved native context'));thread=saved['native_thread_id']
        running=self.send(self.chat(),'[approval]');self.wait(running,lambda row:bool(row['approvals']))
        queued=self.send(self.chat(),'preserve this queued prompt');self.assertEqual(queued['status'],'queued')
        old_count=sum(row['method']=='turn/start' for row in self.methods())
        self.process.kill();self.process.wait(timeout=5)
        self.process=subprocess.Popen(self.command('serve'),stdout=self.output,stderr=self.output,start_new_session=True)
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            metadata=runtime.request(self.settings)
            if metadata:break
            if self.process.poll() is not None:self.fail(self.output_path.read_text())
            time.sleep(.05)
        self.assertTrue(metadata)
        self.port=json.loads((self.settings.runtime_dir/'service.json').read_text())['port']
        self.assertEqual(self.call('/api/jobs/'+running['id'])['status'],'interrupted')
        pending=self.call('/api/jobs/'+queued['id']);self.assertEqual(pending['status'],'interrupted');self.assertEqual(pending['prompt'],'preserve this queued prompt')
        self.assertEqual(self.call('/api/conversations/'+a)['native_thread_id'],thread)
        self.assertEqual(sum(row['method']=='turn/start' for row in self.methods()),old_count)
        self.assertFalse(self.call('/api/status')['execution']['recovery_blocked'])
        self.assertIn('saved native context',self.wait(self.send(a,'[remember]'))['items'][-1]['text'])
