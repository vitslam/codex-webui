'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.LAZYFISH_BROWSER_MODULE);
const f=JSON.parse(fs.readFileSync(process.env.LAZYFISH_BROWSER_FIXTURE,'utf8'));

(async()=>{
  const browser=await chromium.launch({executablePath:process.env.LAZYFISH_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({locale:'en-US'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  async function chooseChat(id){
    await page.locator('#conversation-list .conversation[data-id="'+id+'"]').click();
    await page.waitForFunction(id=>new URL(location.href).searchParams.get('conversation')===id,id);
  }
  async function fresh(){await page.locator('#new-chat').click();await page.waitForFunction(()=>!new URL(location.href).searchParams.has('conversation'));}
  async function inputs(){return {images:await page.locator('#image-previews .image-preview').count(),skills:await page.locator('#selected-skills .skill-chip').count(),text:await page.locator('#prompt').inputValue()};}
  async function prepare(text){
    await page.locator('#image-input').setInputFiles({name:'tiny.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=','base64')});
    await page.waitForFunction(()=>document.querySelectorAll('#image-previews .image-preview').length===1&&document.querySelector('#upload-state').hidden);
    if(!await page.locator('#attachment-settings').evaluate(el=>el.open))await page.locator('#attachment-settings > summary').click();
    await page.locator('#add-skill').click();await page.locator('#skill-picker .skill-option').first().click();await page.locator('#prompt').fill(text);
  }
  async function send(text){
    const previous=await page.locator('.task-status').count();await page.locator('#prompt').fill(text);
    const accepted=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/turns'));
    await page.locator('#send').click();const response=await accepted;assert.equal(response.status(),202);
    await page.waitForFunction(n=>{const states=[...document.querySelectorAll('.task-status')];return states.length>n&&states.at(-1).dataset.state==='completed';},previous);
    return response.request().postDataJSON();
  }
  try{
    if(f.mode==='clipboard')await context.grantPermissions(['clipboard-read','clipboard-write']);
    await page.goto(f.url);await page.locator('#token').fill(f.token);await page.locator('#login button').click();await page.locator('#app:not([hidden])').waitFor();
    if(f.mode==='drafts'){
      await fresh();await prepare('Unsent first-message draft');const before=await inputs();assert.deepEqual(before,{images:1,skills:1,text:'Unsent first-message draft'});
      await chooseChat(f.chats[1]);await fresh();assert.deepEqual(await inputs(),before,'Switching alone preserves the new-chat draft');
      await chooseChat(f.chats[1]);await send('Send from B');await fresh();assert.deepEqual(await inputs(),before,'Sending in B must preserve every input of the new-chat draft');
      await chooseChat(f.chats[0]);await prepare('Existing A draft');const existing=await inputs();
      await chooseChat(f.chats[1]);await send('Another send from B');await chooseChat(f.chats[0]);assert.deepEqual(await inputs(),existing,'An existing conversation draft is independent too');
      await fresh();const payload=await send('First send from the new chat');assert.equal(payload.images.length,1);assert.equal(payload.skills.length,1);
      assert.deepEqual(await inputs(),{images:0,skills:0,text:''},'Sending the draft itself clears only its consumed inputs');
      await chooseChat(f.chats[0]);assert.deepEqual(await inputs(),existing);
    }else{
      await chooseChat(f.chats[0]);await page.locator('.code-header .copy').click();
      assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),"print('fish')",'Secure-context copying still works');
      // Simulate HTTP capability restrictions on the isolated loopback service.
      await page.evaluate(()=>{
        window.testClipboard=navigator.clipboard;
        Object.defineProperty(navigator,'clipboard',{value:undefined,configurable:true});
        Object.defineProperty(window,'isSecureContext',{value:false,configurable:true});
      });
      await page.locator('.user-turn').hover();await page.locator('.user-turn .copy').click();
      assert.equal(await page.evaluate(()=>testClipboard.readText()),f.prompt,'HTTP fallback copies the full folded prompt');
      await page.locator('.code-header .copy').click();assert.equal(await page.evaluate(()=>testClipboard.readText()),"print('fish')");
      const restored=await page.evaluate(async()=>{
        const prompt=document.querySelector('#prompt');prompt.value='Keep this draft';prompt.focus();prompt.setSelectionRange(2,7,'backward');
        const count=document.querySelectorAll('textarea').length;await copyText('Fallback with focus restoration');
        return {focused:document.activeElement===prompt,text:prompt.value,start:prompt.selectionStart,end:prompt.selectionEnd,direction:prompt.selectionDirection,extraAreas:document.querySelectorAll('textarea').length-count};
      });
      assert.deepEqual(restored,{focused:true,text:'Keep this draft',start:2,end:7,direction:'backward',extraAreas:0});
      // A denied modern API also falls back; native failure receives copy-specific feedback.
      await page.evaluate(async()=>{await testClipboard.writeText('Previous clipboard content');Object.defineProperty(window,'isSecureContext',{value:true,configurable:true});Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(new Error('Permission denied'))},configurable:true});});
      await page.locator('.code-header .copy').click();assert.equal(await page.evaluate(()=>testClipboard.readText()),"print('fish')");
      await page.evaluate(()=>{window.testExecCommand=document.execCommand;document.execCommand=()=>false;});
      await page.locator('.code-header .copy').click();await page.getByText('Could not copy. Select the text and copy it manually.',{exact:true}).waitFor();
      assert.equal(await page.locator('.code-header .copy').getAttribute('aria-label'),'Copy code');
      assert.equal(await page.locator('textarea').count(),1,'Temporary copy fields are removed after failure');
      await page.evaluate(()=>{document.execCommand=testExecCommand;});
      await page.locator('.code-header .copy').click();await page.waitForFunction(()=>document.querySelector('#notice').textContent==='');
      assert.equal(await page.evaluate(()=>testClipboard.readText()),"print('fish')");
    }
    assert.deepEqual(errors,[]);console.log(f.mode+' checks passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
