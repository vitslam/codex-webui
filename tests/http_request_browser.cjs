'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.LAZYFISH_BROWSER_MODULE);
const f=JSON.parse(fs.readFileSync(process.env.LAZYFISH_BROWSER_FIXTURE,'utf8'));
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.LAZYFISH_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({locale:'zh-CN'});
  // LAN HTTP exposes getRandomValues, but randomUUID is restricted to secure contexts.
  await context.addInitScript(()=>Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true}));
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  async function skills(){await page.locator('#menu-toggle').click();await page.locator('#skills-toggle').click();}
  try{
    await page.goto(f.url);await page.locator('#token').fill(f.token);await page.locator('#login button').click();await page.locator('#app:not([hidden])').waitFor();
    const ids=await page.evaluate(()=>Array.from({length:40},()=>LazyfishRequestId()));
    assert.equal(new Set(ids).size,40);
    for(const id of ids)assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const sent=page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/turns'));
    await page.locator('#prompt').fill('HTTP browser request');await page.locator('#send').click();
    assert.match((await sent).postDataJSON().client_request_id,/^[0-9a-f-]{36}$/);
    await page.waitForFunction(()=>document.querySelector('.task-status')?.dataset.state==='completed');
    assert.equal(await page.locator('#prompt').inputValue(),'');
    // Editing also uses the fallback instead of directly calling randomUUID.
    await page.locator('.user-turn').hover();await page.locator('.user-edit-button').click();
    await page.locator('.message-editor textarea').fill('Edited HTTP request');
    const edited=page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/edit'));
    await page.locator('.message-edit-send').click();assert.match((await edited).postDataJSON().client_request_id,/^[0-9a-f-]{36}$/);
    await page.waitForFunction(()=>document.querySelector('.task-status')?.dataset.state==='completed'&&!document.querySelector('.message-editor'));
    await page.evaluate(id=>loadConversation(id),f.missing);await skills();
    await page.getByText('这个对话的工作目录已不存在，请从输入框的工作目录选择器中选择现有目录。',{exact:true}).waitFor();
    assert.equal(await page.getByText('当前 CLI 版本、账户或连接无法提供此数据，可刷新重试。',{exact:true}).count(),0);
    await page.locator('#native-page').getByRole('button',{name:'工作目录',exact:true}).click();
    await page.locator('#workdir-dialog').waitFor({state:'visible'});
    await page.locator('#workdir-input').fill(f.workspace);await page.locator('#workdir-save').click();
    await page.locator('#workdir-dialog').waitFor({state:'hidden'});await skills();
    await page.getByText('此工作目录下暂无技能。',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);console.log('HTTP request IDs and workspace recovery passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
