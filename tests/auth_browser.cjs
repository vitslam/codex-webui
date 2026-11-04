"use strict";
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.LAZYFISH_BROWSER_MODULE);
const fixture=JSON.parse(fs.readFileSync(process.env.LAZYFISH_BROWSER_FIXTURE,'utf8'));
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.LAZYFISH_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
  try{
    const context=await browser.newContext(),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(fixture.url);
    await page.locator('#login-screen:not([hidden])').waitFor();
    await page.locator('#token').fill('incorrect-token');await page.locator('#login button').click();
    await page.waitForFunction(()=>/Incorrect Web token/.test(document.querySelector('#message').textContent));
    await page.locator('#token').fill('  '+fixture.token+'  ');await page.locator('#login button').click();
    await page.locator('#app:not([hidden])').waitFor();
    await page.addInitScript(()=>{
      window.loginFlashed=false;
      function check(){const login=document.querySelector('#login-screen');if(login&&!login.hidden)window.loginFlashed=true;}
      new MutationObserver(check).observe(document,{subtree:true,attributes:true,attributeFilter:['hidden'],childList:true});
    });
    // Hold the main script, then the session check, to cover both first HTML paint and async restoration.
    let releaseScript,releaseStatus;
    const scriptGate=new Promise(resolve=>{releaseScript=resolve;});
    const statusGate=new Promise(resolve=>{releaseStatus=resolve;});
    await page.route('**/app.js*',async route=>{await scriptGate;await route.continue();});
    await page.route('**/api/status',async route=>{await statusGate;await route.continue();});
    await page.goto(fixture.url,{waitUntil:'commit'});
    await page.waitForFunction(()=>Boolean(document.querySelector('#login-screen')));
    assert.equal(await page.locator('#login-screen').evaluate(el=>el.hidden),true);
    releaseScript();await page.waitForLoadState('domcontentloaded');
    assert.equal(await page.locator('#login-screen').evaluate(el=>el.hidden),true);
    releaseStatus();await page.locator('#app:not([hidden])').waitFor();
    assert.equal(await page.evaluate(()=>window.loginFlashed),false);
    await page.unrouteAll({behavior:'wait'});
    // Expired sessions and failed status requests must reveal a usable login page.
    assert.equal(await page.evaluate(async()=>{const result=await fetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return result.status;}),200);
    await page.reload();await page.locator('#login-screen:not([hidden])').waitFor();
    await page.route('**/api/status',route=>route.abort());
    await page.reload();await page.locator('#login-screen:not([hidden])').waitFor();
    assert.deepEqual(errors,[]);
    console.log('login restore passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
