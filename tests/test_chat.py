from __future__ import annotations

import http.client
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

from lazyfish import runtime
from lazyfish.processes import identity
from test_service import ServiceCase


class ChatTests(ServiceCase):
    def call(self,path,method="GET",body=None,expected=200):
        code,_,data = self.http(path,method,body,{"Authorization":"Bearer "+self.settings.token})
        result = json.loads(data)
        self.assertEqual(code,expected,result)
        return result

    def create(self):
        return self.call("/api/conversations","POST",{},201)["id"]

    def send(self,conversation,text,key=None,expected=202):
        return self.call(f"/api/conversations/{conversation}/turns","POST",
                         {"text":text,"client_request_id":key or uuid.uuid4().hex},expected)

    def until(self,job,predicate,timeout=10):
        deadline = time.monotonic()+timeout
        while time.monotonic()<deadline:
            result = self.call("/api/jobs/"+job)
            if predicate(result):
                return result
            time.sleep(0.03)
        self.fail("Task did not reach the expected state: "+json.dumps(result))

    def finished(self,job):
        return self.until(job,lambda row:row["status"] not in ("queued","running","cancelling"))

    def methods(self):
        path = self.settings.runtime_dir/"tmp/fake-methods.jsonl"
        return [json.loads(line)["method"] for line in path.read_text().splitlines()]

    def test_streamed_reply_and_native_resume_preserve_context(self):
        conversation = self.create()
        job = self.send(conversation,"Remember the green fish")
        code,_,data = self.http(f"/api/jobs/{job['id']}/events",headers={"Authorization":"Bearer "+self.settings.token})
        self.assertEqual(code,200)
        payloads = [json.loads(line[6:]) for line in data.decode().splitlines() if line.startswith("data: ")]
        deltas = [row["text"] for row in payloads if row.get("type")=="delta"]
        self.assertGreater(len(deltas),1)
        self.assertEqual("".join(deltas),"Reply: Remember the green fish")
        complete = self.finished(job["id"])
        self.assertEqual(complete["status"],"completed")
        self.assertEqual(complete["items"][-1]["text"],"Reply: Remember the green fish")
        history = self.call("/api/conversations/"+conversation)
        native = history["native_thread_id"]
        second = self.finished(self.send(conversation,"[remember]")["id"])
        self.assertEqual(second["items"][-1]["text"],"Earlier: Remember the green fish")
        self.assertEqual(self.call("/api/conversations/"+conversation)["native_thread_id"],native)
        self.assertEqual(self.methods().count("thread/start"),1)
        self.assertEqual(self.methods().count("thread/resume"),1)
        self.assertEqual(self.methods().count("turn/start"),2)

    def test_duplicate_send_never_starts_twice_and_busy_is_rejected(self):
        conversation,key = self.create(),uuid.uuid4().hex
        job = self.send(conversation,"[slow]",key)
        self.assertEqual(self.send(conversation,"[slow]",key)["id"],job["id"])
        self.assertEqual(self.send(conversation,"different",key,409)["error"],"request_key_conflict")
        self.assertEqual(self.send(conversation,"new request",expected=409)["error"],"conversation_busy")
        self.until(job["id"],lambda row:bool(row["items"] and row["items"][0]["text"]))
        self.call(f"/api/jobs/{job['id']}/cancel","POST",{})
        self.finished(job["id"])
        self.assertEqual(self.send(conversation,"[slow]",key)["id"],job["id"])
        self.assertEqual(self.methods().count("turn/start"),1)
        self.assertEqual(len(self.call("/api/conversations/"+conversation)["jobs"]),1)

    def test_cancel_confirms_executor_exit_and_keeps_partial_reply(self):
        conversation = self.create()
        job = self.send(conversation,"[slow]")
        self.until(job["id"],lambda row:bool(row["items"] and row["items"][0]["text"]))
        record = json.loads((self.settings.runtime_dir/"jobs"/(job["id"]+".json")).read_text())
        self.call(f"/api/jobs/{job['id']}/cancel","POST",{})
        result = self.finished(job["id"])
        self.assertEqual(result["status"],"cancelled")
        self.assertEqual(result["items"][0]["text"],"Repl")
        self.assertIsNone(identity(record["pid"]))
        self.assertIn("turn/interrupt",self.methods())
        self.assertEqual(self.finished(self.send(conversation,"After cancellation")["id"])["status"],"completed")

    def test_accept_and_decline_pending_native_approvals(self):
        conversation = self.create()
        for prompt,decision,text in [("[approval]","accept","Approved."),("[file-approval]","decline","Declined.")]:
            job = self.send(conversation,prompt)
            waiting = self.until(job["id"],lambda row:bool(row["approvals"]))
            approval = waiting["approvals"][0]
            self.call(f"/api/jobs/{job['id']}/approvals","POST",{"id":approval["id"],"decision":decision})
            result = self.finished(job["id"])
            self.assertEqual(result["status"],"completed")
            self.assertEqual(result["items"][0]["text"],text)
            self.call(f"/api/jobs/{job['id']}/approvals","POST",{"id":approval["id"],"decision":decision},409)

    def test_cancel_while_waiting_for_approval_expires_it(self):
        job = self.send(self.create(),"[approval]")
        waiting = self.until(job["id"],lambda row:bool(row["approvals"]))
        self.call(f"/api/jobs/{job['id']}/cancel","POST",{})
        result = self.finished(job["id"])
        self.assertEqual(result["status"],"cancelled")
        self.assertEqual(result["approvals"][0]["state"],"expired")
        self.call(f"/api/jobs/{job['id']}/approvals","POST",{"id":waiting["approvals"][0]["id"],"decision":"accept"},409)

    def test_native_failure_crash_and_completion_before_start_response(self):
        conversation = self.create()
        for prompt,status in [("[fail]","failed"),("[crash]","failed"),("[early]","completed")]:
            result = self.finished(self.send(conversation,prompt)["id"])
            self.assertEqual(result["status"],status,result)
        self.assertEqual(self.methods().count("turn/start"),3)

    def test_parallel_conversations_are_bounded_and_shutdown_cancels_all(self):
        jobs = [self.send(self.create(),"[slow]") for _ in range(4)]
        for job in jobs:
            self.until(job["id"],lambda row:bool(row["items"] and row["items"][0]["text"]))
        fifth=self.send(self.create(),"fifth")
        self.assertEqual(fifth['status'],'queued');jobs.append(fifth)
        self.assertTrue(runtime.stop(self.settings))
        self.process.wait(timeout=5)
        from lazyfish.storage import Store
        store = Store(self.settings.data_dir/"lazyfish.db")
        for job in jobs:
            self.assertEqual(store.state(job["id"]),"cancelled")

    def test_stream_disconnect_does_not_cancel_and_cursor_replays(self):
        job = self.send(self.create(),"[slow]")
        connection = http.client.HTTPConnection("127.0.0.1",self.port,timeout=5)
        connection.request("GET",f"/api/jobs/{job['id']}/events",headers={"Authorization":"Bearer "+self.settings.token})
        response = connection.getresponse()
        self.assertEqual(response.status,200)
        self.assertTrue(response.readline())
        response.close(); connection.close()
        partial = self.until(job["id"],lambda row:bool(row["items"] and row["items"][0]["text"]))
        self.assertEqual(partial["status"],"running")
        self.call(f"/api/jobs/{job['id']}/cancel","POST",{})
        self.finished(job["id"])
        code,_,data = self.http(f"/api/jobs/{job['id']}/events?after=0",headers={
            "Authorization":"Bearer "+self.settings.token,"Last-Event-ID":str(partial["cursor"])})
        ids = [int(line[4:]) for line in data.decode().splitlines() if line.startswith("id: ")]
        self.assertEqual(code,200)
        self.assertTrue(all(identifier>partial["cursor"] for identifier in ids))
        self.assertNotIn(b'"type": "delta"',data)

    def test_sigkill_restart_reconciles_without_rerun_and_keeps_native_thread(self):
        conversation = self.create()
        job = self.send(conversation,"[slow]")
        self.until(job["id"],lambda row:bool(row["items"] and row["items"][0]["text"]))
        native = self.call("/api/conversations/"+conversation)["native_thread_id"]
        self.process.kill(); self.process.wait(timeout=5)
        self.process = subprocess.Popen(self.command("serve"),stdout=self.output,stderr=self.output,start_new_session=True)
        deadline = time.monotonic()+12
        while not runtime.request(self.settings) and time.monotonic()<deadline:
            if self.process.poll() is not None:
                self.fail(self.output_path.read_text())
            time.sleep(0.04)
        self.port = json.loads(self.metadata_path.read_text())["port"]
        restored = self.call("/api/conversations/"+conversation)
        self.assertEqual(restored["native_thread_id"],native)
        self.assertEqual(len(restored["jobs"]),1)
        self.assertEqual(restored["jobs"][0]["status"],"interrupted")
        self.assertEqual(restored["jobs"][0]["error_code"],"service_restarted")
        self.assertEqual(self.methods().count("turn/start"),1)
        after = self.finished(self.send(conversation,"[remember]")["id"])
        self.assertEqual(after["items"][0]["text"],"Earlier: [slow]")

    def test_chat_auth_validation_and_non_html_output(self):
        conversation = self.create()
        code,_,body = self.http("/?conversation="+conversation)
        self.assertEqual(code,200)
        self.assertIn(b"<!doctype html>",body)
        self.assertEqual(self.http("/api/conversations")[0],401)
        self.call(f"/api/conversations/{conversation}/turns","POST",{"text":" ","client_request_id":uuid.uuid4().hex},400)
        self.call(f"/api/conversations/{conversation}/turns","POST",{"text":"hello","client_request_id":"bad"},400)
        self.call(f"/api/conversations/{conversation}/turns","POST",{"text":"hello","client_request_id":uuid.uuid4().hex,"model":"bad model"},400)
        text = '<img src=x onerror="window.compromised=true">'
        result = self.finished(self.send(conversation,text)["id"])
        self.assertIn(text,result["items"][0]["text"])
        self.assertNotIn(self.settings.token,json.dumps(result))

    def test_branch_is_idle_idempotent_and_native_history_diverges_at_boundary(self):
        source = self.create()
        first = self.finished(self.send(source,"retained context")["id"])
        second = self.finished(self.send(source,"excluded context")["id"])
        count = self.methods().count("turn/start")
        payload = {"before_job_id":second["id"],"client_request_id":uuid.uuid4().hex,"title":"Separate branch"}
        branch = self.call(f"/api/conversations/{source}/branch","POST",payload,201)
        same = self.call(f"/api/conversations/{source}/branch","POST",payload,201)
        self.assertEqual(branch["id"],same["id"])
        self.assertIsNone(branch["native_thread_id"])
        history = self.call("/api/conversations/"+branch["id"])
        self.assertEqual([job["prompt"] for job in history["jobs"]],[first["prompt"]])
        self.assertNotEqual(history["jobs"][0]["id"],first["id"])
        self.assertEqual(history["jobs"][0]["items"],first["items"])
        self.assertEqual(self.methods().count("turn/start"),count)
        self.assertNotIn("thread/fork",self.methods())
        # Continue source after branch creation: fork must still stop at the frozen boundary.
        self.finished(self.send(source,"later source message")["id"])
        reply = self.finished(self.send(branch["id"],"[remember]")["id"])
        self.assertEqual(reply["items"][-1]["text"],"Earlier: retained context")
        self.assertEqual(self.methods().count("thread/fork"),1)
        self.assertNotEqual(self.call("/api/conversations/"+source)["native_thread_id"],
                            self.call("/api/conversations/"+branch["id"])["native_thread_id"])
        original = self.finished(self.send(source,"[remember]")["id"])
        self.assertEqual(original["items"][-1]["text"],"Earlier: later source message")
        self.call(f"/api/conversations/{source}/branch","POST",dict(payload,before_job_id=first["id"]),409)

    def test_branch_before_first_message_starts_fresh_and_nested_branch_works(self):
        source = self.create()
        first = self.finished(self.send(source,"original")["id"])
        second = self.finished(self.send(source,"boundary")["id"])
        def fork(cid,before):
            return self.call(f"/api/conversations/{cid}/branch","POST",{
                "before_job_id":before,"client_request_id":uuid.uuid4().hex,"title":"Branch"},201)["id"]
        fresh = fork(source,first["id"])
        self.assertEqual(self.call("/api/conversations/"+fresh)["jobs"],[])
        self.assertEqual(self.finished(self.send(fresh,"[remember]")["id"])["items"][-1]["text"],"Earlier: ")
        branch = fork(source,second["id"])
        third = self.finished(self.send(branch,"branch message")["id"])
        nested = fork(branch,third["id"])
        self.assertEqual(self.finished(self.send(nested,"[remember]")["id"])["items"][-1]["text"],"Earlier: original")

    def test_pagination_anchor_active_outside_window_and_settings_validation(self):
        from lazyfish.storage import Store
        store = Store(self.settings.data_dir/"lazyfish.db")
        cid = self.create()
        identifiers = []
        for index in range(65):
            job,_ = store.reserve(cid,"fixture",uuid.uuid4().hex,f"Message {index}",None,None)
            store.finish(job["id"],"completed"); identifiers.append(job["id"])
        latest = self.call(f"/api/conversations/{cid}?limit=20")
        self.assertEqual([j["id"] for j in latest["jobs"]],identifiers[-20:])
        self.assertIsNone(latest["newer_cursor"])
        earlier = self.call(f"/api/conversations/{cid}?limit=20&before={latest['older_cursor']}")
        self.assertEqual([j["id"] for j in earlier["jobs"]],identifiers[-40:-20])
        newer = self.call(f"/api/conversations/{cid}?limit=20&after={earlier['newer_cursor']}")
        self.assertEqual([j["id"] for j in newer["jobs"]],identifiers[-20:])
        running = self.send(cid,"[slow]")
        around = self.call(f"/api/conversations/{cid}?limit=10&anchor={identifiers[12]}")
        self.assertIn(identifiers[12],[j["id"] for j in around["jobs"]])
        self.assertEqual(around["active_job"]["id"],running["id"])
        self.assertTrue(around["older_cursor"] and around["newer_cursor"])
        self.call(f"/api/conversations/{cid}?anchor={uuid.uuid4().hex}",expected=400)
        for query in ("limit=0","limit=101","limit=bad","before=bad",f"before={identifiers[0]}&after={identifiers[1]}"):
            self.call(f"/api/conversations/{cid}?{query}",expected=400)
        self.call(f"/api/conversations/{cid}/settings","POST",{"pinned":1},400)
        self.call(f"/api/conversations/{cid}/settings","POST",{"title":" "},400)
        self.assertEqual(self.call(f"/api/conversations/{cid}/settings","POST",{"pinned":True,"title":"Pinned"})["title"],"Pinned")
        self.assertEqual(self.call("/api/conversations?limit=1")["conversations"][0]["id"],cid)
        self.call(f"/api/jobs/{running['id']}/cancel","POST",{})
        self.finished(running["id"])

    def test_conversation_pages_group_pinned_and_reject_foreign_history_cursor(self):
        identifiers = [self.create() for _ in range(6)]
        self.call(f"/api/conversations/{identifiers[1]}/settings","POST",{"pinned":True})
        first = self.call("/api/conversations?limit=2")
        second = self.call("/api/conversations?limit=2&cursor="+first["next_cursor"])
        third = self.call("/api/conversations?limit=2&cursor="+second["next_cursor"])
        all_rows = first["conversations"]+second["conversations"]+third["conversations"]
        self.assertEqual(all_rows[0]["id"],identifiers[1])
        self.assertEqual(set(row["id"] for row in all_rows),set(identifiers))
        self.assertEqual(len(all_rows),6)
        self.assertIsNone(third["next_cursor"])
        self.call("/api/conversations?cursor=bad",expected=400)
        job = self.finished(self.send(identifiers[0],"one")["id"])
        self.call(f"/api/conversations/{identifiers[1]}?before={job['id']}",expected=400)
        self.call(f"/api/conversations/{identifiers[1]}/branch","POST",{
            "before_job_id":job["id"],"client_request_id":uuid.uuid4().hex,"title":"Invalid"},404)

    def test_old_cli_cannot_silently_ignore_native_fork_boundary(self):
        cid = self.create()
        self.finished(self.send(cid,"keep")["id"])
        boundary = self.finished(self.send(cid,"exclude")["id"])
        branch = self.call(f"/api/conversations/{cid}/branch","POST",{
            "before_job_id":boundary["id"],"client_request_id":uuid.uuid4().hex,"title":"Branch"},201)
        self.binary.write_text(self.binary.read_text().replace("codex-cli 0.162.1","codex-cli 0.100.0"))
        result = self.finished(self.send(branch["id"],"must not run")["id"])
        self.assertEqual(result["status"],"failed")
        self.assertEqual(result["error_code"],"unsupported_native_fork")
        self.assertNotIn("thread/fork",self.methods())
        self.assertEqual(self.methods().count("turn/start"),2)

    def test_title_search_is_literal_paginated_and_bounded(self):
        from urllib.parse import quote
        from lazyfish.storage import Store
        store = Store(self.settings.data_dir/"lazyfish.db")
        rows=[store.create_conversation(str(self.workspace),title) for title in ["Alpha project","other","alpha notes","100% ready","\u9879\u76ee\u8ba1\u5212"]]
        first=self.call("/api/conversations?limit=1&q=ALPHA")
        second=self.call("/api/conversations?limit=1&q=alpha&cursor="+first["next_cursor"])
        self.assertEqual({first["conversations"][0]["id"],second["conversations"][0]["id"]},{rows[0]["id"],rows[2]["id"]})
        self.assertIsNone(second["next_cursor"])
        self.assertEqual(self.call("/api/conversations?q=%25")["conversations"][0]["id"],rows[3]["id"])
        self.assertEqual(self.call("/api/conversations?q="+quote("\u9879\u76ee"))["conversations"][0]["id"],rows[4]["id"])
        self.assertEqual(self.call("/api/conversations?q=absent")["conversations"],[])
        self.call("/api/conversations?q="+"x"*201,expected=400)
