'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.LAZYFISH_BROWSER_MODULE);
const f=JSON.parse(fs.readFileSync(process.env.LAZYFISH_BROWSER_FIXTURE,'utf8'));
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.LAZYFISH_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({locale:'en-US'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const timeline=page.locator('.execution-timeline');
  async function check(){
    await page.waitForFunction(()=>document.querySelectorAll('.command-group .tool-step').length===2);
    assert.equal(await timeline.locator('.tool-step').count(),3);
    const text=await timeline.innerText();assert.equal(text.includes('user_message'),false);assert.equal(text.includes('Saved request'),false);
    assert.equal(text.includes('future_tool'),true,'Unknown genuine tool events keep their fallback label');
    assert.equal(await page.locator('.user-text').innerText(),'Saved request');
    assert.equal(await page.locator('.assistant-text').innerText(),'Saved answer');
  }
  try{
    await page.goto(f.url+'/?conversation='+f.chat);await page.locator('#token').fill(f.token);await page.locator('#login button').click();
    await page.locator('.assistant-text').waitFor();
    const before=await page.evaluate(async id=>(await(await fetch('/api/jobs/'+id+'/steps')).json()).items,f.job);
    assert.equal(before.filter(item=>item.detail.type==='user_message').length,3);
    await page.locator('.execution-process > summary').click();await check();
    // Also render the full in-memory payload, bypassing deferred history loading.
    await page.evaluate(async id=>{const job=await api('/api/jobs/'+id);conversation.jobs=[job];renderJob(job);},f.job);
    if(!await page.locator('.execution-process').evaluate(el=>el.open))await page.locator('.execution-process > summary').click();
    await check();
    const after=await page.evaluate(async id=>(await(await fetch('/api/jobs/'+id+'/steps')).json()).items,f.job);
    assert.deepEqual(after,before,'Display filtering preserves historical records');assert.deepEqual(errors,[]);
    console.log('saved user echoes passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
