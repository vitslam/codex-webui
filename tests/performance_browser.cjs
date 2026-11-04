"use strict";
const fs=require('fs'),assert=require('assert');
const {chromium}=require(process.env.LAZYFISH_BROWSER_MODULE),fixture=JSON.parse(fs.readFileSync(process.env.LAZYFISH_BROWSER_FIXTURE,'utf8'));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.LAZYFISH_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-US'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await page.waitForTimeout(20);}throw Error('Expected concurrent requests did not start');};
 const ready=()=>page.waitForSelector('.assistant-text');
 async function openUsage(){await page.locator('#menu-toggle').click();await page.locator('#usage-toggle').click();}
 try{
  await page.goto(fixture.url+'/?conversation='+fixture.main);await page.locator('#token').fill(fixture.token);await page.locator('#login button').click();await ready();
  assert.equal(await page.locator('.tool-step').count(),0,'Collapsed history must not construct tool nodes');
  await openUsage();await page.waitForSelector('.activity-calendar');await page.locator('#account-close').click();
  let release;const quotaGate=new Promise(resolve=>release=resolve);
  await page.route('**/api/native/usage?*',async route=>{await quotaGate;await route.continue();});
  await openUsage();
  assert.ok(await page.locator('.quota-card').count());assert.equal(await page.locator('.activity-calendar').count(),1);
  assert.equal((await page.locator('#native-page').innerText()).includes('Loading'),false,'Warm panels must render saved quota and activity immediately');
  await page.locator('#account-reload').click();
  assert.equal(await page.locator('.activity-calendar').count(),1);assert.ok(await page.locator('.quota-card').count());
  release();await page.waitForTimeout(850);await page.locator('#account-close').click();await page.unrouteAll({behavior:'ignoreErrors'});
  // Failed refresh keeps old quota/calendar instead of replacing them with a loader or error screen.
  await page.route('**/api/native/usage?*',route=>route.fulfill({status:409,contentType:'application/json',body:'{"error":"native_metadata_unavailable"}'}));
  await openUsage();await page.waitForTimeout(150);assert.ok(await page.locator('.quota-card').count());assert.equal(await page.locator('.activity-calendar').count(),1);
  await page.locator('#account-close').click();await page.unrouteAll({behavior:'ignoreErrors'});
  const keys=await page.evaluate(()=>Object.keys(localStorage));assert.ok(keys.some(k=>k.startsWith('lazyfish.metadata.v1:')));
  let releaseBoot;const boot=new Promise(resolve=>releaseBoot=resolve),started=new Set();
  for(const [name,pattern] of [['status','**/api/status'],['list','**/api/conversations'],['chat','**/api/conversations/'+fixture.main+'?*']]){
   await page.route(pattern,async route=>{started.add(name);await boot;await route.continue();});
  }
  await page.reload({waitUntil:'domcontentloaded'});await wait(()=>started.size===3);releaseBoot();await ready();
  assert.equal(await page.locator('.tool-step').count(),0);
  await page.unrouteAll({behavior:'ignoreErrors'});
  // Browser quota snapshots survive Cmd+R and are painted before a delayed API returns.
  let releaseReload;const reloadQuota=new Promise(resolve=>releaseReload=resolve);
  await page.route('**/api/native/usage?*',async route=>{await reloadQuota;await route.continue();});
  await openUsage();assert.ok(await page.locator('.quota-card').count());assert.equal(await page.locator('.activity-calendar').count(),1);
  assert.equal((await page.locator('#native-page').innerText()).includes('Loading'),false);
  releaseReload();await page.locator('#account-close').click();await page.unrouteAll({behavior:'ignoreErrors'});
  const article=page.locator('.turn').first();await article.locator('.execution-process > summary').click();await article.locator('.tool-step').first().waitFor({state:'attached'});await article.locator('.command-group > summary').click();
  assert.equal(await article.locator('.tool-step').count(),3);
  await article.locator('.tool-step > summary').first().click();await article.locator('.execution-log').filter({hasText:'Saved command output'}).first().waitFor();assert.ok((await article.innerText()).includes('Saved command output'));
  await page.evaluate(()=>window.savedArticle=document.querySelector('.turn'));
  await page.locator('#conversation-list .conversation[data-id="'+fixture.other+'"]').click();await page.waitForFunction(id=>new URL(location.href).searchParams.get('conversation')===id,fixture.other);
  let releaseChat;const chatGate=new Promise(resolve=>releaseChat=resolve);
  await page.route('**/api/conversations/'+fixture.main+'?*',async route=>{await chatGate;await route.continue();});
  await page.locator('#conversation-list .conversation[data-id="'+fixture.main+'"]').click();
  await page.waitForFunction(()=>window.savedArticle===document.querySelector('.turn'));
  assert.equal(await article.locator('.tool-step').count(),3);
  releaseChat();await page.waitForTimeout(300);assert.ok(await page.evaluate(()=>window.savedArticle===document.querySelector('.turn')));await page.unrouteAll({behavior:'ignoreErrors'});
  // Cross-tab edits invalidate retained history after server confirmation.
  const oldId=await article.getAttribute('data-job');
  const edit=await context.request.post(fixture.url+'/api/conversations/'+fixture.main+'/edit',{headers:{Origin:fixture.url},data:{before_job_id:oldId,text:'Changed in another tab',client_request_id:'browser-edit-'+Date.now()}});
  assert.equal(edit.status(),202);
  await page.locator('#conversation-list .conversation[data-id="'+fixture.other+'"]').click();await page.waitForFunction(id=>new URL(location.href).searchParams.get('conversation')===id,fixture.other);
  await page.locator('#conversation-list .conversation[data-id="'+fixture.main+'"]').click();await page.waitForFunction(()=>[...document.querySelectorAll('.user-message')].some(el=>el.textContent.includes('Changed in another tab')));
  assert.equal(await page.locator('.turn[data-job="'+oldId+'"]').count(),0);
  assert.deepEqual(errors,[]);console.log('performance browser checks passed');
 }finally{await page.unrouteAll({behavior:'ignoreErrors'});await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
