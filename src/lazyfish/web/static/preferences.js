"use strict";
// Original settings sections and browser-local preferences, backed by native run inputs.
window.LazyfishPreferences=function({node,t,panels,shortcuts,getConversation,onChange,onDisplayChange=()=>{},onReset}) {
  const $=s=>document.querySelector(s),key="lazyfish.preferences.v1",permissionKeys={ask:"ui.ask.for.approval",auto_review:"ui.auto.review",full_access:"ui.full.access",read_only:"ui.read.only",custom:"ui.custom.configuration"};
  const initial={permission:null,plan:false,showContext:true,showPlan:false,showReasoning:false,workspace:"",send:matchMedia("(pointer:coarse)").matches?"none":"enter",newline:matchMedia("(pointer:coarse)").matches?"enter":"shift-enter",defaults:null};
  let value={...initial},signature="";
  try{const saved=JSON.parse(localStorage.getItem(key));if(saved&&typeof saved==="object")value={...initial,...saved};}catch{/* optional preferences */}
  if(value.permission&&!Object.hasOwn(permissionKeys,value.permission))value.permission=null;
  value.showReasoning=value.showReasoning===true;
  function save(){try{localStorage.setItem(key,JSON.stringify(value));}catch{/* session preferences still work */}}
  function update(changes){Object.assign(value,changes);save();onChange();window.dispatchEvent(new Event('lazyfish-run-settings'));}
  const heading=label=>{const el=node("div","account-section-heading");el.append(node("h3","",t(label)));return el;};
  function row(label,input){const el=node("div","account-row"),caption=node("label","account-row-label",t(label));caption.htmlFor=input.id;el.append(caption,input);return el;}
  function select(id,options,selected,change){const input=node("select");input.id=id;for(const [value,label] of options){const option=node("option","",label);option.value=value;input.append(option);}input.value=selected;input.addEventListener("change",()=>change(input.value));return input;}
  function toggle(id,checked,change){const input=node("input");input.id=id;input.type="checkbox";input.setAttribute("role","switch");input.checked=checked;input.addEventListener("change",()=>change(input.checked));return input;}
  const defaultsSection=node("div"),displaySection=node("div"),composerSection=node("div"),keyboardSection=node("div"),resetSection=node("div");
  const root=$("#settings");root.querySelector(".account-section-heading h3").dataset.text="ui.appearance";
  root.querySelector(".account-section-heading p").remove();
  const shortcutRow=$("#shortcut-prefix").closest(".account-row"),shortcutHelp=root.querySelector(".account-note");
  const oldHeading=shortcutRow.previousElementSibling;oldHeading.remove();shortcutHelp.remove();
  shortcutRow.querySelector("label").dataset.text="ui.conversation.shortcut";
  root.insertBefore(defaultsSection,shortcutRow);root.insertBefore(displaySection,shortcutRow);root.insertBefore(composerSection,shortcutRow);root.insertBefore(keyboardSection,shortcutRow);root.append(resetSection);
  function render(){
    const catalog=panels.runDefaults(),selected=value.defaults||catalog;
    const next=JSON.stringify([document.documentElement.lang,catalog.models,selected.model,selected.effort,selected.fast,value.defaults,value.showContext,value.showPlan,value.showReasoning,value.send,value.newline]);if(signature===next)return;signature=next;
    defaultsSection.replaceChildren(heading("ui.new.conversation.defaults"));
    const modelOptions=[["",t("nativeDefaultShort")],...catalog.models.map(m=>[m.id,m.name||m.id])];
    if(selected.model&&!modelOptions.some(([id])=>id===selected.model))modelOptions.push([selected.model,selected.model]);
    function persistDefaults(changes){value.defaults={...(value.defaults||selected),...changes};delete value.defaults.models;delete value.defaults.fallback;save();if(!getConversation()?.jobs.length)panels.applyDefaults(value.defaults);}
    let effortInput;
    function levels(model){const info=catalog.models.find(m=>m.id===model);return info?.levels?.length?info.levels:catalog.fallback;}
    const modelInput=select("default-model",modelOptions,selected.model||"",model=>{const supported=levels(model),effort=supported.includes(effortInput.value)?effortInput.value:supported.includes("medium")?"medium":supported[0];persistDefaults({model,effort});signature="";render();});
    effortInput=select("default-effort",levels(selected.model).map(e=>[e,t("effort."+e)]),selected.effort||"medium",effort=>persistDefaults({effort}));
    const directory=node("input");directory.type="text";directory.id="default-workspace";directory.value=selected.workspace||"";
    directory.addEventListener("change",()=>{const workspace=directory.value.trim();directory.setCustomValidity(workspace&&!workspace.startsWith("/")?t("ui.enter.an.absolute.working.directory.path"):"");if(directory.reportValidity()){persistDefaults({workspace});update({workspace});}});
    directory.addEventListener("input",()=>directory.setCustomValidity(""));
    const permissionOptions=[["",t("installation")],...Object.entries(permissionKeys).map(([id,key])=>[id,t(key)])];
    defaultsSection.append(row("ui.model",modelInput),row("ui.reasoning.effort",effortInput),row("ui.fast.mode",toggle("default-fast",selected.fast===true,fast=>persistDefaults({fast}))),row("ui.permissions",select("default-permission",permissionOptions,selected.permission||"",permission=>{persistDefaults({permission:permission||null});if(!getConversation()?.jobs.length)update({permission:permission||null});})),row("ui.working.directory",directory));
    const displayStatus=node('p','account-error');displayStatus.setAttribute('role','status');displayStatus.hidden=true;
    const reasoning=toggle('show-reasoning',value.showReasoning,showReasoning=>{
      const next={...value,showReasoning};
      try{localStorage.setItem(key,JSON.stringify(next));}
      catch{reasoning.checked=value.showReasoning;displayStatus.textContent=t('ui.could.not.save.preferences.check.your.browser.storage.settings');displayStatus.hidden=false;return;}
      value=next;displayStatus.textContent='';displayStatus.hidden=true;onDisplayChange();
    });
    reasoning.setAttribute('aria-label',t('ui.show.reasoning.summaries'));
    displaySection.replaceChildren(heading('ui.conversation.display'),row('ui.reasoning.summary',reasoning),node('p','account-note',t('ui.reasoning.visibility.hint')),displayStatus);
    composerSection.replaceChildren(heading("ui.composer"),row("ui.context.usage",toggle("show-context",value.showContext,showContext=>update({showContext}))),row("ui.show.plan",toggle("show-plan",value.showPlan,showPlan=>update({showPlan}))));
    const options=[["enter","Enter"],["shift-enter","Shift + Enter"],["ctrl-enter","Control + Enter"],["meta-enter","Cmd + Enter"],["alt-enter","Option / Alt + Enter"]];
    function keys(action,choice){const changes={[action]:choice},other=action==="send"?"newline":"send";if(value[other]===choice)changes[other]=value[action]==="none"?"enter":value[action];update(changes);signature="";render();}
    keyboardSection.replaceChildren(heading("ui.keyboard.shortcuts"),row("ui.send.shortcut",select("send-shortcut",[...options,["none",t("ui.button.only")]],value.send,v=>keys("send",v))),row("ui.newline.shortcut",select("newline-shortcut",options,value.newline,v=>keys("newline",v))));
    const sidebarOptions=[...$("#shortcut-prefix").options].map(o=>[o.value,o.textContent]);sidebarOptions.splice(1,0,["meta","Cmd"]);
    const sidebarRow=row("ui.sidebar.shortcut",select("sidebar-shortcut",sidebarOptions,shortcuts.sidebarPrefix,v=>shortcuts.setSidebar(v)));
    resetSection.replaceChildren(sidebarRow,heading("ui.reset"));
    const reset=node("button","account-button",t("ui.restore.defaults"));reset.type="button";reset.id="restore-defaults";reset.addEventListener("click",()=>{if(!confirm(t("ui.restore.defaults.this.resets.appearance.language.new.conversation.defaults")))return;value={...initial};for(const k of [key,"lazyfish.run.v1","lazyfish.language"])localStorage.removeItem(k);shortcuts.set("ctrlShift");shortcuts.setSidebar("ctrlShift");$("#shortcut-prefix").value=shortcuts.prefix;signature="";panels.applyDefaults({model:"",effort:"",fast:false});onReset();});resetSection.append(reset);
  }
  window.addEventListener("lazyfish-models",()=>{signature="";render();});
  window.addEventListener("lazyfish-panel",event=>{if(event.detail.page==="settings")render();});
  function keydown(event,send){
    if(event.key!=="Enter"||event.isComposing||event.defaultPrevented)return;
    const key=[event.ctrlKey?"ctrl":null,event.metaKey?"meta":null,event.altKey?"alt":null,event.shiftKey?"shift":null,"enter"].filter(Boolean).join("-");
    if(key===value.send){event.preventDefault();send();}
    else if(key===value.newline){event.preventDefault();const input=event.target;input.setRangeText("\n",input.selectionStart,input.selectionEnd,"end");input.dispatchEvent(new Event("input",{bubbles:true}));}
  }
  return {render,key:()=>key,keydown,settings:()=>({...value}),togglePlan:()=>update({plan:!value.plan}),permission:permission=>update({permission}),
    restoreConversation:settings=>{value.permission=settings.permission_mode||null;value.plan=settings.collaboration_mode==='plan';onChange();},
    inputs:()=>({...value.permission?{permission_mode:value.permission}:{},...value.showPlan?{collaboration_mode:value.plan?"plan":"default"}:{}}),
    applyDefaults:()=>{if(value.defaults){panels.applyDefaults(value.defaults);update({permission:value.defaults.permission||null,workspace:value.defaults.workspace||"",plan:false});}}};
};
