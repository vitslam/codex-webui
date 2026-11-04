import json
from test_service import ServiceCase


class EnvironmentTests(ServiceCase):
    def command(self,*args):
        if args==('serve',):
            self.original_cli=self.binary.read_bytes()
            self.binary.unlink()
        return super().command(*args)

    def call(self,path,body=None,expected=200):
        code,_,data=self.http(path,'POST' if body is not None else 'GET',body,{'Authorization':'Bearer '+self.settings.token})
        result=json.loads(data);self.assertEqual(code,expected,result);return result

    def test_live_recheck_enables_sending_without_restart(self):
        initial=self.call('/api/status')
        self.assertFalse(initial['execution']['available'])
        self.assertEqual(self.http('/healthz')[0],200)
        self.assertEqual(self.http('/readyz')[0],503)
        chat=self.call('/api/conversations',{},201)
        payload={'text':'Fixture only','client_request_id':'environment-fixture-request'}
        self.call('/api/conversations/'+chat['id']+'/turns',payload,409)
        self.assertEqual(self.call('/api/conversations/'+chat['id'])['jobs'],[])
        self.assertEqual(self.http('/api/environment/check','POST',{},{} )[0],403)
        self.binary.write_bytes(self.original_cli);self.binary.chmod(0o700)
        result=self.call('/api/environment/check',{})
        self.assertTrue(result['codex']['ready'])
        self.assertTrue(result['codex']['protocol'])
        self.assertEqual(self.call('/api/status')['instance'],initial['instance'])
        self.assertTrue(self.call('/api/status')['execution']['available'])
        self.assertEqual(self.http('/readyz')[0],200)
        scope=self.call('/api/status')['metadata_scope']
        self.call('/api/environment/check',{})
        self.assertEqual(self.call('/api/status')['metadata_scope'],scope,'Unchanged checks preserve saved display snapshots')
        methods=[json.loads(line)['method'] for line in (self.settings.runtime_dir/'tmp/fake-methods.jsonl').read_text().splitlines()]
        self.assertNotIn('thread/start',methods);self.assertNotIn('turn/start',methods)
        job=self.call('/api/conversations/'+chat['id']+'/turns',payload,202)
        self.call('/api/jobs/'+job['id']+'/cancel',{})
