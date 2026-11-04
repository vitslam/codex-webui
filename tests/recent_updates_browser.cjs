'use strict';
const fs=require('fs'),assert=require('assert');
const {chromium}=require(process.env.LAZYFISH_BROWSER_MODULE),f=JSON.parse(fs.readFileSync(process.env.LAZYFISH_BROWSER_FIXTURE,'utf8'));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.LAZYFISH_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-US'}),page=await context.newPage(),errors=[],writes=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST')writes.push(request.url());});
 const get=async path=>{const response=await context.request.get(f.url+path);assert.ok(response.ok());return response.json();};
 const form=page.locator('#composer'),thread=page.locator('#messages'),prompt=page.locator('#prompt');
 const top=()=>thread.evaluate(el=>el.scrollTop);
 async function wake(){if(await form.isHidden())await page.locator('#composer-handle').click();await form.evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));}
 async function panel(){await wake();if(await page.evaluate(()=>document.body.classList.contains('sidebar-hidden')))await page.locator('#sidebar-toggle').click();await page.locator('#menu-toggle').click();await page.locator('#settings-toggle').click();}
 async function close(){await page.locator('#account-close').click();}
 async function openProcess(job){const node=page.locator('.turn[data-job="'+job+'"] .execution-process');if(!await node.getAttribute('open')){if(!await node.evaluate(el=>el.open))await node.locator(':scope > summary').click();}await page.waitForFunction(job=>document.querySelector('.turn[data-job="'+job+'"] .execution-timeline')&&!document.querySelector('.turn[data-job="'+job+'"] .execution-timeline .meta'),job);return node;}
 async function switchTo(id,collapsed){
   const state=await page.evaluate(id=>{window.switchAnimations=0;window.lastSwitch=loadConversation(id);const form=document.querySelector('#composer');return {hidden:form.hidden,inert:form.inert,animations:form.getAnimations().length};},id);
   assert.deepEqual(state,{hidden:collapsed,inert:collapsed,animations:0});
   const frames=await page.evaluate(async()=>{const states=[];for(let i=0;i<12;i++){await new Promise(requestAnimationFrame);states.push(document.querySelector('#composer').hidden);}await window.lastSwitch;return {states,animations:window.switchAnimations};});
   assert.ok(frames.states.every(value=>value===collapsed),'No intermediate composer visibility');assert.equal(frames.animations,0,'No fold/unfold animation on cached restoration');
 }
 try{
   await page.goto(f.url+'/?conversation='+f.chats[0]);await page.locator('#token').fill(f.token);await page.locator('#login button').click();await page.locator('.assistant-text').waitFor();
   const before=await get('/api/jobs/'+f.jobs[0]+'/steps'),settings=(await get('/api/conversations/'+f.chats[0])).run_settings;
   let main=await openProcess(f.jobs[0]);await page.waitForFunction(()=>document.querySelectorAll('.command-group').length===1);
   assert.equal(await main.locator('.reasoning-body').count(),0);assert.equal(await main.locator('.command-group .tool-step').count(),2);assert.equal(await main.locator('.execution-timeline > .tool-step').count(),1,'Progress prose still separates the third command');
   let only=await openProcess(f.only);assert.equal(await only.locator('.execution-timeline').innerText(),'','Reasoning-only steps do not leak via fallback text');
   let start=writes.length;await panel();assert.equal(await page.getByRole('switch',{name:'Show reasoning summaries',exact:true}).isChecked(),false);
   await page.evaluate(()=>{window.savedStorageSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='lazyfish.preferences.v1')throw new Error('Storage disabled by fixture');return window.savedStorageSetItem.call(this,key,value);};});
   await page.locator('#show-reasoning').click();assert.equal(await page.locator('#show-reasoning').isChecked(),false);await page.getByText('Could not save preferences. Check your browser storage settings.',{exact:true}).waitFor();
   await page.evaluate(()=>Storage.prototype.setItem=window.savedStorageSetItem);await page.locator('#show-reasoning').check();await close();
   main=await openProcess(f.jobs[0]);assert.equal(await main.locator('.reasoning-body').count(),1);only=await openProcess(f.only);assert.ok((await only.locator('.reasoning-body').textContent()).includes('Only saved summary'));
   assert.ok(!writes.slice(start).some(url=>/\/(turns|settings)$/.test(url)),'Display preferences do not send or change run settings');
   await page.reload();await page.locator('.assistant-text').waitFor();main=await openProcess(f.jobs[0]);assert.equal(await main.locator('.reasoning-body').count(),1);
   await page.evaluate(id=>loadConversation(id),f.chats[1]);await page.evaluate(id=>loadConversation(id),f.chats[0]);main=await openProcess(f.jobs[0]);assert.equal(await main.locator('.reasoning-body').count(),1,'Cached history uses current visibility');
   await panel();await page.locator('#show-reasoning').uncheck();await close();main=await openProcess(f.jobs[0]);assert.equal(await main.locator('.reasoning-body').count(),0);assert.equal(await main.locator('.command-group .tool-step').count(),2);
   assert.equal((await get('/api/conversations/'+f.chats[0])).run_settings,settings);assert.deepEqual((await get('/api/jobs/'+f.jobs[0]+'/steps')).items,before.items);
   await panel();await page.locator('#language').selectOption('zh');await page.getByRole('switch',{name:'显示思考摘要',exact:true}).check();page.once('dialog',dialog=>dialog.accept());await page.locator('#restore-defaults').click();assert.equal(await page.locator('#show-reasoning').isChecked(),false);assert.equal(await page.evaluate(()=>localStorage.getItem('lazyfish.preferences.v1')),null);await close();main=await openProcess(f.jobs[0]);assert.equal(await main.locator('.reasoning-body').count(),0);
   // Existing focus/caret behavior remains, without an extra outline.
   if(await page.evaluate(()=>document.body.classList.contains('sidebar-hidden')))await page.locator('#sidebar-toggle').click();
   const row=page.locator('.conversation-row').filter({has:page.locator('.conversation[data-id="'+f.chats[0]+'"]')});await row.locator('.conversation-name').dblclick();const rename=page.locator('.conversation-rename-input');await rename.waitFor();assert.equal(await rename.evaluate(el=>getComputedStyle(el).outlineStyle),'none');assert.ok(await rename.evaluate(el=>document.activeElement===el));await rename.press('Escape');await row.locator('.conversation').focus();assert.equal(await row.locator('.conversation').evaluate(el=>getComputedStyle(el).outlineStyle),'none');
   // Restore drafts, geometry and composer state before painting on desktop and mobile.
   for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
     await page.setViewportSize(viewport);await page.goto(f.url+'/?conversation='+f.chats[0]);await page.locator('.assistant-text').waitFor();await page.evaluate(()=>document.body.classList.add('sidebar-hidden'));
     await form.evaluate(el=>{const animate=el.animate;el.animate=function(...args){window.switchAnimations=(window.switchAnimations||0)+1;return animate.apply(this,args);};});
     await wake();await prompt.fill('Alpha draft\nsecond line\nthird line');await prompt.blur();await thread.evaluate(el=>el.scrollTop=900);await form.waitFor({state:'hidden'});const saved=await top();
     await page.evaluate(id=>loadConversation(id),f.chats[1]);assert.equal(await form.isHidden(),false,'Uncached chat starts expanded');await prompt.fill('Beta draft');await prompt.blur();
     await switchTo(f.chats[0],true);assert.ok(Math.abs(await top()-saved)<=2,'Collapsed restoration retains reading position');assert.equal(await prompt.inputValue(),'Alpha draft\nsecond line\nthird line');
     await switchTo(f.chats[1],false);assert.equal(await prompt.inputValue(),'Beta draft');await switchTo(f.chats[0],true);await wake();
     await switchTo(f.chats[1],false);await switchTo(f.chats[0],false);assert.ok(Math.abs(await top()-saved)<=2,'Manual expansion while reading survives restoration');
     await thread.evaluate(el=>el.scrollTop=el.scrollHeight);await prompt.focus();await prompt.press('Escape');await switchTo(f.chats[1],false);await switchTo(f.chats[0],true);assert.ok(await page.locator('#composer-handle').isVisible());await wake();assert.equal(await form.evaluate(el=>el.inert),false);
   }
   assert.deepEqual(errors,[]);console.log('recent reference updates passed');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
