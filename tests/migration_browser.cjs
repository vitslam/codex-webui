"use strict";
const fs=require('fs'),assert=require('assert');
const {chromium}=require(process.env.LAZYFISH_BROWSER_MODULE),fixture=JSON.parse(fs.readFileSync(process.env.LAZYFISH_BROWSER_FIXTURE,'utf8'));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.LAZYFISH_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-US'});await context.grantPermissions(['clipboard-read','clipboard-write']);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const settle=()=>page.waitForTimeout(180);
 async function composer(){if(await page.locator('#composer-handle').isVisible())await page.locator('#composer-handle').click();await page.locator('#composer').waitFor({state:'visible'});await settle();}
 async function start(text){await composer();await page.locator('#prompt').fill(text);const request=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/turns'));await page.locator('#send').click();return await (await request).json();}
 async function done(job){await page.waitForFunction(id=>document.querySelector(`.turn[data-job="${id}"] .task-status`)?.dataset.state==='completed',job.id);await settle();}
 async function panel(id){await composer();if(await page.evaluate(()=>document.body.classList.contains('sidebar-hidden')))await page.locator('#sidebar-toggle').click();await page.locator('#menu-toggle').click();await page.locator(id).click();}
 async function close(){if(await page.locator('#account-dialog').isVisible())await page.locator('#account-close').click();await composer();}
 try{
  await page.goto(fixture.url);await page.locator('#token').fill(fixture.token);await page.locator('#login button').click();await page.waitForSelector('#app:not([hidden])');
  const output=await start('[outputs]');await done(output);
  assert.deepEqual(errors,[]);
  const article=page.locator(`.turn[data-job="${output.id}"]`);
  assert.equal(await article.locator('.assistant-text .reply-image img').count(),1);assert.equal(await article.locator('.token-usage').innerText(),'token 3,200 · hit 80%');
  assert.equal(await article.locator('.assistant-text').innerText().then(t=>t.includes('iVBORw0')),false);
  const file=article.locator('.output-artifact').filter({hasText:'report.csv'});assert.equal(await file.count(),1);
  const downloadPromise=page.waitForEvent('download');await file.locator('a').click();const download=await downloadPromise;assert.equal(download.suggestedFilename(),'report.csv');assert.equal(fs.readFileSync(await download.path(),'utf8'),'name,value\nfish,3\n');
  await article.locator('.assistant-text .reply-image img').click();await page.keyboard.press('Escape');await page.locator('.image-viewer').waitFor({state:'detached'});
  await article.locator('.execution-process > summary').click();
  const webGroup=article.locator('.step-group > summary').filter({hasText:/Browse|Browsing|Web|浏览/}).first();await webGroup.click();
  const webStep=article.locator('.tool-step').filter({has:page.locator('.web-step-body')}).first();await webStep.locator(':scope > summary').click();assert.equal(await webStep.locator('.web-result').count(),1);assert.ok((await webStep.innerText()).includes('A useful excerpt'));assert.ok((await webStep.locator('.step-metadata dd').boundingBox()).width>150,'Web metadata must use the full content column');
  await page.screenshot({path:fixture.output+'/migrated-web.png'});
  await article.locator('.change-panel > summary').click();const changed=article.locator('.review-file').filter({hasText:'report.csv'});await changed.locator('summary').click();assert.ok((await changed.locator('.review-diff').innerText()).includes('+fish,3'));
  await page.screenshot({path:fixture.output+'/migrated-diff.png'});
  await panel('#settings-toggle');await page.locator('#show-plan').check();await close();await page.locator('#plan-toggle').click();
  const plan=await start('Make a plan');await done(plan);await composer();await page.locator('#prompt').fill('keep my unsent draft');
  const implementResponse=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/turns'));await page.locator(`.turn[data-job="${plan.id}"] .implement-plan`).click();const implementation=await(await implementResponse).json();await done(implementation);assert.equal(await page.locator('#prompt').inputValue(),'keep my unsent draft');
  const planArticle=page.locator(`.turn[data-job="${plan.id}"]`);await planArticle.locator('.user-turn').hover();await planArticle.locator('.user-edit-button').click();await planArticle.locator('.message-editor textarea').fill('Revised plan');
  await page.screenshot({path:fixture.output+'/migrated-editor.png'});
  await planArticle.locator('.message-edit-send').click();await page.waitForFunction(()=>document.querySelectorAll('.turn').length===2&&[...document.querySelectorAll('.user-message')].some(e=>e.textContent==='Revised plan'));await page.waitForFunction(()=>document.querySelector('#composer').dataset.jobStatus==='idle');
  assert.equal(await page.locator('#prompt').inputValue(),'keep my unsent draft');
  const slow=await start('[slow]');await page.waitForFunction(id=>document.querySelector(`.turn[data-job="${id}"] .assistant-text`)?.textContent,slow.id);
  await composer();await page.locator('#prompt').fill('shorten this response');await page.locator('#send').click();await done(slow);assert.ok((await page.locator('.supplementary-instruction').innerText()).includes('Delivered'));
  await page.screenshot({path:fixture.output+'/migrated-instruction.png'});
  const question=await start('[question]');await page.locator('#question-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#question-fields fieldset').count(),2);await page.locator('#question-fields input[type=radio]').first().check();await page.locator('#question-fields input[type=password]').fill('private UI answer');
  await page.screenshot({path:fixture.output+'/migrated-question.png'});await page.locator('#question-submit').click();await page.locator('#question-dialog').waitFor({state:'hidden'});await done(question);assert.equal((await page.locator('#messages').innerText()).includes('private UI answer'),false);
  await panel('#skills-toggle');await page.getByRole('button',{name:'Create skill',exact:true}).click();await page.locator('#skill-scope').selectOption('user');await page.locator('#skill-name').fill('shared-browser-skill');await page.locator('#skill-description').fill('Cross-project skill');await page.locator('#skill-body').fill('Read the current request carefully.');await page.locator('#save-skill').click();await page.waitForSelector('.account-entry');assert.ok((await page.locator('#native-page').innerText()).includes('shared-browser-skill'));await close();
  await panel('#account-toggle');await page.getByRole('button',{name:'Sign in with ChatGPT (device code)',exact:true}).click();await page.locator('.native-login-session').waitFor();await page.screenshot({path:fixture.output+'/migrated-login.png'});await page.waitForFunction(()=>document.querySelector('.native-login-session')?.textContent.includes('Authorization completed.'));
  const keyInput=page.locator('#native-page input[type=password]');await keyInput.fill('test-web-key');await page.locator('#native-page form button').click();await page.waitForFunction(()=>document.querySelector('#native-page')?.textContent.includes('apiKey'));assert.equal((await page.locator('#native-page').innerText()).includes('test-web-key'),false);
  await page.locator('[data-account-tab=connections]').click();await page.locator('#native-page .account-entry button').click();await page.waitForFunction(()=>document.querySelector('.native-login-session')?.textContent.includes('Authorization completed.'));await page.screenshot({path:fixture.output+'/migrated-mcp.png'});await close();
  // Original folded handle remains usable, and typing resumes without changing conversation.
  await page.locator('#prompt').focus();await page.keyboard.press('Escape');await page.locator('#composer-handle').waitFor({state:'visible'});await page.locator('#composer-handle').click();await page.locator('#composer').waitFor({state:'visible'});
  await page.evaluate(async()=>fetch('/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}));
  // A real drag persists ordering, rather than only moving DOM rows.
  const all=await page.evaluate(async()=>{const result=await(await fetch('/api/conversations')).json();return result.conversations;});
  for(const entry of all.slice(0,2))await page.evaluate(async id=>fetch(`/api/conversations/${id}/settings`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pinned:true})}),entry.id);
  await page.waitForFunction(()=>document.querySelectorAll('#pinned-conversations .conversation-row').length>=2);
  const before=await page.locator('#pinned-conversations .conversation-row').evaluateAll(rows=>rows.map(r=>r.dataset.id));const first=await page.locator('#pinned-conversations .conversation').first().boundingBox(),second=await page.locator('#pinned-conversations .conversation').nth(1).boundingBox();
  await page.mouse.move(first.x+40,first.y+first.height/2);await page.mouse.down();await page.mouse.move(second.x+40,second.y+second.height*.8,{steps:12});await page.mouse.up();await page.waitForTimeout(500);
  const persisted=await page.evaluate(async()=>{const data=await(await fetch('/api/conversations')).json();return data.conversations.filter(c=>c.pinned).map(c=>c.id);});assert.deepEqual(persisted.slice(0,2),[before[1],before[0]]);
  await panel('#settings-toggle');await page.locator('#language').selectOption('zh');await close();assert.ok((await page.locator('#messages').innerText()).includes('已完成'));await page.setViewportSize({width:390,height:844});await composer();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:fixture.output+'/migrated-mobile.png'});assert.deepEqual(errors,[]);console.log('migration browser checks passed');
 }catch(error){console.error('Page errors:',errors);fs.writeFileSync(fixture.output+'/migration-dom.html',await page.content());await page.screenshot({path:fixture.output+'/migration-browser-failure.png',fullPage:true});throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
