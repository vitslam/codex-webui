'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.LAZYFISH_BROWSER_MODULE);
const f=JSON.parse(fs.readFileSync(process.env.LAZYFISH_BROWSER_FIXTURE,'utf8'));
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.LAZYFISH_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
  await context.addInitScript(()=>localStorage.setItem('lazyfish.appearance','dark'));
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const chatRow=id=>page.locator('.conversation-row[data-id="'+id+'"]').first();
  async function management(){
    if(!await page.locator('#menu-toggle').isVisible())await page.locator('#sidebar-toggle').click();
    await page.locator('#menu-toggle').click();await page.locator('#settings-toggle').click();
    await page.locator('[data-account-tab="dataManagement"]').click();await page.locator('#data-management[aria-busy="false"]').waitFor();
  }
  async function sameSettingsSize(){
    const size=()=>page.locator('#account-dialog').evaluate(el=>{const box=el.getBoundingClientRect();return [box.x,box.y,box.width,box.height,el.querySelector('.account-nav').getBoundingClientRect().width];});
    await page.locator('[data-account-tab="settings"]').click();const baseline=await size();
    await page.locator('[data-account-tab="dataManagement"]').click();await page.locator('#data-management[aria-busy="false"]').waitFor();
    assert.deepEqual(await size(),baseline,'Data management keeps the same dialog and navigation size');
    const content=await page.locator('#account-dialog .account-content').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth}));
    assert.ok(content.scroll<=content.client+1,'Archived chats stay inside the settings content width');
  }
  try{
    await page.goto(f.url+'/?conversation='+f.active[0]);await page.locator('#token').fill(f.token);await page.locator('#login button').click();
    await page.locator('.assistant-text').waitFor();await chatRow(f.active[2]).hover();
    const archive=chatRow(f.active[2]).getByRole('button',{name:'归档聊天',exact:true});
    assert.equal(await archive.locator('use').getAttribute('href'),'#i-archive');
    assert.equal(await page.locator('.conversation-delete').count(),0);
    assert.equal(await page.locator('.conversation-rename').count(),0,'Sidebar has no pencil action');
    const pin=chatRow(f.active[2]).locator('.conversation-pin');
    await pin.hover();
    await page.screenshot({path:f.output+'/archive-sidebar.png',clip:{x:0,y:0,width:248,height:220},animations:'disabled'});
    const normalColor=await pin.evaluate(el=>getComputedStyle(el).color);
    assert.equal(await pin.locator('.icon').evaluate(el=>getComputedStyle(el).fill),'none');
    await pin.click();await page.waitForFunction(id=>document.querySelector('.conversation-row[data-id="'+id+'"] .conversation-pin')?.getAttribute('aria-pressed')==='true',f.active[2]);
    await pin.hover();await page.screenshot({path:f.output+'/archive-sidebar-pinned.png',clip:{x:0,y:0,width:248,height:300},animations:'disabled'});
    assert.equal(await pin.evaluate(el=>getComputedStyle(el).color),normalColor,'Pinning keeps the normal icon color');
    assert.equal(await pin.locator('.icon').evaluate(el=>getComputedStyle(el).fill===getComputedStyle(el).stroke),true,'Pinned fill matches its outline');
    await pin.click();await page.waitForFunction(id=>document.querySelector('.conversation-row[data-id="'+id+'"] .conversation-pin')?.getAttribute('aria-pressed')==='false',f.active[2]);
    assert.equal(await pin.locator('.icon').evaluate(el=>getComputedStyle(el).fill),'none');
    await archive.click();await chatRow(f.active[2]).waitFor({state:'detached'});
    await management();assert.equal(await page.locator('.archive-row').count(),5);await sameSettingsSize();
    assert.equal(await page.locator('[data-account-tab="dataManagement"] svg').count(),0,'Data management matches the text-only navigation');
    await page.mouse.move(1300,950);await page.locator('#account-dialog').screenshot({path:f.output+'/archived-chats-dark.png',animations:'disabled'});
    const search=page.locator('#archive-search');await search.fill('技能');
    await page.waitForFunction(()=>document.querySelectorAll('.archive-row').length===1);
    assert.ok((await page.locator('.archive-title').innerText()).includes('技能'));
    await search.fill('does-not-exist');await page.getByText('未找到符合条件的已归档聊天。',{exact:true}).waitFor();
    await search.fill('');await page.waitForFunction(()=>document.querySelectorAll('.archive-row').length===5);
    await page.locator('#archive-workspace').selectOption(f.workspaces[1]);await page.waitForFunction(()=>document.querySelectorAll('.archive-row').length===1);
    assert.equal(await page.locator('.archive-title').innerText(),'Review project notes');
    await page.locator('#archive-workspace').selectOption('');await page.waitForFunction(()=>document.querySelectorAll('.archive-row').length===5);
    await page.locator('.archive-row[data-id="'+f.active[2]+'"] button').click();await page.waitForFunction(()=>document.querySelectorAll('.archive-row').length===4);
    await page.locator('#account-close').click();await chatRow(f.active[2]).waitFor();
    await chatRow(f.active[2]).locator('.conversation').click();await page.waitForFunction(id=>conversation?.id===id,f.active[2]);await page.locator('.assistant-text').waitFor();
    assert.ok((await page.locator('.assistant-text').innerText()).includes('项目文件和会话记录均正常'));
    // Archiving the selected chat returns to a draft; reloading keeps it archived.
    await chatRow(f.active[2]).hover();await chatRow(f.active[2]).locator('.conversation-archive').click();await page.locator('#empty:not([hidden])').waitFor();
    await page.reload();await page.locator('#app:not([hidden])').waitFor();assert.equal(await chatRow(f.active[2]).count(),0);
    await management();await page.setViewportSize({width:390,height:844});await sameSettingsSize();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await page.locator('.archive-restore').first().isVisible(),true);
    await page.screenshot({path:f.output+'/archived-chats-mobile.png',animations:'disabled'});
    await page.setViewportSize({width:390,height:1000});await sameSettingsSize();
    await page.setViewportSize({width:1440,height:1000});await page.locator('[data-account-tab="settings"]').click();
    await page.locator('#appearance').selectOption('light');await page.locator('[data-account-tab="dataManagement"]').click();await page.locator('#data-management[aria-busy="false"]').waitFor();
    await page.mouse.move(1300,950);await page.locator('#account-dialog').screenshot({path:f.output+'/archived-chats-light.png',animations:'disabled'});
    await page.locator('[data-account-tab="settings"]').click();await page.locator('#language').selectOption('en');await page.locator('[data-account-tab="dataManagement"]').click();
    await page.getByRole('heading',{name:'Archived chats',exact:true}).waitFor();await page.getByPlaceholder('Search archived chats').waitFor();
    // Empty state after restoring all chats, without touching their histories.
    while(await page.locator('.archive-restore').count())await page.locator('.archive-restore').first().click();
    await page.getByText('No archived chats yet.',{exact:true}).waitFor();assert.deepEqual(errors,[]);
    console.log('archive and restore passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
