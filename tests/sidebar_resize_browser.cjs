'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require(process.env.LAZYFISH_BROWSER_MODULE);
const f=JSON.parse(fs.readFileSync(process.env.LAZYFISH_BROWSER_FIXTURE,'utf8'));
(async()=>{const browser=await chromium.launch({executablePath:process.env.LAZYFISH_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});try{
 const page=await browser.newPage({viewport:{width:1540,height:1000},locale:'en-US'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('lazyfish.language','en');localStorage.setItem('lazyfish.appearance','black');});
 await page.goto(f.url+'/?conversation='+f.main);await page.locator('#token').fill(f.token);await page.locator('#login button').click();await page.waitForFunction(()=>!initializing&&conversation);
 const sidebar=page.locator('#sidebar'),handle=page.locator('#sidebar-resizer'),width=async()=>(await sidebar.boundingBox()).width;
 const drag=async target=>{const b=await handle.boundingBox();await page.mouse.move(b.x+b.width/2,300);await page.mouse.down();const before=await width();await page.mouse.move(b.x+b.width/2+target-before,300,{steps:12});await page.mouse.up();};
 assert.equal(await width(),248);await page.locator('#prompt').fill('Keep my main draft while resizing');await drag(368);assert.ok(Math.abs(await width()-368)<1);
 assert.equal(await page.locator('#prompt').inputValue(),'Keep my main draft while resizing');assert.ok(Math.abs((await page.locator('#chat').boundingBox()).x-368)<1);
 assert.ok(Math.abs(Number(await page.evaluate(()=>localStorage.getItem('lazyfish.sidebar.width')))-368)<1);await page.reload();await page.waitForFunction(()=>!initializing&&conversation);assert.ok(Math.abs(await width()-368)<1);
 await handle.dblclick();assert.equal(await width(),248);assert.equal(await page.evaluate(()=>localStorage.getItem('lazyfish.sidebar.width')),null);
 await handle.focus();await page.keyboard.press('Home');assert.equal(await width(),180);await page.keyboard.press('End');assert.equal(await width(),480);await page.keyboard.press('ArrowLeft');assert.equal(await width(),472);await page.keyboard.press('Shift+ArrowLeft');assert.equal(await width(),448);
 await drag(100);assert.equal(await width(),180);await drag(900);assert.equal(await width(),480);
 await page.setViewportSize({width:770,height:1000});await page.waitForFunction(()=>document.querySelector('#sidebar').getBoundingClientRect().width<=450);assert.ok(await width()<=450);assert.equal(await page.evaluate(()=>localStorage.getItem('lazyfish.sidebar.width')),'480');
 await page.setViewportSize({width:1540,height:1000});await page.waitForFunction(()=>document.querySelector('#sidebar').getBoundingClientRect().width===480);assert.equal(await width(),480);
 await page.locator('#sidebar-toggle').click();await handle.waitFor({state:'hidden'});assert.equal((await page.locator('#chat').boundingBox()).x,0);await page.locator('#sidebar-toggle').click();await handle.waitFor();assert.equal(await width(),480);
 // Pointer cancellation and primary-button guard cannot leave a stuck resize cursor.
 const b=await handle.boundingBox();await page.mouse.move(b.x+4,300);await page.mouse.down();await page.mouse.move(b.x+4-160,300,{steps:8});await handle.dispatchEvent('pointercancel');await page.mouse.up();assert.ok(!await page.locator('body').evaluate(el=>el.classList.contains('sidebar-resizing')));
 const desktop=await width();await handle.dispatchEvent('pointerdown',{button:2,pointerId:999});assert.ok(!await page.locator('body').evaluate(el=>el.classList.contains('sidebar-resizing')));
 await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.body.classList.contains('sidebar-hidden'));await handle.waitFor({state:'hidden'});await page.locator('#sidebar-toggle').click();assert.equal(await width(),264);assert.equal((await page.locator('#chat').boundingBox()).x,0);await page.locator('#sidebar-close').click();
 await page.setViewportSize({width:1540,height:1000});await page.locator('#sidebar-toggle').click();assert.ok(Math.abs(await width()-desktop)<1);
 await page.locator('#side-toggle').click();await page.locator('#side-chat').waitFor();await page.waitForFunction(()=>!document.querySelector('#side-form').inert);await page.locator('#side-prompt').fill('Keep my side draft while resizing');await page.locator('#prompt').fill('Keep my main draft while resizing');
 await drag(480);let main=await page.locator('#chat').boundingBox(),side=await page.locator('#side-chat').boundingBox();assert.ok(main.width>=319&&side.width>=300);
 // Both dividers must coordinate their limits instead of squeezing the center pane.
 const right=await page.locator('#side-resizer').boundingBox();await page.mouse.move(right.x+2,300);await page.mouse.down();await page.mouse.move(400,300,{steps:12});await page.mouse.up();main=await page.locator('#chat').boundingBox();assert.ok(main.width>=319);
 await drag(180);await drag(480);main=await page.locator('#chat').boundingBox();assert.ok(main.width>=319);assert.equal(await page.locator('#prompt').inputValue(),'Keep my main draft while resizing');assert.equal(await page.locator('#side-prompt').inputValue(),'Keep my side draft while resizing');
 await page.setViewportSize({width:1110,height:1000});await page.waitForFunction(()=>document.querySelector('#chat').getBoundingClientRect().width>=319);main=await page.locator('#chat').boundingBox();assert.ok(main.width>=319);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.setViewportSize({width:1540,height:1000});await drag(320);await page.locator('#sidebar-resizer').dblclick();assert.equal(await width(),248);
 await page.evaluate(()=>panels.open('settings'));await page.selectOption('#language','zh');await page.locator('#account-dialog').press('Escape');assert.equal(await handle.getAttribute('aria-label'),'\u8c03\u6574\u5de6\u4fa7\u5bf9\u8bdd\u680f\u5bbd\u5ea6');
 await drag(320);if(f.output)await page.screenshot({path:f.output+'/sidebar-resize-preview.png'});assert.deepEqual(errors,[]);console.log('sidebar resize browser checks passed');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
