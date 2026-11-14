'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.LAZYFISH_BROWSER_MODULE);
const f=JSON.parse(fs.readFileSync(process.env.LAZYFISH_BROWSER_FIXTURE,'utf8'));
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.LAZYFISH_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'zh-CN'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>localStorage.setItem('lazyfish.appearance','dark'));
    const group=path=>page.locator('.sidebar-project').filter({has:page.locator('.sidebar-project-toggle[title="'+path+'"]')});
    const row=(path,id)=>group(path).locator('.conversation-row[data-id="'+id+'"]');
    const toggle=path=>group(path).locator('.sidebar-project-toggle');
    async function expanded(path){if(await toggle(path).getAttribute('aria-expanded')!=='true')await toggle(path).click();await group(path).locator('.conversation-row').first().waitFor();}
    await page.goto(f.url+'/?conversation='+f.chats[13]);await page.locator('#token').fill(f.token);await page.locator('#login button').click();await page.locator('.assistant-text').waitFor();await expanded(f.paths[0]);
    assert.equal(await page.locator('#sidebar-recent>.sidebar-disclosure').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#recent-conversations').count(),0);
    const order=await page.locator('#conversation-list').evaluate(el=>[...el.children].map(e=>e.id));assert.ok(order.indexOf('pinned-conversations')<order.indexOf('sidebar-projects'));assert.ok(order.indexOf('sidebar-projects')<order.indexOf('sidebar-recent'));
    let fail=true;
    await page.route('**/api/conversations?*',route=>{if(fail&&new URL(route.request().url()).searchParams.get('workspace')===f.paths[1]){fail=false;return route.fulfill({status:503,contentType:'application/json',body:'{"error":"storage_unavailable"}'});}return route.continue();});
    await toggle(f.paths[1]).click();await group(f.paths[1]).getByText('加载对话失败。 重试',{exact:true}).click();await group(f.paths[1]).locator('.conversation-row').first().waitFor();await toggle(f.paths[1]).click();await page.unrouteAll({behavior:'wait'});
    assert.equal(await page.locator('.sidebar-project').count(),3);assert.equal(await page.locator('.sidebar-project-path').count(),2,'Same folder names expose their different full paths');
    assert.equal(await page.evaluate(id=>conversations.some(c=>c.id===id),f.chats.at(-1)),false,'Old project is beyond the recent page');
    await expanded(f.paths[2]);await row(f.paths[2],f.chats.at(-1)).locator('.conversation').click();await page.waitForFunction(id=>conversation?.id===id,f.chats.at(-1));
    await expanded(f.paths[0]);assert.equal(await group(f.paths[0]).locator('.conversation-row').count(),10);await group(f.paths[0]).locator('.sidebar-project-more').click();await page.waitForFunction(path=>[...document.querySelectorAll('.sidebar-project')].find(e=>e.dataset.workspace===path)?.querySelectorAll('.conversation-row').length===14,f.paths[0]);
    await page.evaluate(()=>refreshList());assert.equal(await group(f.paths[0]).locator('.conversation-row').count(),14,'Periodic refresh keeps the loaded project history');
    // Rename and pin through the project view; archiving updates both membership and counts.
    await row(f.paths[0],f.chats[0]).locator('.conversation').dblclick();await row(f.paths[0],f.chats[0]).locator('input').fill('Renamed project chat');await row(f.paths[0],f.chats[0]).locator('input').press('Enter');await row(f.paths[0],f.chats[0]).getByText('Renamed project chat',{exact:true}).waitFor();
    await row(f.paths[0],f.chats[0]).hover();await row(f.paths[0],f.chats[0]).locator('.conversation-pin').click();await page.locator('#pinned-conversations .conversation-row[data-id="'+f.chats[0]+'"]').waitFor();
    const pinRows=page.locator('#pinned-conversations .conversation-row'),before=await pinRows.evaluateAll(rows=>rows.map(r=>r.dataset.id));
    const first=await pinRows.first().locator('.conversation').boundingBox(),second=await pinRows.nth(1).locator('.conversation').boundingBox();
    await page.mouse.move(first.x+40,first.y+first.height/2);await page.mouse.down();await page.mouse.move(first.x+40,second.y+second.height*.8,{steps:12});await page.mouse.up();
    await page.waitForFunction(ids=>[...document.querySelectorAll('#pinned-conversations .conversation-row')].map(r=>r.dataset.id).join()===ids.slice().reverse().join(),before);
    await page.waitForFunction(ids=>!document.querySelector('#conversation-list').dataset.reordering&&conversations.slice(0,2).map(c=>c.id).join()===ids.slice().reverse().join(),before);
    const shortcut=await page.evaluate(()=>conversations[0].id);await page.keyboard.down('Control');await page.keyboard.down('Shift');await page.keyboard.down('Digit1');await page.keyboard.up('Digit1');await page.keyboard.up('Shift');await page.keyboard.up('Control');await page.waitForFunction(id=>conversation?.id===id,shortcut);
    await row(f.paths[0],f.chats[1]).hover();await row(f.paths[0],f.chats[1]).locator('.conversation-archive').click();await row(f.paths[0],f.chats[1]).waitFor({state:'detached'});
    await page.waitForFunction(path=>[...document.querySelectorAll('.sidebar-project-toggle')].find(e=>e.title===path)?.querySelector('.sidebar-project-count').textContent==='13',f.paths[0]);
    await page.evaluate(async id=>{await api('/api/conversations/'+id+'/restore',{});await loadConversation(id);},f.chats[1]);
    await page.evaluate(()=>document.querySelector('#edit-workdir').click());await page.locator('#workdir-input').fill(f.paths[1]);await page.locator('#workdir-save').click();await page.locator('#workdir-dialog').waitFor({state:'hidden'});
    await expanded(f.paths[1]);await row(f.paths[1],f.chats[1]).waitFor();
    while(!await row(f.paths[1],f.chats[1]).count()){
      const response=page.waitForResponse(r=>r.url().includes('/api/conversations?')&&new URL(r.url()).searchParams.get('workspace')===f.paths[1]);
      await group(f.paths[1]).locator('.sidebar-project-more').click();await response;
      await page.waitForFunction(path=>![...document.querySelectorAll('.sidebar-project')].find(e=>e.dataset.workspace===path)?.querySelector('.sidebar-project-more[disabled]'),f.paths[1]);
    }
    await row(f.paths[0],f.chats[1]).waitFor({state:'detached'});
    while(await group(f.paths[1]).locator('.conversation-row').count()<110){
      const more=group(f.paths[1]).locator('.sidebar-project-more');await more.click();await page.waitForFunction(path=>![...document.querySelectorAll('.sidebar-project')].find(e=>e.dataset.workspace===path)?.querySelector('.sidebar-project-more[disabled]'),f.paths[1]);
    }
    const loaded=await group(f.paths[1]).locator('.conversation-row').evaluateAll(rows=>rows.map(r=>r.dataset.id));
    await page.evaluate(async path=>{await api('/api/conversations',{workspace:path,title:'Newly created project chat'});await refreshList();},f.paths[1]);
    await group(f.paths[1]).getByText('Newly created project chat',{exact:true}).waitFor();
    const refreshed=await group(f.paths[1]).locator('.conversation-row').evaluateAll(rows=>rows.map(r=>r.dataset.id));assert.ok(loaded.every(id=>refreshed.includes(id)),'Refreshing more than 100 loaded chats preserves the pagination boundary');
    await toggle(f.paths[1]).click();
    await page.locator('#sidebar-recent>.sidebar-disclosure').click();await page.locator('#recent-conversations').waitFor();assert.equal(await page.locator('#more-conversations').isVisible(),true);await page.locator('#sidebar-recent>.sidebar-disclosure').click();
    await page.reload();await page.locator('#sidebar-projects').waitFor();assert.equal(await page.locator('#sidebar-recent>.sidebar-disclosure').getAttribute('aria-expanded'),'false');
    await expanded(f.paths[0]);
    if(process.env.LAZYFISH_BROWSER_OUTPUT)await page.screenshot({path:process.env.LAZYFISH_BROWSER_OUTPUT+'/sidebar-projects-desktop.png'});
    await page.setViewportSize({width:390,height:844});if(await page.evaluate(()=>document.body.classList.contains('sidebar-hidden')))await page.locator('#sidebar-toggle').click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(process.env.LAZYFISH_BROWSER_OUTPUT)await page.screenshot({path:process.env.LAZYFISH_BROWSER_OUTPUT+'/sidebar-projects-mobile.png'});
    assert.deepEqual(errors,[]);console.log('project sidebar checks passed');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
