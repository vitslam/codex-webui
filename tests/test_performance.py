"""Cache, query-volume and deferred transport regressions; no native inference."""
import json
import threading
import time
import uuid
from unittest.mock import patch

from lazyfish.execution import Manager
from lazyfish.storage import Store,StoreError
from support import IsolatedTest
from test_service import ServiceCase


class MetadataCacheTests(IsolatedTest):
    def manager(self):
        manager=Manager(self.settings,uuid.uuid4().hex)
        self.addCleanup(manager.shutdown)
        return manager

    def test_snapshots_persist_and_global_metadata_is_shared_across_workspaces(self):
        first=self.manager();calls=[]
        first.capabilities.query=lambda section,cwd:(calls.append((section,cwd)) or {'windows':[{'remaining_percent':77}]})
        saved=first.capabilities.read('usage',str(self.workspace))
        self.assertEqual(first.capabilities.read('usage',str(self.workspace/'another')),saved)
        self.assertEqual(len(calls),1)
        second=self.manager()
        with patch.object(second.capabilities,'query',side_effect=AssertionError('Warm restart must reuse saved metadata')):
            self.assertEqual(second.capabilities.snapshot('usage',str(self.workspace))['windows'],saved['windows'])
        self.assertEqual(first.capabilities.scope,second.capabilities.scope)

    def test_stale_reads_return_while_refreshing_and_coalesce_even_with_the_native_lock_held(self):
        manager=self.manager();cap=manager.capabilities
        cap.query=lambda *args:{'windows':[{'remaining_percent':77}]}
        cap.read('usage',str(self.workspace))
        key=cap.key('usage',str(self.workspace));stamp,value=cap.cache[key];cap.cache[key]=(0,value)
        entered=threading.Event();release=threading.Event();self.addCleanup(release.set);calls=[]
        def delayed(*args):
            calls.append(1);entered.set();release.wait(5)
            return {'windows':[{'remaining_percent':66}]}
        cap.query=delayed
        result=cap.snapshot('usage',str(self.workspace))
        self.assertTrue(entered.wait(2));self.assertTrue(result['refreshing'])
        done=cap.inflight[key][1]
        for _ in range(4):
            started=time.monotonic();result=cap.snapshot('usage',str(self.workspace/'other'),True)
            self.assertLess(time.monotonic()-started,.2)
            self.assertEqual(result['windows'][0]['remaining_percent'],77)
        release.set();self.assertTrue(done.wait(3));self.assertEqual(len(calls),1)
        self.assertEqual(cap.snapshot('usage',str(self.workspace))['windows'][0]['remaining_percent'],66)

    def test_failed_refresh_retains_saved_values_and_account_invalidation_rejects_late_results(self):
        manager=self.manager();cap=manager.capabilities
        cap.query=lambda *args:{'windows':[{'remaining_percent':77}]}
        cap.read('usage',str(self.workspace))
        with patch.object(cap,'query',side_effect=ValueError('private native failure')):
            with self.assertRaises(StoreError):cap.read('usage',str(self.workspace),True)
        old_scope=cap.scope
        result=cap.snapshot('usage',str(self.workspace))
        self.assertEqual(result['windows'][0]['remaining_percent'],77);self.assertEqual(result['error'],'native_metadata_unavailable')
        release=threading.Event();entered=threading.Event();self.addCleanup(release.set)
        def delayed(*args):
            entered.set();release.wait(5)
            return {'windows':[{'remaining_percent':1}]}
        cap.query=delayed;done=cap.request('usage',str(self.workspace),True);self.assertTrue(entered.wait(2))
        cap.invalidate();release.set();self.assertTrue(done.wait(3))
        self.assertNotEqual(cap.scope,old_scope);self.assertIsNone(cap.cached(('usage','')))
        self.assertIsNone(manager.store.metadata('usage',old_scope+'|'))

    def test_skill_changes_reject_inflight_old_catalogs(self):
        manager=self.manager();cap=manager.capabilities;cwd=str(self.workspace)
        cap.query=lambda *args:{'skills':[{'name':'old'}]}
        cap.read('skills',cwd)
        release=threading.Event();entered=threading.Event();self.addCleanup(release.set);calls=[]
        def query(*args):
            calls.append(1)
            if len(calls)==1:
                entered.set();release.wait(5);return {'skills':[{'name':'old'}]}
            return {'skills':[{'name':'new'}]}
        cap.query=query;old=cap.request('skills',cwd,True);self.assertTrue(entered.wait(2))
        cap.invalidate_section('skills');new=cap.request('skills',cwd,True);release.set()
        self.assertTrue(old.wait(3));self.assertTrue(new.wait(3))
        self.assertEqual(cap.read('skills',cwd)['skills'][0]['name'],'new')


class PerformanceAPITests(ServiceCase):
    def test_versioned_assets_are_reusable_and_data_remains_private(self):
        code,headers,body=self.http('/app.js')
        self.assertEqual(code,200);self.assertEqual(headers['Cache-Control'],'no-cache')
        etag=headers['ETag']
        code,headers,body=self.http('/app.js?v='+etag.strip('"'))
        self.assertIn('immutable',headers['Cache-Control'])
        self.assertEqual(self.http('/app.js',headers={'If-None-Match':etag})[0],304)
        html=self.http('/')[2].decode();self.assertIn('/app.js?v=',html)
        code,headers,_=self.http('/api/status',headers={'Authorization':'Bearer '+self.settings.token})
        self.assertEqual(code,200);self.assertEqual(headers['Cache-Control'],'no-store')

    def test_history_batches_queries_and_defers_process_payloads_without_losing_prose(self):
        store=Store(self.settings.data_dir/'lazyfish.db');conversation=store.create_conversation(str(self.workspace))
        for n in range(30):
            job,_=store.reserve(conversation['id'],'fixture',uuid.uuid4().hex,'Prompt',None,None)
            for i in range(5):
                store.item(job['id'],str(i),'command','echo fixture\n'+'large output '*300,'completed')
                store.detail(job['id'],str(i),{'type':'command_execution','command':'echo fixture','aggregated_output':'large output '*300})
            store.item(job['id'],'reply','assistant','Saved final answer','completed');store.finish(job['id'],'completed')
        connect=store.connect;counts={'connections':0,'selects':0}
        def counted():
            counts['connections']+=1;db=connect()
            def trace(sql):
                if sql.lstrip().upper().startswith('SELECT'):counts['selects']+=1
            db.set_trace_callback(trace);return db
        store.connect=counted
        full=store.history(conversation['id']);self.assertEqual(counts['connections'],1);self.assertLess(counts['selects'],25)
        summary=store.history(conversation['id'],summary=True)
        self.assertLess(len(json.dumps(summary)),len(json.dumps(full))*.25)
        self.assertTrue(all(job['steps_deferred'] for job in summary['jobs']))
        self.assertTrue(all([item['text'] for item in job['items']]==['Saved final answer'] for job in summary['jobs']))
        auth={'Authorization':'Bearer '+self.settings.token};identifier=summary['jobs'][0]['id']
        path='/api/jobs/'+identifier+'/steps'
        self.assertEqual(self.http(path)[0],401)
        code,_,raw=self.http(path+'?offset=0&through=3',headers=auth);page=json.loads(raw)
        self.assertEqual(code,200);self.assertEqual(len(page['items']),3);self.assertFalse(page['has_more'])
        self.assertIn('large output',page['items'][0]['detail']['aggregated_output'])
        self.assertEqual(self.http(path+'?offset=-1',headers=auth)[0],400)
