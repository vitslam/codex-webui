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
    await page.getByText('\u8fd9\u4e2a\u5bf9\u8bdd\u7684\u5de5\u4f5c\u76ee\u5f55\u5df2\u4e0d\u5b58\u5728\uff0c\u8bf7\u4ece\u8f93\u5165\u6846\u7684\u5de5\u4f5c\u76ee\u5f55\u9009\u62e9\u5668\u4e2d\u9009\u62e9\u73b0\u6709\u76ee\u5f55\u3002',{exact:true}).waitFor();
    assert.equal(await page.getByText('\u5f53\u524d CLI \u7248\u672c\u3001\u8d26\u6237\u6216\u8fde\u63a5\u65e0\u6cd5\u63d0\u4f9b\u6b64\u6570\u636e\uff0c\u53ef\u5237\u65b0\u91cd\u8bd5\u3002',{exact:true}).count(),0);
    await page.locator('#native-page').getByRole('button',{name:'\u5de5\u4f5c\u76ee\u5f55',exact:true}).click();
    await page.locator('#workdir-dialog').waitFor({state:'visible'});
    await page.locator('#workdir-input').fill(f.workspace);await page.locator('#workdir-save').click();
    await page.locator('#workdir-dialog').waitFor({state:'hidden'});await skills();
    await page.getByText('\u6b64\u5de5\u4f5c\u76ee\u5f55\u4e0b\u6682\u65e0\u6280\u80fd\u3002',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);console.log('HTTP request IDs and workspace recovery passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
