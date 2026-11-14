'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.LAZYFISH_BROWSER_MODULE);
const f=JSON.parse(fs.readFileSync(process.env.LAZYFISH_BROWSER_FIXTURE,'utf8'));
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.LAZYFISH_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage({locale:'zh-CN'}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{if(!localStorage.getItem('lazyfish.language'))localStorage.setItem('lazyfish.language','zh');});
    await page.goto(f.url+'/?conversation='+f.chat);await page.locator('#token').fill(f.token);await page.locator('#login button').click();
    const summaries=page.locator('.changes-host .change-panel>summary');await summaries.first().waitFor();assert.equal(await summaries.count(),2);
    async function check(expected){const values=await summaries.allTextContents();expected.forEach((text,index)=>assert.ok(values[index].includes(text),values[index]));values.forEach(text=>{assert.ok(text.includes('+56'));assert.ok(text.includes('-4'));});}
    async function setLanguage(value){await page.evaluate(()=>panels.open('settings'));await page.selectOption('#language',value);await page.locator('#account-dialog').press('Escape');}
    await check(['修改 1 个文件','修改 7 个文件']);
    // Keep the report expanded while switching locale; language changes must redraw it.
    await summaries.first().click();await page.locator('.change-panel-body .review-files').waitFor();
    await setLanguage('en');await check(['changed 1 file','changed 7 files']);
    assert.ok(await page.locator('.change-panel').first().evaluate(el=>el.open));
    await setLanguage('zh');await check(['修改 1 个文件','修改 7 个文件']);
    await setLanguage('en');await page.reload();await summaries.first().waitFor();await check(['changed 1 file','changed 7 files']);
    assert.deepEqual(errors,[]);console.log('footer language checks passed');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
