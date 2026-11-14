'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.LAZYFISH_BROWSER_MODULE),f=JSON.parse(fs.readFileSync(process.env.LAZYFISH_BROWSER_FIXTURE,'utf8'));
(async()=>{const browser=await chromium.launch({executablePath:process.env.LAZYFISH_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});try{
 const page=await browser.newPage({viewport:{width:1540,height:1000},locale:'en-US'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('lazyfish.language','en');localStorage.setItem('lazyfish.appearance','black');});
 await page.goto(f.url+'/?conversation='+f.main);await page.locator('#token').fill(f.token);await page.locator('#login button').click();await page.waitForFunction(()=>!initializing&&conversation?.jobs.length===1);
 const menu=page.locator('.text-selection-toolbar'),panel=page.locator('#side-chat');
 const select=async selector=>{const element=page.locator(selector).first();await element.scrollIntoViewIfNeeded();await page.waitForTimeout(200);const text=await element.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(range);document.dispatchEvent(new Event('selectionchange'));return getSelection().toString();});await menu.waitFor();return text;};
 const call=async(path,body)=>page.evaluate(async({path,body})=>{const response=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Error(JSON.stringify(value));return value;},{path,body});
 const go=async id=>{await page.evaluate(id=>loadConversation(id),id);await page.waitForFunction(id=>conversation?.id===id,id);};
 await page.locator('#prompt').fill('Keep my main draft');const quote=await select('#messages .assistant-text p');
 assert.equal(await menu.getByRole('button').count(),2);await page.getByRole('button',{name:'Ask in side chat',exact:true}).click();await panel.waitFor();await page.waitForFunction(()=>!document.querySelector('#side-new').disabled&&document.querySelector('#side-chat').hidden===false);
 await page.locator('#side-quotes .quote-summary').waitFor();assert.equal(await page.locator('#prompt').inputValue(),'Keep my main draft');
 await page.locator('#side-prompt').fill('Explain this passage');await page.locator('#side-send').click();await page.locator('#side-transcript .side-status').filter({hasText:'Completed'}).last().waitFor();
 const sid=(await call('/api/conversations/'+f.main+'/side-chat')).conversation.id;
 assert.equal((await call('/api/conversations/'+f.main)).jobs.length,1);assert.ok(!(await call('/api/conversations')).conversations.some(c=>c.id===sid));
 let box=await panel.boundingBox(),mainBox=await page.locator('#chat').boundingBox();assert.ok(box.x>=mainBox.x+mainBox.width-2&&mainBox.width>300&&box.x+box.width<=1541);
 const back=await select('#side-transcript .assistant-text p');assert.equal(await menu.locator('.selection-side').isVisible(),false);await menu.getByRole('button',{name:'Add to main chat',exact:true}).click();
 assert.equal(await page.locator('#selected-quotes .quote-summary').innerText(),'1 selected passage');assert.equal(await page.locator('#prompt').inputValue(),'Keep my main draft');
 assert.equal((await page.evaluate(()=>features.inputs())).quotes[0].text,back);
 await page.locator('#side-prompt').fill('Unsent side draft');await page.locator('#side-close').click();await panel.waitFor({state:'hidden'});await page.locator('#side-toggle').click();await panel.waitFor();assert.equal(await page.locator('#side-prompt').inputValue(),'Unsent side draft');
 await go(f.other);await panel.waitFor({state:'hidden'});await page.locator('#side-toggle').click();await panel.waitFor();assert.equal(await page.locator('#side-prompt').inputValue(),'');await page.locator('#side-prompt').fill('Another side draft');
 await go(f.main);await panel.waitFor();assert.equal(await page.locator('#side-prompt').inputValue(),'Unsent side draft');assert.equal(await page.locator('#prompt').inputValue(),'Keep my main draft');
 // Retry is bound to the side conversation and its original quotes.
 await select('#messages .assistant-text p');await menu.getByRole('button',{name:'Ask in side chat',exact:true}).click();await page.locator('#side-prompt').fill('Retry this side question');
 await page.route('**/api/conversations/'+sid+'/turns',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"service_stopping"}'}),{times:1});await page.locator('#side-send').click();await page.locator('.side-pending button').click();
 await page.waitForFunction(async id=>(await (await fetch('/api/conversations/'+id)).json()).jobs.length===2,sid);await page.locator('#side-transcript .side-status').filter({hasText:'Completed'}).nth(1).waitFor();
 assert.equal((await call('/api/conversations/'+sid)).jobs[1].inputs.quotes[0].text,quote);
 await page.reload();await panel.waitFor();await page.locator('#side-transcript .side-status').filter({hasText:'Completed'}).nth(1).waitFor();
 assert.equal((await call('/api/conversations/'+f.main+'/side-chat')).conversation.id,sid);
 // Native questions and approvals stay in the side panel.
 await page.locator('#side-prompt').fill('[question]');await page.locator('#side-send').click();await page.locator('.side-question select').selectOption('Green');await page.locator('.side-question input[type="password"]').fill('private-side-answer');await page.locator('.side-question button').click();
 await page.locator('#side-transcript .side-status').filter({hasText:'Completed'}).nth(2).waitFor();assert.ok(!JSON.stringify(await call('/api/conversations/'+sid)).includes('private-side-answer'));
 await page.locator('#side-prompt').fill('[approval]');await page.locator('#side-send').click();await page.locator('.side-approval button').first().click();await page.locator('#side-transcript .side-status').filter({hasText:'Completed'}).nth(3).waitFor();
 // Switching away and back during a slow send must keep the accepted side question.
 await page.route('**/api/conversations/'+sid+'/turns',async route=>{await new Promise(resolve=>setTimeout(resolve,150));await route.continue();},{times:1});
 await page.locator('#side-prompt').fill('Question during a slow reopen');await page.locator('#side-send').click();await go(f.other);await go(f.main);
 await page.locator('#side-transcript .side-status').filter({hasText:'Completed'}).nth(4).waitFor();
 // Streaming redraws must not destroy an active text selection.
 await page.locator('#side-prompt').fill('[stream]');await page.locator('#side-send').click();await page.locator('#side-transcript .side-status').filter({hasText:'Running'}).waitFor();
 const selectedDuringStream=await select('#side-transcript .assistant-text p');await page.waitForTimeout(1000);assert.equal(await page.evaluate(()=>getSelection().toString()),selectedDuringStream);assert.ok(await menu.isVisible());
 await page.evaluate(()=>getSelection().removeAllRanges());await page.locator('#side-transcript .side-status').filter({hasText:'Completed'}).nth(5).waitFor();
 // Independent queue/cancel: stopping the side request cannot interrupt the main task.
 await call('/api/runtime',{target_concurrency:1});const running=await call('/api/conversations/'+f.main+'/turns',{text:'[slow]',client_request_id:'browser-main-'+Date.now()});
 await page.locator('#side-prompt').fill('A queued side question');await page.locator('#side-send').click();await page.locator('#side-transcript .side-status').filter({hasText:'Queued'}).waitFor();await page.locator('#side-stop').click();
 await page.locator('#side-transcript .side-status').filter({hasText:'Cancelled'}).waitFor();assert.equal((await call('/api/jobs/'+running.id)).status,'running');await call('/api/jobs/'+running.id+'/cancel',{});
 await page.waitForFunction(async id=>!['running','queued','cancelling'].includes((await (await fetch('/api/jobs/'+id)).json()).status),running.id);
 await page.locator('#side-new').click();await page.locator('.side-empty').waitFor();const fresh=(await call('/api/conversations/'+f.main+'/side-chat')).conversation;assert.notEqual(fresh.id,sid);
 await page.evaluate(()=>panels.open('settings'));await page.selectOption('#language','zh');await page.locator('#account-dialog').press('Escape');assert.equal(await page.locator('#side-title').innerText(),'\u4fa7\u8fb9\u804a\u5929');
 await page.locator('#side-prompt').fill('A mobile side question');await page.locator('#side-send').click();await page.locator('#side-transcript .side-status').filter({hasText:'\u5df2\u5b8c\u6210'}).waitFor();
 await page.setViewportSize({width:390,height:844});box=await panel.boundingBox();assert.equal(box.x,0);assert.equal(box.width,390);await select('#side-transcript .assistant-text p');await menu.locator('.selection-add').first().click();await panel.waitFor({state:'hidden'});await page.locator('#side-toggle').click();await panel.waitFor();
 await page.setViewportSize({width:1540,height:1000});await page.locator('#side-resizer').focus();const old=await panel.boundingBox();await page.keyboard.press('ArrowLeft');box=await panel.boundingBox();assert.ok(box.width>old.width);
 assert.deepEqual(errors,[]);console.log('side chat browser checks passed');
 }finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
