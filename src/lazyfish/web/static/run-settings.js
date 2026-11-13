"use strict";
// Original Lazyfish model display, dashboard and pointer interaction, using local APIs.
window.LazyfishRunSettings = function({node,icon,t,getStatus,getConversation,onModel}) {
  const $=s=>document.querySelector(s), models=new Map(), fallback=["low","medium","high","xhigh","max","ultra"];
  const validEfforts=new Set(["","none","minimal",...fallback]), slider=$("#effort-slider"), track=$(".effort-slider");
  let defaults={},fast=false,drag=null,signature="";
  const current=()=>$("#model").value;
  function model() {const id=current() || getStatus()?.execution.model || defaults.model;return id ? models.get(id) : [...models.values()].find(m=>m.is_default);}
  function display(value) {return value?.name || String(value?.id || "").replace(/^([^-]+-[^-]+)-/,"$1 ");}
  function levels() {return (model()?.levels || []).length ? model().levels : fallback;}
  function defaultEffort() {const supported=levels();return [model()?.default_effort,getStatus()?.execution.effort,defaults.effort,"medium",supported[0]].find(value=>supported.includes(value));}
  function effort() {return levels().includes($("#effort").value) ? $("#effort").value : defaultEffort();}
  function normalize() {if($("#effort").value && !levels().includes($("#effort").value))$("#effort").value=defaultEffort();}
  function save() {try{localStorage.setItem("lazyfish.run.v1",JSON.stringify({model:current(),effort:$("#effort").value,fast}));}catch{ /* optional browser preferences */ }window.dispatchEvent(new Event('lazyfish-run-settings'));}
  function changed() {onModel();save();}
  function resetPicker(focus=false) {$("#model-picker").hidden=true;$("#dashboard-controls").hidden=false;$("#model-toggle").setAttribute("aria-expanded","false");if(focus)$("#model-toggle").focus();}
  function choose(value) {finishDrag(true);$("#model").value=value;if(value&&!models.has(value))models.set(value,{id:value});normalize();resetPicker(true);changed();}
  function choices() {
    const configured=getStatus()?.execution.model;
    for(const value of [current(),configured,...(getConversation()?.jobs || []).map(j=>j.model)])if(value&&!models.has(value))models.set(value,{id:value});
    const sorted=[...models.values()].sort((a,b)=>Number(/^auto$/i.test(b.id)||/^auto$/i.test(b.name || ""))-Number(/^auto$/i.test(a.id)||/^auto$/i.test(a.name || "")));
    const next=JSON.stringify([t("chooseModel"),current(),sorted]);if(signature===next)return;signature=next;
    const target=$("#model-choices");target.replaceChildren();
    for(const value of [{id:"",name:t("nativeDefaultShort")},...sorted]) {
      const option=node("button","model-option");option.type="button";option.dataset.model=value.id;option.setAttribute("role","option");option.setAttribute("aria-selected",String(value.id===current()));option.tabIndex=value.id===current()?0:-1;
      option.append(node("span","",display(value)),icon("check"));option.addEventListener("focus",()=>{for(const row of target.querySelectorAll("button"))row.tabIndex=row===option?0:-1;});option.addEventListener("click",()=>choose(value.id));target.append(option);
    }
  }
  function render(position) {
    const supported=levels(),selected=effort(),index=Math.max(0,supported.indexOf(selected)),name=t("effort."+selected);
    const modelName=display(models.get(current()) || model() || {id:current() || getStatus()?.execution.model || defaults.model}) || t("nativeDefaultShort");
    $("#model-preview").textContent=modelName;$("#model-label").textContent=modelName;$("#effort-preview").textContent=name;$("#effort-name").textContent=name;
    slider.max=String(supported.length-1);slider.disabled=supported.length<2;slider.value=String(index);slider.setAttribute("aria-valuetext",`${name} (${selected})`);
    $("#model-options").dataset.effort=selected;$("#model-options").dataset.fast=String(fast);
    $("#fast-toggle").setAttribute("aria-pressed",String(fast));$("#fast-toggle").title=t(fast?"fastOn":"fastOff");
    const summary=$("#model-options>summary"),title=`${modelName} · ${name} · ${t(fast?"fastMode":"standardSpeed")}`;summary.title=title;summary.setAttribute("aria-label",title);
    const fill=position ?? (drag&&sameContext(drag)?drag.position:index);
    track.style.setProperty("--effort-fill",`${supported.length>1?fill/(supported.length-1)*100:0}%`);
    const ticks=$("#effort-ticks");if(ticks.children.length!==supported.length){ticks.replaceChildren(...supported.map(()=>node("i")));}
    [...ticks.children].forEach((tick,i)=>tick.classList.toggle("passed",i<index));choices();
  }
  function openPicker() {finishDrag(true);choices();$("#custom-model").value=current();$("#dashboard-controls").hidden=true;$("#model-picker").hidden=false;$("#model-toggle").setAttribute("aria-expanded","true");($("#model-choices [aria-selected='true']") || $("#model-choices button")).focus();}
  $("#model-toggle").addEventListener("click",openPicker);
  $("#model-picker").addEventListener("keydown",event=> {
    if(event.key==="Escape"){event.preventDefault();event.stopPropagation();resetPicker(true);return;}
    const options=[...$("#model-choices").querySelectorAll("[role=option]")],index=options.indexOf(document.activeElement);
    if(index<0||!["ArrowDown","ArrowUp","Home","End"].includes(event.key))return;
    event.preventDefault();options[event.key==="Home"?0:event.key==="End"?options.length-1:(index+(event.key==="ArrowDown"?1:-1)+options.length)%options.length].focus();
  });
  $("#apply-model").addEventListener("click",()=>{const value=$("#custom-model").value.trim();if(value&&!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(value)){$("#custom-model").setCustomValidity(t("invalidModel"));$("#custom-model").reportValidity();return;}choose(value);});
  $("#custom-model").addEventListener("input",()=>$("#custom-model").setCustomValidity(""));
  $("#custom-model").addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();$("#apply-model").click();}});
  // Preserve the original thumb grab offset, smooth movement and cancellation behavior.
  function sameContext(gesture) {return gesture.model===current()&&gesture.conversation===getConversation()?.id;}
  function finishDrag(cancel=false) {
    if(!drag)return;const gesture=drag;drag=null;track.removeAttribute("data-dragging");
    if(cancel&&sameContext(gesture))$("#effort").value=gesture.effort;
    render();if(slider.hasPointerCapture(gesture.id))slider.releasePointerCapture(gesture.id);
    if(!cancel&&sameContext(gesture))save();
  }
  function pointerEffort(event) {const bounds=$(".effort-handle").getBoundingClientRect();return Math.max(0,Math.min(1,(event.clientX-drag.offset-bounds.left)/bounds.width))*(levels().length-1);}
  function preview(position) {drag.position=position;$("#effort").value=levels()[Math.round(position)];render(position);}
  slider.addEventListener("pointerdown",event=> {
    if(slider.disabled||event.button!==0||event.isPrimary===false)return;
    event.preventDefault();slider.focus({preventScroll:true});const bounds=$(".effort-thumb").getBoundingClientRect(),grabbing=event.clientX>=bounds.left&&event.clientX<=bounds.right;
    drag={id:event.pointerId,x:event.clientX,offset:grabbing?event.clientX-(bounds.left+bounds.width/2):0,effort:$("#effort").value,model:current(),conversation:getConversation()?.id,moving:grabbing};
    slider.setPointerCapture(event.pointerId);track.toggleAttribute("data-dragging",grabbing);preview(grabbing?pointerEffort(event):Math.round(pointerEffort(event)));
  });
  slider.addEventListener("pointermove",event=> {
    const bounds=$(".effort-thumb").getBoundingClientRect();track.toggleAttribute("data-thumb-hover",!slider.disabled&&event.clientX>=bounds.left&&event.clientX<=bounds.right);
    if(!drag||drag.id!==event.pointerId)return;if(!sameContext(drag)){finishDrag(true);return;}if(Math.abs(event.clientX-drag.x)>2)drag.moving=true;if(drag.moving){track.setAttribute("data-dragging","");preview(pointerEffort(event));}
  });
  slider.addEventListener("pointerup",event=>{if(drag?.id===event.pointerId)finishDrag();});
  for(const name of ["pointercancel","lostpointercapture"])slider.addEventListener(name,event=>{if(drag?.id===event.pointerId)finishDrag(true);});
  slider.addEventListener("pointerleave",()=>track.removeAttribute("data-thumb-hover"));slider.addEventListener("keydown",()=>finishDrag(true));
  slider.addEventListener("input",()=>{$("#effort").value=levels()[Number(slider.value)];onModel();});slider.addEventListener("change",save);
  $("#effort-reset").addEventListener("click",()=>{finishDrag(true);$("#effort").value=defaultEffort();changed();});
  $("#fast-toggle").addEventListener("click",()=>{fast=!fast;changed();});
  $("#model-options").addEventListener("toggle",()=>{if(!$("#model-options").open){finishDrag(true);track.removeAttribute("data-thumb-hover");resetPicker();}});
  window.addEventListener("blur",()=>finishDrag(true));
  return {render,defaults:()=>({models:[...models.values()],fallback,model:getStatus()?.execution.model||defaults.model||'',effort:getStatus()?.execution.effort||defaults.effort||'medium',fast:false}),
    restoreConversation:value=>{finishDrag(true);$('#model').value=value.model||'';$('#effort').value=value.effort||'';fast=value.fast_mode===true;normalize();render();},
    applyDefaults:value=>{finishDrag(true);$("#model").value=value.model || "";$("#effort").value=value.effort || "";fast=value.fast===true;normalize();changed();},settings:()=>({fast_mode:fast}),restore:()=>{try{const saved=JSON.parse(localStorage.getItem("lazyfish.run.v1"));if(saved&&typeof saved.model==="string"&&/^[a-zA-Z0-9._:/-]{0,120}$/.test(saved.model)&&validEfforts.has(saved.effort)){$("#model").value=saved.model;$("#effort").value=saved.effort;fast=saved.fast===true;}}catch{ /* optional browser preferences */ }render();},
    catalog:value=>{finishDrag(true);defaults=value.defaults || {};for(const item of value.models || [])if(item.id)models.set(item.id,item);normalize();onModel();window.dispatchEvent(new Event("lazyfish-models"));}};
};
