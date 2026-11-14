'use strict';
// Reuse the main composer markup and widgets with isolated IDs and per-side-chat state.
window.LazyfishSideComposer=function({node,icon,t,api,getState,getStatus,preferences,imageNode,onChange,onCompact}){
  const form=document.querySelector('#side-form'),template=document.querySelector('#composer').cloneNode(true),ids=new Map();
  const renamed=id=>({composer:'side-form',prompt:'side-prompt',send:'side-send',cancel:'side-stop','selected-quotes':'side-quotes'}[id]||'side-'+id);
  for(const el of [template,...template.querySelectorAll('[id]')]){ids.set(el.id,renamed(el.id));el.id=renamed(el.id);}
  for(const el of [template,...template.querySelectorAll('*')])for(const name of ['for','aria-controls','aria-labelledby','aria-describedby','href','fill','stroke']){
    const value=el.getAttribute(name);if(value)el.setAttribute(name,value.replace(/url\(#([\w-]+)\)|#([\w-]+)|([\w-]+)/g,(match,url,hash,word)=>url&&ids.has(url)?'url(#'+ids.get(url)+')':hash&&ids.has(hash)?'#'+ids.get(hash):word&&ids.has(word)?ids.get(word):match));
  }
  for(const details of template.querySelectorAll('details'))details.open=false;
  form.className=template.className;form.replaceChildren(...template.childNodes);
  const $=selector=>form.querySelector(selector.replace(/#([\w-]+)/g,(_,id)=>'#'+renamed(id))),prompt=$('#prompt'),drafts=new Map();
  for(const selector of ['#selected-quotes','#selected-skills','#image-previews','#skill-picker'])$(selector).replaceChildren();prompt.value='';
  let currentId=null,generation=0,restoring=false,directoryEdit=null,catalogRequest=null,catalogScope=null;
  const live=s=>getState()===s&&getState()?.chat?.id===currentId;
  function draft(id=getState()?.chat?.id){if(!id)return null;if(!drafts.has(id))drafts.set(id,{id,images:[],skills:[],settings:null,version:0,timer:0,write:Promise.resolve(),uploads:0,catalog:false});return drafts.get(id);}
  const busy=s=>Boolean(s?.pending&&!s.pending.failed||s?.compacting||s?.chat?.jobs.some(job=>['queued','running','cancelling'].includes(job.status)));
  function fail(s,error){if(getState()===s){s.error=error.message;onChange();}}
  function enqueue(s,d){
    clearTimeout(d.timer);d.timer=0;const value={...d.settings},gen=generation;
    d.write=d.write.catch(()=>{}).then(()=>gen===generation?api('/api/conversations/'+d.id+'/settings',{run_settings:value}):undefined).then(()=>{});
    d.write.catch(error=>fail(s,error));return d.write;
  }
  function change(values){const s=getState(),d=draft();if(!s||!d||restoring)return;Object.assign(d.settings,values);d.version++;clearTimeout(d.timer);d.timer=setTimeout(()=>enqueue(s,d),180);onChange();}
  const run=LazyfishRunSettings({node,icon,t,getStatus,getConversation:()=>getState()?.chat,query:$,storageKey:null,notify:false,onModel:()=>run.render(),onChange:change});
  const picker=window.LazyfishUI.skills({document,window,root:form,idPrefix:'side-',node:(tag,text,cls)=>node(tag,cls,text),t,
    request:async(section,options,alive,accept)=>{const id=getState()?.chat?.id;if(!id)throw new Error(t('service_stopping'));try{for(let n=0;n<40&&alive();n++){const value=await api('/api/native/skills?conversation='+id);accept(value);if(!value.refreshing)return value;await new Promise(resolve=>setTimeout(resolve,750));}}catch(error){throw new Error(t(error.message));}},
    getWorkspace:()=>getState()?.chat?.workspace||'',getSelected:()=>draft()?.skills||[],setSelected:value=>{const d=draft();if(d)d.skills=value;},onChange:()=>{const s=getState();if(s)s.text=prompt.value;$('#attachment-settings').open=false;onChange();},onManage:null});picker.bind();
  async function models(s,d){
    const scope=(getStatus()?.metadata_scope||'')+':'+s.chat.workspace;
    if(scope!==catalogScope){catalogScope=scope;catalogRequest=null;}
    if(!catalogRequest){const gen=generation,id=s.chat.id;catalogRequest=(async()=>{let value;for(let n=0;n<40;n++){value=await api('/api/native/models?conversation='+id);if(!value.refreshing||gen!==generation)return value;await new Promise(resolve=>setTimeout(resolve,750));}return value;})().catch(error=>{if(scope===catalogScope)catalogRequest=null;throw error;});}
    const gen=generation;try{const value=await catalogRequest;if(gen!==generation||!live(s)||d!==draft()||!value)return;restoring=true;run.catalog(value);run.restoreConversation(d.settings);restoring=false;onChange();}catch(error){restoring=false;if(live(s))fail(s,error);}
  }
  function switchTo(s){
    const id=s?.chat?.id||null;if(id===currentId)return;
    picker.close();closeMenus();if(directory.open)directory.close();currentId=id;
    if(!id)return;const d=draft(id);if(!d.settings)d.settings={model:null,effort:null,fast_mode:false,permission_mode:null,collaboration_mode:'default',...JSON.parse(s.chat.run_settings||'{}')};
    restoring=true;run.restoreConversation(d.settings);restoring=false;models(s,d);
  }
  function resize(){prompt.style.height='auto';prompt.style.height=Math.min(prompt.scrollHeight,Math.min(260,innerHeight*.3))+'px';}
  function render(){
    const s=getState();form.inert=!s?.chat||s.loading;switchTo(s);const d=draft();if(!s?.chat||!d){$('#send').disabled=true;return;}
    run.render();picker.drawSelection();
    const signature=JSON.stringify(d.images);if($('#image-previews').dataset.signature!==signature){const host=$('#image-previews');host.dataset.signature=signature;host.replaceChildren();for(const image of d.images){const box=node('div','image-preview'),remove=node('button','','×');remove.type='button';remove.setAttribute('aria-label',t('removeImage'));remove.addEventListener('click',()=>{d.images=d.images.filter(i=>i.id!==image.id);onChange();});box.append(imageNode(image),remove);host.append(box);}}
    $('#upload-state').hidden=!d.uploads;$('#upload-state').textContent=t('uploading');
    const active=busy(s);$('#add-image').disabled=active||Boolean(d.uploads);$('#edit-workdir').disabled=active||Boolean(d.uploads);$('#add-skill').disabled=false;
    const permission=d.settings.permission_mode||(getStatus()?.execution.sandbox==='danger-full-access'&&getStatus()?.execution.approval_policy==='never'?'full_access':getStatus()?.execution.sandbox==='read-only'?'read_only':getStatus()?.execution.sandbox==='workspace-write'&&getStatus()?.execution.approval_policy==='on-request'?'ask':null);
    for(const button of form.querySelectorAll('[data-permission]')){button.setAttribute('aria-pressed',String(button.dataset.permission===permission));button.disabled=active;}
    $('#workdir').value=s.chat.workspace;$('#workdir-preview').textContent=s.chat.workspace.split('/').filter(Boolean).pop()||'/';$('#workdir-preview').title=s.chat.workspace;
    const display=preferences.settings();$('#plan-toggle').hidden=!display.showPlan;$('#plan-toggle').setAttribute('aria-pressed',String(d.settings.collaboration_mode==='plan'));$('#plan-toggle').title=t(d.settings.collaboration_mode==='plan'?'ui.switch.to.default.mode':'ui.switch.to.plan.mode');$('#context-settings').hidden=!display.showContext;
    const usage=s.chat.context,valid=Number.isSafeInteger(usage?.used)&&usage.used>=0&&Number.isSafeInteger(usage.window)&&usage.window>0,fresh=!s.chat.native_thread_id&&!s.chat.jobs.length,percent=valid?Math.round(usage.used/usage.window*100):fresh?0:null;
    const detail=percent===null?t('context.pending'):t('context.open',{usage:percent+'%'});$('#context-ring-value').setAttribute('stroke-dasharray',Math.min(percent||0,100)+' 100');$('#context-percent').textContent=percent===null?t('ui.pending.update'):t('context.used',{percent});$('#context-preview').textContent=detail;$('#context-settings summary').setAttribute('aria-label',detail);$('#context-meter').value=Math.min(percent||0,100);
    $('#context-detail').textContent=valid?t('context.details',{used:usage.used.toLocaleString(document.documentElement.lang),window:usage.window.toLocaleString(document.documentElement.lang)}):fresh?t('newContext'):t('contextUnknown');$('#compact-context').disabled=active||Boolean(d.uploads)||!s.chat.native_thread_id;
    resize();
  }
  async function upload(files){
    const s=getState(),d=draft();if(!s?.chat||!d)return;if(busy(s)){fail(s,new Error('supplement_text_only'));return;}
    if(files.length+d.images.length>8){fail(s,new Error('invalid_inputs'));return;}
    const gen=generation;d.uploads++;closeMenus();onChange();
    try{for(const file of files){if(file.size>10*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('invalid_image');const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});const image=await api('/api/attachments',{name:file.name,mime:file.type,data});if(gen!==generation)return;d.images.push(image);}}
    catch(error){if(gen===generation&&getState()?.chat?.id===d.id)fail(s,error);}finally{d.uploads--;if(gen===generation&&getState()?.chat?.id===d.id)onChange();}
  }
  $('#add-image').addEventListener('click',()=>{$('#attachment-settings').open=false;$('#image-input').click();});$('#image-input').addEventListener('change',event=>{upload([...event.target.files]);event.target.value='';});
  prompt.addEventListener('paste',event=>{const files=[...event.clipboardData.files].filter(file=>file.type.startsWith('image/'));if(files.length){event.preventDefault();upload(files);}});
  form.addEventListener('dragover',event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='copy';}});form.addEventListener('drop',event=>{const files=[...event.dataTransfer.files];if(files.length){event.preventDefault();upload(files);}});
  for(const button of form.querySelectorAll('[data-permission]'))button.addEventListener('click',()=>{change({permission_mode:button.dataset.permission});$('#permission-settings').open=false;});
  $('#plan-toggle').addEventListener('click',()=>{change({collaboration_mode:draft().settings.collaboration_mode==='plan'?'default':'plan'});});
  $('#compact-context').addEventListener('click',()=>{$('#context-settings').open=false;onCompact();});
  prompt.addEventListener('keydown',event=>preferences.keydown(event,()=>form.requestSubmit()));
  const menuIds=['#model-options','#permission-settings','#attachment-settings','#context-settings'];
  function closeMenus(){for(const id of menuIds)$(id).open=false;}
  for(const id of menuIds)$(id).addEventListener('toggle',()=>{if($(id).open){for(const other of menuIds)if(other!==id)$(other).open=false;fit($(id));}});
  function fit(details){const panel=details.querySelector('.settings-panel,.permission-panel,.attachment-panel,.context-panel');if(!panel||!details.open)return;const bounds=details.getBoundingClientRect(),width=panel.getBoundingClientRect().width;panel.style.left=Math.max(12,Math.min(innerWidth-width-12,bounds.right-width))-bounds.left+'px';panel.style.right='auto';}
  document.addEventListener('click',event=>{for(const id of menuIds)if(!event.composedPath().includes($(id)))$(id).open=false;});
  form.addEventListener('keydown',event=>{if(event.key!=='Escape'||event.defaultPrevented)return;const open=menuIds.find(id=>$(id).open);if(open){event.preventDefault();event.stopPropagation();$(open).open=false;$(open+' summary').focus();}});
  window.addEventListener('lazyfish-run-settings',onChange);
  window.addEventListener('resize',()=>{resize();for(const id of menuIds)fit($(id));});
  const directory=document.querySelector('#workdir-dialog').cloneNode(true);
  for(const el of [directory,...directory.querySelectorAll('[id]')])el.id='side-'+el.id;
  for(const el of directory.querySelectorAll('[for],[aria-controls],[aria-describedby],[aria-labelledby]'))for(const name of ['for','aria-controls','aria-describedby','aria-labelledby'])if(el.hasAttribute(name))el.setAttribute(name,el.getAttribute(name).split(' ').map(id=>'side-'+id).join(' '));directory.setAttribute('aria-labelledby','side-workdir-heading');document.body.append(directory);
  const dir=selector=>directory.querySelector(selector.replace(/#([\w-]+)/g,(_,id)=>'#side-'+id));
  $('#edit-workdir').addEventListener('click',()=>{const s=getState();directoryEdit={state:s,chat:s.chat,id:s.chat.id,generation};dir('#workdir-input').value=s.chat.workspace;dir('#workdir-error').hidden=true;dir('#workdir-save').disabled=false;closeMenus();directory.showModal();dir('#workdir-input').focus();});
  dir('#workdir-cancel').addEventListener('click',()=>directory.close());directory.addEventListener('close',()=>{directoryEdit=null;});
  dir('#workdir-form').addEventListener('submit',async event=>{event.preventDefault();const edit=directoryEdit;if(!edit||dir('#workdir-save').disabled)return;dir('#workdir-save').disabled=true;try{const result=await api('/api/conversations/'+edit.id+'/settings',{workspace:dir('#workdir-input').value.trim()||getStatus().workspace});if(edit.generation!==generation)return;edit.chat.workspace=result.workspace;const d=draft(edit.id);if(d.skills.length){d.skills=[];fail(edit.state,new Error('skills.workspace.changed'));}if(directoryEdit===edit){picker.close();directory.close();catalogScope=null;models(edit.state,d);onChange();}}catch(error){if(directoryEdit===edit){dir('#workdir-error').textContent=t(error.message);dir('#workdir-error').hidden=false;}}finally{if(directoryEdit===edit)dir('#workdir-save').disabled=false;}});
  return {render,resize,close:()=>{picker.close();closeMenus();if(directory.open)directory.close();},busy:()=>Boolean(draft()?.uploads),hasInputs:()=>Boolean(draft()?.images.length||draft()?.skills.length),hasImages:()=>Boolean(draft()?.images.length),
    snapshot:s=>{const d=draft(s.chat.id);const settings={...d.settings,model:$('#model').value||null,effort:$('#effort').value||null,...run.settings()};if(settings.permission_mode===null)delete settings.permission_mode;return {settings,images:d.images.map(image=>({...image})),inputs:{images:d.images.map(image=>image.id),skills:d.skills.map(skill=>({...skill}))},version:d.version};},
    sent:s=>{const d=draft(s.chat.id);d.images=[];d.skills=[];picker.close();},flush:s=>{const d=draft(s.chat.id);return d.timer?enqueue(s,d):d.write;},
    resave:(s,version)=>{const d=draft(s.chat.id);if(d.version!==version)enqueue(s,d);},
    clear:()=>{generation++;for(const d of drafts.values())clearTimeout(d.timer);drafts.clear();currentId=null;catalogScope=null;catalogRequest=null;picker.close();closeMenus();if(directory.open)directory.close();}};
};
