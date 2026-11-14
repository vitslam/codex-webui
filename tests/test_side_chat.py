"""Independent side discussions use immutable bounded snapshots and the normal scheduler."""
import json
import sqlite3
import time
import uuid
from contextlib import closing

from lazyfish.storage import Store, open_store
from support import IsolatedTest
from test_service import ServiceCase
import test_features


class SideChatTests(ServiceCase):
    call=test_features.FeatureTests.call
    finish=test_features.FeatureTests.finish

    def seed(self):
        store=Store(self.settings.data_dir/'lazyfish.db')
        parent=store.create_conversation(str(self.workspace),'Main task',{'model':'fixture-model','effort':'high'})
        job,_=store.reserve(parent['id'],'fixture',uuid.uuid4().hex,'Original parent question',None,None)
        store.item(job['id'],'reply','assistant','Saved parent explanation','completed');store.finish(job['id'],'completed')
        return store,parent,job

    def side(self,parent,**extra):
        return self.call('/api/conversations/'+parent+'/side-chat',dict(client_request_id=uuid.uuid4().hex,**extra))['conversation']

    def test_snapshot_independent_native_thread_history_and_visibility(self):
        store,parent,original=self.seed();pid=parent['id']
        self.assertIsNone(self.call('/api/conversations/'+pid+'/side-chat')['conversation'])
        side=self.side(pid);sid=side['id'];self.assertNotEqual(sid,pid)
        self.assertEqual(side['side_parent_id'],pid);self.assertNotIn('side_snapshot',side)
        self.assertEqual(side['workspace'],parent['workspace']);self.assertEqual(side['run_settings'],store.conversation(pid)['run_settings'])
        self.assertEqual(self.side(pid)['id'],sid)
        later,_=store.reserve(pid,'fixture',uuid.uuid4().hex,'A later parent question',None,None)
        store.item(later['id'],'later','assistant','Do not leak this future reply','completed');store.finish(later['id'],'completed')
        refs=[{'text':'Saved parent explanation','role':'assistant'}]
        payload=dict(text='Explain the selected passage',quotes=refs,client_request_id=uuid.uuid4().hex)
        job=self.call('/api/conversations/'+sid+'/turns',payload,202);done=self.finish(job)
        self.assertEqual(done['status'],'completed');self.assertEqual(done['inputs']['quotes'],refs)
        self.assertEqual(self.call('/api/conversations/'+sid+'/turns',payload,202)['id'],job['id'])
        saved=store.conversation(sid);self.assertTrue(saved['native_thread_id'])
        methods=[json.loads(line) for line in (self.settings.runtime_dir/'tmp/fake-methods.jsonl').read_text().splitlines()]
        content=next(m['params']['input'] for m in methods if m['method']=='turn/start')
        snapshot=content[0]['text'];self.assertIn('Original parent question',snapshot);self.assertIn('Saved parent explanation',snapshot)
        self.assertNotIn('future reply',snapshot);self.assertNotIn('A later parent question',snapshot)
        self.assertFalse(any(m['method']=='thread/fork' for m in methods))
        next_job=self.call('/api/conversations/'+sid+'/turns',dict(text='One more side question',client_request_id=uuid.uuid4().hex),202);self.finish(next_job)
        methods=[json.loads(line) for line in (self.settings.runtime_dir/'tmp/fake-methods.jsonl').read_text().splitlines()]
        inputs=[m['params']['input'] for m in methods if m['method']=='turn/start']
        self.assertFalse(any('separate side discussion' in item.get('text','') for item in inputs[-1]))
        self.assertEqual([j['id'] for j in store.history(pid)['jobs']],[original['id'],later['id']])
        self.assertEqual([c['id'] for c in store.conversation_page()['conversations']],[pid])
        self.assertEqual(store.conversation_projects()[0]['count'],1)
        self.assertEqual(store.conversation_page(query='Explain the selected passage')['conversations'],[])
        self.assertEqual([c['id'] for c in store.conversations()],[pid])
        self.assertEqual(self.call('/api/conversations/'+pid+'/side-chat')['conversation']['jobs'][-1]['id'],next_job['id'])
        store.archive(pid);self.assertEqual(store.archived_page()['counts'],{str(self.workspace):1});store.restore(pid)
        self.assertEqual(self.side(pid)['id'],sid)

    def test_fresh_is_idempotent_nested_side_chats_are_rejected(self):
        store,parent,_=self.seed();pid=parent['id'];first=self.side(pid)
        payload=dict(client_request_id=uuid.uuid4().hex,fresh=True);route='/api/conversations/'+pid+'/side-chat'
        fresh=self.call(route,payload)['conversation'];self.assertNotEqual(fresh['id'],first['id'])
        self.assertEqual(self.call(route,payload)['conversation']['id'],fresh['id'])
        self.assertEqual(self.side(pid)['id'],fresh['id']);self.assertEqual(len(store.conversation_page()['conversations']),1)
        self.call('/api/conversations/'+fresh['id']+'/side-chat',dict(client_request_id=uuid.uuid4().hex),404)
        self.assertEqual(self.http(route)[0],401)
        self.call(route,dict(client_request_id='invalid',fresh=True),409)
        self.call(route,dict(client_request_id=uuid.uuid4().hex,fresh='yes'),409)

    def test_queue_and_cancel_do_not_stop_parent(self):
        store,parent,_=self.seed();pid=parent['id'];sid=self.side(pid)['id'];self.call('/api/runtime',{'target_concurrency':1})
        running=self.call('/api/conversations/'+pid+'/turns',dict(text='[slow]',client_request_id=uuid.uuid4().hex),202)
        deadline=time.monotonic()+8
        while time.monotonic()<deadline:
            if any(item['text'] for item in self.call('/api/jobs/'+running['id'])['items']):break
            time.sleep(.03)
        side=self.call('/api/conversations/'+sid+'/turns',dict(text='An independent question',client_request_id=uuid.uuid4().hex),202)
        self.assertEqual(side['status'],'queued')
        self.call('/api/conversations/'+pid+'/side-chat',dict(client_request_id=uuid.uuid4().hex,fresh=True),409)
        self.call('/api/conversations/'+pid+'/archive',{},409)
        self.call('/api/jobs/'+side['id']+'/cancel',{})
        self.assertEqual(self.finish(side)['status'],'cancelled')
        self.assertEqual(self.call('/api/jobs/'+running['id'])['status'],'running')
        self.call('/api/jobs/'+running['id']+'/cancel',{});self.finish(running)


