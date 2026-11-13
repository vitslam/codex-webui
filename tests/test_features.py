"""Native metadata, local attachment/skill inputs and persistent context usage."""
import base64
import json
from pathlib import Path
import time
import uuid
from urllib.parse import quote

from test_service import ServiceCase

PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII='


class FeatureTests(ServiceCase):
    def call(self,path,body=None,expected=200):
        code,_,data=self.http(path,'POST' if body is not None else 'GET',body,{'Authorization':'Bearer '+self.settings.token})
        result=json.loads(data);self.assertEqual(code,expected,result);return result

    def finish(self,job):
        deadline=time.monotonic()+8
        while time.monotonic()<deadline:
            value=self.call('/api/jobs/'+job['id'])
            if value['status'] not in ('queued','running','cancelling'):return value
            time.sleep(.03)
        self.fail('Task did not finish')

    def test_metadata_is_authenticated_sanitized_cached_and_never_runs_a_turn(self):
        self.assertEqual(self.http('/api/native/usage')[0],401)
        usage=self.call('/api/native/usage');self.assertEqual(usage['windows'][1]['remaining_percent'],67)
        self.assertEqual(usage,self.call('/api/native/usage'))
        account=self.call('/api/native/account');self.assertEqual(account['account']['email'],'demo@example.invalid')
        connections=self.call('/api/native/connections');self.assertEqual(connections['servers'][0]['tools'],['search','read'])
        self.assertNotIn('must-never-expose',json.dumps([usage,account,connections]))
        methods=[json.loads(line)['method'] for line in (self.settings.runtime_dir/'tmp/fake-methods.jsonl').read_text().splitlines()]
        self.assertNotIn('thread/start',methods);self.assertNotIn('turn/start',methods)
        self.assertEqual(methods.count('account/rateLimits/read'),1)
        self.assertEqual(list((self.settings.runtime_dir/'jobs').glob('inspect-*')),[])

    def test_image_and_skill_reach_native_inputs_and_survive_refresh_and_branch(self):
        skill=self.call('/api/skills',{'name':'review-work','description':'Review the project','body':'Inspect the local changes.'})
        catalog=self.call('/api/native/skills')['skills'];self.assertEqual(catalog[0]['path'],skill['path'])
        self.assert_private(Path(skill['path']),0o600)
        image=self.call('/api/attachments',{'name':'tiny.png','mime':'image/png','data':PNG},201)
        self.assertEqual(self.http('/api/attachments/'+image['id'])[0],401)
        code,headers,content=self.http('/api/attachments/'+image['id'],headers={'Authorization':'Bearer '+self.settings.token})
        self.assertEqual(code,200);self.assertEqual(content,base64.b64decode(PNG));self.assertEqual(headers['Content-Type'],'image/png')
        conversation=self.call('/api/conversations',{},201)['id'];key=uuid.uuid4().hex
        payload={'text':'Review this image','images':[image['id']],'skills':[{'name':skill['name'],'path':skill['path']}],'client_request_id':key}
        job=self.call('/api/conversations/'+conversation+'/turns',payload,202)
        done=self.finish(job);self.assertEqual(done['status'],'completed',done)
        self.assertEqual(done['inputs']['images'][0]['id'],image['id'])
        retry=self.call('/api/conversations/'+conversation+'/turns',payload,202);self.assertEqual(retry['id'],job['id'])
        self.call('/api/conversations/'+conversation+'/turns',{**payload,'images':[]},409)
        history=self.call('/api/conversations/'+conversation);self.assertEqual(history['context']['used'],3200)
        self.assertEqual(history['context']['window'],10000)
        self.assertEqual(history['jobs'][0]['inputs'],done['inputs'])
        events=self.call('/api/jobs/'+job['id'])
        self.assertTrue(any(i['kind']=='skill' for i in events['items']))
        methods=[json.loads(line) for line in (self.settings.runtime_dir/'tmp/fake-methods.jsonl').read_text().splitlines()]
        inputs=next(m['params']['input'] for m in methods if m['method']=='turn/start')
        self.assertEqual([i['type'] for i in inputs],['text','localImage','text','skill'])
        self.assertEqual(inputs[-1]['path'],skill['path']);self.assert_private(Path(inputs[1]['path']),0o600)
        boundary=self.call('/api/conversations/'+conversation+'/turns',{'text':'next','client_request_id':uuid.uuid4().hex},202);self.finish(boundary)
        branch=self.call('/api/conversations/'+conversation+'/branch',{'before_job_id':boundary['id'],'client_request_id':uuid.uuid4().hex,'title':'branch'},201)
        branch_history=self.call('/api/conversations/'+branch['id']);self.assertEqual(branch_history['jobs'][0]['inputs'],done['inputs'])
        self.assertIsNone(branch_history['context'])  # Do not invent usage for a newly forked native session.

    def test_input_and_workspace_boundaries_and_skill_edits(self):
        child=self.workspace/'child';child.mkdir()
        conversation=self.call('/api/conversations',{'workspace':str(child)},201)['id']
        self.call('/api/conversations',{'workspace':str(self.root)},409)
        self.call('/api/conversations',{'workspace':'../'},409)
        self.call('/api/conversations/'+conversation+'/settings',{'workspace':str(self.workspace)})
        self.call('/api/attachments',{'name':'fake.png','mime':'image/png','data':base64.b64encode(b'not png').decode()},400)
        self.call('/api/attachments',{'name':'evil.svg','mime':'image/svg+xml','data':PNG},400)
        self.call('/api/skills',{'name':'../escape','description':'bad','body':'bad'},409)
        skill=self.call('/api/skills',{'name':'example','description':'first','body':'First body'})
        self.call('/api/skills',{'name':'example','description':'second','body':'Second body'},409)
        document=self.call('/api/skills/document?path='+quote(skill['path']))
        self.call('/api/skills/source',{'path':skill['path'],'hash':document['hash'],'content':'---\nname: "example"\ndescription: "second"\n---\n\nSecond body\n'})
        content=self.call('/api/skills/document?path='+quote(skill['path']))
        self.assertIn('Second body',content['content']);self.assertEqual(content['description'],'second')
        self.call('/api/skills/enabled',{'path':skill['path'],'enabled':False})
        self.assertFalse(self.call('/api/native/skills')['skills'][0]['enabled'])
        self.call('/api/skills/enabled',{'path':skill['path'],'enabled':True})
        self.call('/api/skills/document?path='+quote(str(self.config)),expected=409)
        (self.workspace/'.agents/skills/linked').symlink_to(self.root,target_is_directory=True)
        self.call('/api/skills',{'name':'linked','description':'unsafe','body':'unsafe'},409)
        self.call('/api/conversations/'+conversation+'/turns',{'text':'bad','client_request_id':uuid.uuid4().hex,'skills':[{'name':'example','path':str(self.config)}]},409)
        job=self.call('/api/conversations/'+conversation+'/turns',{'text':'ok','client_request_id':uuid.uuid4().hex},202);self.finish(job)
        self.assertEqual(self.call('/api/conversations/'+conversation+'/settings',{'workspace':str(child)})['workspace'],str(child.resolve()))

    def test_unsupported_metadata_is_explicit_without_raw_native_errors(self):
        self.binary.write_text(self.binary.read_text().replace('method == "account/rateLimits/read"','method == "account/rateLimits/unsupported"'))
        result=self.call('/api/native/usage',expected=409)
        self.assertEqual(result,{'error':'native_metadata_unavailable'})
        self.assertEqual(list((self.settings.runtime_dir/'jobs').glob('inspect-*')),[])

    def test_skill_discovery_reports_bounded_errors_without_native_contents(self):
        skills=[{'name':'skill-'+str(i),'path':str(self.workspace/('skill-'+str(i))/'SKILL.md')}
                for i in range(301)]
        errors=[{'path':str(self.workspace/'broken'/'SKILL.md'),
                 'message':message,'secret':'native-private-value'} for message in (
                     'missing required field name: native-private-value',
                     'description is required: native-private-value',
                     'invalid YAML frontmatter: native-private-value',
                     'permission denied while reading native-private-value',
                     'native-private-value')]
        errors += [{'path':'invalid\npath','message':'native-private-value'}]*16
        fixture=self.settings.runtime_dir/'tmp/skills-result.json'
        def refresh():
            result=self.call('/api/native/skills?refresh=1')
            deadline=time.monotonic()+5
            while result.get('refreshing') and time.monotonic()<deadline:
                time.sleep(.03);result=self.call('/api/native/skills')
            self.assertFalse(result.get('refreshing'))
            return result
        fixture.write_text(json.dumps({'data':[{'skills':skills,'errors':[]},
                                              {'skills':[],'errors':errors}]}))
        result=refresh()
        self.assertEqual(len(result['skills']),300);self.assertTrue(result['truncated'])
        self.assertEqual(len(result['errors']),20);self.assertTrue(result['errors_truncated'])
        self.assertEqual([e['reason'] for e in result['errors'][:5]],
                         ['missing_name','missing_description','invalid_metadata','read_failed','load_failed'])
        self.assertEqual(result['errors'][5]['path'],'')
        self.assertNotIn('native-private-value',json.dumps(result))
        self.assertTrue(all(set(e)=={'path','reason'} for e in result['errors']))
        # Exactly the limit is complete, not truncated; clean refresh clears errors.
        fixture.write_text(json.dumps({'data':[{'skills':skills[:300],'errors':[]}]}))
        clean=refresh()
        self.assertFalse(clean['truncated']);self.assertFalse(clean['errors_truncated'])
        self.assertEqual(clean['errors'],[])
        fixture.write_text(json.dumps({'data':[{'skills':[],'errors':errors[:1]}]}))
        failed=refresh()
        self.assertEqual(failed['skills'],[]);self.assertEqual(len(failed['errors']),1)

    def test_shutdown_reaps_an_in_progress_metadata_process(self):
        import threading
        from lazyfish.processes import identity
        self.binary.write_text(self.binary.read_text().replace('elif method == "account/rateLimits/read":','elif method == "account/rateLimits/read":\n                time.sleep(20)'))
        def read():
            try: self.http('/api/native/usage',headers={'Authorization':'Bearer '+self.settings.token})
            except OSError: pass
        requester=threading.Thread(target=read,daemon=True);requester.start()
        deadline=time.monotonic()+5;records=[]
        while time.monotonic()<deadline:
            records=list((self.settings.runtime_dir/'jobs').glob('inspect-*.json'))
            if records: break
            time.sleep(.02)
        self.assertTrue(records)
        record=json.loads(records[0].read_text())
        self.process.terminate();self.process.wait(timeout=8);requester.join(timeout=4)
        self.assertIsNone(identity(record['pid']))
        self.assertEqual(list((self.settings.runtime_dir/'jobs').glob('inspect-*')),[])

    def test_model_capabilities_and_fast_mode_are_transmitted_and_idempotent(self):
        catalog=self.call('/api/native/models')
        default=catalog['models'][0]
        self.assertEqual(default['name'],'Fixture Model')
        self.assertEqual(default['levels'],['low','medium','high','xhigh','max','ultra'])
        self.assertEqual(default['default_effort'],'medium')
        self.assertEqual(catalog['defaults']['model'],'fixture-model')
        conversation=self.call('/api/conversations',{},201)['id']
        for fast in [True,False]:
            payload={'text':'speed','client_request_id':uuid.uuid4().hex,'fast_mode':fast}
            result=self.call('/api/conversations/'+conversation+'/turns',payload,202);self.finish(result)
            self.assertEqual(self.call('/api/jobs/'+result['id'])['inputs']['fast_mode'],fast)
            self.call('/api/conversations/'+conversation+'/turns',{**payload,'fast_mode':not fast},409)
        methods=[json.loads(line) for line in (self.settings.runtime_dir/'tmp/fake-methods.jsonl').read_text().splitlines()]
        turns=[m['params'] for m in methods if m['method']=='turn/start']
        self.assertEqual([v['serviceTierForTurn'] for v in turns],['fast','default'])
        self.call('/api/conversations/'+conversation+'/turns',{'text':'bad','client_request_id':uuid.uuid4().hex,'fast_mode':'yes'},400)

    def test_manual_compaction_preserves_history_and_native_identity(self):
        conversation=self.call('/api/conversations',{},201)['id']
        self.call('/api/conversations/'+conversation+'/compact',{'client_request_id':uuid.uuid4().hex},409)
        job=self.call('/api/conversations/'+conversation+'/turns',{'text':'keep this history','client_request_id':uuid.uuid4().hex},202)
        self.finish(job)
        original=self.call('/api/conversations/'+conversation)
        key=uuid.uuid4().hex
        compact=self.call('/api/conversations/'+conversation+'/compact',{'client_request_id':key},202)
        completed=self.finish(compact)
        self.assertEqual(completed['status'],'completed')
        self.assertEqual(completed['inputs']['operation'],'compact')
        self.assertEqual(self.call('/api/conversations/'+conversation+'/compact',{'client_request_id':key},202)['id'],compact['id'])
        after=self.call('/api/conversations/'+conversation)
        self.assertEqual(after['native_thread_id'],original['native_thread_id'])
        self.assertEqual(after['jobs'][0]['prompt'],'keep this history')
        self.assertEqual(after['context']['used'],1200)
        methods=[json.loads(line) for line in (self.settings.runtime_dir/'tmp/fake-methods.jsonl').read_text().splitlines()]
        self.assertEqual(sum(m['method']=='turn/start' for m in methods),1)
        self.assertEqual(sum(m['method']=='thread/compact/start' for m in methods),1)
        self.assertTrue(any(item['kind']=='compact' and item['status']=='completed' for item in completed['items']))

    def test_permission_presets_plan_mode_and_idle_workspace_change(self):
        conversation=self.call('/api/conversations',{},201)['id']
        expected={'ask':('workspace-write','on-request','user'),'read_only':('read-only','on-request','user'),
                  'auto_review':('workspace-write','on-request','auto_review'),'full_access':('danger-full-access','never','user')}
        for preset in [*expected,'custom']:
            job=self.call('/api/conversations/'+conversation+'/turns',{'text':'permissions','client_request_id':uuid.uuid4().hex,'permission_mode':preset,'collaboration_mode':'plan'},202)
            result=self.finish(job);self.assertEqual(result['status'],'completed')
        methods=[json.loads(line) for line in (self.settings.runtime_dir/'tmp/fake-methods.jsonl').read_text().splitlines()]
        starts=[m['params'] for m in methods if m['method'] in ('thread/start','thread/resume')]
        for params,preset in zip(starts,expected):
            self.assertEqual((params['sandbox'],params['approvalPolicy'],params['approvalsReviewer']),expected[preset])
        turns=[m['params'] for m in methods if m['method']=='turn/start']
        self.assertTrue(all(v['collaborationMode']['mode']=='plan' and v['collaborationMode']['settings']['model']=='fixture-model' for v in turns))
        for field,bad in [('permission_mode','admin'),('collaboration_mode',True)]:
            self.call('/api/conversations/'+conversation+'/turns',{'text':'bad','client_request_id':uuid.uuid4().hex,field:bad},400)
        job=self.call('/api/conversations/'+conversation+'/turns',{'text':'[slow]','client_request_id':uuid.uuid4().hex},202)
        self.call('/api/conversations/'+conversation+'/settings',{'workspace':str(self.workspace)},409)
        self.call('/api/conversations/'+conversation+'/compact',{'client_request_id':uuid.uuid4().hex},409)
        self.call('/api/jobs/'+job['id']+'/cancel',{})
        self.finish(job)

    def test_archive_restore_preserves_history_settings_and_native_identity(self):
        from lazyfish.storage import Store
        from urllib.parse import urlencode
        store=Store(self.settings.data_dir/'lazyfish.db')
        conversation=self.call('/api/conversations',{'title':'Restore this chat'},201)['id']
        self.call('/api/conversations/'+conversation+'/settings',{'pinned':True})
        job=self.call('/api/conversations/'+conversation+'/turns',{'text':'Preserved body phrase','client_request_id':uuid.uuid4().hex},202)
        self.finish(job)
        before=self.call('/api/conversations/'+conversation)
        self.assertEqual(self.http('/api/conversations/archived')[0],401)
        self.call('/api/conversations/'+conversation+'/archive',{})
        self.call('/api/conversations/'+conversation,expected=404)
        self.assertEqual(self.call('/api/conversations')['conversations'],[])
        archived=self.call('/api/conversations/archived?'+urlencode({'q':'body phrase','workspace':str(self.workspace)}))
        self.assertEqual([row['id'] for row in archived['conversations']],[conversation])
        self.assertEqual(archived['workspaces'],[str(self.workspace)])
        self.call('/api/conversations/'+conversation+'/restore',{})
        self.call('/api/conversations/'+conversation+'/restore',{})  # Retry is safe.
        after=self.call('/api/conversations/'+conversation)
        for key in ('native_thread_id','jobs','run_settings','pinned','pin_order'):
            self.assertEqual(after[key],before[key])
        self.assertEqual(self.call('/api/conversations/archived')['conversations'],[])
        self.call('/api/conversations/'+'0'*32+'/restore',{},404)
        busy,_=store.reserve(conversation,'fixture',uuid.uuid4().hex,'Still running',None,None,queued=True)
        self.call('/api/conversations/'+conversation+'/archive',{},409)
        store.finish(busy['id'],'cancelled')

    def test_archived_pagination_filters_and_cursor_validation(self):
        from lazyfish.storage import Store
        store=Store(self.settings.data_dir/'lazyfish.db')
        for index in range(4):
            chat=store.create_conversation(str(self.workspace),'Archived '+str(index));store.archive(chat['id'])
        rows=[];path='/api/conversations/archived?limit=2'
        while path:
            page=self.call(path);rows.extend(page['conversations'])
            self.assertEqual(page['counts'],{str(self.workspace):4})
            path='/api/conversations/archived?limit=2&cursor='+quote(page['next_cursor']) if page['next_cursor'] else None
        self.assertEqual(len({row['id'] for row in rows}),4)
        self.assertEqual(len(self.call('/api/conversations/archived?q=Archived%201')['conversations']),1)
        self.assertEqual(self.call('/api/conversations/archived?workspace=missing')['conversations'],[])
        self.call('/api/conversations/archived?cursor=bad',expected=400)
        self.call('/api/conversations/archived?limit=0',expected=400)
        self.call('/api/conversations/archived?q='+('x'*201),expected=400)

    def test_activity_content_search_and_local_delete(self):
        activity=self.call('/api/native/activity')
        self.assertEqual(activity['summary'],{'lifetimeTokens':12345,'currentStreakDays':3})
        self.assertNotIn('must-never-expose',json.dumps(activity))
        conversation=self.call('/api/conversations',{'title':'different title'},201)['id']
        job=self.call('/api/conversations/'+conversation+'/turns',{'text':'a unique phrase in the body','client_request_id':uuid.uuid4().hex},202)
        self.finish(job)
        result=self.call('/api/conversations?q=unique%20phrase')
        self.assertEqual([c['id'] for c in result['conversations']],[conversation])
        self.assertIn('unique phrase',result['conversations'][0]['snippet'])
        native=self.call('/api/conversations/'+conversation)['native_thread_id']
        self.call('/api/conversations/'+conversation+'/delete',{})
        self.assertEqual(self.call('/api/conversations?q=unique%20phrase')['conversations'],[])
        # App deletion is non-destructive: original history/native thread remain intact.
        self.call('/api/conversations/'+conversation,expected=404)
        from lazyfish.storage import Store
        from contextlib import closing
        with closing(Store(self.settings.data_dir/'lazyfish.db').connect()) as db:
            self.assertEqual(db.execute('SELECT native_thread_id FROM conversations WHERE id=?',(conversation,)).fetchone()[0],native)
            self.assertEqual(db.execute('SELECT prompt FROM jobs WHERE conversation_id=?',(conversation,)).fetchone()[0],'a unique phrase in the body')
