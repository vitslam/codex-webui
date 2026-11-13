"""Versioned local store. Mutations and replayable events share transactions."""

from __future__ import annotations

from contextlib import closing
from pathlib import Path
import sqlite3
import json
import uuid
import base64
import hashlib
import time
from datetime import datetime, timezone

ACTIVE = ("queued", "running", "cancelling")
TERMINAL = ("completed", "failed", "cancelled", "interrupted")


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class StoreError(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def open_store(path: Path) -> sqlite3.Connection:
    if path.is_symlink():
        raise ValueError("Database cannot be a symlink.")
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    path.chmod(0o600)
    try:
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version > 8:
            raise ValueError("Database version is newer than this application; do not downgrade it.")
        if version == 0:
            with connection:
                connection.execute("""CREATE TABLE IF NOT EXISTS service_runs (
                    id TEXT PRIMARY KEY, started_at TEXT NOT NULL, stopped_at TEXT,
                    outcome TEXT NOT NULL DEFAULT 'running')""")
                connection.execute("PRAGMA user_version=1")
        if version < 2:
            with connection:
                connection.executescript("""
                    CREATE TABLE IF NOT EXISTS conversations (
                        id TEXT PRIMARY KEY, title TEXT NOT NULL, workspace TEXT NOT NULL,
                        native_thread_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
                    CREATE TABLE IF NOT EXISTS jobs (
                        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id),
                        owner TEXT NOT NULL, request_key TEXT NOT NULL, prompt TEXT NOT NULL,
                        model TEXT, effort TEXT, status TEXT NOT NULL, native_turn_id TEXT,
                        error_code TEXT, created_at TEXT NOT NULL, finished_at TEXT,
                        UNIQUE(conversation_id, request_key));
                    CREATE UNIQUE INDEX IF NOT EXISTS one_active_per_conversation
                        ON jobs(conversation_id) WHERE status IN ('running', 'cancelling');
                    CREATE TABLE IF NOT EXISTS items (
                        job_id TEXT NOT NULL REFERENCES jobs(id), id TEXT NOT NULL,
                        kind TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL,
                        PRIMARY KEY(job_id,id));
                    CREATE TABLE IF NOT EXISTS approvals (
                        id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id),
                        native_id TEXT NOT NULL, kind TEXT NOT NULL, description TEXT NOT NULL,
                        state TEXT NOT NULL DEFAULT 'pending');
                    CREATE TABLE IF NOT EXISTS events (
                        id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES jobs(id),
                        payload TEXT NOT NULL);
                    CREATE INDEX IF NOT EXISTS events_by_job ON events(job_id,id);
                    PRAGMA user_version=2;
                """)
        if version < 3:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                for name, declaration in {
                    "pinned":"INTEGER NOT NULL DEFAULT 0", "parent_conversation_id":"TEXT",
                    "parent_before_job_id":"TEXT", "fork_source_thread_id":"TEXT",
                    "fork_last_turn_id":"TEXT", "fork_request_key":"TEXT",
                }.items():
                    connection.execute(f"ALTER TABLE conversations ADD COLUMN {name} {declaration}")
                connection.execute("CREATE UNIQUE INDEX fork_request ON conversations(parent_conversation_id,fork_request_key)")
                # A single-column SQLite index also sorts its implicit rowid suffix;
                # this supports history's (conversation_id, rowid) keyset directly.
                connection.execute("CREATE INDEX jobs_history ON jobs(conversation_id)")
                connection.execute("PRAGMA user_version=3")
        if version < 4:
            with connection:
                connection.executescript("""
                    BEGIN IMMEDIATE;
                    CREATE TABLE attachments (id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL,
                        content BLOB NOT NULL, created_at TEXT NOT NULL);
                    CREATE TABLE job_inputs (job_id TEXT PRIMARY KEY REFERENCES jobs(id), payload TEXT NOT NULL);
                    CREATE TABLE conversation_context (conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),
                        used INTEGER NOT NULL, window INTEGER NOT NULL, updated_at TEXT NOT NULL);
                    PRAGMA user_version=4;
                    COMMIT;
                """)
        if version < 5:
            with connection:
                connection.execute("ALTER TABLE conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0")
                connection.execute("PRAGMA user_version=5")
        if version < 6:
            with connection:
                connection.executescript("""
                    BEGIN IMMEDIATE;
                    ALTER TABLE jobs ADD COLUMN retired INTEGER NOT NULL DEFAULT 0;
                    ALTER TABLE items ADD COLUMN detail TEXT NOT NULL DEFAULT '{}';
                    ALTER TABLE conversations ADD COLUMN pin_order INTEGER NOT NULL DEFAULT 0;
                    CREATE TABLE job_reports(job_id TEXT PRIMARY KEY REFERENCES jobs(id),payload TEXT NOT NULL);
                    CREATE TABLE output_artifacts(job_id TEXT NOT NULL REFERENCES jobs(id),hash TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,content BLOB NOT NULL,PRIMARY KEY(job_id,hash));
                    CREATE TABLE instructions(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),request_key TEXT NOT NULL,text TEXT NOT NULL,state TEXT NOT NULL,position INTEGER NOT NULL,created_at TEXT NOT NULL,UNIQUE(job_id,request_key));
                    CREATE TABLE questions(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),native_id TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL);
                    CREATE TABLE edits(conversation_id TEXT NOT NULL,request_key TEXT NOT NULL,before_job_id TEXT NOT NULL,text TEXT NOT NULL,job_id TEXT NOT NULL,PRIMARY KEY(conversation_id,request_key));
                    PRAGMA user_version=6;
                    COMMIT;
                """)
        if version < 7:
            with connection:
                connection.execute("CREATE TABLE metadata_cache(section TEXT NOT NULL,scope TEXT NOT NULL,payload TEXT NOT NULL,updated_at REAL NOT NULL,PRIMARY KEY(section,scope))")
                connection.execute("PRAGMA user_version=7")
        if version < 8:
            with connection:
                connection.executescript("""
                    BEGIN IMMEDIATE;
                    ALTER TABLE conversations ADD COLUMN run_settings TEXT NOT NULL DEFAULT '{}';
                    ALTER TABLE conversations ADD COLUMN read_job_id TEXT;
                    ALTER TABLE conversations ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
                    ALTER TABLE conversations ADD COLUMN creation_key TEXT;
                    CREATE UNIQUE INDEX conversation_creation_key ON conversations(creation_key);
                    ALTER TABLE instructions ADD COLUMN skills TEXT NOT NULL DEFAULT '[]';
                    ALTER TABLE approvals ADD COLUMN choices TEXT NOT NULL DEFAULT '[]';
                    ALTER TABLE approvals ADD COLUMN response TEXT;
                    ALTER TABLE items ADD COLUMN detail_version INTEGER NOT NULL DEFAULT 0;
                    ALTER TABLE attachments ADD COLUMN width INTEGER NOT NULL DEFAULT 0;
                    ALTER TABLE attachments ADD COLUMN height INTEGER NOT NULL DEFAULT 0;
                    CREATE TABLE installation_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                    CREATE TABLE request_timings(trace_id TEXT NOT NULL,span_id TEXT NOT NULL,turn_id TEXT NOT NULL,
                        duration_ms REAL NOT NULL,finished_at REAL NOT NULL,failed INTEGER NOT NULL,
                        PRIMARY KEY(trace_id,span_id));
                    DROP INDEX IF EXISTS one_active_per_conversation;
                    CREATE UNIQUE INDEX one_active_per_conversation ON jobs(conversation_id)
                        WHERE retired=0 AND status IN ('queued','running','cancelling');
                    CREATE TRIGGER conversation_job_added AFTER INSERT ON jobs BEGIN
                        UPDATE conversations SET revision=revision+1 WHERE id=new.conversation_id; END;
                    CREATE TRIGGER conversation_job_changed AFTER UPDATE OF status,retired ON jobs BEGIN
                        UPDATE conversations SET revision=revision+1 WHERE id=new.conversation_id; END;
                    CREATE TRIGGER conversation_settings_changed AFTER UPDATE OF run_settings,title,workspace,pinned,pin_order,archived ON conversations BEGIN
                        UPDATE conversations SET revision=revision+1 WHERE id=new.id; END;
                """)
                from .image_sizes import image_dimensions
                for row in connection.execute('SELECT id,content FROM attachments'):
                    connection.execute('UPDATE attachments SET width=?,height=? WHERE id=?',(*image_dimensions(row['content']),row['id']))
                # Restore the last saved choice for existing conversations, without starting work.
                for row in connection.execute('SELECT id FROM conversations'):
                    for last in connection.execute('SELECT j.model,j.effort,i.payload FROM jobs j LEFT JOIN job_inputs i ON i.job_id=j.id WHERE j.conversation_id=? AND j.retired=0 ORDER BY j.rowid DESC',(row['id'],)):
                        inputs=json.loads(last['payload'] or '{}')
                        if inputs.get('operation')=='compact':continue
                        values={k:inputs[k] for k in ('fast_mode','permission_mode','collaboration_mode') if k in inputs}
                        values.update(model=last['model'],effort=last['effort'])
                        connection.execute('UPDATE conversations SET run_settings=? WHERE id=?',(json.dumps(values),row['id']))
                        break
                connection.execute('PRAGMA user_version=8')
        return connection
    except Exception:
        connection.close()
        raise


def record_start(path: Path, instance: str, started: str) -> None:
    with closing(open_store(path)) as connection, connection:
        connection.execute("INSERT INTO service_runs(id, started_at) VALUES (?, ?)", (instance, started))


def record_stop(path: Path, instance: str, stopped: str) -> None:
    with closing(open_store(path)) as connection, connection:
        connection.execute("UPDATE service_runs SET stopped_at=?, outcome='stopped' WHERE id=?",
                           (stopped, instance))


class Store:
    def __init__(self, path: Path):
        self.path = path
        with closing(open_store(path)):
            pass

    def connect(self):
        # Migrations run once at startup, not for every streamed delta.
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    @staticmethod
    def event(db, job: str, payload: dict):
        db.execute("INSERT INTO events(job_id,payload) VALUES (?,?)", (job, json.dumps(payload)))

    def conversations(self) -> list[dict]:
        with closing(self.connect()) as db:
            return [dict(row) for row in db.execute("""SELECT c.*,
                (SELECT status FROM jobs WHERE retired=0 AND conversation_id=c.id ORDER BY rowid DESC LIMIT 1) AS status
                FROM conversations c ORDER BY updated_at DESC, id DESC LIMIT 500""")]

    def create_conversation(self, workspace: str, title: str = "", settings=None, key=None) -> dict:
        identifier, stamp = uuid.uuid4().hex, now()
        with closing(self.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            if key:
                old=db.execute('SELECT id,workspace FROM conversations WHERE creation_key=?',(key,)).fetchone()
                if old:
                    if old['workspace']!=workspace:raise StoreError('request_key_conflict')
                    return self.conversation(old['id'])
            db.execute("INSERT INTO conversations(id,title,workspace,native_thread_id,created_at,updated_at) VALUES (?,?,?,NULL,?,?)",
                       (identifier, title.strip()[:100] or "", workspace, stamp, stamp))
            if settings:db.execute('UPDATE conversations SET run_settings=? WHERE id=?',(json.dumps(settings),identifier))
            if key:db.execute('UPDATE conversations SET creation_key=? WHERE id=?',(key,identifier))
        return self.conversation(identifier)

    def conversation(self, identifier: str) -> dict:
        with closing(self.connect()) as db:
            row = db.execute("SELECT * FROM conversations WHERE id=? AND archived=0", (identifier,)).fetchone()
            if not row:
                raise StoreError("not_found")
            result = dict(row)
            context = db.execute("SELECT used,window,updated_at FROM conversation_context WHERE conversation_id=?",(identifier,)).fetchone()
            result["context"] = dict(context) if context else None
            return result

    def metadata(self, section, scope):
        with closing(self.connect()) as db:
            row=db.execute("SELECT payload,updated_at FROM metadata_cache WHERE section=? AND scope=?",(section,scope)).fetchone()
            return (json.loads(row[0]),row[1]) if row else None

    def save_metadata(self, section, scope, value, stamp):
        with closing(self.connect()) as db,db:
            db.execute("INSERT OR REPLACE INTO metadata_cache VALUES (?,?,?,?)",(section,scope,json.dumps(value),stamp))

    def clear_metadata(self, section=None):
        with closing(self.connect()) as db,db:
            db.execute("DELETE FROM metadata_cache WHERE section=?" if section else "DELETE FROM metadata_cache",(section,) if section else ())

    def job(self, identifier: str) -> dict:
        with closing(self.connect()) as db:
            db.execute("BEGIN")
            result=self.job_snapshots(db,[identifier])
            if not result:raise StoreError("not_found")
            return result[0]

    def job_snapshots(self, db, identifiers, summary=False):
        """One transaction and a bounded number of reads for a complete history page."""
        if not identifiers:return []
        marks=','.join('?' for _ in identifiers)
        jobs={}
        for row in db.execute(f"SELECT rowid AS history_position,* FROM jobs WHERE id IN ({marks})",identifiers):
            job=dict(row);job.pop('owner');job['client_request_id']=job.pop('request_key')
            job.update(inputs={"images":[],"skills":[]},items=[],report={},artifacts=[],instructions=[],questions=[],approvals=[],cursor=0)
            jobs[job['id']]=job
        for row in db.execute(f"SELECT * FROM job_inputs WHERE job_id IN ({marks})",identifiers):jobs[row['job_id']]['inputs']=json.loads(row['payload'])
        image_ids={image['id'] for job in jobs.values() for image in job['inputs'].get('images',[])}
        if image_ids:
            images={row['id']:dict(row) for row in db.execute('SELECT id,width,height FROM attachments WHERE id IN ('+','.join('?' for _ in image_ids)+')',list(image_ids))}
            for job in jobs.values():
                for image in job['inputs'].get('images',[]):image.update(images.get(image['id'],{}))
        # Terminal history only carries final prose; process details load on disclosure.
        condition=" AND (kind='assistant' OR job_id IN (SELECT id FROM jobs WHERE status IN ('queued','running','cancelling')))" if summary else ""
        item_columns="job_id,id,kind,CASE WHEN kind='command' THEN substr(text,1,160) ELSE text END AS text,status,CASE WHEN kind='command' THEN '{}' ELSE detail END AS detail,detail_version" if summary else '*'
        for row in db.execute(f"SELECT {item_columns} FROM items WHERE job_id IN ({marks})"+condition+" ORDER BY rowid",identifiers):
            item=dict(row);job=jobs[item.pop('job_id')];item['detail']={} if summary and job['status'] not in ACTIVE else json.loads(item['detail']);job['items'].append(item)
            if summary and item['kind']=='command':item['detail']=dict(type='command_execution',command=item['text'].split('\n',1)[0],details_deferred=True,detail_version=item['detail_version'])
        for row in db.execute(f"SELECT * FROM job_reports WHERE job_id IN ({marks})",identifiers):
            job=jobs[row['job_id']];report=json.loads(row['payload'])
            if summary and job['status'] not in ACTIVE and report.get('changes'):
                report['changes']={k:v for k,v in report['changes'].items() if k in ('state','reason','file_count','additions','deletions')}
            job['report']=report
        for row in db.execute(f"SELECT job_id,hash,name,mime,length(content) AS size FROM output_artifacts WHERE job_id IN ({marks})",identifiers):
            jobs[row['job_id']]['artifacts'].append(self.artifact_info(row['job_id'],row))
        for table,columns in [('instructions','id,job_id,text,state,position,created_at,skills'),('questions','*'),('approvals','id,job_id,kind,description,state,choices')]:
            for row in db.execute(f"SELECT {columns} FROM {table} WHERE job_id IN ({marks}) ORDER BY rowid",identifiers):
                value=dict(row);job=jobs[value.pop('job_id')]
                if table=='questions':value=dict(id=value['id'],state=value['state'],**json.loads(value['payload']))
                if table=='instructions':value['skills']=json.loads(value['skills'])
                if table=='approvals':value['choices']=json.loads(value['choices'])
                job[table].append(value)
        contexts={row['conversation_id']:dict(used=row['used'],window=row['window'],updated_at=row['updated_at']) for row in db.execute(f"SELECT * FROM conversation_context WHERE conversation_id IN (SELECT conversation_id FROM jobs WHERE id IN ({marks}))",identifiers)}
        threads={row['id']:row['native_thread_id'] for row in db.execute(f"SELECT id,native_thread_id FROM conversations WHERE id IN (SELECT conversation_id FROM jobs WHERE id IN ({marks}))",identifiers)}
        for row in db.execute(f"SELECT job_id,MAX(id) AS cursor FROM events WHERE job_id IN ({marks}) GROUP BY job_id",identifiers):jobs[row['job_id']]['cursor']=row['cursor']
        for job in jobs.values():
            job['context']=contexts.get(job['conversation_id']);job['native_thread_id']=threads.get(job['conversation_id'])
            if summary and job['status'] not in ACTIVE:job['steps_deferred']=True
        return [jobs[i] for i in identifiers if i in jobs]

    def steps(self, identifier, offset=0, through=None, limit=100, preview=False):
        with closing(self.connect()) as db:
            db.execute('BEGIN')
            if not db.execute("SELECT 1 FROM jobs WHERE id=?",(identifier,)).fetchone():raise StoreError('not_found')
            amount=min(limit,through-offset) if through is not None else limit
            columns="id,kind,CASE WHEN kind='command' THEN substr(text,1,160) ELSE text END AS text,status,CASE WHEN kind='command' THEN '{}' ELSE detail END AS detail,detail_version" if preview else "id,kind,text,status,detail,detail_version"
            rows=list(db.execute(f"SELECT {columns} FROM items WHERE job_id=? ORDER BY rowid LIMIT ? OFFSET ?",(identifier,amount+1,offset)))
            more=len(rows)>amount and (through is None or offset+amount<through)
            items=[]
            for row in rows[:amount]:
                item=dict(row);item['detail']=json.loads(item['detail'])
                if preview and item['kind']=='command':item['detail']=dict(type='command_execution',command=item['text'].split('\n',1)[0],details_deferred=True,detail_version=item['detail_version'])
                items.append(item)
            return dict(items=items,has_more=more,next_offset=offset+len(items))

    def history(self, conversation: str, limit: int = 30, before=None, after=None, anchor=None, summary=False) -> dict:
        with closing(self.connect()) as db:
            db.execute("BEGIN")
            row=db.execute("SELECT * FROM conversations WHERE id=? AND archived=0",(conversation,)).fetchone()
            if not row:raise StoreError("not_found")
            result=dict(row)
            context=db.execute("SELECT used,window,updated_at FROM conversation_context WHERE conversation_id=?",(conversation,)).fetchone()
            result["context"]=dict(context) if context else None
            boundary = None
            if before or after or anchor:
                row = db.execute("SELECT rowid FROM jobs WHERE retired=0 AND conversation_id=? AND id=?",(conversation,before or after or anchor)).fetchone()
                if not row:
                    raise StoreError("invalid_cursor")
                boundary = row[0]
            if anchor:
                left = list(db.execute("SELECT id,rowid FROM jobs WHERE retired=0 AND conversation_id=? AND rowid<=? ORDER BY rowid DESC LIMIT ?",(conversation,boundary,(limit+1)//2)))
                right = list(db.execute("SELECT id,rowid FROM jobs WHERE retired=0 AND conversation_id=? AND rowid>? ORDER BY rowid LIMIT ?",(conversation,boundary,limit-len(left))))
                rows = list(reversed(left))+right
            elif after:
                rows = list(db.execute("SELECT id,rowid FROM jobs WHERE retired=0 AND conversation_id=? AND rowid>? ORDER BY rowid LIMIT ?",(conversation,boundary,limit)))
            else:
                rows = list(db.execute("SELECT id,rowid FROM jobs WHERE retired=0 AND conversation_id=? AND rowid<? ORDER BY rowid DESC LIMIT ?",(conversation,boundary or 9223372036854775807,limit)))
                rows.reverse()
            ids = [row[0] for row in rows]
            result["older_cursor"] = rows[0][0] if rows and db.execute("SELECT 1 FROM jobs WHERE retired=0 AND conversation_id=? AND rowid<? LIMIT 1",(conversation,rows[0][1])).fetchone() else None
            result["newer_cursor"] = rows[-1][0] if rows and db.execute("SELECT 1 FROM jobs WHERE retired=0 AND conversation_id=? AND rowid>? LIMIT 1",(conversation,rows[-1][1])).fetchone() else None
            active = db.execute("SELECT id FROM jobs WHERE retired=0 AND conversation_id=? AND status IN ('queued','running','cancelling')",(conversation,)).fetchone()
            all_ids=ids+([active[0]] if active and active[0] not in ids else [])
            snapshots={job['id']:job for job in self.job_snapshots(db,all_ids,summary)}
            result["jobs"]=[snapshots[i] for i in ids]
            result["active_job"]=snapshots[active[0]] if active and active[0] not in ids else None
            result["history_revision"]=db.execute("SELECT COALESCE(MAX(rowid),0) FROM edits WHERE conversation_id=?",(conversation,)).fetchone()[0]
        return result

    def conversation_page(self, limit: int = 50, cursor: str | None = None, query: str = "") -> dict:
        where, values = "WHERE c.archived=0", []
        if cursor:
            try:
                parts=json.loads(base64.urlsafe_b64decode(cursor.encode()+b"="*(-len(cursor)%4)))
                pin, rank, stamp, identifier = parts if len(parts)==4 else [parts[0],0,*parts[1:]]
                if type(pin) is not int or pin not in (0,1) or type(rank) is not int or not isinstance(stamp,str) or not isinstance(identifier,str):
                    raise ValueError
            except (ValueError,TypeError,UnicodeError) as exc:
                raise StoreError("invalid_cursor") from exc
            where += " AND (c.pinned,c.pin_order,c.updated_at,c.id)<(?,?,?,?)"
            values = [pin,rank,stamp,identifier]
        if query:
            where += (" AND " if where else "WHERE ")+"(instr(lower(c.title),lower(?))>0 OR EXISTS(SELECT 1 FROM jobs j WHERE j.retired=0 AND j.conversation_id=c.id AND (instr(lower(j.prompt),lower(?))>0 OR EXISTS(SELECT 1 FROM items i WHERE i.job_id=j.id AND instr(lower(i.text),lower(?))>0))))"
            values.extend([query,query,query])
        with closing(self.connect()) as db:
            rows = [dict(row) for row in db.execute(f"""SELECT c.*,
                (SELECT status FROM jobs WHERE retired=0 AND conversation_id=c.id ORDER BY rowid DESC LIMIT 1) AS status,
                (SELECT id FROM jobs WHERE retired=0 AND conversation_id=c.id ORDER BY rowid DESC LIMIT 1) AS last_job_id
                FROM conversations c {where} ORDER BY c.pinned DESC,c.pin_order DESC,c.updated_at DESC,c.id DESC LIMIT ?""",[*values,limit+1])]
            if query:
                for row in rows:
                    match=db.execute("""SELECT text FROM (SELECT prompt AS text FROM jobs WHERE retired=0 AND conversation_id=?
                        UNION ALL SELECT i.text FROM items i JOIN jobs j ON i.job_id=j.id WHERE j.retired=0 AND j.conversation_id=?)
                        WHERE instr(lower(text),lower(?))>0 LIMIT 1""",(row["id"],row["id"],query)).fetchone()
                    if match:
                        index=match[0].lower().find(query.lower());start=max(0,index-50)
                        row["snippet"]=("…" if start else "")+match[0][start:start+200]+("…" if start+200<len(match[0]) else "")
        more = len(rows)>limit
        rows = rows[:limit]
        cursor = None
        if rows and more:
            last = rows[-1]
            cursor = base64.urlsafe_b64encode(json.dumps([last["pinned"],last["pin_order"],last["updated_at"],last["id"]]).encode()).decode().rstrip("=")
        with closing(self.connect()) as db:removed=[row[0] for row in db.execute('SELECT id FROM conversations WHERE archived=1 ORDER BY rowid DESC LIMIT 1000')]
        return {"conversations":rows,"next_cursor":cursor,"removed_ids":removed}

    def archived_page(self, limit=50, cursor=None, query='', workspace=None):
        where, values = 'WHERE c.archived=1', []
        boundary=None
        if cursor:
            try:
                stamp, identifier = json.loads(base64.urlsafe_b64decode(cursor.encode()+b'='*(-len(cursor)%4)))
                if not isinstance(stamp,str) or not isinstance(identifier,str): raise ValueError()
            except (ValueError,TypeError,UnicodeError) as exc:
                raise StoreError('invalid_cursor') from exc
            boundary=[stamp,identifier]
        if workspace is not None:
            where += ' AND c.workspace=?'; values.append(workspace)
        if query:
            where += ''' AND (instr(lower(c.title),lower(?))>0 OR EXISTS(
                SELECT 1 FROM jobs j WHERE j.retired=0 AND j.conversation_id=c.id AND
                (instr(lower(j.prompt),lower(?))>0 OR EXISTS(SELECT 1 FROM items i
                WHERE i.job_id=j.id AND instr(lower(i.text),lower(?))>0))))'''
            values.extend([query,query,query])
        with closing(self.connect()) as db:
            db.execute('BEGIN')
            counts={row[0]:row[1] for row in db.execute(f'SELECT c.workspace,COUNT(*) FROM conversations c {where} GROUP BY c.workspace',values)}
            if boundary:
                where += ' AND (c.updated_at,c.id)<(?,?)';values.extend(boundary)
            rows=[dict(row) for row in db.execute(f'''SELECT c.id,c.title,c.workspace,c.updated_at
                FROM conversations c {where} ORDER BY c.updated_at DESC,c.id DESC LIMIT ?''',[*values,limit+1])]
            workspaces=[row[0] for row in db.execute('SELECT DISTINCT workspace FROM conversations WHERE archived=1 ORDER BY workspace')]
        more=len(rows)>limit; rows=rows[:limit]
        next_cursor=base64.urlsafe_b64encode(json.dumps([rows[-1]['updated_at'],rows[-1]['id']]).encode()).decode().rstrip('=') if more else None
        return {'conversations':rows,'workspaces':workspaces,'counts':counts,'next_cursor':next_cursor}

    def restore(self, identifier):
        with closing(self.connect()) as db,db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT 1 FROM conversations WHERE id=?',(identifier,)).fetchone(): raise StoreError('not_found')
            db.execute('UPDATE conversations SET archived=0 WHERE id=? AND archived=1',(identifier,))
        return self.conversation(identifier)

    def update_conversation(self, identifier: str, title=None, pinned=None) -> dict:
        self.conversation(identifier)
        with closing(self.connect()) as db, db:
            if title is not None:
                db.execute("UPDATE conversations SET title=? WHERE id=?",(title,identifier))
            if pinned is not None:
                db.execute("UPDATE conversations SET pin_order=CASE WHEN ?=0 THEN 0 WHEN pinned=0 THEN (SELECT COALESCE(MAX(pin_order),0)+1 FROM conversations WHERE archived=0) ELSE pin_order END,pinned=? WHERE id=?",(int(pinned),int(pinned),identifier))
        return self.conversation(identifier)

    def branch(self, source: str, before_job: str, request_key: str, title: str) -> dict:
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            prior = db.execute("SELECT * FROM conversations WHERE parent_conversation_id=? AND fork_request_key=?",(source,request_key)).fetchone()
            if prior:
                if prior["parent_before_job_id"] != before_job:
                    raise StoreError("request_key_conflict")
                return dict(prior)
            original = db.execute("SELECT * FROM conversations WHERE id=?",(source,)).fetchone()
            boundary = db.execute("SELECT rowid FROM jobs WHERE retired=0 AND id=? AND conversation_id=?",(before_job,source)).fetchone()
            if not original or not boundary:
                raise StoreError("not_found")
            retained = list(db.execute("SELECT * FROM jobs WHERE retired=0 AND conversation_id=? AND rowid<? ORDER BY rowid",(source,boundary[0])))
            if any(row["status"] in ACTIVE for row in retained):
                raise StoreError("conversation_busy")
            last_turn = next((row["native_turn_id"] for row in reversed(retained) if row["native_turn_id"]),None)
            native_source = (original["native_thread_id"] or original["fork_source_thread_id"]) if last_turn else None
            if last_turn and not native_source:
                raise StoreError("branch_history_unavailable")
            identifier, stamp = uuid.uuid4().hex, now()
            db.execute("""INSERT INTO conversations(id,title,workspace,created_at,updated_at,parent_conversation_id,
                parent_before_job_id,fork_source_thread_id,fork_last_turn_id,fork_request_key) VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (identifier,title,original["workspace"],stamp,stamp,source,before_job,native_source,last_turn,request_key))
            db.execute('UPDATE conversations SET run_settings=? WHERE id=?',(original['run_settings'],identifier))
            for row in retained:
                new_id = uuid.uuid4().hex
                db.execute("""INSERT INTO jobs(id,conversation_id,owner,request_key,prompt,model,effort,status,
                    native_turn_id,error_code,created_at,finished_at) VALUES (?,?,'history',?,?,?,?,?,?,?,?,?)""",
                    (new_id,identifier,uuid.uuid4().hex,row["prompt"],row["model"],row["effort"],row["status"],
                     row["native_turn_id"],row["error_code"],row["created_at"],row["finished_at"]))
                db.execute("INSERT INTO items SELECT ?,id,kind,text,status,detail,detail_version FROM items WHERE job_id=?",(new_id,row["id"]))
                db.execute("INSERT INTO job_inputs SELECT ?,payload FROM job_inputs WHERE job_id=?",(new_id,row["id"]))
                db.execute("INSERT INTO output_artifacts SELECT ?,hash,name,mime,content FROM output_artifacts WHERE job_id=?",(new_id,row['id']))
                report=db.execute('SELECT payload FROM job_reports WHERE job_id=?',(row['id'],)).fetchone()
                if report:db.execute('INSERT INTO job_reports VALUES (?,?)',(new_id,report[0].replace('/api/jobs/'+row['id']+'/', '/api/jobs/'+new_id+'/')))
                db.execute('UPDATE items SET text=replace(text,?,?),detail=replace(detail,?,?) WHERE job_id=?',('/api/jobs/'+row['id']+'/', '/api/jobs/'+new_id+'/', '/api/jobs/'+row['id']+'/', '/api/jobs/'+new_id+'/',new_id))
                for instruction in db.execute('SELECT * FROM instructions WHERE job_id=? ORDER BY rowid',(row['id'],)):
                    db.execute('INSERT INTO instructions VALUES (?,?,?,?,?,?,?,?)',(uuid.uuid4().hex,new_id,uuid.uuid4().hex,instruction['text'],instruction['state'],instruction['position'],instruction['created_at'],instruction['skills']))

        return self.conversation(identifier)

    def active(self) -> list[dict]:
        with closing(self.connect()) as db:
            return [dict(row) for row in db.execute("SELECT * FROM jobs WHERE status IN ('queued','running','cancelling') ORDER BY rowid")]

    def queued(self) -> list[dict]:
        with closing(self.connect()) as db:
            return [dict(row) for row in db.execute("SELECT id,conversation_id FROM jobs WHERE status='queued' ORDER BY rowid")]

    def reserve(self, conversation: str, owner: str, key: str, prompt: str,
                model: str | None, effort: str | None, inputs=None, queued=False) -> tuple[dict, bool]:
        inputs = inputs or {"images":[],"skills":[]}
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            prior = db.execute("SELECT * FROM jobs WHERE conversation_id=? AND request_key=?", (conversation,key)).fetchone()
            if prior:
                if prior['retired']:raise StoreError('request_key_conflict')
                old_inputs = db.execute("SELECT payload FROM job_inputs WHERE job_id=?",(prior["id"],)).fetchone()
                if (prior["prompt"], prior["model"], prior["effort"]) != (prompt, model, effort) or (json.loads(old_inputs[0]) if old_inputs else {"images":[],"skills":[]}) != inputs:
                    raise StoreError("request_key_conflict")
                return self.job(prior["id"]), False
            row = db.execute("SELECT id FROM conversations WHERE id=?", (conversation,)).fetchone()
            if not row:
                raise StoreError("not_found")
            if db.execute("SELECT 1 FROM jobs WHERE retired=0 AND conversation_id=? AND status IN ('queued','running','cancelling')", (conversation,)).fetchone():
                raise StoreError("conversation_busy")
            if db.execute("SELECT COUNT(*) FROM jobs WHERE status IN ('queued','running','cancelling')").fetchone()[0] >= (100 if queued else 4):
                raise StoreError("capacity_reached")
            identifier, stamp = uuid.uuid4().hex, now()
            db.execute("""INSERT INTO jobs(id,conversation_id,owner,request_key,prompt,model,effort,status,created_at)
                VALUES (?,?,?,?,?,?,?,'running',?)""", (identifier,conversation,owner,key,prompt,model,effort,stamp))
            db.execute("INSERT INTO job_inputs VALUES (?,?)",(identifier,json.dumps(inputs)))
            if queued:db.execute("UPDATE jobs SET status='queued' WHERE id=?",(identifier,))
            if inputs.get('operation')!='compact':
                saved=json.loads(db.execute('SELECT run_settings FROM conversations WHERE id=?',(conversation,)).fetchone()[0])
                saved.update(model=model,effort=effort,**{k:inputs[k] for k in ('fast_mode','permission_mode','collaboration_mode') if k in inputs})
                db.execute('UPDATE conversations SET run_settings=? WHERE id=?',(json.dumps(saved),conversation))
            db.execute("UPDATE conversations SET updated_at=?, title=CASE WHEN title='' THEN ? ELSE title END WHERE id=?",
                       (stamp, (prompt.strip().splitlines() or ["Image / Skill"])[0][:70], conversation))
            self.event(db,identifier,{"type":"status", "status":"queued" if queued else "running"})
        return self.job(identifier), True

    def native_thread(self, conversation: str, thread: str):
        with closing(self.connect()) as db, db:
            db.execute("UPDATE conversations SET native_thread_id=? WHERE id=?", (thread,conversation))

    def native_turn(self, identifier: str, turn: str):
        with closing(self.connect()) as db, db:
            db.execute("UPDATE jobs SET native_turn_id=? WHERE id=?", (turn,identifier))

    def item(self, job: str, identifier: str, kind: str, text: str, status: str, delta: bool = False):
        with closing(self.connect()) as db, db:
            db.execute("""INSERT INTO items(job_id,id,kind,text,status) VALUES (?,?,?,?,?)
                ON CONFLICT(job_id,id) DO UPDATE SET kind=excluded.kind,
                text=CASE WHEN ? THEN items.text || excluded.text ELSE excluded.text END, status=excluded.status,detail_version=items.detail_version+1""",
                       (job,identifier,kind,text,status,delta))
            if kind=='command':
                row=db.execute('SELECT substr(text,1,160),detail_version FROM items WHERE job_id=? AND id=?',(job,identifier)).fetchone()
                preview=row[0].split('\n',1)[0]
                self.event(db,job,dict(type='item',id=identifier,kind=kind,text=preview,status=status,
                    detail=dict(type='command_execution',command=preview,details_deferred=True,detail_version=row[1])))
            else:self.event(db, job, {"type":"delta" if delta else "item", "id":identifier,"kind":kind, "text":text,"status":status})

    def approval(self, job: str, native_id, kind: str, description: str, choices=None) -> str:
        identifier = uuid.uuid4().hex
        with closing(self.connect()) as db, db:
            public=choices or [dict(label='approval.allow_once',response={'decision':'accept'}),dict(label='approval.decline',response={'decision':'decline'})]
            db.execute("INSERT INTO approvals(id,job_id,native_id,kind,description,choices) VALUES (?,?,?,?,?,?)",
                       (identifier,job,json.dumps(native_id),kind,description[:12000],json.dumps(public)))
            self.event(db, job, {"type":"approval", "id":identifier,"kind":kind,
                                 "description":description[:12000],"state":"pending","choices":public})
        return identifier

    def decide(self, job: str, approval: str, decision: str):
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            state = db.execute("SELECT status FROM jobs WHERE id=?", (job,)).fetchone()
            row = db.execute("SELECT * FROM approvals WHERE id=? AND job_id=?", (approval,job)).fetchone()
            if not row:
                raise StoreError("not_found")
            if not state or state[0] not in ACTIVE or row["state"] != "pending":
                raise StoreError("approval_expired")
            choices=json.loads(row['choices'])
            if type(decision) is int:
                if not 0<=decision<len(choices):raise StoreError('invalid_decision')
                response=choices[decision]['response'];state='answered'
            elif decision in ('accept','decline'):
                response={'decision':decision};state=decision
                if choices and not any(c['response']==response for c in choices):raise StoreError('invalid_decision')
            else:raise StoreError('invalid_decision')
            db.execute("UPDATE approvals SET state=?,response=? WHERE id=?", (state,json.dumps(response),approval))
            self.event(db,job,{"type":"approval_state","id":approval,"state":state})

    def decisions(self, job: str) -> list[dict]:
        with closing(self.connect()) as db:
            return [dict(row) for row in db.execute("SELECT * FROM approvals WHERE job_id=? AND state IN ('accept','decline','answered')",(job,))]

    def expire_approval(self, job, native_id):
        with closing(self.connect()) as db,db:
            row=db.execute("SELECT id FROM approvals WHERE job_id=? AND native_id=? AND state='pending'",(job,json.dumps(native_id))).fetchone()
            if row:
                db.execute("UPDATE approvals SET state='expired' WHERE id=?",(row['id'],))
                self.event(db,job,{'type':'approval_state','id':row['id'],'state':'expired'})

    def cancelling(self, job: str):
        with closing(self.connect()) as db, db:
            if db.execute("UPDATE jobs SET status='cancelling' WHERE id=? AND status='running'",(job,)).rowcount:
                self.event(db,job,{"type":"status","status":"cancelling"})

    def finish(self, job: str, status: str, error: str | None = None):
        if status not in TERMINAL:
            raise ValueError("Invalid terminal task status")
        with closing(self.connect()) as db, db:
            if db.execute("UPDATE jobs SET status=?,error_code=?,finished_at=? WHERE id=? AND status IN ('queued','running','cancelling')",
                          (status,error,now(),job)).rowcount:
                db.execute("UPDATE approvals SET state='expired' WHERE job_id=? AND state='pending'",(job,))
                db.execute("UPDATE items SET status=? WHERE job_id=? AND status='running'",(status,job))
                db.execute("UPDATE questions SET state='expired' WHERE job_id=? AND state IN ('pending','answering')",(job,))
                db.execute("UPDATE instructions SET state='failed' WHERE job_id=? AND state='pending'",(job,))
                self.event(db,job,{"type":"status","status":status,"error_code":error,"finished_at":now()})

    def events(self, job: str, after: int) -> list[dict]:
        with closing(self.connect()) as db:
            return [{"id": row[0], "data":json.loads(row[1])} for row in db.execute(
                "SELECT id,payload FROM events WHERE job_id=? AND id>? ORDER BY id LIMIT 200",(job,after))]

    def state(self, job: str) -> str:
        with closing(self.connect()) as db:
            row = db.execute("SELECT status FROM jobs WHERE id=?",(job,)).fetchone()
            if not row:
                raise StoreError("not_found")
            return row[0]

    def context_usage(self, conversation, job, used, window):
        with closing(self.connect()) as db, db:
            value = {"used":used,"window":window,"updated_at":now()}
            db.execute("INSERT INTO conversation_context VALUES (?,?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET used=excluded.used,window=excluded.window,updated_at=excluded.updated_at",(conversation,used,window,value["updated_at"]))
            self.event(db,job,{"type":"context","usage":value})

    def attachment(self, identifier, content=False):
        with closing(self.connect()) as db:
            row = db.execute("SELECT id,name,mime,width,height"+(",content" if content else "")+" FROM attachments WHERE id=?",(identifier,)).fetchone()
            if not row: raise StoreError("attachment_unavailable")
            return dict(row)

    def add_attachment(self, name, mime, content):
        identifier = uuid.uuid4().hex
        with closing(self.connect()) as db, db:
            from .image_sizes import image_dimensions
            db.execute("INSERT INTO attachments VALUES (?,?,?,?,?,?,?)",(identifier,name,mime,content,now(),*image_dimensions(content)))
        return self.attachment(identifier)

    def workspace(self, identifier, workspace):
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT native_thread_id FROM conversations WHERE id=?",(identifier,)).fetchone()
            if not row: raise StoreError("not_found")
            if db.execute("SELECT 1 FROM jobs WHERE retired=0 AND conversation_id=? AND status IN ('queued','running','cancelling')",(identifier,)).fetchone(): raise StoreError("conversation_busy")
            db.execute("UPDATE conversations SET workspace=? WHERE id=?",(workspace,identifier))
        return self.conversation(identifier)

    def clear_context(self, conversation, job):
        with closing(self.connect()) as db, db:
            db.execute("DELETE FROM conversation_context WHERE conversation_id=?",(conversation,))
            self.event(db,job,{"type":"context","usage":None})

    def archive(self, identifier):
        with closing(self.connect()) as db,db:
            db.execute("BEGIN IMMEDIATE")
            if not db.execute("SELECT 1 FROM conversations WHERE id=?",(identifier,)).fetchone():raise StoreError("not_found")
            if db.execute("SELECT 1 FROM jobs WHERE retired=0 AND conversation_id=? AND status IN ('queued','running','cancelling')",(identifier,)).fetchone():raise StoreError("conversation_busy")
            db.execute("UPDATE conversations SET archived=1 WHERE id=?",(identifier,))
        return {"id":identifier,"archived":True}

    def detail(self, job, identifier, payload):
        with closing(self.connect()) as db,db:
            db.execute("UPDATE items SET detail=?,detail_version=detail_version+1 WHERE job_id=? AND id=?",(json.dumps(payload),job,identifier))
            if payload.get('type')=='command_execution':
                version=db.execute('SELECT detail_version FROM items WHERE job_id=? AND id=?',(job,identifier)).fetchone()[0]
                payload=dict(type='command_execution',command=str(payload.get('command',''))[:160],details_deferred=True,detail_version=version)
            self.event(db,job,{"type":"detail","id":identifier,"detail":payload})

    def report(self, job, payload):
        with closing(self.connect()) as db,db:
            previous=db.execute("SELECT payload FROM job_reports WHERE job_id=?",(job,)).fetchone()
            value={**(json.loads(previous[0]) if previous else {}),**payload}
            db.execute("INSERT INTO job_reports VALUES (?,?) ON CONFLICT(job_id) DO UPDATE SET payload=excluded.payload",(job,json.dumps(value)))
            self.event(db,job,{"type":"report","report":value})

    @staticmethod
    def artifact_info(job, row):
        return {"hash":row["hash"],"name":row["name"],"mime":row["mime"],"size":row["size"],"url":f"/api/jobs/{job}/artifacts/{row['hash']}"}

    def save_artifact(self, job, digest, name, mime, content):
        with closing(self.connect()) as db,db:
            db.execute("INSERT OR IGNORE INTO output_artifacts VALUES (?,?,?,?,?)",(job,digest,name,mime,content))
        return self.artifact_info(job,dict(hash=digest,name=name,mime=mime,size=len(content)))

    def output_artifact(self, job, digest):
        with closing(self.connect()) as db:
            row=db.execute("SELECT * FROM output_artifacts WHERE job_id=? AND hash=?",(job,digest)).fetchone()
            if not row:raise StoreError("not_found")
            return dict(row)

    def cleanup_attachments(self, before):
        with closing(self.connect()) as db,db:
            used={image['id'] for row in db.execute("SELECT payload FROM job_inputs") for image in json.loads(row[0]).get('images',[])}
            abandoned=[row[0] for row in db.execute("SELECT id FROM attachments WHERE created_at<?",(before,)) if row[0] not in used]
            db.executemany("DELETE FROM attachments WHERE id=?",[(identifier,) for identifier in abandoned])
        return len(abandoned)

    def reorder_pins(self, identifiers):
        with closing(self.connect()) as db,db:
            db.execute("BEGIN IMMEDIATE")
            available={row[0] for row in db.execute("SELECT id FROM conversations WHERE pinned=1 AND archived=0")}
            if len(set(identifiers))!=len(identifiers) or not set(identifiers).issubset(available):raise StoreError("invalid_conversation_settings")
            # Place the visible reordered page first, preserving every unloaded pin.
            remaining=[row[0] for row in db.execute("SELECT id FROM conversations WHERE pinned=1 AND archived=0 ORDER BY pin_order DESC,updated_at DESC,id DESC") if row[0] not in identifiers]
            ordered=identifiers+remaining
            for index,identifier in enumerate(ordered):db.execute("UPDATE conversations SET pin_order=? WHERE id=?",(len(ordered)-index,identifier))
        return {"ok":True}

    def instruction(self, job, key, text, skills=None):
        skills=skills or []
        with closing(self.connect()) as db,db:
            db.execute("BEGIN IMMEDIATE")
            prior=db.execute("SELECT * FROM instructions WHERE job_id=? AND request_key=?",(job,key)).fetchone()
            if prior:
                if prior['text']!=text or json.loads(prior['skills'])!=skills:raise StoreError('request_key_conflict')
                return {**dict(prior),'skills':skills},False
            if not db.execute("SELECT 1 FROM jobs WHERE id=? AND status='running'",(job,)).fetchone():raise StoreError('instruction_expired')
            identifier=uuid.uuid4().hex
            position=db.execute("SELECT COUNT(*) FROM items WHERE job_id=?",(job,)).fetchone()[0]
            value=dict(id=identifier,text=text,state='pending',position=position,created_at=now(),skills=skills)
            db.execute("INSERT INTO instructions VALUES (?,?,?,?,?,?,?,?)",(identifier,job,key,text,'pending',position,value['created_at'],json.dumps(skills)))
            self.event(db,job,{"type":"instruction","instruction":value})
        return value,True

    def instruction_state(self, job, identifier, state):
        with closing(self.connect()) as db,db:
            db.execute("UPDATE instructions SET state=? WHERE id=? AND job_id=?",(state,identifier,job))
            self.event(db,job,{"type":"instruction_state","id":identifier,"state":state})

    def question(self, job, native_id, payload):
        identifier=uuid.uuid4().hex
        with closing(self.connect()) as db,db:
            db.execute("INSERT INTO questions VALUES (?,?,?,?,?)",(identifier,job,json.dumps(native_id),json.dumps(payload),'pending'))
            self.event(db,job,{"type":"question","question":{"id":identifier,"state":"pending",**payload}})
        return identifier

    def question_answering(self, job, identifier):
        with closing(self.connect()) as db,db:
            db.execute("BEGIN IMMEDIATE")
            row=db.execute("SELECT * FROM questions WHERE id=? AND job_id=? AND state='pending'",(identifier,job)).fetchone()
            if not row or not db.execute("SELECT 1 FROM jobs WHERE id=? AND status='running'",(job,)).fetchone():raise StoreError('question_expired')
            db.execute("UPDATE questions SET state='answering' WHERE id=?",(identifier,))
            return dict(row)

    def question_state(self, job, identifier, state):
        with closing(self.connect()) as db,db:
            db.execute("UPDATE questions SET state=? WHERE id=? AND job_id=?",(state,identifier,job))
            self.event(db,job,{"type":"question_state","id":identifier,"state":state})

    def edit_reserve(self, conversation, before, key, text, owner, queued=False):
        with closing(self.connect()) as db,db:
            db.execute('BEGIN IMMEDIATE')
            prior=db.execute('SELECT * FROM edits WHERE conversation_id=? AND request_key=?',(conversation,key)).fetchone()
            if prior:
                if prior['before_job_id']!=before or prior['text']!=text:raise StoreError('request_key_conflict')
                return self.job(prior['job_id']),False
            if db.execute("SELECT 1 FROM jobs WHERE conversation_id=? AND status IN ('queued','running','cancelling')",(conversation,)).fetchone():raise StoreError('conversation_busy')
            if db.execute("SELECT COUNT(*) FROM jobs WHERE status IN ('queued','running','cancelling')").fetchone()[0]>=(100 if queued else 4):raise StoreError('capacity_reached')
            original=db.execute('SELECT * FROM conversations WHERE id=?',(conversation,)).fetchone()
            boundary=db.execute('SELECT rowid,* FROM jobs WHERE id=? AND conversation_id=? AND retired=0',(before,conversation)).fetchone()
            if not original or not boundary:raise StoreError('not_found')
            retained=db.execute('SELECT native_turn_id FROM jobs WHERE conversation_id=? AND retired=0 AND rowid<? AND native_turn_id IS NOT NULL ORDER BY rowid DESC LIMIT 1',(conversation,boundary['rowid'])).fetchone()
            source=(original['native_thread_id'] or original['fork_source_thread_id']) if retained else None
            if retained and not source:raise StoreError('branch_history_unavailable')
            db.execute('UPDATE jobs SET retired=1 WHERE conversation_id=? AND rowid>=?',(conversation,boundary['rowid']))
            db.execute('UPDATE conversations SET native_thread_id=NULL,fork_source_thread_id=?,fork_last_turn_id=? WHERE id=?',(source,retained[0] if retained else None,conversation))
            db.execute('DELETE FROM conversation_context WHERE conversation_id=?',(conversation,))
            identifier,stamp=uuid.uuid4().hex,now()
            db.execute("INSERT INTO jobs(id,conversation_id,owner,request_key,prompt,model,effort,status,created_at) VALUES (?,?,?,?,?,?,?,'running',?)",(identifier,conversation,owner,key,text,boundary['model'],boundary['effort'],stamp))
            inputs=db.execute('SELECT payload FROM job_inputs WHERE job_id=?',(before,)).fetchone()
            db.execute('INSERT INTO job_inputs VALUES (?,?)',(identifier,inputs[0] if inputs else '{"images":[],"skills":[]}'))
            if queued:db.execute("UPDATE jobs SET status='queued' WHERE id=?",(identifier,))
            db.execute('UPDATE conversations SET updated_at=? WHERE id=?',(stamp,conversation))
            db.execute('INSERT INTO edits VALUES (?,?,?,?,?)',(conversation,key,before,text,identifier))
            self.event(db,identifier,{"type":"status","status":"running"})
        return self.job(identifier),True

    def save_run_settings(self, identifier, values):
        from .run_settings import validate
        values=validate(values)
        with closing(self.connect()) as db,db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT run_settings FROM conversations WHERE id=? AND archived=0',(identifier,)).fetchone()
            if not row:raise StoreError('not_found')
            previous=json.loads(row[0]);previous.update(values)
            db.execute('UPDATE conversations SET run_settings=? WHERE id=?',(json.dumps(previous),identifier))
        return self.conversation(identifier)

    def mark_read(self, receipts):
        with closing(self.connect()) as db,db:
            for cid,jid in receipts.items():
                latest=db.execute('SELECT id,status FROM jobs WHERE conversation_id=? AND retired=0 ORDER BY rowid DESC LIMIT 1',(cid,)).fetchone()
                if latest and latest['id']==jid and latest['status'] in TERMINAL:
                    db.execute('UPDATE conversations SET read_job_id=? WHERE id=?',(jid,cid))
        return {'ok':True}

    def revision(self, identifier):
        with closing(self.connect()) as db:
            row=db.execute('SELECT revision FROM conversations WHERE id=? AND archived=0',(identifier,)).fetchone()
            if not row:raise StoreError('not_found')
            return row[0]

    def command_detail(self, job, item, offset=0, prefix_hash='', language='en'):
        with closing(self.connect()) as db:
            row=db.execute("SELECT text,detail,detail_version,status FROM items WHERE job_id=? AND id=? AND kind='command'",(job,item)).fetchone()
            if not row:raise StoreError('not_found')
            detail=json.loads(row['detail']);command=detail.get('command');output=detail.get('aggregated_output')
            if command is None or row['status']=='running':
                command,_,output=row['text'].partition('\n')
            parts=[command,output]
            if type(detail.get('exit_code')) is int:parts.append(('退出码：' if language.startswith('zh') else 'Exit code: ')+str(detail['exit_code']))
            body='\n\n'.join(str(p) for p in parts if p is not None and p!='').encode()
            reset=offset>len(body) or bool(offset and hashlib.sha256(body[:offset]).hexdigest()!=prefix_hash)
            if reset:offset=0
            try:text=body[offset:].decode()
            except UnicodeDecodeError:raise StoreError('invalid_cursor') from None
            return dict(text=text,offset=offset,next_offset=len(body),reset=reset,prefix_hash=hashlib.sha256(body).hexdigest(),version=row['detail_version'])

    def changes(self, job):
        with closing(self.connect()) as db:
            row=db.execute('SELECT payload FROM job_reports WHERE job_id=?',(job,)).fetchone()
            if not db.execute('SELECT 1 FROM jobs WHERE id=?',(job,)).fetchone():raise StoreError('not_found')
            return json.loads(row[0]).get('changes') if row else None

    def concurrency(self, value=None):
        with closing(self.connect()) as db,db:
            if value is not None:
                if type(value) is not int or not 1<=value<=16:raise StoreError('invalid_concurrency')
                db.execute("INSERT OR REPLACE INTO installation_settings VALUES ('concurrency',?)",(str(value),))
            row=db.execute("SELECT value FROM installation_settings WHERE key='concurrency'").fetchone()
            return int(row[0]) if row else 4

    def claim(self, identifier):
        with closing(self.connect()) as db,db:
            if db.execute("UPDATE jobs SET status='running' WHERE id=? AND status='queued'",(identifier,)).rowcount:
                self.event(db,identifier,{'type':'status','status':'running'})
                return True
            return False

    def record_timings(self, rows):
        with closing(self.connect()) as db,db:
            db.executemany('INSERT OR IGNORE INTO request_timings VALUES (?,?,?,?,?,?)',rows)
            db.execute('DELETE FROM request_timings WHERE finished_at<?',(time.time()-30*86400,))

    def timings(self):
        with closing(self.connect()) as db:
            rows=db.execute('SELECT r.duration_ms,r.finished_at,r.failed,j.model FROM request_timings r JOIN jobs j ON j.native_turn_id=r.turn_id AND j.owner!=\'history\' ORDER BY r.finished_at DESC LIMIT 20').fetchall()
            return {'requests':[dict(row,failed=bool(row['failed'])) for row in rows]}