class SideStorageTests(IsolatedTest):
    def test_schema_nine_migration_preserves_existing_history(self):
        path=self.settings.data_dir/'side-migration.db';store=Store(path)
        parent=store.create_conversation(str(self.workspace),'Saved parent');job,_=store.reserve(parent['id'],'fixture',uuid.uuid4().hex,'Saved message',None,None)
        store.item(job['id'],'reply','assistant','Saved reply','completed');store.finish(job['id'],'completed')
        with closing(sqlite3.connect(path)) as db,db:
            db.execute('DROP INDEX current_side_chat')
            for column in ('side_snapshot','side_retired','side_parent_id'):db.execute('ALTER TABLE conversations DROP COLUMN '+column)
            db.execute('PRAGMA user_version=9')
        with closing(open_store(path)) as db:self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0],10)
        self.assertEqual(Store(path).job(job['id'])['items'][0]['text'],'Saved reply')
        self.assertEqual(Store(path).conversation(parent['id'])['workspace'],str(self.workspace))

    def test_snapshot_is_bounded_and_copies_visible_partial_reply(self):
        store=Store(self.settings.data_dir/'snapshot.db');parent=store.create_conversation(str(self.workspace))
        for n in range(12):
            job,_=store.reserve(parent['id'],'fixture',uuid.uuid4().hex,'Question '+str(n),None,None)
            store.item(job['id'],'reply','assistant',('Saved passage '+str(n)+'\n')*2000,'running' if n==11 else 'completed')
            if n!=11:store.finish(job['id'],'completed')
        side=store.side_chat(parent['id'],True,uuid.uuid4().hex)
        saved=json.loads(store.conversation(side['id'])['side_snapshot'])
        self.assertTrue(saved['truncated']);self.assertIn('Saved passage 11',saved['text']);self.assertLess(len(saved['text']),120000)
        store.item(job['id'],'reply','assistant','A newly generated suffix','completed',delta=True)
        self.assertNotIn('newly generated',store.side_input_context(side['id'],'unused'))
