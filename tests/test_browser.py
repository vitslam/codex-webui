"""Optional real-browser regression suite; the service still uses only fake Codex."""
import json
import os
from pathlib import Path
import subprocess
import unittest
import uuid

from lazyfish.storage import Store
from test_service import ServiceCase


@unittest.skipUnless(all(os.environ.get(key) for key in (
    "LAZYFISH_BROWSER_NODE", "LAZYFISH_BROWSER_MODULE", "LAZYFISH_BROWSER_EXECUTABLE")),
    "Set LAZYFISH_BROWSER_NODE/MODULE/EXECUTABLE to run browser checks")
class BrowserTests(ServiceCase):
    def test_selected_passages(self):
        chats=[]
        for title in ('Selection Alpha', 'Selection Beta'):
            chat=Store(self.settings.data_dir/'lazyfish.db').create_conversation(str(self.workspace),title)
            store=Store(self.settings.data_dir/'lazyfish.db');chats.append(chat['id'])
            job,_=store.reserve(chat['id'],'fixture',uuid.uuid4().hex,'Saved question about the project',None,None)
            store.item(job['id'],'reply','assistant','Working directories define where a task starts. File access is controlled by sandbox permissions and approvals.\n\n```html\n<img src=x onerror=alert(1)>\n```','completed')
            store.finish(job['id'],'completed')
        fixture=self.root/'selection-quotes.json'
        fixture.write_text(json.dumps(dict(url=f'http://127.0.0.1:{self.port}',token=self.settings.token,main=chats[0],other=chats[1],output=os.environ.get('LAZYFISH_BROWSER_OUTPUT',str(self.root)))))
        result=subprocess.run([os.environ['LAZYFISH_BROWSER_NODE'],str(Path(__file__).with_name('selection_quotes_browser.cjs'))],env=dict(os.environ,LAZYFISH_BROWSER_FIXTURE=str(fixture)),capture_output=True,text=True,timeout=120)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn('selected passage browser checks passed',result.stdout)

    def test_search_timing_composition_stale_results_and_retry(self):
        self._display_browser('search-timing')

    def test_refresh_restores_conversation_without_welcome_flash(self):
        self._display_browser('restore')

    def test_cached_search_results_and_history_loading_feedback(self):
        self._display_browser('search-history')

    def _display_browser(self, mode):
        from contextlib import closing
        from datetime import datetime,timedelta,timezone
        store=Store(self.settings.data_dir/'lazyfish.db')
        chat=store.create_conversation(str(self.workspace),'Restored conversation')
        for index in range(125):
            job,_=store.reserve(chat['id'],'fixture',uuid.uuid4().hex,'Saved question '+str(index),None,None)
            store.item(job['id'],'reply','assistant','Saved answer '+str(index)+'\n\n'+'History paragraph. '*20,'completed');store.finish(job['id'],'completed')
        now=datetime.now(timezone.utc);old=None
        for index in range(61):
            entry=store.create_conversation(str(self.workspace),'Needle conversation '+str(index))
            stamp=now-timedelta(days=3) if index==0 else now-timedelta(minutes=index*3)
            with closing(store.connect()) as db,db:db.execute('UPDATE conversations SET updated_at=?,pinned=? WHERE id=?',(stamp.isoformat(),int(index==0),entry['id']))
            if not index:old=entry['id']
        fixture=self.root/'display-browser.json'
        fixture.write_text(json.dumps(dict(url=f'http://127.0.0.1:{self.port}',token=self.settings.token,chat=chat['id'],old=old,mode=mode)))
        script='search_timing_browser.cjs' if mode=='search-timing' else 'display_browser.cjs'
        result=subprocess.run([os.environ['LAZYFISH_BROWSER_NODE'],str(Path(__file__).with_name(script))],
                              env=dict(os.environ,LAZYFISH_BROWSER_FIXTURE=str(fixture)),capture_output=True,text=True,timeout=120)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn(mode+' checks passed',result.stdout)

    def test_project_sidebar_groups_pagination_actions_and_disclosures(self):
        fixture=self._project_sidebar_fixture()
        result=subprocess.run([os.environ['LAZYFISH_BROWSER_NODE'],str(Path(__file__).with_name('sidebar_projects_browser.cjs'))],
                              env=dict(os.environ,LAZYFISH_BROWSER_FIXTURE=str(fixture)),capture_output=True,text=True,timeout=120)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn('project sidebar checks passed',result.stdout)

    def _project_sidebar_fixture(self):
        from contextlib import closing
        store=Store(self.settings.data_dir/'lazyfish.db')
        paths=[self.workspace/'alpha/shared',self.workspace/'beta/shared',self.workspace/'old-project']
        for path in paths:path.mkdir(parents=True)
        chats=[]
        for index in range(140):
            project=0 if index<14 else 1 if index<139 else 2
            chat=store.create_conversation(str(paths[project]),('Alpha ' if project==0 else 'Beta ' if project==1 else 'Old ')+str(index));chats.append(chat['id'])
            job,_=store.reserve(chat['id'],'fixture',uuid.uuid4().hex,'Saved question',None,None)
            store.item(job['id'],'reply','assistant','Saved project answer','completed');store.finish(job['id'],'completed')
        with closing(store.connect()) as db,db:
            db.execute('UPDATE conversations SET pinned=1 WHERE id=?',(chats[13],))
            db.execute('UPDATE conversations SET updated_at=? WHERE id=?',('2000-01-01T00:00:00+00:00',chats[-1]))
        fixture=self.root/'sidebar-projects.json'
        fixture.write_text(json.dumps(dict(url=f'http://127.0.0.1:{self.port}',token=self.settings.token,chats=chats,paths=[str(p) for p in paths])))
        return fixture

    def test_file_change_footer_updates_when_language_changes(self):
        fixture=self._footer_language_fixture()
        result=subprocess.run([os.environ['LAZYFISH_BROWSER_NODE'],str(Path(__file__).with_name('footer_language_browser.cjs'))],
                              env=dict(os.environ,LAZYFISH_BROWSER_FIXTURE=str(fixture)),capture_output=True,text=True,timeout=60)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn('footer language checks passed',result.stdout)

    def _footer_language_fixture(self):
        store=Store(self.settings.data_dir/'lazyfish.db')
        chat=store.create_conversation(str(self.workspace),'Footer translation regression')
        for count in (1,7):
            job,_=store.reserve(chat['id'],'fixture',uuid.uuid4().hex,'Saved question',None,None)
            store.item(job['id'],'reply','assistant','Saved answer','completed')
            store.report(job['id'],{'changes':{'state':'complete','file_count':count,'additions':56,'deletions':4,'files':[{'path':'example.txt','status':'modified','additions':56,'deletions':4,'diff':'+saved output\n','notice':'\u6587\u4ef6\u6a21\u5f0f\u6216\u6362\u884c\u53d1\u751f\u53d8\u5316\u3002' if count==1 else 'diff_truncated'}]}})
            store.finish(job['id'],'completed')
        fixture=self.root/'footer-language.json'
        fixture.write_text(json.dumps(dict(url=f'http://127.0.0.1:{self.port}',token=self.settings.token,chat=chat['id'])))
        return fixture

    def test_server_shared_working_directory_defaults(self):
        fixture=self._workspace_browser_fixture()
        result=subprocess.run([os.environ['LAZYFISH_BROWSER_NODE'],str(Path(__file__).with_name('workspace_browser.cjs'))],
                              env=dict(os.environ,LAZYFISH_BROWSER_FIXTURE=str(fixture)),capture_output=True,text=True,timeout=120)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn('shared workspace checks passed',result.stdout)

    def _workspace_browser_fixture(self):
        store=Store(self.settings.data_dir/'lazyfish.db');projects=[];chats=[]
        for index in range(2):
            project=self.root/('outside-default-'+str(index));project.mkdir(mode=0o755);projects.append(str(project))
            skill=project/'.agents/skills'/('skill-'+str(index))/'SKILL.md';skill.parent.mkdir(parents=True)
            skill.write_text(f'---\nname: skill-{index}\ndescription: Project fixture\n---\nFixture instructions.\n')
            chat=store.create_conversation(str(project),'Independent project '+str(index));chats.append(chat['id'])
            job,_=store.reserve(chat['id'],'fixture',uuid.uuid4().hex,'Saved question',None,None)
            store.item(job['id'],'reply','assistant','Saved answer','completed');store.finish(job['id'],'completed')
        code,_,raw=self.http('/api/workspace/default',headers={'Authorization':'Bearer '+self.settings.token})
        self.assertEqual(code,200)
        fixture=self.root/'workspace-browser.json'
        fixture.write_text(json.dumps(dict(url=f'http://127.0.0.1:{self.port}',token=self.settings.token,chats=chats,projects=projects,workspace=json.loads(raw)['workspace'])))
        return fixture

    def test_workspace_skill_context_and_new_chat_defaults(self):
        self._interaction_browser('workspace')

    def test_question_addenda_and_ephemeral_drafts(self):
        self._interaction_browser('questions')

    def _interaction_browser(self, mode):
        store=Store(self.settings.data_dir/'lazyfish.db');projects=[];chats=[]
        for index in range(2):
            project=self.workspace/('project-'+str(index));projects.append(str(project))
            skill=project/'.agents/skills'/('skill-'+str(index))/'SKILL.md';skill.parent.mkdir(parents=True)
            skill.write_text(f'---\nname: skill-{index}\ndescription: Project fixture\n---\nFixture instructions.\n')
            values={'model':'compact-model','effort':'high','fast_mode':True,'permission_mode':'read_only','collaboration_mode':'plan'} if not index else {}
            chat=store.create_conversation(str(project),'Project '+str(index),values);chats.append(chat['id'])
            job,_=store.reserve(chat['id'],'fixture',uuid.uuid4().hex,'Saved question',None,None)
            store.item(job['id'],'reply','assistant','Saved answer','completed');store.finish(job['id'],'completed')
            if values:store.save_run_settings(chat['id'],values)
        fixture=self.root/'interaction-browser.json'
        fixture.write_text(json.dumps(dict(url=f'http://127.0.0.1:{self.port}',token=self.settings.token,chats=chats,projects=projects,workspace=str(self.workspace),mode=mode)))
        result=subprocess.run([os.environ['LAZYFISH_BROWSER_NODE'],str(Path(__file__).with_name('interaction_browser.cjs'))],
                              env=dict(os.environ,LAZYFISH_BROWSER_FIXTURE=str(fixture)),capture_output=True,text=True,timeout=120)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn(mode+' checks passed',result.stdout)

    def test_unsent_new_chat_inputs_survive_other_conversation_sends(self):
        self._composer_browser('drafts')

    def test_http_text_copy_fallback_and_failure_feedback(self):
        self._composer_browser('clipboard')

    def _composer_browser(self, mode):
        store=Store(self.settings.data_dir/'lazyfish.db')
        skill=self.workspace/'.agents/skills/draft-check/SKILL.md'
        skill.parent.mkdir(parents=True)
        skill.write_text('---\nname: draft-check\ndescription: Isolated draft check\n---\nFixture instructions.\n')
        chats=[]
        prompt='\n'.join('Saved question line '+str(i) for i in range(25))
        for title in ('Conversation A','Conversation B'):
            chat=store.create_conversation(str(self.workspace),title)
            job,_=store.reserve(chat['id'],'fixture',uuid.uuid4().hex,prompt,None,None)
            store.item(job['id'],'answer','assistant',"Saved answer.\n\n```python\nprint('fish')\n```",'completed')
            store.finish(job['id'],'completed');chats.append(chat['id'])
        fixture=self.root/'composer-browser.json'
        fixture.write_text(json.dumps(dict(url=f'http://127.0.0.1:{self.port}',token=self.settings.token,chats=chats,prompt=prompt,mode=mode)))
        result=subprocess.run([os.environ['LAZYFISH_BROWSER_NODE'],str(Path(__file__).with_name('composer_browser.cjs'))],
                              env=dict(os.environ,LAZYFISH_BROWSER_FIXTURE=str(fixture)),capture_output=True,text=True,timeout=90)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn(mode+' checks passed',result.stdout)

    def test_saved_user_echoes_are_hidden_without_hiding_tools(self):
        store=Store(self.settings.data_dir/'lazyfish.db')
        chat=store.create_conversation(str(self.workspace),'Saved user echoes')
        job,_=store.reserve(chat['id'],'fixture',uuid.uuid4().hex,'Saved request',None,None)
        for identifier,kind in [('echo-before','echo'),('command-one','command'),('echo-between','echo'),('command-two','command'),('echo-after','echo'),('future-tool','future')]:
            store.item(job['id'],identifier,'command' if kind=='command' else 'tool','Saved request' if kind=='echo' else identifier,'completed')
            detail={'type':'user_message','content':[{'type':'text','text':'Saved request'}]} if kind=='echo' else {'type':'command_execution','command':'echo '+identifier,'aggregated_output':'fixture','exit_code':0} if kind=='command' else {'type':'future_tool'}
            store.detail(job['id'],identifier,detail)
        store.item(job['id'],'answer','assistant','Saved answer','completed');store.finish(job['id'],'completed')
        fixture=self.root/'user-echo-browser.json'
        fixture.write_text(json.dumps(dict(url=f'http://127.0.0.1:{self.port}',token=self.settings.token,chat=chat['id'],job=job['id'])))
        result=subprocess.run([os.environ['LAZYFISH_BROWSER_NODE'],str(Path(__file__).with_name('user_echo_browser.cjs'))],env=dict(os.environ,LAZYFISH_BROWSER_FIXTURE=str(fixture)),capture_output=True,text=True,timeout=90)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn('saved user echoes passed',result.stdout)

    def test_http_request_ids_and_missing_workspace_recovery(self):
        missing=self.workspace/'removed-project';missing.mkdir()
        store=Store(self.settings.data_dir/'lazyfish.db')
        chat=store.create_conversation(str(missing),'Missing workspace')
        missing.rmdir()
        fixture=self.root/'http-request-browser.json'
        fixture.write_text(json.dumps(dict(url=f'http://127.0.0.1:{self.port}',token=self.settings.token,missing=chat['id'],workspace=str(self.workspace))))
        result=subprocess.run([os.environ['LAZYFISH_BROWSER_NODE'],str(Path(__file__).with_name('http_request_browser.cjs'))],env=dict(os.environ,LAZYFISH_BROWSER_FIXTURE=str(fixture)),capture_output=True,text=True,timeout=90)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn('HTTP request IDs and workspace recovery passed',result.stdout)

    def test_conversation_archive_and_restore(self):
        store=Store(self.settings.data_dir/'lazyfish.db')
        workspaces=[self.workspace/'lazyfish',self.workspace/'example-project']
        for path in workspaces:path.mkdir()
        archived=[]
        for index,title in enumerate(('\u68b3\u7406\u4f1a\u8bdd\u5f52\u6863\u4ea4\u4e92','\u4fee\u590d\u6280\u80fd\u52a0\u8f7d\u8bca\u65ad','\u68c0\u67e5\u957f\u6d88\u606f\u6298\u53e0\u6548\u679c','Review project notes')):
            chat=store.create_conversation(str(workspaces[index//3]),title)
            job,_=store.reserve(chat['id'],'fixture',uuid.uuid4().hex,'Saved question',None,None)
            store.item(job['id'],'answer','assistant','Saved response.','completed');store.finish(job['id'],'completed')
            store.archive(chat['id']);archived.append(chat['id'])
        active=[]
        for title in ('\u5f52\u6863\u529f\u80fd\u9884\u89c8','\u53d1\u5e03\u524d\u68c0\u67e5','\u754c\u9762\u4ea4\u4e92\u8bb0\u5f55'):
            chat=store.create_conversation(str(workspaces[0]),title)
            job,_=store.reserve(chat['id'],'fixture',uuid.uuid4().hex,'\u8bf7\u68c0\u67e5\u9879\u76ee\u5f53\u524d\u7684\u72b6\u6001\u3002',None,None)
            store.item(job['id'],'answer','assistant','\u5df2\u5b8c\u6210\u68c0\u67e5\u3002\n\n\u9879\u76ee\u6587\u4ef6\u548c\u4f1a\u8bdd\u8bb0\u5f55\u5747\u6b63\u5e38\uff0c\u53ef\u4ee5\u7ee7\u7eed\u5904\u7406\u540e\u7eed\u4efb\u52a1\u3002','completed');store.finish(job['id'],'completed');active.append(chat['id'])
        fixture=self.root/'archive-browser.json'
        fixture.write_text(json.dumps(dict(url=f'http://127.0.0.1:{self.port}',token=self.settings.token,active=active,archived=archived,workspaces=[str(p) for p in workspaces],output=os.environ.get('LAZYFISH_BROWSER_OUTPUT',str(self.root)))))
        result=subprocess.run([os.environ['LAZYFISH_BROWSER_NODE'],str(Path(__file__).with_name('archive_browser.cjs'))],env=dict(os.environ,LAZYFISH_BROWSER_FIXTURE=str(fixture)),capture_output=True,text=True,timeout=120)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn('archive and restore passed',result.stdout)

    def test_message_folding_and_skill_diagnostics(self):
        import base64
        store=Store(self.settings.data_dir/'lazyfish.db')
        chat=store.create_conversation(str(self.workspace),'Message folding')
        other=store.create_conversation(str(self.workspace),'Other conversation')
        image=store.add_attachment('tiny.png','image/png',base64.b64decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII='))
        prompts=['\n'.join('Line '+str(i+1) for i in range(count)) for count in (19,20,25)]
        prompts.append('A wrapped line without newlines. '*250)
        prompts.append('Width-sensitive wrapping. '*50)
        jobs=[]
        for prompt in prompts:
            job,_=store.reserve(chat['id'],'fixture',uuid.uuid4().hex,prompt,None,None,
                                {'images':[image],'skills':[{'name':'example','path':str(self.workspace/'SKILL.md')}]})
            if len(jobs)==2:
                instruction,_=store.instruction(job['id'],uuid.uuid4().hex,prompts[2])
                store.instruction_state(job['id'],instruction['id'],'delivered')
            store.item(job['id'],'answer','assistant','Saved response.','completed')
            store.finish(job['id'],'completed');jobs.append(job['id'])
        fixture=self.root/'message-skill-browser.json'
        fixture.write_text(json.dumps(dict(url=f'http://127.0.0.1:{self.port}',token=self.settings.token,
                                          chat=chat['id'],other=other['id'],jobs=jobs,prompts=prompts,
                                          skills_fixture=str(self.settings.runtime_dir/'tmp/skills-result.json'),
                                          output=os.environ.get('LAZYFISH_BROWSER_OUTPUT',str(self.root)))))
        result=subprocess.run([os.environ['LAZYFISH_BROWSER_NODE'],str(Path(__file__).with_name('message_skills_browser.cjs'))],
                              env=dict(os.environ,LAZYFISH_BROWSER_FIXTURE=str(fixture)),capture_output=True,text=True,timeout=120)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn('message folding and skill diagnostics passed',result.stdout)

    def test_compact_image_outputs(self):
        import hashlib
        import struct
        import zlib

        def png(width, height):
            def chunk(kind, data):
                return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind+data))
            pixels = b''.join(b'\0' + (bytes((235, 240, 246)) if y % 100 < 70 else bytes((116, 151, 185))) * width
                              for y in range(height))
            return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')

        store = Store(self.settings.data_dir/'lazyfish.db')
        chat = store.create_conversation(str(self.workspace), 'Image output preview')
        job, _ = store.reserve(chat['id'], 'fixture', uuid.uuid4().hex, 'Show image output examples', None, None)
        artifacts = []
        for name, width, height in [('linked.png', 1100, 850), ('inline.png', 1200, 800),
                                    ('landscape.png', 1400, 900), ('portrait.png', 800, 1600)]:
            raw = png(width, height)
            artifacts.append(store.save_artifact(job['id'], hashlib.sha256(raw).hexdigest(), name, 'image/png', raw))
        text = '### \u56fe\u7247\u5c55\u793a\n\n[\u67e5\u770b\u622a\u56fe](' + artifacts[0]['url'] + '?download=1#preview)\n\n' + \
               '![\u6b63\u6587\u56fe\u7247](' + artifacts[1]['url'] + ')\n\n[\u4e0b\u8f7d\u539f\u56fe](' + artifacts[1]['url'] + '?download=1)'
        store.item(job['id'], 'reply', 'assistant', text, 'completed')
        store.report(job['id'], {'artifacts':artifacts+[artifacts[-1]]}); store.finish(job['id'], 'completed')
        fixture = self.root/'image-outputs-browser.json'
        fixture.write_text(json.dumps(dict(url=f'http://127.0.0.1:{self.port}', token=self.settings.token,
                                          chat=chat['id'], output=os.environ.get('LAZYFISH_BROWSER_OUTPUT', str(self.root)))))
        result = subprocess.run([os.environ['LAZYFISH_BROWSER_NODE'], str(Path(__file__).with_name('image_outputs_browser.cjs'))],
                                env=dict(os.environ, LAZYFISH_BROWSER_FIXTURE=str(fixture)), capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
        self.assertIn('compact image outputs passed', result.stdout)

    def test_local_markdown_links(self):
        store = Store(self.settings.data_dir/'lazyfish.db')
        chat = store.create_conversation(str(self.workspace), 'Local Markdown paths')
        job, _ = store.reserve(chat['id'], 'fixture', uuid.uuid4().hex, 'Show local repositories', None, None)
        content = '\n\n'.join([
            '- [aclone](/projects/dataset/aclone)',
            '| File | Purpose |\n| --- | --- |\n| [\u62a5\u544a](</projects/My Report (draft).md:12:3>) | Notes |',
            '**[nested](/projects/a(b(c)).py#L42C2)**',
            '[\u4e2d\u6587](/projects/\u6570\u636e/\u8bf4\u660e.md)',
            '[web](https://example.org/docs) [mail](mailto:user@example.org)',
            '[download](/api/jobs/' + job['id'] + '/artifacts/' + 'a'*64 + '?download=1)',
            '`[literal](/projects/code)`\n\n```text\n[fenced](/projects/code)\n```',
            '[unsafe](javascript:alert(1)) [network](//example.org/file) [empty]()',
            '[html](/projects/<img src=x onerror=alert(1)>.md)',
            '[unfinished](/projects/draft\n<script>window.compromised=true</script>',
        ])
        store.item(job['id'], 'reply', 'assistant', content, 'completed'); store.finish(job['id'], 'completed')
        fixture = self.root/'local-links-browser.json'
        fixture.write_text(json.dumps(dict(url=f'http://127.0.0.1:{self.port}', token=self.settings.token,
                                          chat=chat['id'], output=os.environ.get('LAZYFISH_BROWSER_OUTPUT', str(self.root)))))
        result = subprocess.run([os.environ['LAZYFISH_BROWSER_NODE'], str(Path(__file__).with_name('local_links_browser.cjs'))],
                                env=dict(os.environ, LAZYFISH_BROWSER_FIXTURE=str(fixture)), capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
        self.assertIn('local Markdown links passed', result.stdout)

    def test_native_login_recovery(self):
        (self.settings.runtime_dir/'tmp/login-delay').write_text('30')
        fixture=self.root/'native-login-browser.json'
        fixture.write_text(json.dumps(dict(url=f'http://127.0.0.1:{self.port}',token=self.settings.token)))
        result=subprocess.run([os.environ['LAZYFISH_BROWSER_NODE'],str(Path(__file__).with_name('native_login_browser.cjs'))],env=dict(os.environ,LAZYFISH_BROWSER_FIXTURE=str(fixture)),capture_output=True,text=True,timeout=60)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn('native login recovery passed',result.stdout)

    def test_pointer_and_keyboard_focus(self):
        fixture=self.root/'focus-browser.json'
        fixture.write_text(json.dumps(dict(url=f'http://127.0.0.1:{self.port}',token=self.settings.token)))
        result=subprocess.run([os.environ['LAZYFISH_BROWSER_NODE'],str(Path(__file__).with_name('focus_browser.cjs'))],env=dict(os.environ,LAZYFISH_BROWSER_FIXTURE=str(fixture)),capture_output=True,text=True,timeout=60)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn('pointer and keyboard focus passed',result.stdout)

    def test_login_restore_does_not_flash(self):
        fixture=self.root/'auth-browser.json'
        fixture.write_text(json.dumps(dict(url=f'http://127.0.0.1:{self.port}',token=self.settings.token)))
        result=subprocess.run([os.environ['LAZYFISH_BROWSER_NODE'],str(Path(__file__).with_name('auth_browser.cjs'))],env=dict(os.environ,LAZYFISH_BROWSER_FIXTURE=str(fixture)),capture_output=True,text=True,timeout=60)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn('login restore passed',result.stdout)

    def test_reference_style_parity(self):
        store=Store(self.settings.data_dir/'lazyfish.db')
        chat=store.create_conversation(str(self.workspace),'Style reference')
        job,_=store.reserve(chat['id'],'fixture',uuid.uuid4().hex,'Saved question',None,None)
        store.item(job['id'],'answer','assistant','\n\n'.join('Paragraph '+str(i)+' for history navigation.' for i in range(100)),'completed');store.finish(job['id'],'completed')
        fixture=self.root/'style-browser.json'
        fixture.write_text(json.dumps(dict(url=f'http://127.0.0.1:{self.port}',token=self.settings.token,chat=chat['id'],output=os.environ.get('LAZYFISH_BROWSER_OUTPUT',str(self.root)))))
        result=subprocess.run([os.environ['LAZYFISH_BROWSER_NODE'],str(Path(__file__).with_name('style_browser.cjs'))],env=dict(os.environ,LAZYFISH_BROWSER_FIXTURE=str(fixture)),capture_output=True,text=True,timeout=110)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn('reference style parity passed',result.stdout)

    def test_recent_reference_updates(self):
        store=Store(self.settings.data_dir/'lazyfish.db');chats=[];jobs=[]
        for title in ('Restore Alpha','Restore Beta'):
            chat=store.create_conversation(str(self.workspace),title);chats.append(chat['id'])
            job,_=store.reserve(chat['id'],'fixture',uuid.uuid4().hex,'Saved question',None,'high')
            for identifier,kind,text in [('one','command','echo first\nFirst output'),('reason','reasoning','**Saved summary**'),('two','command','echo second\nSecond output'),('progress','commentary','Actual progress update'),('three','command','echo third\nThird output')]:
                store.item(job['id'],identifier,kind,text,'completed')
                if kind=='command':store.detail(job['id'],identifier,{'type':'command_execution','command':text.split('\n')[0],'aggregated_output':text.split('\n')[1],'exit_code':1 if identifier=='two' else 0})
            store.item(job['id'],'answer','assistant','\n\n'.join('Saved answer paragraph '+str(i)+' — preserve this reading position.' for i in range(120)),'completed')
            store.finish(job['id'],'completed');jobs.append(job['id'])
        only,_=store.reserve(chats[0],'fixture',uuid.uuid4().hex,'Only reasoning fixture',None,'high')
        store.item(only['id'],'reason-only','reasoning','Only saved summary','completed');store.finish(only['id'],'completed')
        fixture=self.root/'recent-updates.json'
        fixture.write_text(json.dumps(dict(url=f'http://127.0.0.1:{self.port}',token=self.settings.token,chats=chats,jobs=jobs,only=only['id'])))
        result=subprocess.run([os.environ['LAZYFISH_BROWSER_NODE'],str(Path(__file__).with_name('recent_updates_browser.cjs'))],env=dict(os.environ,LAZYFISH_BROWSER_FIXTURE=str(fixture)),capture_output=True,text=True,timeout=120)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn('recent reference updates passed',result.stdout)

    def test_conversation_experience(self):
        store = Store(self.settings.data_dir/"lazyfish.db")
        main = store.create_conversation(str(self.workspace),"Long history")
        ids = []
        rich = '**[Clickable bold](https://example.org/docs)**\n\n<script>window.compromised=true</script>\n[unsafe](javascript:alert(1))\n\n3. third\n   - nested\n4. fourth\n\n| Item | Value |\n| --- | ---: |\n| fish | 3 |\n\n> A quote\n\n```python\nprint("fish")\n```'
        for index in range(65):
            job,_ = store.reserve(main["id"],"fixture",uuid.uuid4().hex,f"User message {index}",None,None)
            store.item(job["id"],"reply","assistant",rich+'\n\n'+'\n'.join(
                f'Paragraph {index}.{line} — readable history.' for line in range(9)),"completed")
            store.finish(job["id"],"completed"); ids.append(job["id"])
        other = store.create_conversation(str(self.workspace),"Codex Web \u9879\u76ee")
        store.update_conversation(other["id"],pinned=True)
        sample,_ = store.reserve(other["id"],"fixture",uuid.uuid4().hex,
            "\u5e2e\u6211\u68b3\u7406\u4e00\u4e0b\u63a5\u4e0b\u6765\u7684\u5f00\u53d1\u8ba1\u5212\uff0c\u4f18\u5148\u6253\u78e8\u65e5\u5e38\u4f7f\u7528\u7684\u5bf9\u8bdd\u4f53\u9a8c\u3002",None,"medium")
        store.item(sample["id"],"reply","assistant",
            "\u53ef\u4ee5\u3002\u5148\u628a\u6838\u5fc3\u5bf9\u8bdd\u4f53\u9a8c\u6253\u78e8\u5b8c\u6574\uff0c\u518d\u6269\u5c55\u9644\u4ef6\u4e0e\u6280\u80fd\u3002\n\n"
            "### \u63a5\u4e0b\u6765\u7684\u91cd\u70b9\n\n"
            "| \u4f18\u5148\u7ea7 | \u65b9\u5411 | \u76ee\u6807 |\n| --- | --- | --- |\n"
            "| 01 | \u5bf9\u8bdd\u4f53\u9a8c | \u7a33\u5b9a\u7eed\u804a\u3001\u5386\u53f2\u5b9a\u4f4d\u548c\u5feb\u6377\u5207\u6362 |\n"
            "| 02 | \u9644\u4ef6\u4e0e\u6280\u80fd | \u56fe\u7247\u9884\u89c8\u3001\u6587\u4ef6\u4e0b\u8f7d\u548c\u6280\u80fd\u9009\u62e9 |\n\n"
            "\u65e5\u5e38\u5f00\u53d1\u53ef\u4ee5\u5148\u68c0\u67e5\u672c\u673a\u73af\u5883\uff0c\u518d\u542f\u52a8\u670d\u52a1\uff1a\n\n"
            "```bash\nlazyfish doctor --probe\nlazyfish serve\n```\n\n"
            "\u4fdd\u6301\u6bcf\u4e00\u6b65\u90fd\u53ef\u4ee5\u72ec\u7acb\u8fd0\u884c\u548c\u9a8c\u8bc1\u3002","completed")
        store.finish(sample["id"],"completed")
        titles = ["\u90e8\u7f72\u4e0e\u73af\u5883\u68c0\u67e5","\u539f\u751f\u4f1a\u8bdd\u7eed\u804a","Markdown \u6392\u7248","\u5bf9\u8bdd\u5206\u652f\u8bbe\u8ba1","\u4e3b\u9898\u4e0e\u5feb\u6377\u952e","\u5de5\u4f5c\u76ee\u5f55\u68b3\u7406","\u9644\u4ef6\u9884\u89c8","\u5f00\u53d1\u8def\u7ebf\u56fe"]
        for index in range(53):
            store.create_conversation(str(self.workspace),titles[index%len(titles)]+(f" · {index//len(titles)+1}" if index>=len(titles) else ""))
        fixture = self.root/"browser-fixture.json"
        fixture.write_text(json.dumps({"url":f"http://127.0.0.1:{self.port}","token":self.settings.token,
                                       "main":main["id"],"other":other["id"],"jobs":ids,
                                       "output":os.environ.get("LAZYFISH_BROWSER_OUTPUT",str(self.root))}))
        env = dict(os.environ,LAZYFISH_BROWSER_FIXTURE=str(fixture))
        result = subprocess.run([os.environ["LAZYFISH_BROWSER_NODE"],str(Path(__file__).with_name("browser.cjs"))],
                                env=env,capture_output=True,text=True,timeout=150)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn("browser checks passed",result.stdout)

    def test_remaining_reference_features(self):
        subprocess.run(['git','init','-q',str(self.workspace)],check=True,capture_output=True)
        fixture=self.root/'migration-browser.json'
        fixture.write_text(json.dumps({'url':f'http://127.0.0.1:{self.port}','token':self.settings.token,
                                       'output':os.environ.get('LAZYFISH_BROWSER_OUTPUT',str(self.root))}))
        result=subprocess.run([os.environ['LAZYFISH_BROWSER_NODE'],str(Path(__file__).with_name('migration_browser.cjs'))],
                              env=dict(os.environ,LAZYFISH_BROWSER_FIXTURE=str(fixture)),capture_output=True,text=True,timeout=160)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn('migration browser checks passed',result.stdout)

    def test_cached_refresh_and_deferred_history(self):
        store=Store(self.settings.data_dir/'lazyfish.db')
        main=store.create_conversation(str(self.workspace),'Cached conversation')
        for _ in range(12):
            job,_=store.reserve(main['id'],'fixture',uuid.uuid4().hex,'Saved question',None,None)
            for index in range(3):
                store.item(job['id'],str(index),'command','echo fixture\nSaved command output','completed')
                store.detail(job['id'],str(index),{'type':'command_execution','command':'echo fixture','aggregated_output':'Saved command output'})
            store.item(job['id'],'reply','assistant','Saved answer','completed');store.finish(job['id'],'completed')
        other=store.create_conversation(str(self.workspace),'Other conversation')
        job,_=store.reserve(other['id'],'fixture',uuid.uuid4().hex,'Other question',None,None)
        store.item(job['id'],'reply','assistant','Other answer','completed');store.finish(job['id'],'completed')
        fixture=self.root/'performance-browser.json'
        fixture.write_text(json.dumps({'url':f'http://127.0.0.1:{self.port}','token':self.settings.token,'main':main['id'],'other':other['id']}))
        result=subprocess.run([os.environ['LAZYFISH_BROWSER_NODE'],str(Path(__file__).with_name('performance_browser.cjs'))],
                              env=dict(os.environ,LAZYFISH_BROWSER_FIXTURE=str(fixture)),capture_output=True,text=True,timeout=90)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn('performance browser checks passed',result.stdout)

    def test_reference_lifecycle_parity(self):
        import time
        store=Store(self.settings.data_dir/'lazyfish.db');chats=[]
        for title in ('Parity Alpha','Parity Beta'):
            chat=store.create_conversation(str(self.workspace),title);chats.append(chat['id'])
            job,_=store.reserve(chat['id'],'fixture',uuid.uuid4().hex,title+' question',None,'medium')
            store.item(job['id'],'reply','assistant',title+' saved answer','completed');store.finish(job['id'],'completed')
            if title=='Parity Alpha':
                store.native_turn(job['id'],'timing-fixture')
                store.record_timings([('fixture','one','timing-fixture',1250,time.time(),0)])
        fixture=self.root/'parity-browser.json'
        fixture.write_text(json.dumps(dict(url=f'http://127.0.0.1:{self.port}',token=self.settings.token,alpha=chats[0],beta=chats[1],output=os.environ.get('LAZYFISH_BROWSER_OUTPUT',str(self.root)))))
        result=subprocess.run([os.environ['LAZYFISH_BROWSER_NODE'],str(Path(__file__).with_name('parity_browser.cjs'))],env=dict(os.environ,LAZYFISH_BROWSER_FIXTURE=str(fixture)),capture_output=True,text=True,timeout=180)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn('reference parity browser checks passed',result.stdout)
