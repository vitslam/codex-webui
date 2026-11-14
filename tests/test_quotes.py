"""Selected passages are saved context, including retries, edits and steering."""
import json
import sqlite3
import time
import uuid
from contextlib import closing

from lazyfish.quotes import validate
from lazyfish.storage import Store, StoreError, open_store
from support import IsolatedTest
import test_features as _features
from test_service import ServiceCase


class QuoteTests(ServiceCase):
    call = _features.FeatureTests.call
    finish = _features.FeatureTests.finish

    def test_native_context_retry_history_branch_and_edit(self):
        chat = self.call('/api/conversations', {}, 201)['id']
        quotes = [{'text': 'Keep <b>this</b> exact.\nSecond line.', 'role': 'assistant'},
                  {'text': 'Original question', 'role': 'user'}]
        payload = dict(text='Explain this choice', quotes=quotes, client_request_id=uuid.uuid4().hex)
        path = '/api/conversations/' + chat + '/turns'
        job = self.call(path, payload, 202)
        self.assertEqual(self.finish(job)['status'], 'completed')
        self.assertEqual(self.call(path, payload, 202)['id'], job['id'])
        self.call(path, {**payload, 'quotes': quotes[:1]}, 409)
        history = self.call('/api/conversations/' + chat)
        self.assertEqual(history['jobs'][0]['inputs']['quotes'], quotes)
        methods = [json.loads(line) for line in (self.settings.runtime_dir/'tmp/fake-methods.jsonl').read_text().splitlines()]
        inputs = next(m['params']['input'] for m in methods if m['method'] == 'turn/start')
        self.assertIn('reference text', inputs[0]['text'])
        self.assertIn('> Keep <b>this</b> exact.\n> Second line.', inputs[0]['text'])
        self.assertEqual(inputs[1], {'type': 'text', 'text': payload['text']})
        boundary = self.call(path, dict(text='Boundary', client_request_id=uuid.uuid4().hex), 202)
        self.finish(boundary)
        branch = self.call('/api/conversations/'+chat+'/branch', dict(before_job_id=boundary['id'], client_request_id=uuid.uuid4().hex, title='Reference branch'), 201)
        self.assertEqual(self.call('/api/conversations/'+branch['id'])['jobs'][0]['inputs']['quotes'], quotes)
        edited = self.call('/api/conversations/'+chat+'/edit', dict(before_job_id=job['id'], text='Edited question', client_request_id=uuid.uuid4().hex), 202)
        self.assertEqual(self.finish(edited)['inputs']['quotes'], quotes)

    def test_quote_only_and_invalid_inputs(self):
        chat = self.call('/api/conversations', {}, 201)['id']
        path = '/api/conversations/' + chat + '/turns'
        quote = {'text': 'Selected passage', 'role': 'assistant'}
        for value in [None, {}, 'text', [None], [{**quote, 'text': ' '}], [{**quote, 'text': '\0'}],
                      [{**quote, 'text': 'x'*8001}], [{**quote, 'role': 'system'}],
                      [quote]*9, [{**quote, 'text': 'x'*8000}]*4]:
            with self.subTest(value=str(value)[:80]):
                self.assertEqual(self.call(path, dict(text='Do not run', quotes=value, client_request_id=uuid.uuid4().hex), 409)['error'], 'invalid_quotes')
        self.assertEqual(self.call('/api/conversations/'+chat)['jobs'], [])
        job = self.call(path, dict(text='', quotes=[quote], client_request_id=uuid.uuid4().hex), 202)
        self.assertEqual(self.finish(job)['inputs']['quotes'], [quote])
        self.assertEqual(self.http(path, 'POST', dict(text='', quotes=[quote], client_request_id=uuid.uuid4().hex), {'Origin': f'http://127.0.0.1:{self.port}'})[0], 401)

    def test_steering_quotes_are_persisted_idempotent_and_copied_to_branch(self):
        chat = self.call('/api/conversations', {}, 201)['id']
        path = '/api/conversations/' + chat + '/turns'
        job = self.call(path, dict(text='[slow]', client_request_id=uuid.uuid4().hex), 202)
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            value = self.call('/api/jobs/'+job['id'])
            if any(i['text'] for i in value['items']): break
            time.sleep(.03)
        quotes = [{'text': 'Steered context', 'role': 'assistant'}]
        payload = dict(text='', quotes=quotes, client_request_id=uuid.uuid4().hex)
        route = '/api/jobs/'+job['id']+'/instructions'
        instruction = self.call(route, payload, 202)
        self.assertEqual(self.call(route, payload, 202)['id'], instruction['id'])
        self.call(route, {**payload, 'quotes': [{**quotes[0], 'text': 'Other'}]}, 409)
        done = self.finish(job)
        self.assertEqual(done['instructions'][0]['quotes'], quotes)
        self.assertEqual(done['instructions'][0]['state'], 'delivered')
        methods = [json.loads(line) for line in (self.settings.runtime_dir/'tmp/fake-methods.jsonl').read_text().splitlines()]
        steer = [m for m in methods if m['method'] == 'turn/steer']
        self.assertEqual(len(steer), 1)
        self.assertIn('> Steered context', steer[0]['params']['input'][0]['text'])
        boundary = self.call(path, dict(text='Boundary', client_request_id=uuid.uuid4().hex), 202)
        self.finish(boundary)
        branch = self.call('/api/conversations/'+chat+'/branch', dict(before_job_id=boundary['id'], client_request_id=uuid.uuid4().hex, title='Reference branch'), 201)
        copied = self.call('/api/conversations/'+branch['id'])['jobs'][0]['instructions'][0]
        self.assertEqual(copied['quotes'], quotes)


class QuoteStorageTests(IsolatedTest):
    def test_version_eight_preserves_existing_instructions(self):
        path = self.settings.data_dir/'migration.db'
        store = Store(path)
        chat = store.create_conversation(str(self.workspace))
        job, _ = store.reserve(chat['id'], 'fixture', uuid.uuid4().hex, 'Original', None, None)
        skills = [{'name': 'fixture', 'path': str(self.workspace/'SKILL.md')}]
        saved, _ = store.instruction(job['id'], uuid.uuid4().hex, 'Keep this instruction', skills)
        with closing(sqlite3.connect(path)) as db, db:
            db.execute('ALTER TABLE instructions DROP COLUMN quotes')
            db.execute('PRAGMA user_version=8')
        with closing(open_store(path)) as db:
            self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0], 9)
        restored = Store(path).job(job['id'])['instructions'][0]
        self.assertTrue(all(restored[key] == value for key, value in saved.items()))
        self.assertEqual(restored['quotes'], [])

    def test_unicode_limits_and_normalization(self):
        value = [{'text': '\U0001f41f'*8000, 'role': 'user', 'ignored': 'field'}]*3
        clean = validate(value)
        self.assertEqual(len(clean), 3)
        self.assertNotIn('ignored', clean[0])
        with self.assertRaises(StoreError): validate(value + [{'text': 'x', 'role': 'user'}])
