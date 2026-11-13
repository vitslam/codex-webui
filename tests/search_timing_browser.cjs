'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.LAZYFISH_BROWSER_MODULE);
const f=JSON.parse(fs.readFileSync(process.env.LAZYFISH_BROWSER_FIXTURE,'utf8'));
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.LAZYFISH_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({locale:'en-US'}),page=await context.newPage(),queries=[],errors=[],releases=[];
  const query=url=>new URL(url).searchParams.get('q');
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/conversations'&&query(request.url())!==null)queries.push(query(request.url()));});
  async function until(check){const deadline=Date.now()+5000;while(Date.now()<deadline){if(await check())return;await new Promise(r=>setTimeout(r,20));}throw new Error('Browser did not settle');}
  async function hold(value){
    let release,arrived;const gate=new Promise(r=>release=r),seen=new Promise(r=>arrived=r);releases.push(release);
    const match=url=>url.pathname==='/api/conversations'&&url.searchParams.get('q')===value;
    await page.route(match,async route=>{arrived();await gate;await route.continue();});return {release,seen,match};
  }
  const results=()=>page.locator('.search-result').count(),feedback=()=>page.locator('.search-feedback').count();
  try{
    await page.goto(f.url+'/?conversation='+f.chat);await page.locator('#token').fill(f.token);await page.locator('#login button').click();await page.locator('#app:not([hidden])').waitFor();await page.locator('#search-toggle').click();assert.equal(await results(),20);assert.deepEqual(queries,[]);
    await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
    const slow=await hold('Needle');await page.locator('#conversation-search').fill('Needle');await page.clock.runFor(49);assert.deepEqual(queries,[]);await page.clock.runFor(1);await slow.seen;
    assert.deepEqual(queries,['Needle']);assert.equal(await results(),20,'Prior results remain during the request');await page.clock.runFor(299);assert.equal(await feedback(),0);await page.clock.runFor(1);assert.equal(await page.locator('.search-feedback span').innerText(),'Searching…');assert.equal(await results(),20);
    slow.release();await until(async()=>await results()===50);assert.equal(await feedback(),0);await page.unroute(slow.match);
    // Fast responses never flash loading feedback, even after its former deadline.
    await page.evaluate(()=>{window.loadingFlashed=false;new MutationObserver(()=>{if(document.querySelector('.search-feedback span')?.textContent==='Searching…')loadingFlashed=true;}).observe(document.querySelector('#search-results'),{subtree:true,childList:true});});
    await page.locator('#conversation-search').fill('Restored');await page.clock.runFor(50);await until(async()=>await results()===1);await page.clock.runFor(500);assert.equal(await page.evaluate(()=>loadingFlashed),false);
    // Intermediate IME text and composition-time submissions do not send searches.
    const before=queries.length;await page.evaluate(()=>{const input=document.querySelector('#conversation-search');input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));input.value='ni';input.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));document.querySelector('#conversation-search-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    await page.clock.runFor(1000);assert.equal(queries.length,before);
    await page.evaluate(()=>{const input=document.querySelector('#conversation-search');input.value='Needle';input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));input.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:false}));});
    await page.clock.runFor(49);assert.equal(queries.length,before);await page.clock.runFor(1);await until(async()=>await results()===50);assert.equal(queries.length,before+1);
    // A response to an obsolete query cannot overwrite a newer query's results.
    const stale=await hold('Needle conversation'),staleResponse=page.waitForResponse(r=>query(r.url())==='Needle conversation');await page.locator('#conversation-search').fill('Needle conversation');await page.clock.runFor(50);await stale.seen;
    await page.locator('#conversation-search').fill('Restored');await page.clock.runFor(50);await until(async()=>await results()===1);stale.release();await (await staleResponse).finished();await page.evaluate(()=>Promise.resolve());assert.equal(await results(),1);assert.equal(await page.locator('.search-result').getAttribute('data-id'),f.chat);await page.unroute(stale.match);
    // Clearing the query restores local recents synchronously and cancels old feedback.
    const clearing=await hold('Needle conversation'),clearedResponse=page.waitForResponse(r=>query(r.url())==='Needle conversation');await page.locator('#conversation-search').fill('Needle conversation');await page.clock.runFor(50);await clearing.seen;await page.locator('#conversation-search').fill('');assert.equal(await results(),20);assert.equal(await feedback(),0);clearing.release();await (await clearedResponse).finished();await page.clock.runFor(500);assert.equal(await results(),20);await page.unroute(clearing.match);
    // Failures keep the previous results and expose an explicit retry action.
    let attempts=0;await page.route(url=>url.pathname==='/api/conversations'&&url.searchParams.get('q')==='broken-query',route=>{attempts++;return route.fulfill({status:attempts===1?503:200,contentType:'application/json',body:attempts===1?'{}':'{"conversations":[],"next_cursor":null}'});});
    await page.locator('#conversation-search').fill('broken-query');await page.clock.runFor(50);await until(async()=>await page.locator('.search-retry').count()===1);assert.equal(await results(),20);assert.equal(await page.locator('.search-feedback span').innerText(),'Search failed.');assert.equal(await page.locator('.search-empty').count(),0);
    await page.evaluate(()=>document.querySelector('.search-retry').click());await until(async()=>await page.locator('.search-empty').count()===1);assert.equal(attempts,2);assert.equal(await feedback(),0);assert.equal(await results(),0);
    // Closing cancels a queued search; reopening still needs no blank-query request.
    const closedBefore=queries.length;await page.locator('#conversation-search').fill('Needle');await page.evaluate(()=>document.querySelector('#search-dialog').close());await page.clock.runFor(100);assert.equal(queries.length,closedBefore);await page.evaluate(()=>document.querySelector('#search-toggle').click());assert.equal(await results(),20);assert.equal(queries.includes(''),false);
    assert.deepEqual(errors,[]);console.log('search-timing checks passed');
  }finally{for(const release of releases)release();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
