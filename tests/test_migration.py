"""End-to-end acceptance checks for the remaining reference features; fake CLI only."""
import json
import subprocess
import time
import uuid
from urllib.parse import quote
from contextlib import closing
from pathlib import Path
from lazyfish import runtime
from lazyfish.outputs import Outputs
from lazyfish.processes import session_members
from lazyfish.storage import Store
from test_features import FeatureTests as _Features
from test_service import ServiceCase


class MigrationTests(ServiceCase):
    call=_Features.call
    finish=_Features.finish

    def create(self):return self.call('/api/conversations',{},201)['id']
    def send(self,conversation,text,**inputs):
        return self.call('/api/conversations/'+conversation+'/turns',dict(text=text,client_request_id=uuid.uuid4().hex,**inputs),202)
    def wait(self,job,predicate):
        deadline=time.monotonic()+8
        while time.monotonic()<deadline:
            value=self.call('/api/jobs/'+job['id'])
            if predicate(value):return value
            time.sleep(.03)
        self.fail('Expected state was not reached')
    def session(self,session):
        deadline=time.monotonic()+8
        while time.monotonic()<deadline:
            value=self.call('/api/native/sessions/'+session['id'])
            if value['state'] not in ('starting','pending'):return value
            time.sleep(.04)
        self.fail('Login did not finish')

    def test_typed_outputs_markdown_download_diff_and_token_usage(self):
        subprocess.run(['git','init','-q',str(self.workspace)],check=True,capture_output=True)
        conversation=self.create();job=self.finish(self.send(conversation,'[outputs]'))
        self.assertEqual(job['status'],'completed')
        self.assertEqual(len(job['artifacts']),2)
        self.assertEqual(job['report']['token_usage'],{'input_tokens':3000,'cached_input_tokens':2400,'output_tokens':200})
        self.assertGreaterEqual(job['report']['changes']['file_count'],1)
        text=next(i['text'] for i in job['items'] if i['kind']=='assistant')
        self.assertIn('/artifacts/',text);self.assertIn('?download=1',text)
        for artifact in job['artifacts']:
            code,headers,raw=self.http(artifact['url'],headers={'Authorization':'Bearer '+self.settings.token})
            self.assertEqual(code,200);self.assertGreater(len(raw),0)
            self.assertEqual(self.http(artifact['url'])[0],401)
            if artifact['name'].endswith('.csv'):self.assertIn('attachment',headers['Content-Disposition']);self.assertEqual(raw,b'name,value\nfish,3\n')
        snapshot=json.dumps(job)
        self.assertNotIn('iVBORw0KGgo',snapshot);self.assertNotIn('must-never-expose',snapshot)
        generated=next(i['detail'] for i in job['items'] if i['id']=='typed-tool')
        self.assertEqual(generated['type'],'image_generation');self.assertEqual(generated['artifact_state'],'ready')
        report=self.call('/api/jobs/'+job['id']+'/changes')['report'];self.assertTrue(any(f['diff'] for f in report['files']))
        boundary=self.finish(self.send(conversation,'boundary'))
        branch=self.call('/api/conversations/'+conversation+'/branch',dict(before_job_id=boundary['id'],client_request_id=uuid.uuid4().hex,title='outputs branch'),201)
        cloned=self.call('/api/conversations/'+branch['id'])['jobs'][0]
        self.assertEqual(len(cloned['artifacts']),2)
        for artifact in cloned['artifacts']:self.assertIn(cloned['id'],artifact['url'])

    def test_mid_turn_steer_is_idempotent_and_does_not_start_another_turn(self):
        conversation=self.create();job=self.send(conversation,'[slow]');self.wait(job,lambda j:any(i['text'] for i in j['items']))
        payload={'text':'use the shorter approach','client_request_id':uuid.uuid4().hex}
        instruction=self.call('/api/jobs/'+job['id']+'/instructions',payload,202)
        again=self.call('/api/jobs/'+job['id']+'/instructions',payload,202);self.assertEqual(again['id'],instruction['id'])
        result=self.finish(job);self.assertEqual(result['instructions'][0]['state'],'delivered')
        self.assertIn('shorter approach',next(i['text'] for i in result['items'] if i['kind']=='assistant'))
        methods=[json.loads(line)['method'] for line in (self.settings.runtime_dir/'tmp/fake-methods.jsonl').read_text().splitlines()]
        self.assertEqual(methods.count('turn/start'),1);self.assertEqual(methods.count('turn/steer'),1)
        self.call('/api/jobs/'+job['id']+'/instructions',{'text':'late','client_request_id':uuid.uuid4().hex},409)

    def test_blocking_and_nonblocking_questions_and_private_answers(self):
        for prompt in ('[question]','[question-async]'):
            job=self.send(self.create(),prompt);snapshot=self.wait(job,lambda j:bool(j['questions']));question=snapshot['questions'][0]
            self.call('/api/jobs/'+job['id']+'/questions',{'id':question['id'],'answers':{}},409)
            private='private-answer-not-for-storage'
            answers={'color':{'answers':['Green']},'note':{'answers':[private]}}
            self.call('/api/jobs/'+job['id']+'/questions',{'id':question['id'],'answers':answers})
            result=self.finish(job);self.assertEqual(result['questions'][0]['state'],'answered')
            self.assertNotIn(private,json.dumps(result)) if prompt=='[question]' else None
            if prompt=='[question]':
                with closing(Store(self.settings.data_dir/'lazyfish.db').connect()) as db:
                    self.assertNotIn(private,'\n'.join(r[0] for r in db.execute('SELECT payload FROM events WHERE job_id=?',(job['id'],))))
        job=self.send(self.create(),'[question]');snapshot=self.wait(job,lambda j:bool(j['questions']))
        self.call('/api/jobs/'+job['id']+'/cancel',{});result=self.finish(job);self.assertEqual(result['questions'][0]['state'],'expired')
        self.call('/api/jobs/'+job['id']+'/questions',{'id':snapshot['questions'][0]['id'],'answers':{}},409)

    def test_edit_preserves_prefix_replaces_suffix_and_retries_once(self):
        conversation=self.create();first=self.finish(self.send(conversation,'first'));second=self.finish(self.send(conversation,'second'))
        third_key=uuid.uuid4().hex;third=self.finish(self.call('/api/conversations/'+conversation+'/turns',{'text':'third','client_request_id':third_key},202))
        native=self.call('/api/conversations/'+conversation)['native_thread_id'];key=uuid.uuid4().hex
        payload={'before_job_id':second['id'],'client_request_id':key,'text':'edited second'}
        edited=self.call('/api/conversations/'+conversation+'/edit',payload,202);self.finish(edited)
        self.assertEqual(self.call('/api/conversations/'+conversation+'/edit',payload,202)['id'],edited['id'])
        history=self.call('/api/conversations/'+conversation)
        self.assertEqual([j['prompt'] for j in history['jobs']],['first','edited second']);self.assertNotEqual(history['native_thread_id'],native)
        self.assertEqual(self.call('/api/jobs/'+third['id'])['prompt'],'third')
        self.call('/api/conversations/'+conversation+'/turns',{'text':'third','client_request_id':third_key},409)
        self.call('/api/conversations/'+conversation+'/branch',{'before_job_id':third['id'],'client_request_id':uuid.uuid4().hex,'title':'Stale branch'},404)
        remembered=self.finish(self.send(conversation,'[remember]'));self.assertIn('edited second',remembered['items'][-1]['text'])
        key=uuid.uuid4().hex;edited=self.call('/api/conversations/'+conversation+'/edit',{'before_job_id':first['id'],'client_request_id':key,'text':'fresh first'},202);self.finish(edited)
        self.assertEqual([j['prompt'] for j in self.call('/api/conversations/'+conversation)['jobs']],['fresh first'])

    def test_personal_skills_pin_order_and_attachment_cleanup(self):
        first,second=self.create(),self.create()
        skill=self.call('/api/skills',dict(name='personal-example',description='Shared',body='Use carefully.',scope='user'))
        self.assertTrue(Path(skill['path']).is_relative_to(Path(self.settings.secret_env['CODEX_HOME']).resolve()))
        self.assertTrue(any(s['name']=='personal-example' for s in self.call('/api/native/skills?conversation='+second)['skills']))
        read=self.call('/api/skills/document?conversation='+second+'&path='+quote(skill['path']))
        self.assertEqual(read['scope'],'user')
        result=self.finish(self.send(second,'[skill-read]',skills=[{'name':skill['name'],'path':skill['path']}]))
        self.assertEqual({i['detail']['status'] for i in result['items'] if i['kind']=='skill'},{'provided','loaded'})
        for identifier in (first,second):self.call('/api/conversations/'+identifier+'/settings',{'pinned':True})
        self.call('/api/conversations/reorder',{'ids':[first,second]})
        self.assertEqual([c['id'] for c in self.call('/api/conversations')['conversations']][:2],[first,second])
        self.call('/api/conversations/reorder',{'ids':[first,first]},409)
        store=Store(self.settings.data_dir/'lazyfish.db');unused=store.add_attachment('unused.png','image/png',b'fixture');used=store.add_attachment('used.png','image/png',b'fixture')
        with closing(store.connect()) as db,db:db.execute("UPDATE attachments SET created_at='2000-01-01'")
        job=self.send(second,'attached',images=[used['id']]);self.finish(job)
        self.assertEqual(self.call('/api/attachments/cleanup',{})['removed'],1)
        self.call('/api/attachments/'+unused['id'],expected=409)
        self.assertEqual(store.attachment(used['id'])['name'],'used.png')

    def test_pending_logins_are_discoverable_reused_and_cancellable(self):
        (self.settings.runtime_dir/'tmp/login-delay').write_text('30')
        self.assertEqual(self.http('/api/native/sessions')[0],401)
        first=self.call('/api/native/login',{'type':'chatgptDeviceCode'},202)
        duplicate=self.call('/api/native/login',{'type':'chatgpt'},202)
        self.assertEqual(duplicate['id'],first['id'])
        self.assertEqual(duplicate['user_code'],'TEST-CODE')
        sessions=self.call('/api/native/sessions')['sessions']
        self.assertEqual([s['id'] for s in sessions],[first['id']])
        self.assertNotIn('login_id',sessions[0])
        mcp=self.call('/api/native/mcp/login',{'name':'Local example'},202)
        self.assertEqual(self.call('/api/native/mcp/login',{'name':'Local example'},202)['id'],mcp['id'])
        self.assertEqual({s['kind'] for s in self.call('/api/native/sessions')['sessions']},{'account','mcp'})
        for session in (first,mcp):
            self.call('/api/native/sessions/'+session['id']+'/cancel',{})
            self.assertEqual(self.session(session)['state'],'cancelled')
        self.assertEqual(self.call('/api/native/sessions')['sessions'],[])
        methods=[json.loads(line)['method'] for line in (self.settings.runtime_dir/'tmp/fake-methods.jsonl').read_text().splitlines()]
        self.assertEqual(methods.count('account/login/start'),1)
        self.assertEqual(methods.count('mcpServer/oauth/login'),1)

    def test_native_account_and_mcp_login_completion_cancel_and_busy(self):
        session=self.call('/api/native/login',{'type':'chatgptDeviceCode'},202)
        self.assertEqual(session['user_code'],'TEST-CODE');self.assertEqual(self.session(session)['state'],'completed')
        session=self.call('/api/native/login',{'type':'apiKey','apiKey':'test-key-not-real'},202)
        self.assertEqual(session['state'],'completed');self.assertEqual(self.call('/api/native/account?refresh=1')['account']['type'],'apiKey')
        session=self.call('/api/native/mcp/login',{'name':'Local example'},202);self.assertEqual(self.session(session)['state'],'completed')
        session=self.call('/api/native/login',{'type':'chatgptDeviceCode'},202);self.call('/api/native/sessions/'+session['id']+'/cancel',{})
        self.assertEqual(self.session(session)['state'],'cancelled')
        job=self.send(self.create(),'[slow]');self.wait(job,lambda j:bool(j['native_thread_id']))
        self.call('/api/native/login',{'type':'logout'},409)
        self.call('/api/jobs/'+job['id']+'/cancel',{});self.finish(job)

    def test_generic_outputs_block_private_paths_and_snapshot_linked_files(self):
        job=self.finish(self.send(self.create(),'output boundaries'))
        store=Store(self.settings.data_dir/'lazyfish.db')
        output_root=self.settings.data_dir/'outputs'/job['id'];output_root.mkdir(parents=True,exist_ok=True)
        outputs=Outputs(store,job['id'],self.workspace,output_root,[self.settings.data_dir])
        secret=self.workspace/'.env';secret.write_text('private credential')
        escape=self.workspace/'escape.txt';escape.symlink_to(self.settings.data_dir/'lazyfish.db')
        private=f'[secret]({secret}) [escape]({escape})'
        self.assertEqual(outputs.rewrite(private),private)
        report=self.workspace/'report.txt';report.write_text('original output')
        linked=outputs.rewrite('[report](report.txt)')
        report.write_text('later workspace edit')
        artifact=store.job(job['id'])['artifacts'][0]
        self.assertIn(artifact['url'],linked)
        self.assertEqual(store.output_artifact(job['id'],artifact['hash'])['content'],b'original output')
        self.assertEqual(outputs.rewrite('`[report](report.txt)`'),'`[report](report.txt)`')

    def test_crashed_service_cleans_owned_login_without_replaying_it(self):
        conversation=self.create();saved=self.finish(self.send(conversation,'keep existing history'))
        session=self.call('/api/native/login',{'type':'chatgptDeviceCode'},202)
        journal=self.settings.runtime_dir/'jobs'/('auth-'+session['id']+'.json')
        record=json.loads(journal.read_text())
        self.process.kill();self.process.wait(timeout=5)
        self.process=subprocess.Popen(self.command('serve'),stdout=self.output,stderr=self.output,start_new_session=True)
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            metadata=runtime.request(self.settings)
            if metadata:
                self.port=json.loads(self.metadata_path.read_text())['port'];break
            time.sleep(.03)
        else:self.fail('Service did not recover')
        self.assertFalse(journal.exists())
        self.assertFalse(session_members(record['pid'],record['start_ticks']))
        self.assertEqual(self.call('/api/conversations/'+conversation)['jobs'][0]['id'],saved['id'])
        self.assertFalse(self.call('/api/status')['execution']['recovery_blocked'])
        self.call('/api/native/sessions/'+session['id'],expected=404)
        methods=[json.loads(line)['method'] for line in (self.settings.runtime_dir/'tmp/fake-methods.jsonl').read_text().splitlines()]
        self.assertEqual(methods.count('account/login/start'),1)


del _Features
