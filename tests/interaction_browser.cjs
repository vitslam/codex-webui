'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.LAZYFISH_BROWSER_MODULE);
const f=JSON.parse(fs.readFileSync(process.env.LAZYFISH_BROWSER_FIXTURE,'utf8'));
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.LAZYFISH_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({locale:'en-US'}),page=await context.newPage(),errors=[];
  await context.addInitScript(()=>localStorage.setItem('lazyfish.preferences.v1',JSON.stringify({showPlan:true})));
  page.on('pageerror',error=>errors.push(error.message));
  const chat=id=>page.evaluate(id=>loadConversation(id),id);
  const fresh=()=>page.locator('#new-chat').click();
  async function directory(path){await page.evaluate(()=>document.querySelector('#edit-workdir').click());await page.locator('#workdir-input').fill(path);await page.locator('#workdir-save').click();await page.locator('#workdir-dialog').waitFor({state:'hidden'});}
  async function skills(){await page.evaluate(()=>document.querySelector('#add-skill').click());await page.locator('#skill-picker .skill-option').first().waitFor();return page.locator('#skill-picker .skill-option').allTextContents();}
  async function send(text){const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/turns'));await page.locator('#prompt').fill(text);await page.locator('#send').click();const result=await response;assert.equal(result.status(),202);return result.json();}
  async function done(job){await page.waitForFunction(async id=>(await(await fetch('/api/jobs/'+id)).json()).status==='completed',job.id);await page.waitForFunction(()=>document.querySelector('#composer').dataset.jobStatus==='idle');}
  try{
    await page.goto(f.url+'/?conversation='+f.chats[0]);await page.locator('#token').fill(f.token);await page.locator('#login button').click();await page.locator('.assistant-text').waitFor();
    if(f.mode==='workspace'){
      await page.waitForFunction(()=>document.querySelector('#model').value==='compact-model'&&panels.runDefaults().model==='fixture-model');
      const baseline=await page.evaluate(()=>panels.runDefaults());await fresh();
      const defaults=await page.evaluate(()=>runChoices());assert.equal(defaults.model,baseline.model||null);assert.equal(defaults.effort,baseline.effort);assert.equal(defaults.fast_mode,false);assert.equal(defaults.permission_mode,null);assert.equal(defaults.collaboration_mode,'default');
      await directory(f.projects[1]);let rows=await skills();assert.ok(rows.join(' ').includes('skill-1'));assert.ok(!rows.join(' ').includes('skill-0'));
      await page.locator('#skill-picker .skill-option').first().click();assert.equal(await page.locator('#selected-skills .skill-chip').count(),1);
      await chat(f.chats[1]);await fresh();assert.equal(await page.locator('#workdir').inputValue(),f.projects[1],'Unsent new-chat draft keeps its selected directory');
      await directory(f.projects[0]);assert.equal(await page.locator('#selected-skills .skill-chip').count(),0);await page.getByText('The working directory changed. Select skills again for this message.',{exact:true}).waitFor();
      rows=await skills();assert.ok(rows.join(' ').includes('skill-0'));await page.locator('#skill-picker .skill-option').first().click();
      const first=await send('Send with the selected project skill');await done(first);await fresh();assert.equal(await page.locator('#workdir').inputValue(),f.workspace,'A consumed new-chat directory does not become a global default');
      await chat(f.chats[0]);await skills();await page.locator('#skill-picker .skill-option').first().click();await directory(f.projects[1]);assert.equal(await page.locator('#selected-skills .skill-chip').count(),0,'Existing chat directory changes clear its selected skills too');
      const changed=await send('Send after switching the existing project');await done(changed);
      // Hold a directory save across dismissal and a conversation switch.
      let release,arrived;const gate=new Promise(r=>release=r),seen=new Promise(r=>arrived=r);
      await page.route('**/api/conversations/'+f.chats[0]+'/settings',async route=>{if(!route.request().postDataJSON()?.workspace)return route.continue();arrived();await gate;const response=await route.fetch();await route.fulfill({response});});
      await page.evaluate(()=>document.querySelector('#edit-workdir').click());await page.locator('#workdir-input').fill(f.workspace);await page.locator('#workdir-save').click();await seen;await page.locator('#workdir-cancel').click();await chat(f.chats[1]);release();
      await page.waitForFunction(async({id,path})=>(await(await fetch('/api/conversations/'+id)).json()).workspace===path,{id:f.chats[0],path:f.workspace});
      assert.equal(await page.locator('#workdir').inputValue(),f.projects[1]);assert.equal(await page.evaluate(()=>conversation.workspace),f.projects[1]);await page.unrouteAll({behavior:'wait'});
      // Explicit saved defaults win over any previously viewed chat's settings.
      await page.evaluate(()=>panels.open('settings'));await page.locator('#default-fast').check();await page.locator('#default-permission').selectOption('ask');await page.locator('#default-workspace').fill(f.projects[1]);await page.locator('#default-workspace').press('Tab');await page.locator('#default-workspace-status').filter({hasText:'Default directory saved.'}).waitFor();await page.locator('#account-dialog').press('Escape');
      await chat(f.chats[0]);await fresh();assert.equal(await page.locator('#workdir').inputValue(),f.projects[1]);const explicit=await page.evaluate(()=>runChoices());assert.equal(explicit.fast_mode,true);assert.equal(explicit.permission_mode,'ask');assert.equal(explicit.collaboration_mode,'default');
    }else{
      const first=await send('[question]');await page.locator('#question-dialog').waitFor();
      await page.locator('#question-fields input[value=Blue]').check();await page.locator('#question-fields textarea').fill('Keep backward compatibility');await page.locator('#question-fields input[type=password]').fill('fixture-secret');await page.locator('#question-close').click();
      await page.locator('.turn[data-job="'+first.id+'"] .question-reopen').click();assert.equal(await page.locator('#question-fields textarea').inputValue(),'Keep backward compatibility');assert.ok(await page.locator('#question-fields input[value=Blue]').isChecked());assert.equal(await page.locator('#question-fields input[type=password]').inputValue(),'');
      await page.locator('#question-dialog').press('Escape');await page.locator('.turn[data-job="'+first.id+'"] .question-reopen').click();assert.equal(await page.locator('#question-fields textarea').inputValue(),'Keep backward compatibility');
      await page.route('**/api/jobs/'+first.id+'/questions',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"storage_unavailable"}'}));
      await page.locator('#question-fields input[type=password]').fill('fixture-secret');await page.locator('#question-submit').click();await page.waitForFunction(()=>document.querySelector('#question-status').textContent.length>0&&!document.querySelector('#question-submit').disabled);await page.unrouteAll({behavior:'wait'});
      await page.locator('#question-later').click();await page.locator('.turn[data-job="'+first.id+'"] .question-reopen').click();assert.ok(await page.locator('#question-fields input[value=Blue]').isChecked());assert.equal(await page.locator('#question-fields textarea').inputValue(),'Keep backward compatibility');
      await page.locator('#question-fields input[type=password]').fill('fixture-secret');const answered=page.waitForResponse(r=>r.url().endsWith('/questions')&&r.request().method()==='POST');await page.locator('#question-submit').click();const response=await answered;assert.equal(response.status(),200);const values=response.request().postDataJSON().answers;assert.equal(values.color.answers[0],'Blue\nAdditional details: Keep backward compatibility');assert.deepEqual(values.note.answers,['fixture-secret']);await done(first);
      await page.locator('.turn[data-job="'+first.id+'"] .question-reopen').click();assert.equal(await page.locator('#question-fields textarea').inputValue(),'');assert.ok(await page.locator('#question-submit').isDisabled());await page.locator('#question-close').click();
      await chat(f.chats[1]);const second=await send('[question]');await page.locator('#question-dialog').waitFor();assert.equal(await page.locator('#question-fields textarea').inputValue(),'');assert.equal(await page.locator('#question-fields input:checked').count(),0);await page.locator('#question-fields input[value=Green]').check();await page.locator('#question-fields input[type=password]').fill('other-fixture');await page.locator('#question-submit').click();await done(second);
      const leaked=await page.evaluate(()=>[...Object.values(localStorage),...Object.values(sessionStorage)].some(v=>v.includes('fixture-secret')||v.includes('Keep backward compatibility')));assert.equal(leaked,false,'Question drafts remain in memory and secret inputs are not persisted');
    }
    assert.deepEqual(errors,[]);console.log(f.mode+' checks passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
