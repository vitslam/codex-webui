"use strict";
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.LAZYFISH_BROWSER_MODULE),f=JSON.parse(fs.readFileSync(process.env.LAZYFISH_BROWSER_FIXTURE,'utf8'));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.LAZYFISH_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({locale:'en-US'}),page=await context.newPage(),errors=[];let starts=0;
  context.on('page',p=>{p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).pathname==='/api/native/login'&&r.method()==='POST')starts++;});});
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname==='/api/native/login'&&r.method()==='POST')starts++;});
  async function account(p){await p.locator('#app:not([hidden])').waitFor();await p.locator('#menu-toggle').click();await p.locator('#account-toggle').click();await p.locator('.account-auth-methods').waitFor();}
  await page.goto(f.url);await page.locator('#token').fill(f.token);await page.locator('#login button').click();await account(page);
  await page.locator('.account-auth-methods button').first().evaluate(button=>{button.click();button.click();});
  await page.locator('.native-login-session[data-session]').waitFor();
  const id=await page.locator('.native-login-session').getAttribute('data-session');assert.equal(starts,1);
  await page.locator('.account-auth-methods button').last().click();assert.equal(starts,1,'Repeated click reuses the current authorization');assert.equal(await page.locator('.native-login-session').count(),1);
  await page.reload();await account(page);await page.locator(`.native-login-session[data-session="${id}"]`).waitFor();assert.equal(starts,1,'Reload does not start a new native authorization');
  const other=await context.newPage();await other.goto(f.url);await account(other);await other.locator(`.native-login-session[data-session="${id}"]`).waitFor();assert.equal(starts,1,'New tabs recover the server session');
  assert.match(await other.locator('.native-login-session').textContent(),/TEST-CODE/);
  assert.equal(await other.locator('.native-login-session a').getAttribute('href'),'https://example.invalid/device');
  let dropped=false,confirmDrop;const droppedRequest=new Promise(resolve=>{confirmDrop=resolve;});
  await other.route('**/api/native/sessions/'+id,route=>{if(!dropped){dropped=true;confirmDrop();return route.abort();}return route.continue();});
  await droppedRequest;await other.waitForResponse(r=>new URL(r.url()).pathname==='/api/native/sessions/'+id&&r.status()===200);assert.equal(dropped,true,'A transient status failure is retried');
  await other.getByRole('button',{name:'Cancel authorization',exact:true}).click();
  await other.waitForFunction(()=>document.querySelector('.native-login-session')?.textContent.includes('Authorization cancelled.'));
  await page.waitForFunction(()=>document.querySelector('.native-login-session')?.textContent.includes('Authorization cancelled.'));
  assert.equal(await other.locator('.native-login-session').count(),1);
  await other.route('**/api/native/login',route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'account_busy'})}));
  for(let i=0;i<3;i++){
   const response=other.waitForResponse(r=>new URL(r.url()).pathname==='/api/native/login');
   await other.locator('.account-auth-methods button').first().click();await response;
   await other.waitForFunction(()=>document.querySelector('.native-login-feedback')?.textContent.includes('Wait for active tasks'));
   assert.equal(await other.locator('.native-login-feedback').count(),1,'Errors replace the previous feedback');
  }
  // A starting response may not have an authorization URL yet; cancellation is still available.
  await other.unroute('**/api/native/login');
  let releaseStatus,newId;
  const gate=new Promise(resolve=>{releaseStatus=resolve;});
  await other.route('**/api/native/sessions/*',async route=>{if(route.request().method()==='GET'&&new URL(route.request().url()).pathname.endsWith('/'+newId))await gate;await route.continue();});
  await other.route('**/api/native/login',async route=>{const response=await route.fetch(),session=await response.json();newId=session.id;await route.fulfill({response,json:{id:newId,kind:'account',state:'starting'}});});
  await other.locator('.account-auth-methods button').first().click();
  await other.locator('.native-login-session a').waitFor({state:'detached'});
  const cancelled=other.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/cancel'));
  await other.getByRole('button',{name:'Cancel authorization',exact:true}).click();await cancelled;
  releaseStatus();
  await other.waitForFunction(()=>document.querySelector('.native-login-session')?.textContent.includes('Authorization cancelled.'));
  assert.deepEqual(errors,[]);console.log('native login recovery passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
