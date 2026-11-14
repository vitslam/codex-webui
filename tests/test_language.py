"""Keep repository text English while retaining isolated Chinese locale resources."""
from pathlib import Path
import re
import subprocess
import shutil
import unittest

from support import IsolatedTest
from lazyfish.storage import Store

ROOT=Path(__file__).resolve().parents[1]
CHINESE=re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]')
ALLOWED={'README.zh-CN.md','src/lazyfish/web/static/i18n-zh.js','src/lazyfish/locales/zh.py'}


class RepositoryLanguageTests(unittest.TestCase):
    def test_chinese_text_is_confined_to_readme_and_locale_resources(self):
        result=subprocess.run(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=ROOT,
                              capture_output=True,check=True)
        unexpected=[]
        for name in result.stdout.decode().split('\0'):
            if not name or name in ALLOWED:continue
            try:lines=(ROOT/name).read_text().splitlines()
            except (UnicodeError,OSError):continue
            unexpected.extend(f'{name}:{index}' for index,line in enumerate(lines,1) if CHINESE.search(line))
        self.assertEqual(unexpected,[], 'Move localized strings into the Chinese locale resources.')

    @unittest.skipUnless(shutil.which('node'), 'Node is needed for locale resource checks')
    def test_locale_resources_have_matching_keys_and_placeholders(self):
        result=subprocess.run([shutil.which('node'),str(ROOT/'tests/check_locales.cjs'),str(ROOT)],
                              capture_output=True,text=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)

    def test_documentation_links_use_existing_heading_anchors(self):
        def slug(text):
            text=text.strip().lower().replace('`','')
            return ''.join(c for c in text if c.isalnum() or c in '_- ').replace(' ','-')
        broken=[]
        for path in [ROOT/'README.md',ROOT/'README.zh-CN.md',*sorted((ROOT/'docs').glob('*.md'))]:
            for target,anchor in re.findall(r'\]\(([^)#]*)#([^)]*)\)',path.read_text()):
                if '://' in target:continue
                dest=path.parent/target if target else path
                if not dest.is_file():continue
                headings={slug(line.lstrip('#')) for line in dest.read_text().splitlines() if line.startswith('#')}
                if anchor not in headings:broken.append(str(path.relative_to(ROOT))+': '+target+'#'+anchor)
        self.assertEqual(broken,[])


class ServerLocaleTests(IsolatedTest):
    def test_command_details_keep_the_requested_exit_code_language(self):
        store=Store(self.settings.data_dir/'lazyfish.db')
        chat=store.create_conversation(str(self.workspace),'Localized command details')
        job,_=store.reserve(chat['id'],'fixture','locale-check-request','Saved question',None,None)
        store.item(job['id'],'command','command','echo fixture','completed')
        store.detail(job['id'],'command',{'type':'command_execution','command':'echo fixture','aggregated_output':'Saved output','exit_code':7})
        self.assertIn('Exit code: 7',store.command_detail(job['id'],'command',language='en')['text'])
        self.assertIn('\u9000\u51fa\u7801\uff1a7',store.command_detail(job['id'],'command',language='zh')['text'])
