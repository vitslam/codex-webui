'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.LAZYFISH_BROWSER_MODULE);
const f=JSON.parse(fs.readFileSync(process.env.LAZYFISH_BROWSER_FIXTURE,'utf8'));
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.LAZYFISH_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({locale:'en-US'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(f.url+'/?conversation='+f.chat);await page.locator('#token').fill(f.token);await page.locator('#login button').click();await page.locator('#app:not([hidden])').waitFor();await page.locator('.assistant-text').first().waitFor();
    if(f.mode==='restore'){
      await page.addInitScript(()=>{
        window.restoreFrames=[];
        function check(){const visible=id=>Boolean(document.querySelector(id)?.getClientRects().length);if(visible('#empty'))restoreFrames.push('welcome');if(visible('#login-screen'))restoreFrames.push('login');}
        new MutationObserver(check).observe(document,{subtree:true,attributes:true,attributeFilter:['hidden','class'],childList:true});
        function frame(){check();requestAnimationFrame(frame);}requestAnimationFrame(frame);
      });
      let release,arrived;const gate=new Promise(r=>release=r),seen=new Promise(r=>arrived=r);
      await page.route('**/api/conversations/'+f.chat+'?view=summary*',async route=>{arrived();await gate;await route.continue();});
      await page.reload({waitUntil:'domcontentloaded'});await seen;await page.locator('#restore-loading:not([hidden])').waitFor();
      assert.equal(await page.locator('#empty').isVisible(),false);assert.equal(await page.locator('#app').isVisible(),false);assert.equal(await page.locator('#login-screen').isVisible(),false);
      await page.evaluate(()=>new Promise(r=>setTimeout(r,150)));release();await page.locator('#app:not([hidden])').waitFor();await page.locator('.assistant-text').first().waitFor();
      assert.deepEqual(await page.evaluate(()=>[...new Set(restoreFrames)]),[],'Refresh never paints a welcome or login page before the restored conversation');await page.unrouteAll({behavior:'wait'});
      // A failed history restoration must not masquerade as an empty conversation.
      await page.route('**/api/conversations/'+f.chat+'?view=summary*',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"storage_unavailable"}'}));
      await page.reload();await page.getByText('Could not restore this conversation. Refresh to retry.',{exact:true}).waitFor();assert.equal(await page.locator('#empty').isVisible(),false);await page.unrouteAll({behavior:'wait'});
      await page.reload();await page.locator('.assistant-text').first().waitFor();assert.equal(await page.locator('#empty').isVisible(),false);
      // A genuinely new chat still shows the welcome state.
      await page.locator('#new-chat').click();await page.locator('#empty').waitFor({state:'visible'});
    }else{
      let blankRequests=0;page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/api/conversations'&&url.searchParams.has('q')&&!url.searchParams.get('q'))blankRequests++;});
      await page.locator('#search-toggle').click();assert.equal(await page.locator('.search-result').count(),20);assert.equal(await page.locator('#search-results .search-loading').count(),0);assert.equal(await page.locator('.search-result[data-id="'+f.old+'"]').count(),0,'Old pinned chats do not displace recent chats');
      const stamps=await page.locator('.search-result-time').evaluateAll(nodes=>nodes.map(n=>Date.parse(n.dateTime)));assert.ok(stamps.every((n,i)=>!i||n<=stamps[i-1]));assert.equal(blankRequests,0);
      await page.locator('#search-dialog').press('Escape');await page.locator('#search-toggle').click();assert.equal(await page.locator('.search-result').count(),20);assert.equal(blankRequests,0);
      const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/conversations'&&new URL(r.url()).searchParams.get('q')==='Needle');await page.locator('#conversation-search').fill('Needle');const result=await response;assert.equal(new URL(result.url()).searchParams.get('limit'),'50');assert.equal((await result.json()).conversations.length,50);
      await page.waitForFunction(()=>document.querySelectorAll('.search-result').length===50);assert.match(await page.locator('.search-limit').innerText(),/50/);assert.ok(await page.locator('.search-result mark').count());assert.match(await page.locator('.search-result[data-id="'+f.old+'"] .search-result-time').innerText(),/3 days ago/);
      const times=await page.locator('.search-result-time').allTextContents();assert.ok(times.some(t=>/minutes? ago/.test(t)));assert.ok(times.some(t=>/hours? ago/.test(t)));assert.ok(await page.locator('.search-result-time').first().getAttribute('title'));
      await page.locator('#conversation-search').fill('');await page.waitForFunction(()=>document.querySelectorAll('.search-result').length===20);assert.equal(blankRequests,0);await page.locator('#search-dialog').press('Escape');
      // Keep an older-page request pending to inspect feedback and duplicate prevention.
      const before=await page.locator('.turn').count();let release,arrived,count=0;const gate=new Promise(r=>release=r),seen=new Promise(r=>arrived=r);
      await page.route('**/api/conversations/'+f.chat+'?view=summary&before=*',async route=>{count++;arrived();await gate;await route.continue();});
      await page.evaluate(()=>document.querySelector('#older').click());await seen;assert.equal(await page.locator('#older').innerText(),'Loading earlier messages…');assert.ok(await page.locator('#older').isDisabled());assert.equal(await page.locator('#older').getAttribute('aria-busy'),'true');await page.evaluate(()=>refreshCurrent(true));assert.equal(await page.locator('#older').getAttribute('aria-busy'),'true','Background sync must not clear an outstanding history load');await page.evaluate(()=>document.querySelector('#older').click());assert.equal(count,1);
      release();await page.waitForFunction(n=>document.querySelectorAll('.turn').length>n,before);await page.waitForFunction(()=>document.querySelector('#older').getAttribute('aria-busy')==='false');assert.equal(await page.locator('#older').innerText(),'Earlier messages');await page.unrouteAll({behavior:'wait'});
      const loaded=await page.locator('.turn').count();await page.route('**/api/conversations/'+f.chat+'?view=summary&before=*',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"storage_unavailable"}'}));
      await page.evaluate(()=>document.querySelector('#older').click());await page.waitForFunction(()=>document.querySelector('#notice').textContent.length>0&&document.querySelector('#older').getAttribute('aria-busy')==='false');assert.equal(await page.locator('.turn').count(),loaded);assert.equal(await page.locator('#older').innerText(),'Earlier messages');assert.equal(await page.locator('#older').isDisabled(),false);await page.unrouteAll({behavior:'wait'});
    }
    assert.deepEqual(errors,[]);console.log(f.mode+' checks passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
