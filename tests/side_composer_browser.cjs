'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.LAZYFISH_BROWSER_MODULE),f=JSON.parse(fs.readFileSync(process.env.LAZYFISH_BROWSER_FIXTURE,'utf8'));
(async()=>{const browser=await chromium.launch({executablePath:process.env.LAZYFISH_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});try{
 const page=await browser.newPage({viewport:{width:1540,height:1000},locale:'en-US'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('lazyfish.language','en');localStorage.setItem('lazyfish.appearance','black');});
 const call=async(path,body)=>page.evaluate(async({path,body})=>{const r=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error(JSON.stringify(v));return v;},{path,body});
 const upload=async prefix=>{await page.locator('#'+prefix+'image-input').setInputFiles({name:'tiny.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=','base64')});await page.waitForFunction(prefix=>document.querySelectorAll('#'+prefix+'image-previews .image-preview').length===1&&document.querySelector('#'+prefix+'upload-state').hidden,prefix);};
 const skill=async prefix=>{await page.locator('#'+prefix+'attachment-settings>summary').click();await page.locator('#'+prefix+'add-skill').click();await page.locator('#'+prefix+'skill-picker .skill-option').first().click();};
 const finish=async n=>page.waitForFunction(n=>document.querySelectorAll('#side-transcript .side-status').length>=n&&[...document.querySelectorAll('#side-transcript .side-status')].filter(el=>el.textContent==='Completed').length>=n,n);
 const send=async text=>{await page.locator('#side-prompt').fill(text);const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/turns'));await page.locator('#side-send').click();const r=await response;assert.equal(r.status(),202);return r.json();};
 await page.goto(f.url+'/?conversation='+f.main);await page.locator('#token').fill(f.token);await page.locator('#login button').click();await page.waitForFunction(()=>!initializing&&conversation?.jobs.length===1);
 await upload('');await skill('');await page.locator('#prompt').fill('Keep the main draft');
 const mainBefore=await call('/api/conversations/'+f.main);await page.locator('#side-toggle').click();await page.waitForFunction(()=>!document.querySelector('#side-new').disabled);
 if((await call('/api/conversations/'+f.main+'/side-chat')).conversation.jobs.length){await page.locator('#side-new').click();await page.waitForFunction(()=>!document.querySelector('#side-new').disabled);}
 const sid=(await call('/api/conversations/'+f.main+'/side-chat')).conversation.id;
 assert.deepEqual(await page.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);return ids.filter((v,i)=>ids.indexOf(v)!==i);}),[]);
 assert.equal(await page.locator('#side-form .composer-tools').count(),await page.locator('#composer .composer-tools').count());
 await page.locator('#side-model-options>summary').click();await page.locator('#side-model-toggle').click();await page.locator('#side-model-choices [data-model="compact-model"]').click();
 await page.locator('#side-effort-slider').focus();await page.keyboard.press('Home');await page.keyboard.press('End');await page.locator('#side-fast-toggle').click();await page.locator('#side-model-options>summary').click();
 await page.locator('#side-permission-settings>summary').click();await page.locator('#side-form [data-permission="read_only"]').click();
 await upload('side-');await skill('side-');
 const job=await send('Side settings and attachments');await finish(1);
 const saved=await call('/api/jobs/'+job.id);assert.equal(saved.model,'compact-model');assert.equal(saved.effort,'high');assert.equal(saved.inputs.fast_mode,true);assert.equal(saved.inputs.permission_mode,'read_only');assert.equal(saved.inputs.images.length,1);assert.equal(saved.inputs.skills[0].name,'side-fixture');
 assert.equal(await page.locator('#side-transcript .image-list img').count(),1);assert.equal(await page.locator('#image-previews .image-preview').count(),1);assert.equal(await page.locator('#selected-skills .skill-chip').count(),1);assert.equal(await page.locator('#prompt').inputValue(),'Keep the main draft');
 assert.equal((await call('/api/conversations/'+f.main)).run_settings,mainBefore.run_settings);assert.equal(await page.locator('#model').inputValue(),'');
 console.log('Reached '+'Retry keeps');
 // Retry keeps captured settings and attachments, without consuming a newly typed draft.
 await upload('side-');await page.route('**/api/conversations/'+sid+'/turns',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"service_stopping"}'}),{times:1});
 await page.locator('#side-prompt').fill('Retry the original upload');await page.locator('#side-send').click();await page.locator('.side-pending button').waitFor();
 await page.locator('#side-prompt').fill('Keep a newer side draft');await upload('side-');await page.locator('.side-pending button').click();await finish(2);assert.equal(await page.locator('#side-prompt').inputValue(),'Keep a newer side draft');assert.equal(await page.locator('#side-image-previews .image-preview').count(),1);
 console.log('Reached '+'Per-side-chat');
 // Per-side-chat drafts are independent when switching parents.
 await page.evaluate(id=>loadConversation(id),f.other);await page.locator('#side-toggle').click();await page.waitForFunction(()=>!document.querySelector('#side-new').disabled);assert.equal(await page.locator('#side-image-previews .image-preview').count(),0);
 await page.evaluate(id=>loadConversation(id),f.main);await page.waitForFunction(()=>!document.querySelector('#side-new').disabled);assert.equal(await page.locator('#side-prompt').inputValue(),'Keep a newer side draft');assert.equal(await page.locator('#side-image-previews .image-preview').count(),1);
 await page.locator('#side-image-previews button').click();await page.locator('#side-prompt').fill('');
 console.log('Reached '+'Workdir changes');
 // Workdir changes affect only the side chat.
 await page.locator('#side-attachment-settings>summary').click();await page.locator('#side-edit-workdir').click();await page.locator('#side-workdir-input').fill(f.alternate);await page.locator('#side-workdir-save').click();await page.locator('#side-workdir-dialog').waitFor({state:'hidden'});
 assert.equal((await call('/api/conversations/'+sid)).workspace,f.alternate);assert.equal((await call('/api/conversations/'+f.main)).workspace,f.workspace);
 await page.reload();await page.waitForFunction(()=>!initializing&&!document.querySelector('#side-new').disabled);assert.equal(await page.locator('#side-model').inputValue(),'compact-model');assert.equal(await page.locator('#side-fast-toggle').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#side-form [data-permission="read_only"]').getAttribute('aria-pressed'),'true');
 console.log('Reached '+'Supplementing');
 // Supplementing the running side task does not start another native turn.
 const slow=await send('[slow]');await page.waitForFunction(()=>[...document.querySelectorAll('#side-transcript .side-status')].some(e=>e.textContent==='Running'));
 await page.locator('#side-prompt').fill('Supplement the same task');const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/instructions'));await page.locator('#side-send').click();assert.equal((await response).status(),202);await finish(3);
 const stopped=await call('/api/jobs/'+slow.id);assert.equal(stopped.instructions[0].text,'Supplement the same task');assert.equal(stopped.instructions[0].state,'delivered');assert.equal((await call('/api/conversations/'+f.main)).jobs.length,1);
 console.log('Reached '+'Compact is');
 // Compact is scoped to this native thread and leaves the current draft intact.
 await page.locator('#side-prompt').fill('Keep during compaction');await page.locator('#side-context-settings>summary').click();const compactResponse=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/compact'));await page.locator('#side-compact-context').click();const compactJob=await (await compactResponse).json();await page.waitForFunction(async id=>(await(await fetch('/api/jobs/'+id)).json()).status==='completed',compactJob.id);assert.equal(await page.locator('#side-prompt').inputValue(),'Keep during compaction');await page.locator('#side-stop').waitFor({state:'hidden'});
 // Display and keyboard preferences apply equally, while Plan stays side-specific.
 await page.evaluate(()=>panels.open('settings'));await page.locator('#show-plan').check();await page.locator('#show-context').uncheck();assert.equal(await page.locator('#side-context-settings').isHidden(),true);await page.locator('#show-context').check();await page.selectOption('#send-shortcut','ctrl-enter');await page.selectOption('#newline-shortcut','enter');await page.locator('#account-dialog').press('Escape');
 await page.locator('#side-plan-toggle').click();assert.equal(await page.locator('#plan-toggle').getAttribute('aria-pressed'),'false');assert.equal(await page.locator('#side-plan-toggle').getAttribute('aria-pressed'),'true');
 const count=(await call('/api/conversations/'+sid)).jobs.length;await page.locator('#side-prompt').fill('Keyboard preference');await page.locator('#side-prompt').press('Enter');assert.equal(await page.locator('#side-prompt').inputValue(),'Keyboard preference\n');assert.equal((await call('/api/conversations/'+sid)).jobs.length,count);
 const keyboardResponse=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/turns'));await page.locator('#side-prompt').press('Control+Enter');const keyboardJob=await(await keyboardResponse).json();assert.equal(keyboardJob.inputs.collaboration_mode,'plan');await page.locator('#side-stop').waitFor({state:'hidden'});
 await page.setViewportSize({width:390,height:844});await page.locator('#side-model-options>summary').click();const box=await page.locator('#side-form .settings-panel').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=391);await page.screenshot({path:f.output+'/side-composer-mobile.png'});await page.locator('#side-model-options>summary').click();
 await page.setViewportSize({width:1540,height:1000});await page.screenshot({path:f.output+'/side-composer-desktop.png'});assert.deepEqual(errors,[]);console.log('side composer browser checks passed');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
