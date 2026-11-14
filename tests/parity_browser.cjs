"use strict";
const fs=require('fs'),assert=require('assert');
const {chromium}=require(process.env.LAZYFISH_BROWSER_MODULE),f=JSON.parse(fs.readFileSync(process.env.LAZYFISH_BROWSER_FIXTURE,'utf8'));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.LAZYFISH_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-US'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const post=async(path,data)=>{const response=await context.request.post(f.url+path,{headers:{Origin:f.url},data});assert.ok(response.ok(),await response.text());return response.json();};
 const get=async path=>(await context.request.get(f.url+path)).json();
 const select=async id=>{await page.locator('#conversation-list .conversation[data-id="'+id+'"]').click();await page.waitForFunction(id=>new URL(location.href).searchParams.get('conversation')===id,id);};
 const done=async job=>{await page.waitForFunction(id=>document.querySelector('.turn[data-job="'+id+'"] .task-status')?.dataset.state==='completed',job.id);};
 const composer=async()=>{if(await page.locator('#composer-handle').isVisible())await page.locator('#composer-handle').click();};
 const panel=async id=>{await page.locator('#menu-toggle').click();await page.locator(id).click();};
 const start=async text=>{await composer();await page.locator('#prompt').fill(text);const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/turns'));await page.locator('#send').click();return(await response).json();};
 try{
  await page.goto(f.url);await page.locator('#token').fill(f.token);await page.locator('#login button').click();await page.locator('#empty:not([hidden])').waitFor();
  assert.equal((await get('/api/conversations')).conversations.length,2,'No saved browser selection opens an unsaved draft');
  await page.locator('#new-chat').click();assert.equal((await get('/api/conversations')).conversations.length,2,'New-chat clicks do not create empty records');
  await select(f.alpha);await page.locator('.assistant-text').waitFor();
  async function effort(value){const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/settings')&&r.request().postDataJSON().run_settings);await page.locator('#effort').evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('change'));},value);await response;}
  await effort('low');await select(f.beta);await effort('high');await select(f.alpha);assert.equal(await page.locator('#effort').inputValue(),'low');
  await page.reload();await page.locator('.assistant-text').waitFor();assert.equal(await page.locator('#effort').inputValue(),'low');
  assert.equal(await page.locator('#conversation-list .conversation[data-id="'+f.alpha+'"] .dot.completed').count(),0,'Viewed completion markers clear');
  const external=await post('/api/conversations/'+f.alpha+'/turns',{text:'Created in a different browser page',client_request_id:'parity-external-message'});await done(external);
  assert.ok((await page.locator('.user-message .user-text').allTextContents()).includes('Created in a different browser page'),'Idle conversation receives a new external turn');
  // Pending requests paint immediately; retries keep the original request key and the next draft.
  let release,seen;const gate=new Promise(r=>release=r),arrived=new Promise(r=>seen=r);let firstKey;
  await page.route('**/api/conversations/'+f.alpha+'/turns',async route=>{firstKey=route.request().postDataJSON().client_request_id;seen();await gate;await route.fulfill({status:503,contentType:'application/json',body:'{"error":"unavailable"}'});});
  await composer();await page.locator('#prompt').fill('Retry this exact request');await page.locator('#send').click();await arrived;
  assert.equal(await page.locator('.pending-send .user-message').count(),1);assert.equal(await page.locator('#prompt').isDisabled(),false);
  await page.locator('#prompt').fill('My next unsent draft');release();await page.locator('.send-retry').waitFor();await page.unrouteAll({behavior:'ignoreErrors'});
  const retry=page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/turns'));await page.locator('.send-retry').click();assert.equal((await retry).postDataJSON().client_request_id,firstKey);
  await page.waitForFunction(()=>!document.querySelector('.pending-send'));assert.equal(await page.locator('#prompt').inputValue(),'My next unsent draft');
  await page.waitForFunction(()=>document.querySelector('#composer').dataset.jobStatus==='idle');
  // A native plan proposal is final prose, even without an agentMessage result.
  const plan=await post('/api/conversations/'+f.alpha+'/turns',{text:'[plan-only]',collaboration_mode:'plan',client_request_id:'parity-plan-proposal'});await done(plan);
  assert.ok(await page.locator('.turn[data-job="'+plan.id+'"] .assistant-text').count());assert.equal(await page.locator('.turn[data-job="'+plan.id+'"] .implement-plan').count(),1);
  const approval=await start('[permissions-approval]');await page.locator('#question-dialog').waitFor();
  assert.equal(await page.locator('#question-fields input[name=approval]').count(),3);await page.locator('#question-fields input[value="1"]').check();await page.locator('#question-submit').click();await page.locator('#question-dialog').waitFor({state:'hidden'});await done(approval);
  // An approval resolved by another observer closes this page's stale modal too.
  const remoteApproval=await start('[permissions-approval]');await page.locator('#question-dialog').waitFor();
  const remoteJob=await get('/api/jobs/'+remoteApproval.id);await post('/api/jobs/'+remoteApproval.id+'/approvals',{id:remoteJob.approvals[0].id,decision:0});
  await page.locator('#question-dialog').waitFor({state:'hidden'});await done(remoteApproval);
  // Nonblocking questions prompt once, and Later survives a page refresh.
  const question=await start('[question-async]');await page.locator('#question-dialog').waitFor();await page.locator('#question-later').click();await page.reload();await page.locator('.question-reopen[data-question-id]').waitFor();await page.waitForTimeout(200);
  assert.equal(await page.locator('#question-dialog').isVisible(),false);await post('/api/jobs/'+question.id+'/cancel',{});await page.waitForFunction(()=>document.querySelector('#composer').dataset.jobStatus==='idle');
  // Existing skills edit the entire source, including extra frontmatter; stale forms cannot overwrite newer content.
  const skill=await post('/api/skills',{conversation:f.alpha,name:'browser-source',description:'Keep full source',body:'Original body'});
  let doc=await get('/api/skills/document?conversation='+f.alpha+'&path='+encodeURIComponent(skill.path));const raw=doc.content.replace('\n---\n','\nlicense: MIT\nmetadata:\n  owner: fixture\n---\n');
  await post('/api/skills/source',{conversation:f.alpha,path:skill.path,hash:doc.hash,content:raw});await panel('#skills-toggle');
  await page.locator('.account-entry').filter({has:page.locator('h4',{hasText:'browser-source'})}).getByRole('button',{name:'Edit',exact:true}).click();
  await page.locator('#skill-source').waitFor();assert.ok((await page.locator('#skill-source').inputValue()).includes('license: MIT'));await page.locator('#skill-source').fill(raw+'\nEdited in browser\n');await page.locator('#save-skill').click();await page.locator('.account-entry').waitFor();
  doc=await get('/api/skills/document?conversation='+f.alpha+'&path='+encodeURIComponent(skill.path));assert.ok(doc.content.includes('metadata:'));assert.ok(doc.content.includes('Edited in browser'));
  await page.locator('.account-entry').filter({has:page.locator('h4',{hasText:'browser-source'})}).getByRole('button',{name:'Edit',exact:true}).click();await page.locator('#skill-source').waitFor();
  await post('/api/skills/source',{conversation:f.alpha,path:skill.path,hash:doc.hash,content:doc.content+'\nExternal update\n'});await page.locator('#save-skill').click();await page.getByText('This skill changed since you opened it. Reopen it before saving.',{exact:true}).waitFor();await page.locator('#account-close').click();
  // Local slot cards and the original interactive timing chart both use local APIs.
  await post('/api/runtime',{target_concurrency:1});const busy=await start('[slow]');await page.waitForSelector('.turn[data-job="'+busy.id+'"] .assistant-text');
  const queued=await post('/api/conversations/'+f.beta+'/turns',{text:'[slow]',client_request_id:'parity-queued-task'});assert.equal(queued.status,'queued');
  await panel('#diagnostics-toggle');await page.locator('.worker-slot').waitFor();assert.equal(await page.locator('.worker-slot').count(),1);assert.equal(await page.locator('.performance-bar').count(),1);
  await page.locator('#worker-concurrency').selectOption('2');await page.locator('#worker-concurrency-save').click();await page.waitForFunction(()=>document.querySelectorAll('.worker-slot').length===2);await page.screenshot({path:f.output+'/reference-local-diagnostics.png'});
  await page.locator('#account-close').click();
  // A delayed stop request freezes the shown output immediately, with a retry on failure.
  let stopRelease,stopSeen;const stopGate=new Promise(r=>stopRelease=r),stopArrived=new Promise(r=>stopSeen=r);
  await page.route('**/api/jobs/'+busy.id+'/cancel',async route=>{stopSeen();await stopGate;await route.fulfill({status:503,contentType:'application/json',body:'{"error":"unavailable"}'});});
  await composer();await page.locator('#cancel').click();await stopArrived;assert.equal(await page.locator('.turn[data-job="'+busy.id+'"] .task-status').getAttribute('data-state'),'cancelled');
  stopRelease();await page.locator('.stop-retry').waitFor();await page.unrouteAll({behavior:'ignoreErrors'});await page.locator('.stop-retry').click();await post('/api/jobs/'+queued.id+'/cancel',{});await page.waitForFunction(()=>document.querySelector('#composer').dataset.jobStatus==='idle');
  await panel('#settings-toggle');await page.locator('#language').selectOption('zh');await page.locator('#account-close').click();await panel('#diagnostics-toggle');await page.getByText('\u6267\u884c\u69fd',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('.worker-slot').length===2);
  assert.deepEqual(errors,[]);console.log('reference parity browser checks passed');
 }finally{await page.unrouteAll({behavior:'ignoreErrors'});await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
