'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.LAZYFISH_BROWSER_MODULE);
const f=JSON.parse(fs.readFileSync(process.env.LAZYFISH_BROWSER_FIXTURE,'utf8'));
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.LAZYFISH_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-US'});
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const user=index=>page.locator('.turn[data-job="'+f.jobs[index]+'"] > .user-turn');
  const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  async function load(){await page.goto(f.url+'/?conversation='+f.chat);await page.locator('.assistant-text').first().waitFor();await frame();}
  async function skills(){
    if(!await page.locator('#menu-toggle').isVisible())await page.locator('#sidebar-toggle').click();
    await page.locator('#menu-toggle').click();await page.locator('#skills-toggle').click();
  }
  async function refresh(){await page.locator('#account-reload').click();await page.waitForFunction(()=>document.querySelector('#native-page').getAttribute('aria-busy')==='false');}
  try{
    await page.goto(f.url+'/?conversation='+f.chat);await page.locator('#token').fill(f.token);await page.locator('#login button').click();
    await page.locator('.assistant-text').first().waitFor();await frame();
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
      await page.setViewportSize(viewport);await load();
      assert.equal(await user(0).locator('.user-content-toggle').isHidden(),true,'19 lines stay visible');
      assert.equal(await user(1).locator('.user-content-toggle').isHidden(),true,'Exactly 20 lines stay visible');
      for(const index of [2,3]){
        const text=user(index).locator('.user-text'),toggle=user(index).locator('.user-content-toggle');
        assert.equal(await toggle.isVisible(),true,'Overflow, including wrapped text, gets a toggle');
        assert.ok(await text.evaluate(el=>Math.abs(el.clientHeight-20*parseFloat(getComputedStyle(el).lineHeight))<=1));
        await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'true');
        assert.equal(await text.evaluate(el=>el.scrollHeight<=el.clientHeight+1),true);
        await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');
        assert.equal(await user(index).locator('.image-list img').count(),1,'Attachments are outside the clamped text');
        assert.equal(await user(index).locator('.skill-chip').innerText(),'example');
      }
      const supplementary=page.locator('.supplementary-instruction .user-content-toggle');
      assert.equal(await supplementary.isVisible(),true);await supplementary.click();
      assert.equal(await supplementary.getAttribute('aria-expanded'),'true');
      const long=user(2),toggle=long.locator('.user-content-toggle');
      await toggle.click();await page.evaluate(id=>loadConversation(id),f.other);await page.evaluate(id=>loadConversation(id),f.chat);
      assert.equal(await toggle.getAttribute('aria-expanded'),'true','Cached chat retains expansion');
      await toggle.click();await long.hover();
      await long.locator('.copy-button:not(.branch):not(.user-edit-button)').click();
      assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),f.prompts[2],'Copy uses the full prompt');
      await long.locator('.user-edit-button').click();assert.equal(await long.locator('textarea').inputValue(),f.prompts[2]);
      await long.locator('textarea').press('Escape');assert.equal(await toggle.getAttribute('aria-expanded'),'false');
      await page.screenshot({path:f.output+'/message-folding-'+viewport.width+'.png'});
    }
    // A resize alone must recompute wrapping without reloading the conversation.
    await page.setViewportSize({width:1440,height:1000});await load();
    assert.equal(await user(4).locator('.user-content-toggle').isHidden(),true);
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(id=>!document.querySelector('.turn[data-job="'+id+'"] .user-content-toggle').hidden,f.jobs[4]);
    const wrapped=user(3),wrappedToggle=wrapped.locator('.user-content-toggle');
    await wrappedToggle.click();
    await wrapped.locator('.user-text').evaluate(el=>{
      const viewport=document.querySelector('#messages');
      viewport.scrollTop+=el.getBoundingClientRect().bottom-viewport.getBoundingClientRect().top-100;
    });await frame();
    await wrappedToggle.evaluate(el=>el.click());await frame();
    assert.equal(await wrappedToggle.getAttribute('aria-expanded'),'false');
    assert.ok(await wrapped.evaluate(el=>el.getBoundingClientRect().bottom>=document.querySelector('#messages').getBoundingClientRect().top),'Collapsing a long bubble keeps it reachable');
    await page.setViewportSize({width:1100,height:850});
    const result={data:[{skills:Array.from({length:301},(_,i)=>({name:'skill-'+i,path:'/project/skill-'+i+'/SKILL.md',description:'Fixture skill',enabled:true})),
      errors:Array.from({length:21},()=>({path:'/project/broken/SKILL.md',message:'missing required field name: native-private-value'}))}]};
    fs.writeFileSync(f.skills_fixture,JSON.stringify(result));await skills();
    await page.getByText('Skill loading issues',{exact:true}).waitFor();
    assert.equal(await page.locator('#native-page .account-entry:not(.skill-discovery-errors .account-entry)').count(),300);
    await page.getByText('Showing the first 300 skills.',{exact:true}).waitFor();
    assert.ok((await page.locator('.skill-discovery-errors').innerText()).includes('/project/broken/SKILL.md'));
    assert.equal(await page.locator('.skill-discovery-errors .account-entry').count(),20);
    await page.getByText('Showing the first 20 loading issues.',{exact:true}).waitFor();
    assert.equal((await page.locator('#native-page').innerText()).includes('native-private-value'),false);
    await page.screenshot({path:f.output+'/skill-diagnostics-en.png'});
    fs.writeFileSync(f.skills_fixture,JSON.stringify({data:[{skills:[],errors:result.data[0].errors.slice(0,1)}]}));await refresh();
    await page.getByText('No skills could be loaded. See the issues below.',{exact:true}).waitFor();
    await page.locator('[data-account-tab="settings"]').click();await page.locator('#language').selectOption('zh');
    await page.locator('[data-account-tab="skills"]').click();await page.getByText('技能加载问题',{exact:true}).waitFor();
    await page.getByText('技能缺少必填的名称，或名称为空。',{exact:true}).waitFor();
    await page.screenshot({path:f.output+'/skill-diagnostics-zh.png'});
    fs.writeFileSync(f.skills_fixture,JSON.stringify({data:[{skills:[],errors:[]}]}));await refresh();
    await page.getByText('此工作目录下暂无技能。',{exact:true}).waitFor();
    assert.equal(await page.locator('.skill-discovery-errors').count(),0,'A clean refresh clears old diagnostics');
    await page.locator('#account-close').click();await load();
    await user(2).locator('.user-content-toggle').getByText('展开',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);console.log('message folding and skill diagnostics passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
