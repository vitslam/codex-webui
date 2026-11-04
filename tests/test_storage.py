from contextlib import closing
import base64
import json
import sqlite3

from lazyfish.storage import Store, open_store, record_start, record_stop
from support import IsolatedTest


class StorageTests(IsolatedTest):
    def test_schema_and_unclean_run_are_preserved_without_replay(self):
        path = self.settings.data_dir / "lazyfish.db"
        record_start(path, "old", "before")
        record_start(path, "new", "now")
        record_stop(path, "new", "later")
        with closing(open_store(path)) as connection:
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 8)
            rows = [tuple(row) for row in connection.execute("SELECT id, outcome FROM service_runs ORDER BY id")]
        self.assertEqual(rows, [("new", "stopped"), ("old", "running")])
        self.assert_private(path, 0o600)

    def test_refuse_newer_schema(self):
        path = self.settings.data_dir / "newer.db"
        with closing(sqlite3.connect(path)) as connection:
            connection.execute("PRAGMA user_version=999")
        with self.assertRaisesRegex(ValueError, "newer"):
            open_store(path)

    def test_version_one_migration_preserves_service_audit(self):
        path = self.settings.data_dir/"version-one.db"
        with closing(sqlite3.connect(path)) as connection, connection:
            connection.execute("CREATE TABLE service_runs(id TEXT PRIMARY KEY,started_at TEXT NOT NULL,stopped_at TEXT,outcome TEXT NOT NULL DEFAULT 'running')")
            connection.execute("INSERT INTO service_runs VALUES ('original','before',NULL,'running')")
            connection.execute("PRAGMA user_version=1")
        store = Store(path)
        conversation = store.create_conversation(str(self.workspace))
        with closing(open_store(path)) as connection:
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0],8)
            self.assertEqual(connection.execute("SELECT id FROM service_runs").fetchone()[0],"original")
            self.assertEqual(connection.execute("SELECT id FROM conversations").fetchone()[0],conversation["id"])

    def test_version_two_migration_preserves_native_thread_and_job_identifiers(self):
        path = self.settings.data_dir/"version-two.db"
        with closing(sqlite3.connect(path)) as connection, connection:
            connection.executescript("""
                CREATE TABLE conversations(id TEXT PRIMARY KEY,title TEXT NOT NULL,workspace TEXT NOT NULL,
                    native_thread_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
                CREATE TABLE jobs(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,created_at TEXT NOT NULL,model TEXT,effort TEXT,status TEXT);
                CREATE TABLE approvals(id TEXT PRIMARY KEY,job_id TEXT,native_id TEXT,kind TEXT,description TEXT,state TEXT);
                CREATE TABLE items(job_id TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL,PRIMARY KEY(job_id,id));
                INSERT INTO conversations VALUES ('saved','Original','workspace','native-kept','before','before');
                INSERT INTO jobs(id,conversation_id,created_at,status) VALUES ('job-kept','saved','before','completed');
                PRAGMA user_version=2;
            """)
        store = Store(path)
        self.assertEqual(store.conversation("saved")["native_thread_id"],"native-kept")
        self.assertEqual(store.conversation("saved")["pinned"],0)
        with closing(open_store(path)) as connection:
            self.assertEqual(connection.execute("SELECT id FROM jobs").fetchone()[0],"job-kept")
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0],8)

    def test_version_five_migration_preserves_history_inputs_context_and_events(self):
        path=self.settings.data_dir/'version-five.db'
        with closing(sqlite3.connect(path)) as db,db:
            db.executescript("""
                CREATE TABLE service_runs(id TEXT PRIMARY KEY,started_at TEXT,stopped_at TEXT,outcome TEXT);
                CREATE TABLE conversations(id TEXT PRIMARY KEY,title TEXT,workspace TEXT,native_thread_id TEXT,created_at TEXT,updated_at TEXT,pinned INTEGER DEFAULT 0,parent_conversation_id TEXT,parent_before_job_id TEXT,fork_source_thread_id TEXT,fork_last_turn_id TEXT,fork_request_key TEXT,archived INTEGER DEFAULT 0);
                CREATE TABLE jobs(id TEXT PRIMARY KEY,conversation_id TEXT,owner TEXT,request_key TEXT,prompt TEXT,model TEXT,effort TEXT,status TEXT,native_turn_id TEXT,error_code TEXT,created_at TEXT,finished_at TEXT,UNIQUE(conversation_id,request_key));
                CREATE TABLE items(job_id TEXT,id TEXT,kind TEXT,text TEXT,status TEXT,PRIMARY KEY(job_id,id));
                CREATE TABLE approvals(id TEXT PRIMARY KEY,job_id TEXT,native_id TEXT,kind TEXT,description TEXT,state TEXT);
                CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT,payload TEXT);
                CREATE TABLE attachments(id TEXT PRIMARY KEY,name TEXT,mime TEXT,content BLOB,created_at TEXT);
                CREATE TABLE job_inputs(job_id TEXT PRIMARY KEY,payload TEXT);
                CREATE TABLE conversation_context(conversation_id TEXT PRIMARY KEY,used INTEGER,window INTEGER,updated_at TEXT);
                INSERT INTO conversations(id,title,workspace,native_thread_id,created_at,updated_at,pinned) VALUES ('chat','Saved','workspace','native-thread','before','before',1);
                INSERT INTO jobs VALUES ('turn','chat','old-owner','key','original prompt',NULL,NULL,'completed','native-turn',NULL,'before','later');
                INSERT INTO items VALUES ('turn','reply','assistant','saved reply','completed');
                INSERT INTO events(job_id,payload) VALUES ('turn','{"type":"status","status":"completed"}');
                INSERT INTO attachments VALUES ('image','kept.png','image/png',X'010203','before');
                INSERT INTO job_inputs VALUES ('turn','{"images":[{"id":"image","name":"kept.png","mime":"image/png"}],"skills":[]}');
                INSERT INTO conversation_context VALUES ('chat',3200,10000,'before');
                PRAGMA user_version=5;
            """)
            image=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kxZkAAAAASUVORK5CYII=')
            db.execute('UPDATE attachments SET content=?',(image,))
            db.execute("UPDATE jobs SET model='fixture-model',effort='high'")
            payload=json.loads(db.execute('SELECT payload FROM job_inputs').fetchone()[0]);payload.update(fast_mode=True,permission_mode='read_only',collaboration_mode='plan')
            db.execute('UPDATE job_inputs SET payload=?',(json.dumps(payload),))
            # Compaction is newer but must not erase the last real turn's choices during backfill.
            db.execute("INSERT INTO jobs VALUES ('compact','chat','old-owner','compact-key','',NULL,NULL,'completed','compact-turn',NULL,'later','latest')")
            db.execute("INSERT INTO job_inputs VALUES ('compact','{\"operation\":\"compact\"}')")
        store=Store(path);snapshot=store.conversation('chat');job=store.job('turn')
        self.assertEqual(snapshot['native_thread_id'],'native-thread')
        self.assertEqual(job['native_turn_id'],'native-turn')
        self.assertEqual(job['items'][0]['text'],'saved reply')
        self.assertEqual(job['items'][0]['detail'],{})
        self.assertEqual(job['inputs']['images'][0]['id'],'image')
        attachment=store.attachment('image',True)
        self.assertEqual(attachment['content'],image)
        self.assertEqual((attachment['width'],attachment['height']),(1,1))
        self.assertEqual((job['inputs']['images'][0]['width'],job['inputs']['images'][0]['height']),(1,1))
        self.assertEqual(json.loads(snapshot['run_settings']),dict(model='fixture-model',effort='high',fast_mode=True,permission_mode='read_only',collaboration_mode='plan'))
        self.assertEqual(snapshot['context']['used'],3200)
        self.assertEqual(len(store.events('turn',0)),1)
        self.assertEqual(job['retired'],0)
