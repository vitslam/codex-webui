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
