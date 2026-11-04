"""Native-protocol fixture. No network, credentials or real inference."""

import base64
import json
from collections import deque
import os
from pathlib import Path
import select
import sys
import time
import uuid


def main():
    args = sys.argv[1:]
    assert not any(key.startswith("LAZYFISH_") for key in os.environ)
    if args == ["--version"]:
        print("codex-cli 0.162.1")
        return
    if args == ["login","status"]:
        print("Account output must stay private: simulated-account-secret")
        return
    if args == ["app-server","--help"]:
        print("Native app server")
        return
    assert args == ["app-server"] or len(args)==3 and args[:2]==['app-server','-c'] and 'http://127.0.0.1:' in args[2]
    root = Path(os.environ["TMPDIR"])
    thread_id, job, ready_at, awaiting = None,None,0,False
    pending, buffer = deque(),b""
    login=None;login_ready=0
    png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII="

    def send(value):
        print(json.dumps(value),flush=True)

    def event(method,params):
        send({"method":method,"params":{"threadId":thread_id,**params}})

    def finish(status="completed"):
        nonlocal job
        item = {"type":"plan" if job['prompt']=='[plan-only]' else "agentMessage","id":"reply","text":job["text"],"phase":"final_answer"}
        event("thread/tokenUsage/updated",{"turnId":job["id"],"tokenUsage":{"last":{"totalTokens":3200,"inputTokens":3000,"cachedInputTokens":2400,"outputTokens":200},"total":{"inputTokens":3000,"cachedInputTokens":2400,"outputTokens":200},"modelContextWindow":10000}})
        if status=="completed":
            event("item/completed",{"turnId":job["id"],"item":item,"completedAtMs":0})
        event("turn/completed",{"turn":{"id":job["id"],"status":status,"items":[]}})
        job = None

    while True:
        if not pending:
            readable,_,_ = select.select([sys.stdin],[],[],0.02)
            if readable:
                data = os.read(0,65536)
                if not data:
                    return
                buffer += data
                parts = buffer.split(b"\n")
                buffer = parts.pop()
                pending.extend(parts)
        if pending:
            message = json.loads(pending.popleft())
            method = message.get("method")
            params = message.get("params",{})
            with (root/"fake-methods.jsonl").open("a") as log:
                log.write(json.dumps({"method":method,"params":params,"response_id":message.get("id") if not method else None,"pid":os.getpid()})+"\n")
            if method == "initialize":
                send({"id":message["id"],"result":{"userAgent":"fake"}})
            elif method == "account/login/start":
                if params['type']=='apiKey':
                    (root/'account-state.json').write_text(json.dumps({'type':'apiKey'}));send({'id':message['id'],'result':{'type':'apiKey'}})
                else:
                    login={'kind':'account','id':uuid.uuid4().hex};login_ready=time.monotonic()+(float((root/"login-delay").read_text()) if (root/"login-delay").exists() else 1.5)
                    send({'id':message['id'],'result':{'type':params['type'],'loginId':login['id'],'authUrl':'https://example.invalid/authorize','verificationUrl':'https://example.invalid/device','userCode':'TEST-CODE'}})
            elif method == 'account/logout':
                (root/'account-state.json').write_text(json.dumps({'type':'none'}));send({'id':message['id'],'result':{}})
            elif method == 'mcpServer/oauth/login':
                login={'kind':'mcp','id':uuid.uuid4().hex,'name':params['name']};login_ready=time.monotonic()+(float((root/"login-delay").read_text()) if (root/"login-delay").exists() else 1.5)
                send({'id':message['id'],'result':{'authorizationUrl':'https://example.invalid/mcp','loginId':login['id']}})
            elif method == "account/read":
                account=json.loads((root/'account-state.json').read_text()) if (root/'account-state.json').exists() else {}
                if account.get('type')=='apiKey':send({'id':message['id'],'result':{'account':{'type':'apiKey'}}});continue
                if account.get('type')=='none':send({'id':message['id'],'result':{'account':None}});continue
                send({"id":message["id"],"result":{"account":{"type":"chatgpt","email":"demo@example.invalid","planType":"plus","accessToken":"must-never-expose"}}})
            elif method == "account/usage/read":
                send({"id":message["id"],"result":{"summary":{"lifetimeTokens":12345,"currentStreakDays":3,"secret":"must-never-expose"},"dailyUsageBuckets":[{"startDate":time.strftime("%Y-%m-%d"),"tokens":12345}]}})
            elif method == "account/rateLimits/read":
                send({"id":message["id"],"result":{"rateLimits":{"primary":{"usedPercent":12,"windowDurationMins":300,"resetsAt":1900000000},"secondary":{"usedPercent":33,"windowDurationMins":10080,"resetsAt":1900000300}}}})
            elif method == "skills/config/write":
                state=root/'skills-config.json'
                values=json.loads(state.read_text()) if state.exists() else {}
                values[params['path']]=params['enabled'];state.write_text(json.dumps(values))
                send({"id":message["id"],"result":{}})
            elif method == "skills/list":
                skills=[]
                for cwd in params["cwds"]:
                    for path in [*(Path(cwd)/".agents"/"skills").glob("*/SKILL.md"),*(Path(os.environ["CODEX_HOME"])/"skills").glob("*/SKILL.md")]:
                        text=path.read_text();head=text.split("---")[1]
                        values={}
                        for line in head.strip().splitlines():
                            key,_,value=line.partition(":")
                            try: values[key]=json.loads(value.strip())
                            except ValueError: values[key]=value.strip()
                        skills.append({"name":values.get("name",path.parent.name),"description":values.get("description",""),"path":str(path),"scope":"user" if path.is_relative_to(Path(os.environ["CODEX_HOME"])) else "repo","enabled":(json.loads((root/"skills-config.json").read_text()) if (root/"skills-config.json").exists() else {}).get(str(path),True)})
                send({"id":message["id"],"result":{"data":[{"skills":skills,"errors":[]}]}})
            elif method == "mcpServerStatus/list":
                send({"id":message["id"],"result":{"data":[{"name":"Local example","authStatus":"notLoggedIn","tools":{"search":{"secret":"must-never-expose"},"read":{}},"env":{"TOKEN":"must-never-expose"}}],"nextCursor":None}})
            elif method == "model/list":
                send({"id":message["id"],"result":{"data":[{"id":"fixture-model","model":"fixture-model","displayName":"Fixture Model","isDefault":True,"defaultReasoningEffort":"medium","supportedReasoningEfforts":[{"reasoningEffort":v} for v in ["low","medium","high","xhigh","max","ultra"]]}, {"id":"compact-model","displayName":"Compact Model","defaultReasoningEffort":"high","supportedReasoningEfforts":[{"reasoningEffort":"medium"},{"reasoningEffort":"high"}]}],"nextCursor":None}})
            elif method == "config/read":
                send({"id":message["id"],"result":{"config":{"model":"fixture-model","model_reasoning_effort":"medium"}}})
            elif method == "initialized":
                pass
            elif method in ("thread/start","thread/resume"):
                thread_id = params.get("threadId") or "native-"+uuid.uuid4().hex
                path = root/(thread_id+".json")
                if method=="thread/resume" and not path.exists():
                    send({"id":message["id"],"error":{"code":-32000,"message":"unknown thread"}})
                else:
                    if not path.exists():
                        path.write_text(json.dumps({"prompts":[],"turns":[]}))
                    send({"id":message["id"],"result":{"thread":{"id":thread_id,"status":{"type":"idle"}},"model":"fixture-model"}})
            elif method == "thread/fork":
                source = json.loads((root/(params["threadId"]+".json")).read_text())
                end = source["turns"].index(params["lastTurnId"])+1
                thread_id = "native-"+uuid.uuid4().hex
                (root/(thread_id+".json")).write_text(json.dumps({"prompts":source["prompts"][:end],"turns":source["turns"][:end]}))
                send({"id":message["id"],"result":{"thread":{"id":thread_id,"status":{"type":"idle"}},"model":"fixture-model"}})
            elif method == "thread/compact/start":
                job={"id":uuid.uuid4().hex,"text":"","prompt":"[compact]","index":0}
                event("turn/started",{"turn":{"id":job["id"],"status":"inProgress"}})
                send({"id":message["id"],"result":{}})
                event("thread/tokenUsage/updated",{"tokenUsage":{"last":{"totalTokens":1200},"modelContextWindow":10000}})
                event("turn/completed",{"turn":{"id":job["id"],"status":"completed","items":[]}})
                job=None
            elif method == "turn/start":
                assert params["threadId"]==thread_id
                prompt = next((i["text"] for i in params["input"] if i["type"]=="text"),"[images]")
                path = root/(thread_id+".json")
                history = json.loads(path.read_text())
                previous = history["prompts"][-1] if history["prompts"] else ""
                text = "Earlier: "+previous if prompt=="[remember]" else "Reply: "+prompt
                if prompt=='[outputs]':
                    Path('report.csv').write_text('name,value\nfish,3\n');Path('diagram.png').write_bytes(base64.b64decode(png))
                    text='[Download report](report.csv)\n\n![Diagram](diagram.png)'
                if prompt == "[stream]":
                    text = "\n".join(f"Streaming paragraph {index}." for index in range(25))
                job = {"id":uuid.uuid4().hex,"text":text,"index":0,"prompt":prompt}
                history["prompts"].append(prompt); history["turns"].append(job["id"]); path.write_text(json.dumps(history))
                event("turn/started",{"turn":{"id":job["id"],"status":"inProgress"}})
                event("item/started",{"turnId":job["id"],"item":{"id":"reply","type":"plan" if prompt=='[plan-only]' else "agentMessage","text":""}})
                if prompt=='[ephemeral-image]':
                    temporary=Path(params['cwd'])/'ephemeral-fixture.png';temporary.write_bytes(base64.b64decode(png))
                    viewed={'id':'view-ephemeral','type':'imageView','path':str(temporary)}
                    event('item/started',{'turnId':job['id'],'item':viewed});time.sleep(.2);temporary.unlink();event('item/completed',{'turnId':job['id'],'item':viewed})
                result = {"id":message["id"],"result":{"turn":{"id":job["id"],"status":"inProgress"}}}
                if prompt=="[early]":
                    finish(); send(result); continue
                send(result)
                if prompt=='[outputs]':
                    for i,item in enumerate([
                        {'id':'generated','type':'imageGeneration','result':png,'status':'completed','revisedPrompt':'A tiny test image'},
                        {'id':'typed-tool','type':'dynamicToolCall','tool':'fixture-image','contentItems':[{'type':'inputImage','imageUrl':'data:image/png;base64,'+png}],'apiKey':'must-never-expose'},
                        {'id':'web-one','type':'webSearch','action':{'type':'openPage','url':'https://example.org/docs'},'results':[{'title':'Example docs','url':'https://example.org/docs','snippet':'A useful excerpt','ref_id':'one'},{'title':'Example docs','url':'https://example.org/docs','snippet':'A useful excerpt','ref_id':'two'}]},
                        {'id':'web-two','type':'webSearch','action':{'type':'search','queries':['fixture query']},'results':[{'title':'Other page','url':'https://example.org/other','snippet':'A second source'}]},
                        {'id':'command','type':'commandExecution','command':'echo fixture','aggregatedOutput':'fixture output','exitCode':0,'status':'completed'},
                        {'id':'changed','type':'fileChange','changes':[{'path':'report.csv','kind':{'type':'add'},'diff':'+name,value\n+fish,3'}]},
                    ]):event('item/completed',{'turnId':job['id'],'item':item})
                if prompt=='[skill-read]':
                    skill=next(v for v in params['input'] if v['type']=='skill')
                    event('item/completed',{'turnId':job['id'],'item':{'id':'read-skill','type':'commandExecution','command':'cat '+skill['path'],'exitCode':0,'aggregatedOutput':'skill instructions'}})
                if prompt in ('[question]','[question-async]'):
                    awaiting=prompt=='[question]'
                    if prompt=='[question-async]':job['prompt']='[slow]'
                    send({'id':901,'method':'item/tool/requestUserInput','params':{'threadId':thread_id,'turnId':job['id'],'itemId':'question','isBlocking':prompt=='[question]','questions':[{'id':'color','header':'Color','question':'Choose a color','options':[{'label':'Green','description':'Use green'},{'label':'Blue','description':'Use blue'}]},{'id':'note','header':'Note','question':'Private note','isSecret':True}]}})
                if prompt=="[crash]":
                    os._exit(7)
                if prompt=="[fail]":
                    finish("failed"); continue
                awaiting = prompt in ("[approval]","[file-approval]","[permissions-approval]","[restricted-approval]","[question]")
                if prompt=='[permissions-approval]':
                    send({'id':900,'method':'item/permissions/requestApproval','params':{'threadId':thread_id,'turnId':job['id'],'permissions':{'network':{'enabled':True}}}})
                if prompt in ("[approval]","[file-approval]","[restricted-approval]"):
                    send({"id":900,"method":"item/fileChange/requestApproval" if prompt=="[file-approval]" else "item/commandExecution/requestApproval",
                          "params":{"threadId":thread_id,"turnId":job["id"],"command":"echo fixture","reason":"Fixture change",**({'availableDecisions':['decline']} if prompt=='[restricted-approval]' else {})}})
                ready_at = time.monotonic()+0.05
            elif method=='turn/steer':
                if not job or params['expectedTurnId']!=job['id']:send({'id':message['id'],'error':{'code':-32000,'message':'stale turn'}})
                else:
                    job['text']='Steered: '+params['input'][0]['text'];job['index']=0;job['prompt']='steered';awaiting=False
                    send({'id':message['id'],'result':{'turnId':job['id']}})
            elif not method and message.get('id')==901:
                if message.get('result',{}).get('answers'):awaiting=False;job['text']='Answered.'
            elif method=="turn/interrupt":
                send({"id":message["id"],"result":{}})
                if job:
                    finish("interrupted")
            elif not method and message.get("id")==900:
                awaiting = False
                job["text"] = "Approved." if message.get("result",{}).get("decision")=="accept" else "Declined."
            elif method:
                send({"id":message["id"],"error":{"code":-32601,"message":"unsupported method"}})
        if login and time.monotonic()>login_ready:
            if login['kind']=='account':
                (root/'account-state.json').write_text(json.dumps({'type':'chatgpt'}));send({'method':'account/login/completed','params':{'loginId':login['id'],'success':True}})
            else:send({'method':'mcpServer/oauthLogin/completed','params':{'name':login['name'],'loginId':login['id'],'success':True}})
            login=None
        if job and not awaiting and time.monotonic()>ready_at:
            if job["prompt"]=="[slow]" and job["index"]>0:
                continue
            chunk = job["text"][job["index"]:job["index"]+4]
            if chunk:
                event("item/plan/delta" if job['prompt']=='[plan-only]' else "item/agentMessage/delta",{"turnId":job["id"],"itemId":"reply","delta":chunk})
                job["index"] += len(chunk)
                ready_at = time.monotonic()+0.02
            else:
                finish()


if __name__=="__main__":
    main()
