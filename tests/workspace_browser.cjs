'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.LAZYFISH_BROWSER_MODULE);
const f=JSON.parse(fs.readFileSync(process.env.LAZYFISH_BROWSER_FIXTURE,'utf8'));
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.LAZYFISH_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
  const errors=[],contexts=[];
  async function client(){
    const context=await browser.newContext({locale:'en-US'});contexts.push(context);
    await context.addInitScript(()=>localStorage.setItem('lazyfish.preferences.v1',JSON.stringify({workspace:'/obsolete/browser/default',defaults:{workspace:'/obsolete/browser/default'}})));
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(f.url+'/?conversation='+f.chats[0]);await page.locator('#token').fill(f.token);await page.locator('#login button').click();await page.locator('.assistant-text').waitFor();return page;
  }
  async function fresh(page){await page.locator('#new-chat').click();}
  async function cwd(page,path){await page.waitForFunction(path=>document.querySelector('#workdir').value===path,path);}
  async function settings(page){await page.evaluate(()=>panels.open('settings'));await page.locator('#default-workspace').waitFor();}
  async function close(page){await page.locator('#account-dialog').press('Escape');}
  async function save(page,path,success=true){
    const response=page.waitForResponse(r=>r.url().endsWith('/api/workspace/default')&&r.request().method()==='POST');
    await page.locator('#default-workspace').fill(path);await page.locator('#default-workspace').press('Tab');
    const result=await response;assert.equal(result.status(),success?200:409);
    await page.waitForFunction(()=>!document.querySelector('#default-workspace').disabled);
    await page.locator('#default-workspace-status').filter({hasText:success?'Default directory saved.':'Choose an existing absolute directory.'}).waitFor();
    return result.json();
  }
  const global=page=>page.evaluate(()=>api('/api/workspace/default'));
  const chat=(page,id)=>page.evaluate(id=>api('/api/conversations/'+id),id);
  try{
    const one=await client(),two=await client();
    assert.equal((await global(one)).workspace,f.workspace);await fresh(one);await cwd(one,f.workspace);
    await settings(one);assert.equal(await one.locator('#default-workspace').inputValue(),f.workspace,'Legacy local preference cannot override server default');
    const saved=await save(one,f.projects[0]);await close(one);await cwd(one,f.projects[0]);
    await two.evaluate(()=>refreshList());await fresh(two);await cwd(two,f.projects[0]);
    assert.equal((await chat(one,f.chats[1])).workspace,f.projects[1]);
    await settings(one);await save(one,f.projects[1]);await close(one);
    // Server chooses the latest default even if another browser has not refreshed.
    await two.evaluate(value=>applyDefaultWorkspace(value),{workspace:f.projects[0],revision:saved.revision});
    const created=two.waitForResponse(r=>r.url().endsWith('/api/conversations')&&r.request().method()==='POST');
    await two.locator('#prompt').fill('Check shared default');await two.locator('#send').click();
    const response=await created;assert.equal(response.status(),201);assert.ok(!Object.hasOwn(response.request().postDataJSON(),'workspace'));
    const newChat=await response.json();assert.equal(newChat.workspace,f.projects[1]);
    await two.waitForFunction(()=>conversation?.jobs.some(j=>j.status==='completed'));await cwd(two,f.projects[1]);
    await two.evaluate(()=>document.querySelector('#edit-workdir').click());await two.locator('#workdir-input').fill(f.projects[0]);await two.locator('#workdir-save').click();await two.locator('#workdir-dialog').waitFor({state:'hidden'});await cwd(two,f.projects[0]);
    assert.equal((await global(one)).workspace,f.projects[1]);assert.equal((await chat(one,f.chats[1])).workspace,f.projects[1]);
    await two.evaluate(()=>document.querySelector('#add-skill').click());await two.locator('#skill-picker .skill-option').first().waitFor();
    const skills=(await two.locator('#skill-picker .skill-option').allTextContents()).join(' ');assert.ok(skills.includes('skill-0'));assert.ok(!skills.includes('skill-1'));
    await settings(one);await save(one,f.workspace+'/missing-directory',false);assert.equal((await global(one)).workspace,f.projects[1]);
    await save(one,'');await close(one);await cwd(one,f.workspace);
    await two.reload();await two.locator('.assistant-text').waitFor();await cwd(two,f.projects[0]);
    await fresh(two);await cwd(two,f.workspace);
    assert.equal((await chat(one,f.chats[0])).workspace,f.projects[0]);assert.equal((await chat(one,newChat.id)).workspace,f.projects[0]);
    assert.deepEqual(errors,[]);console.log('shared workspace checks passed');
    if(process.env.LAZYFISH_BROWSER_OUTPUT){await settings(one);await one.screenshot({path:process.env.LAZYFISH_BROWSER_OUTPUT+'/workspace-settings.png'});await close(one);await one.evaluate(()=>document.querySelector('#edit-workdir').click());await one.screenshot({path:process.env.LAZYFISH_BROWSER_OUTPUT+'/workspace-dialog.png'});}
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
