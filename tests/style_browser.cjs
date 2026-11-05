'use strict';
const fs=require('fs'),assert=require('assert');
const {chromium}=require(process.env.LAZYFISH_BROWSER_MODULE),f=JSON.parse(fs.readFileSync(process.env.LAZYFISH_BROWSER_FIXTURE,'utf8'));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.LAZYFISH_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-US'}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const form=page.locator('#composer'),prompt=page.locator('#prompt');
 const style=(locator,property)=>locator.evaluate((el,key)=>getComputedStyle(el)[key],property);
 async function wake(){if(await form.isHidden())await page.locator('#composer-handle').click();await form.evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));}
 async function settings(){await wake();if(await page.evaluate(()=>document.body.classList.contains('sidebar-hidden')))await page.locator('#sidebar-toggle').click();await page.locator('#menu-toggle').click();await page.locator('#settings-toggle').click();}
 try{
  await page.goto(f.url);await page.locator('#token').fill(f.token);await page.locator('#login button').click();await page.waitForSelector('#app:not([hidden])');
  for(const theme of ['light','dark']){
   await settings();await page.locator('#appearance').selectOption(theme);await page.locator('#account-close').click();
   for(const size of [{width:1440,height:1000},{width:390,height:844}]){
    await page.setViewportSize(size);await page.evaluate(()=>document.body.classList.add('sidebar-hidden'));
    assert.equal(await page.locator('.composer-hint').count(),0);assert.equal(await prompt.getAttribute('rows'),'1');
    // outline-style:none means no painted outline; Chromium may retain a nonzero computed width.
    await prompt.fill('');await prompt.click();assert.equal(await style(prompt,'outlineStyle'),'none');assert.equal(await style(prompt,'boxShadow'),'none');assert.ok(await prompt.evaluate(el=>document.activeElement===el));
    assert.ok((await prompt.boundingBox()).height<48,'No extra two-row/min-height scaffold');
    const font=Number.parseFloat(await style(prompt,'fontSize')),line=Number.parseFloat(await style(prompt,'lineHeight'));assert.ok(Math.abs(line-font*(size.width<760?1.5:1.7))<.1,'Reference line-height survives the CSS cascade');
    await prompt.fill('Typing still works');await prompt.press('ArrowLeft');assert.equal(await style(prompt,'outlineStyle'),'none');assert.equal(await prompt.inputValue(),'Typing still works');
    await prompt.fill(Array.from({length:100},(_,i)=>'Long draft '+i).join('\n'));assert.ok((await prompt.boundingBox()).height<=Math.min(260,size.height*.3)+1);assert.ok(await prompt.evaluate(el=>el.scrollHeight>el.clientHeight));await prompt.fill('');
    await page.locator('#permission-settings > summary').click();assert.equal(await style(page.locator('.permission-panel'),'left'),'-35px');const menu=await page.locator('.permission-panel').boundingBox();assert.ok(menu.x>=0&&menu.x+menu.width<=size.width);await page.keyboard.press('Escape');
    await prompt.click();await page.screenshot({path:f.output+'/composer-'+theme+'-'+size.width+'.png'});
   }
  }
  await settings();await page.locator('#language').selectOption('zh');await page.locator('#account-close').click();await page.evaluate(()=>document.body.classList.add('sidebar-hidden'));assert.equal(await prompt.getAttribute('placeholder'),'与 Codex 协作');assert.equal(await page.locator('.composer-hint').count(),0);
  // The shared image dialog keeps the reference footprint and both dismissal paths.
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kxZkAAAAASUVORK5CYII=','base64');
  await page.locator('#image-input').setInputFiles({name:'tiny.png',mimeType:'image/png',buffer:png});const image=page.locator('#image-previews img');await image.waitFor();await image.click();const viewer=page.locator('.image-viewer');await viewer.waitFor();assert.ok((await viewer.boundingBox()).width<390-32+1);assert.ok((await viewer.boundingBox()).height<844-32+1);await page.mouse.click(4,4);await viewer.waitFor({state:'detached'});await image.click();await page.keyboard.press('Escape');await viewer.waitFor({state:'detached'});
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(id=>loadConversation(id),f.chat);await page.evaluate(()=>document.body.classList.add('sidebar-hidden'));
  const bubble=page.locator('.user-turn');assert.equal(await style(bubble,'marginBottom'),'35px');await bubble.hover();await bubble.locator('.user-edit-button').click();const editor=page.locator('.message-editor textarea');await editor.waitFor();await editor.click();assert.equal(await style(editor,'outlineStyle'),'none');await editor.press('Escape');
  // Only reduced-motion users lose the handle animation; cached restores are separately tested.
  await page.emulateMedia({reducedMotion:'no-preference'});await wake();await prompt.blur();await page.locator('#messages').evaluate(el=>el.scrollTop=500);await form.waitFor({state:'hidden'});assert.equal(await style(page.locator('#composer-handle'),'animationName'),'composer-handle-in');
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await style(page.locator('#composer-handle'),'animationName'),'none');await wake();
  // Offered approvals use the reference readable, bounded detail card.
  const response=await context.request.post(f.url+'/api/conversations/'+f.chat+'/turns',{headers:{Origin:f.url},data:{text:'[permissions-approval]',client_request_id:'style-approval-fixture'}});assert.ok(response.ok(),await response.text());const job=await response.json();await page.locator('#question-dialog').waitFor();const detail=page.locator('.approval-detail');assert.equal(await style(detail,'maxHeight'),'180px');assert.equal(await style(detail,'fontSize'),'11px');assert.equal(await style(detail,'paddingTop'),'12px');
  await page.locator('#question-later').click();await context.request.post(f.url+'/api/jobs/'+job.id+'/cancel',{headers:{Origin:f.url},data:{}});
  assert.deepEqual(errors,[]);console.log('reference style parity passed');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
