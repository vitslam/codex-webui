"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {chromium} = require(process.env.LAZYFISH_BROWSER_MODULE);
const fixture = JSON.parse(fs.readFileSync(process.env.LAZYFISH_BROWSER_FIXTURE,"utf8"));
(async()=> {
  const browser = await chromium.launch({executablePath:process.env.LAZYFISH_BROWSER_EXECUTABLE,headless:true,args:["--no-sandbox"]});
  const context = await browser.newContext({viewport:{width:1280,height:900},locale:"en-US"});
  await context.addInitScript(()=>localStorage.setItem("lazyfish.sidebar.groups.v1",JSON.stringify({recent:true,projects:false})));
  await context.grantPermissions(["clipboard-read","clipboard-write"]);
  const page = await context.newPage(), errors = [];
  page.on("pageerror",error=>errors.push(error.message));
  async function settle() { await page.waitForTimeout(180); }
  async function wakeComposer(){if(await page.locator('#composer-handle').isVisible())await page.locator('#composer-handle').click();await page.locator('#composer').waitFor({state:'visible'});await page.waitForTimeout(120);}
  async function opened(id) { await page.waitForFunction(id=>new URL(location.href).searchParams.get("conversation")===id && document.querySelector("#conversation-title").textContent!=="What would you like to do?",id); await settle(); }
  async function geometry() {
    return page.evaluate(()=> {
      const el=document.querySelector("#messages"),top=el.getBoundingClientRect().top;
      const anchor=[...el.querySelectorAll("[data-anchor]")].find(a=>a.getBoundingClientRect().bottom>top+2);
      return {job:anchor?.closest("[data-job]").dataset.job,anchor:anchor?.dataset.anchor,
        offset:anchor?.getBoundingClientRect().top-top, distance:el.scrollHeight-el.scrollTop-el.clientHeight};
    });
  }
  try {
    await page.goto(fixture.url);
    await page.locator("#token").fill(fixture.token); await page.locator("#login button").click();
    await page.waitForSelector("#app:not([hidden])");
    // A URL can open a conversation beyond the first sidebar page.
    await page.goto(`${fixture.url}/?conversation=${fixture.main}`); await opened(fixture.main);
    assert.equal(await page.locator(".turn").count(),30);
    assert.equal(await page.locator(".markdown strong a").first().getAttribute("href"),"https://example.org/docs");
    assert.equal(await page.locator(".markdown script,.markdown img,.markdown a[href^='javascript:']").count(),0);
    assert.equal(await page.evaluate(()=>Boolean(window.compromised)),false);
    assert.equal(await page.locator(".markdown ol").first().getAttribute("start"),"3");
    assert.equal(await page.locator(".markdown ol ul").count(),30);
    assert.equal(await page.locator(".markdown table").count(),30);
    assert.equal(await page.locator(".markdown blockquote").count(),30);
    assert.equal(await page.locator(".code-block pre").first().innerText(),'print("fish")');
    await page.locator(".code-header button").first().click();
    await page.waitForFunction(()=>document.querySelector(".code-header button").getAttribute("aria-label")==="Copied");
    assert.equal(await page.locator(".code-header button").first().getAttribute("aria-label"),"Copied");
    // Paginated prepend preserves the visible message, not the old pixel offset.
    const before = await page.evaluate(()=>{const el=document.querySelector('#messages');el.scrollTop=0;const top=el.getBoundingClientRect().top,anchor=[...el.querySelectorAll('[data-anchor]')].find(a=>a.getBoundingClientRect().bottom>top+2);return {job:anchor?.closest('[data-job]').dataset.job,anchor:anchor?.dataset.anchor,offset:anchor?.getBoundingClientRect().top-top};});
    await page.waitForFunction(()=>document.querySelectorAll(".turn").length>=60); await settle();
    const afterOffset = await page.evaluate(before=> {
      const container=document.querySelector("#messages");
      const el=[...container.querySelectorAll("[data-anchor]")].find(el=>el.dataset.anchor===before.anchor && el.closest("[data-job]").dataset.job===before.job);
      return el.getBoundingClientRect().top-container.getBoundingClientRect().top;
    },before);
    assert.ok(Math.abs(afterOffset-before.offset)<3,JSON.stringify({before,afterOffset}));
    // Remember a point far back, switch and refresh; fetch its anchor window.
    await page.locator(`[data-job='${fixture.jobs[12]}'] .user-message`).scrollIntoViewIfNeeded(); await settle();
    const reading = await geometry();
    await page.locator(`#conversation-list .conversation[data-id='${fixture.other}']`).click(); await opened(fixture.other);
    await page.goto(`${fixture.url}/?conversation=${fixture.main}`); await opened(fixture.main);
    let restored = await geometry(); assert.equal(restored.job,reading.job); assert.ok(Math.abs(restored.offset-reading.offset)<3,JSON.stringify({reading,restored}));
    await page.reload(); await opened(fixture.main); restored=await geometry();
    assert.equal(restored.job,reading.job); assert.ok(Math.abs(restored.offset-reading.offset)<3);
    assert.equal(await page.locator("#latest").isVisible(),true);
    await page.locator("#latest").click(); await settle(); assert.ok((await geometry()).distance<3);
    await page.setViewportSize({width:970,height:740}); await settle(); assert.ok((await geometry()).distance<3);
    await page.setViewportSize({width:970,height:620}); await settle(); assert.ok((await geometry()).distance<3);
    await page.setViewportSize({width:970,height:740}); await settle();
    await page.reload(); await opened(fixture.main); assert.ok((await geometry()).distance<3);
    // Load all sidebar pages and pin the long chat for stable numeric positions.
    await page.locator("#more-conversations").click(); await page.waitForFunction(()=>document.querySelectorAll("#conversation-list .conversation").length===55);
    await page.locator(`#conversation-list .conversation-row[data-id='${fixture.main}']`).scrollIntoViewIfNeeded();
    await page.locator(`#conversation-list .conversation-row[data-id='${fixture.main}'] .conversation-pin`).click();
    await page.waitForFunction(id=>document.querySelector(`#conversation-list .conversation-row[data-id='${id}'] .conversation-pin`)?.getAttribute("aria-pressed")==="true",fixture.main);
    await page.locator("#menu-toggle").click(); await page.locator("#settings-toggle").click(); await page.locator("#shortcut-prefix").selectOption("alt"); await page.locator("#account-close").click();
    const entries = await page.locator("#conversation-list .conversation").evaluateAll(els=>els.slice(0,2).map(el=>el.dataset.id));
    await page.keyboard.down("Alt"); await page.keyboard.down("Digit1");
    assert.equal(new URL(page.url()).searchParams.get("conversation"),fixture.main);
    assert.equal(await page.locator("#conversation-list .preselected").getAttribute("data-id"),entries[0]);
    await page.keyboard.up('Digit1');await page.keyboard.down("Digit2"); assert.equal(await page.locator("#conversation-list .preselected").getAttribute("data-id"),entries[1]);
    await page.keyboard.up('Digit2');await opened(entries[1]);await page.keyboard.up("Alt");
    await page.keyboard.down("Alt"); await page.keyboard.down("Digit1"); await page.keyboard.press("Escape");await page.keyboard.up('Digit1'); await page.keyboard.up("Alt"); await settle();
    assert.equal(new URL(page.url()).searchParams.get("conversation"),entries[1]);
    // Prefix Tab toggles MRU; ordinary Tab leaves focus unchanged, arrows don't select.
    await page.keyboard.down("Alt"); await page.keyboard.press("Tab"); await page.keyboard.up("Alt"); await opened(fixture.main);
    await page.keyboard.down("Alt"); await page.keyboard.press("Tab"); await page.keyboard.up("Alt"); await opened(entries[1]);
    await page.keyboard.down("Alt"); await page.keyboard.press("ArrowUp"); assert.equal(await page.locator(".preselected").count(),0); await page.keyboard.up("Alt");
    await wakeComposer();await page.locator("#prompt").focus(); await page.keyboard.press("Tab"); assert.equal(await page.evaluate(()=>document.activeElement.id),"prompt");
    // Hidden sidebar: pinned/recent groups, status dots, spacing and preselection.
    await page.locator("#sidebar-toggle").click(); await page.keyboard.down("Alt");
    assert.equal(await page.locator("#shortcut-hints").isVisible(),true);
    assert.deepEqual(await page.locator("#shortcut-hints .list-group").allTextContents(),["Pinned","Recent"]);
    assert.equal(await page.locator("#shortcut-hints .dot").count(),9);
    assert.ok(await page.locator("#shortcut-hints .separated").evaluate(el=>parseFloat(getComputedStyle(el).marginTop))>=16);
    await page.keyboard.press("Digit2"); await page.keyboard.up("Alt"); await opened(entries[1]);
    // Branching before a user bubble excludes it; source is unchanged and no task runs.
    await page.goto(`${fixture.url}/?conversation=${fixture.main}`); await opened(fixture.main);
    const last=page.locator(".turn").last(); await last.locator(".user-turn").hover(); await last.locator(".branch").click();
    await page.waitForFunction(id=>new URL(location.href).searchParams.get("conversation")!==id,fixture.main); await settle();
    assert.equal(await page.locator(".turn").count(),30);
    assert.equal(await page.locator(".user-message").last().innerText(),"User message 63");
    assert.equal(await page.locator("#cancel").isVisible(),false);
    // Both languages update ordinary and hover actions.
    if (await page.evaluate(()=>document.body.classList.contains("sidebar-hidden"))) await page.locator("#sidebar-toggle").click();
    await page.locator("#menu-toggle").click(); await page.locator("#settings-toggle").click();
    await page.locator("#language").selectOption("zh"); await page.locator("#account-close").click(); assert.equal(await page.locator("#settings-toggle").innerText(),"\u8bbe\u7f6e");
    assert.equal(await page.locator(".branch").first().getAttribute("aria-label"),"\u5206\u652f\u5230\u65b0\u804a\u5929");
    // A streaming turn must not pull a reader away from older messages.
    await page.goto(`${fixture.url}/?conversation=${fixture.main}`); await opened(fixture.main);
    await wakeComposer();await page.locator("#prompt").fill("[stream]"); await wakeComposer();await page.locator("#send").click();
    await page.waitForSelector("#cancel:not([hidden])");
    await page.locator(`[data-job='${fixture.jobs[60]}'] .user-message`).scrollIntoViewIfNeeded(); await settle();
    const during = await geometry(); await page.waitForTimeout(850); const later = await geometry();
    assert.equal(later.job,during.job); assert.equal(later.anchor,during.anchor); assert.ok(Math.abs(later.offset-during.offset)<3);
    await wakeComposer();await page.locator("#cancel").click(); await wakeComposer();await page.locator("#cancel").waitFor({state:"hidden"});
    // Blurring cancels preselection, including a lost modifier-key release.
    await page.keyboard.down("Alt"); await page.keyboard.down("Digit1");
    await page.evaluate(()=>window.dispatchEvent(new Event("blur")));await page.keyboard.up('Digit1'); await page.keyboard.up("Alt"); await settle();
    assert.equal(new URL(page.url()).searchParams.get("conversation"),fixture.main);
    // Imported appearance registry: all palettes, persistence and clean desktop layout.
    await page.goto(`${fixture.url}/?conversation=${fixture.other}`); await opened(fixture.other);
    if (await page.evaluate(()=>document.body.classList.contains("sidebar-hidden"))) await page.locator("#sidebar-toggle").click();
    await page.locator("#menu-toggle").click(); await page.locator("#settings-toggle").click();
    assert.equal(await page.locator("#appearance option").count(),9);
    for (const theme of ["light","dark","warm","warm-dark","black","midnight","nord","sepia"]) {
      await page.locator("#appearance").selectOption(theme);
      assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme);
      assert.ok(await page.evaluate(()=> {
        let hex=appearance.theme.color.slice(1); if (hex.length===3) hex=[...hex].map(c=>c+c).join("");
        const rgb=`rgb(${[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)).join(", ")})`;
        return getComputedStyle(document.body).backgroundColor===rgb;
      }));
    }
    await page.locator("#appearance").selectOption("light"); await page.locator("#account-close").click();
    await page.reload(); await opened(fixture.other);
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),"light");
    await page.setViewportSize({width:1440,height:1000}); await settle();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const bounds=await page.locator("#composer").boundingBox(), textBounds=await page.locator("#transcript").boundingBox();
    assert.ok(Math.abs(bounds.x-(textBounds.x+32))<2);
    await page.screenshot({path:fixture.output+"/desktop-light.png"});
    await page.locator("#theme-toggle").click(); await settle();
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),"dark");
    await page.screenshot({path:fixture.output+"/desktop-dark.png"});
    await page.locator("#new-chat").click(); await page.waitForSelector("#empty:not([hidden])"); await settle();
    assert.deepEqual(await page.locator("#conversation-list .list-group,#conversation-list>.sidebar-projects>.sidebar-disclosure,#conversation-list>.sidebar-recent>.sidebar-disclosure").allTextContents(),["\u7f6e\u9876","\u9879\u76ee","\u6700\u8fd1\u5bf9\u8bdd"]);
    const welcome=await page.locator("#empty").boundingBox(), composer=await page.locator("#composer").boundingBox();
    assert.ok(welcome.y>150 && welcome.y<500); assert.ok(composer.y>welcome.y);
    await page.screenshot({path:fixture.output+"/desktop-empty.png"});
    // Mobile drawer/backdrop, model controls, dialogs and keyboard-sized input.
    await page.goto(`${fixture.url}/?conversation=${fixture.other}`); await opened(fixture.other);
    await page.setViewportSize({width:390,height:844}); await settle();
    assert.equal(await page.locator("#sidebar-backdrop").isVisible(),false);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.ok(await page.locator("#prompt").evaluate(el=>parseFloat(getComputedStyle(el).fontSize))>=16);
    await page.locator("#sidebar-toggle").click(); assert.equal(await page.locator("#sidebar-backdrop").isVisible(),true);
    await page.locator("#menu-toggle").click(); await page.locator("#settings-toggle").click();
    assert.equal(await page.locator("#settings").isVisible(),true);
    await page.locator("#appearance").selectOption("light"); await page.keyboard.press("Escape");
    assert.equal(await page.locator("#settings").isVisible(),false);
    await page.locator("#sidebar-backdrop").click({position:{x:380,y:400}});
    assert.equal(await page.locator("#sidebar").isVisible(),false);
    await wakeComposer();await page.locator("#model-options summary").click();
    const modelBounds=await page.locator("#model-options .settings-panel").boundingBox();
    assert.ok(modelBounds.x>=0 && modelBounds.x+modelBounds.width<=390);
    await wakeComposer();await page.locator("#model-options summary").click();
    await page.screenshot({path:fixture.output+"/mobile-light.png"});
    // Expanded controls use the original panels, not generic form dialogs.
    await wakeComposer();await page.locator("#model-options summary").click();
    assert.equal(await page.locator("#dashboard-controls").isVisible(),true);
    await page.locator("#effort-slider").focus(); await page.keyboard.press("End");
    assert.equal(await page.locator("#effort").inputValue(),"ultra");
    await page.keyboard.press("Home"); await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator("#effort").inputValue(),"medium");
    assert.equal(await page.locator("#model-preview").textContent(),"Fixture Model");
    assert.equal(await page.locator("#effort-ticks i").count(),6);
    const handle=await page.locator(".effort-handle").boundingBox();
    await page.mouse.click(handle.x+handle.width,handle.y+handle.height/2);assert.equal(await page.locator("#effort").inputValue(),"ultra");
    const thumb=await page.locator(".effort-thumb").boundingBox();await page.mouse.move(thumb.x+thumb.width/2,thumb.y+thumb.height/2);await page.mouse.down();await page.mouse.move(handle.x,handle.y+handle.height/2,{steps:5});
    assert.equal(await page.locator("#effort").inputValue(),"low");await page.keyboard.press("Escape");await page.mouse.up();
    assert.equal(await page.locator("#effort").inputValue(),"ultra");await wakeComposer();await page.locator("#model-options summary").click();
    await page.locator("#effort-reset").click();
    await settle();await page.screenshot({path:fixture.output+"/mobile-model-dashboard.png"});
    await page.locator("#effort-reset").click(); assert.equal(await page.locator("#effort").inputValue(),"medium");
    await page.locator("#model-toggle").click(); assert.equal(await page.locator("#model-picker").isVisible(),true);
    await page.locator("#custom-model").fill("example-model"); await page.locator("#apply-model").click();
    assert.equal(await page.locator("#model").inputValue(),"example-model");
    await page.locator("#model-toggle").click();
    await page.locator('#model-choices button[data-model=""]').click();
    assert.equal(await page.locator("#model").inputValue(),"");
    await page.locator("#model-toggle").click();
    await page.locator('#model-choices button[data-model="compact-model"]').click();assert.equal(await page.locator("#model-preview").innerText(),"Compact Model");
    assert.equal(await page.locator("#effort-ticks i").count(),2);await page.locator("#effort-reset").click();assert.equal(await page.locator("#effort").inputValue(),"high");
    await page.locator("#model-toggle").click();await page.keyboard.press("Home");await page.keyboard.press("End");assert.ok(await page.evaluate(()=>document.activeElement.getAttribute("role")==="option"));
    await page.keyboard.press("Escape");assert.equal(await page.locator("#dashboard-controls").isVisible(),true);
    await page.locator("#model-toggle").click();await page.locator('#model-choices button[data-model=""]').click();await page.locator("#effort-reset").click();
    await page.keyboard.press("Escape"); assert.equal(await page.locator("#model-options").getAttribute("open"),null);
    await wakeComposer();await page.locator("#permission-settings summary").click();
    assert.equal(await page.locator(".permission-panel").isVisible(),true);
    assert.equal(await page.locator("#account-dialog").isVisible(),false);
    assert.equal(await page.locator("[data-permission]").count(),5);
    await page.screenshot({path:fixture.output+"/mobile-permissions.png"});
    await page.keyboard.press("Escape");await page.locator("#sidebar-toggle").click();await page.locator("#menu-toggle").click();await page.locator("#settings-toggle").click();await page.locator('[data-account-tab="installation"]').click();
    assert.equal(await page.locator("#installation").isVisible(),true);
    await page.locator('[data-account-tab="diagnostics"]').click();
    assert.equal(await page.locator("#checks li").count(),4);
    await page.locator('[data-account-tab="settings"]').click();
    await page.screenshot({path:fixture.output+"/mobile-settings.png"});
    await page.locator("#language").selectOption("en");
    assert.equal(await page.locator("#account-dialog-title").innerText(),"Settings");
    await page.locator("#language").selectOption("zh");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#account-dialog").isVisible(),false);
    if(await page.evaluate(()=>document.body.classList.contains("sidebar-hidden")))await page.locator("#sidebar-toggle").click(); await page.locator("#search-toggle").click();
    await page.locator("#conversation-search").fill("Codex Web");
    await page.waitForFunction(id=>document.querySelectorAll("#search-results .search-result").length===1 && document.querySelector("#search-results .search-result").dataset.id===id,fixture.other);
    await page.screenshot({path:fixture.output+"/mobile-search.png"});
    await page.locator("#search-results .search-result").click(); await opened(fixture.other);
    assert.equal(await page.locator("#search-dialog").isVisible(),false);
    await page.setViewportSize({width:1440,height:1000}); await settle();
    if (await page.evaluate(()=>document.body.classList.contains("sidebar-hidden"))) await page.locator("#sidebar-toggle").click();
    await page.locator("#menu-toggle").click(); await page.screenshot({path:fixture.output+"/desktop-menu.png"});
    await page.locator("#settings-toggle").click(); await page.screenshot({path:fixture.output+"/desktop-settings.png"});
    await page.locator("#appearance").selectOption("dark"); await page.screenshot({path:fixture.output+"/desktop-settings-dark.png"});
    await page.locator("#appearance").selectOption("light"); await page.mouse.click(5,5); await settle();
    assert.equal(await page.locator("#account-dialog").isVisible(),false);
    assert.equal(await page.evaluate(()=>document.activeElement.id),"menu-toggle");
    await wakeComposer();await page.locator("#model-options summary").click();
    await page.locator("#effort-slider").focus(); await page.keyboard.press("Home"); await page.keyboard.press("ArrowRight");
    await settle();await page.screenshot({path:fixture.output+"/desktop-model-dashboard.png"});
    await page.locator("#fast-toggle").click();await page.locator("#effort-slider").focus();await page.keyboard.press("End");
    await settle();await page.screenshot({path:fixture.output+"/desktop-model-ultra.png"});await page.locator("#fast-toggle").click();await page.locator("#effort-reset").click();
    await page.locator("#model-toggle").click(); await page.screenshot({path:fixture.output+"/desktop-model-picker.png"});
    await page.keyboard.press("Escape"); await wakeComposer();await page.locator("#permission-settings summary").click();
    await page.screenshot({path:fixture.output+"/desktop-permissions.png"}); await page.keyboard.press("Escape");
    // The visual dashboard still sends the selected native model/effort values.
    await wakeComposer();await page.locator("#model-options summary").click(); await page.locator("#model-toggle").click();
    await page.locator('#model-choices button[data-model="example-model"]').click();
    assert.equal(await page.locator("#dashboard-controls").isVisible(),true);
    await page.locator("#effort-slider").focus(); await page.keyboard.press("Home");
    assert.equal(await page.locator("#effort").inputValue(),"low");
    for(let i=0;i<2;i++){await page.keyboard.press("ArrowRight");assert.equal(await page.locator("#effort").inputValue(),["medium","high"][i]);}
    await page.locator("#fast-toggle").click();assert.equal(await page.locator("#fast-toggle").getAttribute("aria-pressed"),"true");
    await page.keyboard.press("Escape"); await wakeComposer();await page.locator("#prompt").fill("[slow]");
    const requestPromise=page.waitForRequest(request=>request.method()==="POST"&&request.url().endsWith("/turns"));
    await wakeComposer();await page.locator("#send").click(); const request=await requestPromise;
    assert.equal(request.postDataJSON().model,"example-model"); assert.equal(request.postDataJSON().effort,"high"); assert.equal(request.postDataJSON().fast_mode,true);
    await page.waitForSelector("#cancel:not([hidden])"); await wakeComposer();await page.locator("#cancel").click(); await wakeComposer();await page.locator("#cancel").waitFor({state:"hidden"});
    // Migrated account, quota, skills, attachments and context use real local APIs.
    await page.locator("#menu-toggle").click();await page.locator("#usage-toggle").click();
    await page.waitForFunction(()=>document.querySelectorAll(".quota-card").length===2);
    assert.ok((await page.locator("#native-page").innerText()).includes("67%"));
    await page.screenshot({path:fixture.output+"/weekly-usage.png"});
    await page.locator('[data-account-tab="connections"]').click();await page.waitForSelector(".account-entry");
    assert.ok((await page.locator("#native-page").innerText()).includes("Local example"));
    assert.ok(!(await page.locator("#native-page").innerText()).includes("must-never-expose"));
    await page.keyboard.press("Escape");await page.locator("#new-chat").click();await page.waitForSelector("#empty:not([hidden])");
    await wakeComposer();await page.locator("#context-settings summary").click();assert.equal(await page.locator("#context-percent").innerText(),"0% \u5df2\u7528");await page.keyboard.press("Escape");
    await page.locator("#menu-toggle").click();await page.locator("#skills-toggle").click();
    await page.getByRole("button",{name:"\u521b\u5efa\u6280\u80fd",exact:true}).click();
    await page.locator("#skill-name").fill("review-example");await page.locator("#skill-description").fill("Review local code");await page.locator("#skill-body").fill("Inspect the current changes.");
    await page.locator("#save-skill").click();await page.waitForSelector(".account-entry");
    await page.screenshot({path:fixture.output+"/skills-manager.png"});
    await page.getByRole("button",{name:"\u7f16\u8f91",exact:true}).click();const skillSource=await page.locator('#skill-source').inputValue();await page.locator("#skill-source").fill(skillSource.replace('Inspect the current changes.','Inspect changes and explain findings.'));await page.locator("#save-skill").click();await page.waitForSelector(".account-entry");
    await page.getByRole("button",{name:"\u5728\u6d88\u606f\u4e2d\u4f7f\u7528",exact:true}).click();assert.equal(await page.locator("#selected-skills .skill-chip").count(),1);
    await page.locator("#selected-skills button").click();await wakeComposer();await page.locator("#prompt").fill("@review");await page.waitForSelector(".skill-option");await page.keyboard.press("Enter");
    assert.equal(await page.locator("#selected-skills .skill-chip").count(),1);assert.equal(await page.locator("#prompt").inputValue(),"");
    await wakeComposer();await page.locator("#attachment-settings summary").first().click();await page.screenshot({path:fixture.output+"/attachment-menu.png"});
    const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=","base64");
    await page.locator("#image-input").setInputFiles({name:"tiny.png",mimeType:"image/png",buffer:png});
    await page.waitForSelector("#image-previews img");await page.locator("#image-previews img").click();await page.locator(".image-viewer").waitFor({state:"visible"});
    await page.keyboard.press("Escape");await page.locator(".image-viewer").waitFor({state:"detached"});
    await page.locator("#image-previews img").click();await page.mouse.click(5,5);await page.locator(".image-viewer").waitFor({state:"detached"});
    await wakeComposer();await page.locator("#prompt").fill("Review the attached image");await page.keyboard.press("Escape");
    const inputRequest=page.waitForRequest(r=>r.method()==="POST"&&r.url().endsWith("/turns"));await wakeComposer();await page.locator("#send").click();
    const submitted=(await inputRequest).postDataJSON();assert.equal(submitted.images.length,1);assert.equal(submitted.skills[0].name,"review-example");
    await page.waitForFunction(()=>[...document.querySelectorAll(".turn .task-status")].some(el=>el.dataset.state==="completed"));await wakeComposer();await page.locator("#context-settings summary").click();
    await page.waitForFunction(()=>document.querySelector("#context-percent").textContent==="32% \u5df2\u7528");await page.screenshot({path:fixture.output+"/context-usage.png"});
    await page.reload();await settle();await page.waitForSelector(".user-message img");
    // Reload restores this chat's submitted settings, independent of earlier chats.
    assert.equal(await page.locator("#fast-toggle").getAttribute("aria-pressed"),String(submitted.fast_mode));assert.equal(await page.locator("#model").inputValue(),submitted.model||"");assert.equal(await page.locator("#effort").inputValue(),submitted.effort||"");
    await wakeComposer();await page.locator("#context-settings summary").click();assert.equal(await page.locator("#context-percent").innerText(),"32% \u5df2\u7528");
    await page.setViewportSize({width:390,height:844});await settle();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const contextBounds=await page.locator(".context-panel").boundingBox();assert.ok(contextBounds.x>=0&&contextBounds.x+contextBounds.width<=390);
    await page.screenshot({path:fixture.output+"/mobile-context.png"});
    // Hover and expanded context match the original in both languages and viewports.
    await page.keyboard.press("Escape");await page.setViewportSize({width:1440,height:1000});await settle();
    await wakeComposer();await page.locator("#context-settings summary").hover();
    assert.equal(await page.locator("#context-preview").innerText(),"\u4e0a\u4e0b\u6587\u5df2\u7528\uff1a32%");assert.equal(await page.locator("#context-preview").isVisible(),true);
    await page.screenshot({path:fixture.output+"/context-hover.png"});
    await wakeComposer();await page.locator("#context-settings summary").click();assert.equal(await page.locator("#context-preview").isVisible(),false);
    assert.ok((await page.locator("#context-detail").innerText()).includes("3,200 / 10,000"));
    assert.equal(await page.locator("#compact-context").isEnabled(),true);
    await wakeComposer();await page.locator("#prompt").fill("draft preserved through compaction");
    const compactResponse=page.waitForResponse(r=>r.request().method()==="POST"&&r.url().endsWith("/compact"));await page.locator("#compact-context").click();
    const compactJob=await (await compactResponse).json();
    await page.waitForFunction(id=>document.querySelector(`.turn[data-job="${id}"] .task-status`)?.dataset.state==="completed",compactJob.id);
    assert.equal(await page.locator(`.turn[data-job="${compactJob.id}"] .user-turn`).isVisible(),false);
    assert.equal(await page.locator("#prompt").inputValue(),"draft preserved through compaction");
    await wakeComposer();await page.locator("#context-settings summary").click();assert.equal(await page.locator("#context-percent").innerText(),"12% \u5df2\u7528");await page.keyboard.press("Escape");
    await wakeComposer();await page.locator("#attachment-settings summary").click();await page.locator("#edit-workdir").click();
    assert.equal(await page.locator("#workdir-dialog").isVisible(),true);assert.equal(await page.locator("#workdir-input").isEnabled(),true);
    await page.locator("#workdir-input").fill("/missing-workspace");await page.locator("#workdir-save").click();await page.waitForSelector("#workdir-error:not([hidden])");
    await page.screenshot({path:fixture.output+"/directory-dialog.png"});await page.keyboard.press("Escape");
    await page.locator(".user-message img").click({button:"right"});await page.waitForSelector(".image-menu");assert.equal(await page.locator(".image-menu button").count(),3);await page.keyboard.press("Escape");
    if(await page.evaluate(()=>document.body.classList.contains("sidebar-hidden")))await page.locator("#sidebar-toggle").click();
    await page.locator("#menu-toggle").click();await page.locator("#settings-toggle").click();
    for(const id of ["default-model","default-effort","default-fast","default-permission","default-workspace","show-context","show-plan","send-shortcut","newline-shortcut","sidebar-shortcut","restore-defaults"])assert.equal(await page.locator("#"+id).count(),1);
    await page.locator("#show-context").uncheck();assert.equal(await page.locator("#context-settings").getAttribute("hidden"),"");
    await page.locator("#show-context").check();await page.locator("#show-plan").check();
    await page.locator("#send-shortcut").selectOption("ctrl-enter");await page.locator("#newline-shortcut").selectOption("enter");
    await page.locator("#language").selectOption("en");await page.screenshot({path:fixture.output+"/settings-complete-en.png"});
    await page.keyboard.press("Escape");await wakeComposer();await page.locator("#context-settings summary").hover();assert.equal(await page.locator("#context-preview").innerText(),"Context used: 12%");
    await wakeComposer();await page.locator("#context-settings summary").click();assert.equal(await page.locator("#context-percent").innerText(),"12% used");await page.keyboard.press("Escape");
    await wakeComposer();await page.locator("#prompt").fill("first");await wakeComposer();await page.locator("#prompt").press("Enter");assert.equal(await page.locator("#prompt").inputValue(),"first\n");
    await wakeComposer();await page.locator("#permission-settings summary").click();await page.locator('[data-permission="read_only"]').click();await page.locator("#plan-toggle").click();
    const planRequest=page.waitForRequest(r=>r.method()==="POST"&&r.url().endsWith("/turns"));await wakeComposer();await page.locator("#prompt").press("Control+Enter");const planInputs=(await planRequest).postDataJSON();assert.equal(planInputs.permission_mode,"read_only");assert.equal(planInputs.collaboration_mode,"plan");
    await page.waitForFunction(()=>document.querySelector("#cancel").hidden);
    await page.locator("#search-toggle").click();await page.locator("#conversation-search").fill("readable history");await page.waitForSelector(".search-result-snippet");assert.ok((await page.locator(".search-result-snippet").first().innerText()).includes("readable history"));await page.keyboard.press("Escape");
    const activeId=new URL(page.url()).searchParams.get("conversation"),activeRow=page.locator(`.conversation-row[data-id="${activeId}"]`);await activeRow.hover();await activeRow.locator(".conversation-name").dblclick();await activeRow.locator("input").fill("Renamed from sidebar");await page.waitForTimeout(5200);assert.equal(await activeRow.locator("input").inputValue(),"Renamed from sidebar");await activeRow.locator("input").press("Enter");await page.waitForFunction(()=>document.querySelector("#conversation-title").textContent==="Renamed from sidebar");
    await page.locator("#new-chat").click();await page.waitForSelector("#empty:not([hidden])");
    const deletion=await page.evaluate(async()=>await(await fetch('/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"title":"Disposable"}'})).json());
    const deleteId=deletion.id;await page.goto(fixture.url+'/?conversation='+deleteId);await opened(deleteId);const deleteRow=page.locator(`.conversation-row[data-id="${deleteId}"]`);await deleteRow.hover();await deleteRow.locator(".conversation-archive").click();await deleteRow.waitFor({state:"detached"});
    assert.deepEqual(errors,[]);
    console.log("browser checks passed");
  } catch (error) { await page.screenshot({path:fixture.output+"/browser-failure.png",fullPage:true}); throw error; }
  finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
