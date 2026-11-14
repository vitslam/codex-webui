'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.LAZYFISH_BROWSER_MODULE);
const f=JSON.parse(fs.readFileSync(process.env.LAZYFISH_BROWSER_FIXTURE,'utf8'));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.LAZYFISH_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({locale:'en-US',viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{localStorage.setItem('lazyfish.language','en');localStorage.setItem('lazyfish.appearance','black');});
  await page.goto(f.url+'/?conversation='+f.main);await page.locator('#token').fill(f.token);await page.locator('#login button').click();
  await page.locator('.assistant-text').first().waitFor();
  const menu=page.locator('.text-selection-toolbar'),chip=page.locator('#selected-quotes .quote-summary');
  const select=async(selector)=>{
   await page.locator(selector).first().scrollIntoViewIfNeeded();await page.waitForTimeout(250);
   return page.locator(selector).first().evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const s=window.getSelection();s.removeAllRanges();s.addRange(range);document.dispatchEvent(new Event('selectionchange'));document.dispatchEvent(new Event('pointerup'));return s.toString();});
  };
  const add=async selector=>{const text=await select(selector);await menu.waitFor();await menu.locator('.selection-add').first().click();return text;};
  async function go(id){await page.evaluate(id=>loadConversation(id),id);await page.waitForFunction(id=>conversation?.id===id,id);}
  // Real pointer drag, not only synthetic ranges.
  await page.locator('#prompt').fill('Existing unsent question');
  const p=page.locator('.assistant-text p').first();await p.scrollIntoViewIfNeeded();const box=await p.boundingBox();
  await page.mouse.move(box.x+2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+180,box.y+box.height/2,{steps:15});await page.mouse.up();
  await menu.waitFor();const dragged=await page.evaluate(()=>getSelection().toString());assert.ok(dragged.length>5);
  await menu.getByRole('button',{name:'Add to chat'}).click();await chip.waitFor();assert.equal(await page.locator('#prompt').inputValue(),'Existing unsent question');
  await chip.click();assert.equal(await page.locator('#selected-quotes .quote-text').innerText(),dragged);
  await page.getByRole('button',{name:'Remove passage 1',exact:true}).click();await chip.waitFor({state:'hidden'});
  // Escape, non-message selection and a context switch must not retain the menu.
  await select('.assistant-text p');await menu.waitFor();await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
  await select('.reply-model');await page.waitForTimeout(160);assert.equal(await menu.isVisible(),false);
  await select('.assistant-text p');await menu.waitFor();await go(f.other);await menu.waitFor({state:'hidden'});await go(f.main);
  const text=await add('.assistant-text p');await chip.waitFor();
  await select('.assistant-text p');await menu.waitFor();await menu.locator('.selection-add').first().click();assert.equal(await chip.innerText(),'1 selected passage');
  await page.locator('#prompt').click();
  await go(f.other);assert.equal(await chip.isVisible(),false);await page.locator('#prompt').fill('Message in the other chat');await page.locator('#composer').evaluate(el=>el.requestSubmit());
  await page.waitForFunction(()=>conversation?.jobs.at(-1)?.status==='completed'&&conversation.jobs.length===2);
  await go(f.main);assert.equal(await chip.innerText(),'1 selected passage');assert.equal(await page.locator('#prompt').inputValue(),'Existing unsent question');
  // Reference text stays plain text, including code that looks like HTML.
  const code=await add('.assistant-text pre code');await chip.click();
  assert.ok((await page.locator('#selected-quotes .quote-text').allTextContents()).includes(code));assert.equal(await page.locator('#selected-quotes img').count(),0);
  const fromUser=await add('.user-text');assert.ok(fromUser.includes('Saved question'));
  await page.evaluate(()=>panels.open('settings'));await page.selectOption('#language','zh');await page.locator('#account-dialog').press('Escape');
  assert.equal(await chip.innerText(),'3 \u4e2a\u5df2\u9009\u6587\u672c\u7247\u6bb5');
  await select('.assistant-text p');await menu.waitFor();assert.equal(await menu.locator('.selection-add').first().innerText(),'\u6dfb\u52a0\u5230\u5bf9\u8bdd');await page.keyboard.press('Escape');
  if(f.output)await page.screenshot({path:f.output+'/selected-passages-preview.png'});
  await page.evaluate(()=>panels.open('settings'));await page.selectOption('#language','en');await page.locator('#account-dialog').press('Escape');
  // A failed request keeps its immutable reference payload for retry.
  await page.route('**/api/conversations/*/turns',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"service_stopping"}'}),{times:1});
  await page.locator('#composer').evaluate(el=>el.requestSubmit());await page.locator('.pending-send .send-retry').waitFor();
  assert.equal(await page.locator('.pending-send .quote-summary').innerText(),'3 selected passages');
  await page.locator('.pending-send .send-retry').click();
  await page.waitForFunction(()=>conversation?.jobs.length===2&&conversation.jobs.at(-1).status==='completed');
  const saved=await page.evaluate(()=>conversation.jobs.at(-1).inputs.quotes);assert.deepEqual(saved,[{text,role:'assistant'},{text:code,role:'assistant'},{text:fromUser,role:'user'}]);
  await page.reload();await page.waitForFunction(()=>conversation?.jobs.length===2);assert.deepEqual(await page.evaluate(()=>conversation.jobs.at(-1).inputs.quotes),saved);
  assert.equal(await page.locator('.user-turn .quote-summary').last().innerText(),'3 selected passages');assert.equal(await chip.isVisible(),false);
  // Narrow viewport: the selection action remains within the screen.
  await page.setViewportSize({width:390,height:844});await select('.assistant-text p');await menu.waitFor();const bounds=await menu.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390&&bounds.y>=0&&bounds.y+bounds.height<=844);
  await page.setViewportSize({width:1440,height:1000});await go(f.other);
  await page.locator('#prompt').fill('[slow]');await page.locator('#composer').evaluate(el=>el.requestSubmit());
  await page.waitForFunction(()=>conversation?.jobs.at(-1)?.status==='running'&&conversation.jobs.at(-1).items.some(item=>item.text));
  const supplement=await add('.assistant-text p');await page.locator('#composer').evaluate(el=>el.requestSubmit());
  await page.waitForFunction(()=>conversation?.jobs.at(-1)?.status==='completed');
  assert.deepEqual(await page.evaluate(()=>conversation.jobs.at(-1).instructions[0].quotes),[{text:supplement,role:'assistant'}]);
  assert.deepEqual(errors,[]);console.log('selected passage browser checks passed');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
