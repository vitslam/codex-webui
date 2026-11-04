"use strict";
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.LAZYFISH_BROWSER_MODULE),fixture=JSON.parse(fs.readFileSync(process.env.LAZYFISH_BROWSER_FIXTURE,'utf8'));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.LAZYFISH_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(fixture.url);await page.locator('#token').fill(fixture.token);await page.locator('#login button').click();await page.locator('#app:not([hidden])').waitFor();
  const outline=()=>page.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle);
  async function settings(){await page.locator('#menu-toggle').click();await page.locator('#settings-toggle').click();}
  await settings();
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.accountTab),'settings');
  assert.equal(await outline(),'none','Mouse opening settings has no focus border');
  for(const tab of ['account','usage','settings','skills','connections','diagnostics','installation']){
   await page.locator(`[data-account-tab="${tab}"]`).click();assert.equal(await outline(),'none',tab+' pointer focus');
  }
  await page.locator('[data-account-tab="settings"]').click();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.inputMethod),'keyboard');
  assert.notEqual(await outline(),'none','Keyboard traversal retains a visible focus indicator');
  await page.locator('[data-account-tab="settings"]').click();assert.equal(await outline(),'none','Clicking after keyboard traversal removes the ring');
  await page.locator('#account-close').click();assert.equal(await outline(),'none','Restoring focus after close has no pointer ring');
  await page.locator('#search-toggle').click();assert.equal(await outline(),'none','Search autofocus has no extra outline');await page.keyboard.press('Escape');
  await page.locator('#attachment-settings summary').click();await page.locator('#edit-workdir').click();assert.equal(await outline(),'none','Directory autofocus has no extra outline');await page.locator('#workdir-cancel').click();
  await page.locator('#model-options summary').click();await page.locator('#model-toggle').click();assert.equal(await outline(),'none','Model picker autofocus has no pointer ring');await page.keyboard.press('ArrowDown');assert.notEqual(await outline(),'none','Model keyboard selection retains its focus indicator');await page.keyboard.press('Escape');
  assert.deepEqual(errors,[]);console.log('pointer and keyboard focus passed');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
