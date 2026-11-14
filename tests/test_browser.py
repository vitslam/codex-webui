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
            store.report(job['id'],{'changes':{'state':'complete','file_count':count,'additions':56,'deletions':4,'files':[]}})
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
        for index,title in enumerate(('梳理会话归档交互','修复技能加载诊断','检查长消息折叠效果','Review project notes')):
            chat=store.create_conversation(str(workspaces[index//3]),title)
            job,_=store.reserve(chat['id'],'fixture',uuid.uuid4().hex,'Saved question',None,None)
            store.item(job['id'],'answer','assistant','Saved response.','completed');store.finish(job['id'],'completed')
            store.archive(chat['id']);archived.append(chat['id'])
        active=[]
        for title in ('归档功能预览','发布前检查','界面交互记录'):
            chat=store.create_conversation(str(workspaces[0]),title)
            job,_=store.reserve(chat['id'],'fixture',uuid.uuid4().hex,'请检查项目当前的状态。',None,None)
            store.item(job['id'],'answer','assistant','已完成检查。\n\n项目文件和会话记录均正常，可以继续处理后续任务。','completed');store.finish(job['id'],'completed');active.append(chat['id'])
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
        text = '### 图片展示\n\n[查看截图](' + artifacts[0]['url'] + '?download=1#preview)\n\n' + \
               '![正文图片](' + artifacts[1]['url'] + ')\n\n[下载原图](' + artifacts[1]['url'] + '?download=1)'
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
            '| File | Purpose |\n| --- | --- |\n| [报告](</projects/My Report (draft).md:12:3>) | Notes |',
            '**[nested](/projects/a(b(c)).py#L42C2)**',
            '[中文](/projects/数据/说明.md)',
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
        other = store.create_conversation(str(self.workspace),"Codex Web 项目")
        store.update_conversation(other["id"],pinned=True)
        sample,_ = store.reserve(other["id"],"fixture",uuid.uuid4().hex,
            "帮我梳理一下接下来的开发计划，优先打磨日常使用的对话体验。",None,"medium")
        store.item(sample["id"],"reply","assistant",
            "可以。先把核心对话体验打磨完整，再扩展附件与技能。\n\n"
            "### 接下来的重点\n\n"
            "| 优先级 | 方向 | 目标 |\n| --- | --- | --- |\n"
            "| 01 | 对话体验 | 稳定续聊、历史定位和快捷切换 |\n"
            "| 02 | 附件与技能 | 图片预览、文件下载和技能选择 |\n\n"
            "日常开发可以先检查本机环境，再启动服务：\n\n"
            "```bash\nlazyfish doctor --probe\nlazyfish serve\n```\n\n"
            "保持每一步都可以独立运行和验证。","completed")
        store.finish(sample["id"],"completed")
        titles = ["部署与环境检查","原生会话续聊","Markdown 排版","对话分支设计","主题与快捷键","工作目录梳理","附件预览","开发路线图"]
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
