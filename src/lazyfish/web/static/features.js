"use strict";
// Original Lazyfish account and composer components, wired to local native APIs.
window.LazyfishFeatures = function({node,icon,t,api,getStatus,getConversation,panels,report,onChange,onCompact,getBusy,preferences,refreshStatus}) {
  const $=s=>document.querySelector(s), drafts=new Map();
  let epoch=0, pending=0, desiredWorkspace="", basics=0,visiblePage=null,authSession=null,authTimer=0,authStarting=false,authPolling=null,authRevision=0;
  const current=()=>getConversation()?.id || "new";
  function draft(id=current()) { if(!drafts.has(id))drafts.set(id,{images:[],skills:[]});return drafts.get(id); }
  function path(section,refresh=false) {return `/api/native/${section}?${getConversation() ? "conversation="+getConversation().id+"&" : ""}${refresh ? "refresh=1" : ""}`;}
  const calendar=window.LazyfishActivity({node:(tag,text,cls)=>node(tag,cls,text),t});
  const note=text=>node("p","account-note",text);
  function button(label,action) {const b=node("button","account-button",label);b.type="button";b.addEventListener("click",action);return b;}
  function loginButton(label,action){const b=button(label,action);b.dataset.nativeLoginAction='';b.disabled=authStarting;return b;}
  function updateLoginButtons(){for(const b of document.querySelectorAll('[data-native-login-action]'))b.disabled=authStarting;}
  function row(label,value) {const el=node("div","account-row");el.append(node("span","account-row-label",label),node("span","account-row-value",value));return el;}
  function heading(label,detail) {const el=node("div","account-section-heading");el.append(node("h3","",label));if(detail)el.append(note(detail));return el;}
  function empty(target,label) {target.append(node("p","account-empty",label));}
  function identity(data) {
    const account=data.account || {},name=account.email || account.type || t("accountUnknown");
    $("#account-name").removeAttribute("data-text");$("#account-name").textContent=name;$("#account-plan").textContent=account.planType || "Codex CLI";$("#account-avatar").textContent=(account.email || "LF").slice(0,2).toUpperCase();
    return {account,name};
  }
  function usageMenu(data) {
    const week=data.windows.find(w=>w.window_minutes===10080);
    $("#usage-remaining").textContent=week ? `${Math.round(week.remaining_percent)}%` : t("quotaNone");
  }
  // Only sanitized quota/activity snapshots persist in this browser, scoped to the native installation/account epoch.
  const snapshots=new Map(),metadataRequests=new Map();let snapshotScope='',cacheGeneration=0;
  const metadataKey=section=>section==='skills'?section+':'+(getConversation()?.workspace||getStatus()?.workspace):section;
  function scopeSnapshots(scope=getStatus()?.metadata_scope){
    if(!scope||scope===snapshotScope)return;
    snapshotScope=scope;snapshots.clear();
    for(const section of ['usage','activity']){
      try{const value=JSON.parse(localStorage.getItem('lazyfish.metadata.v1:'+scope+':'+section));
        if(value&&typeof value==='object'&&value.cache_scope===scope&&
           (section==='usage'?Array.isArray(value.windows)&&value.windows.length<=2&&value.windows.every(w=>Number.isFinite(w.remaining_percent)&&w.remaining_percent>=0&&w.remaining_percent<=100):Array.isArray(value.daily)&&value.daily.length<=366&&value.daily.every(day=>day&&typeof day.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day.date)&&Number.isSafeInteger(day.tokens)&&day.tokens>=0)))snapshots.set(section,value);
      }catch{}
    }
  }
  function saveSnapshot(section,value){
    scopeSnapshots(value.cache_scope);
    if(getStatus())getStatus().metadata_scope=value.cache_scope;
    snapshots.set(metadataKey(section),value);
    if(['usage','activity'].includes(section))try{localStorage.setItem('lazyfish.metadata.v1:'+snapshotScope+':'+section,JSON.stringify(value));}catch{}
  }
  function readMetadata(section,force,onUpdate,alive=()=>true){
    scopeSnapshots();const key=metadataKey(section),generation=cacheGeneration;
    let entry=metadataRequests.get(key);
    if(!entry){
      entry={listeners:new Set()};metadataRequests.set(key,entry);
      const requestPath=path(section,force),nextPath=path(section);
      entry.promise=(async()=>{
        let value=await api(requestPath);
        for(let attempt=0;;attempt++){
          if(generation!==cacheGeneration||!getStatus()||metadataRequests.get(key)!==entry)return;
          saveSnapshot(section,value);
          for(const listener of entry.listeners)if(listener.alive())listener.update(value);
          if(!value.refreshing||attempt>=40)return value;
          await new Promise(resolve=>setTimeout(resolve,750));
          if(generation!==cacheGeneration||!getStatus()||metadataRequests.get(key)!==entry)return;
          value=await api(nextPath);
        }
      })().finally(()=>{if(metadataRequests.get(key)===entry)metadataRequests.delete(key);});
    }
    const listener={update:onUpdate,alive};entry.listeners.add(listener);
    return entry.promise.finally(()=>entry.listeners.delete(listener));
  }
  function forgetSection(section){const key=metadataKey(section);metadataRequests.delete(key);snapshots.delete(key);}
  async function refreshBasics() {
    if(!getStatus())return;scopeSnapshots();
    const request=++basics,alive=()=>request===basics&&Boolean(getStatus());
    if(snapshots.has('usage'))usageMenu(snapshots.get('usage'));
    await Promise.allSettled(['account','usage','models'].map(section=>
      readMetadata(section,false,value=>{if(section==='account')identity(value);else if(section==='usage')usageMenu(value);else panels.addModels(value);},alive)
        .catch(()=>{if(alive()&&section==='usage'&&!snapshots.has('usage'))$("#usage-remaining").textContent=t("quotaNone");})));
  }
  function drawActivity(data){
    const activity=$('#usage-activity');if(!activity)return;
    if(!data){activity.replaceChildren(note(t('ui.loading.usage.history')));return;}
    activity.replaceChildren(heading(t("ui.token.usage")),calendar(data.daily));
    if(data.summary?.lifetimeTokens!=null)activity.append(row(t("ui.lifetime.tokens"),data.summary.lifetimeTokens.toLocaleString(document.documentElement.lang)));
    if(data.summary?.currentStreakDays!=null)activity.append(row(t("ui.current.streak"),t("activity.streak",{count:data.summary.currentStreakDays})));
    if(data.error)activity.append(note(t('ui.update.failed.showing.saved.data')));
    activity.setAttribute('aria-busy',String(Boolean(data.refreshing)));
  }
  function drawPage(page,data){
    const target=$("#native-page"),cwd=getConversation()?.workspace||getStatus()?.workspace;
    target.replaceChildren();
      if(page==="account") {
        const value=identity(data),card=node("div","account-identity"),avatar=node("span","avatar",(value.account.email||"LF").slice(0,2).toUpperCase());card.append(avatar,heading(value.name,value.account.planType || "Codex CLI"));target.append(card,row(t("authentication"),value.account.type || t("accountUnknown")),row(t("workspace"),cwd),note(t("accountHelp")));loginControls(target);
      } else if(page==="usage") {
        usageMenu(data);target.append(heading(t("usage"),t("quotaHelp")));
        if(!data.windows.length)empty(target,t("noQuota"));
        for(const window of data.windows) {
          const duration=window.window_minutes===10080 ? t("weekly") : window.window_minutes===300 ? t("fiveHours") : `${window.window_minutes || "?"} ${t("minutes")}`;
          const card=node("section","quota-card"),meter=node("progress");meter.max=100;meter.value=window.remaining_percent;meter.setAttribute("aria-label",duration);
          card.append(row(duration,`${Math.round(window.remaining_percent)}% ${t("remaining")}`),meter,note(`${t("resets")} ${window.resets_at ? new Date(window.resets_at*1000).toLocaleString(document.documentElement.lang) : t("unknown")}`));target.append(card);
        }
        const activity=node("div");activity.id='usage-activity';target.append(activity);
        drawActivity(snapshots.get('activity'));
      } else if(page==="skills") {
        const toolbar=node("div","account-section-actions");toolbar.append(heading(t("skills"),t("skillsHelp")),button(t("createSkill"),()=>editor()));target.append(toolbar);
        const errors=data.errors||[];
        if(!data.skills.length)empty(target,t(errors.length?'skills.discovery.none_loaded':'noSkills'));
        for(const skill of data.skills) {
          const card=node("section","account-entry"),actions=node("div","skill-entry-actions");
          card.append(node("h4","",skill.name),note(skill.description || ""),note(skill.path));
          actions.append(button(skill.editable ? t("edit") : t("view"),()=>readSkill(skill)),button(t("useSkill"),()=>{addSkill(skill);$("#account-dialog").close();$("#prompt").focus();}));
          actions.lastChild.disabled=skill.enabled===false;
          const toggle=button(t(skill.enabled===false ? "enableSkill" : "disableSkill"),async()=>{toggle.disabled=true;try{await api("/api/skills/enabled",{conversation:getConversation()?.id,path:skill.path,enabled:skill.enabled===false});forgetSection('skills');window.dispatchEvent(new Event("skillschanged"));await showPage("skills",true);}catch(error){report(error);toggle.disabled=false;}});
          actions.append(toggle);card.append(actions);target.append(card);
        }
        if(data.truncated)target.append(note(t('ui.showing.the.first.300.skills')));
        if(errors.length){
          const diagnostics=node('section','skill-discovery-errors');diagnostics.setAttribute('role','status');
          diagnostics.append(heading(t('skills.discovery.heading')));
          for(const error of errors){
            const entry=node('div','account-entry');if(error.path)entry.append(node('p','account-path',error.path));
            entry.append(note(t('skills.discovery.'+error.reason)));diagnostics.append(entry);
          }
          if(data.errors_truncated)diagnostics.append(note(t('skills.discovery.errors_truncated')));
          target.append(diagnostics);
        }
      } else {
        target.append(heading(t("connections"),t("connectionsHelp")));
        if(!data.servers.length)empty(target,t("noConnections"));
        for(const server of data.servers) {
          const card=node("section","account-entry"),details=node("details"),list=node("ul");
          card.append(row(server.name,t("auth."+server.auth_status)),note(`${server.tool_count} ${t("tools")}`));
          details.append(node("summary","",t("viewTools")));for(const name of server.tools)list.append(node("li","",name));details.append(list);card.append(details);
          if(['notLoggedIn','loggedIn'].includes(server.auth_status))card.append(loginButton(t(server.auth_status==='loggedIn'?'ui.authorize.again':'ui.connect.server'),()=>startLogin('mcp',server.name)));target.append(card);
        }
      }
      if(data.error)target.append(note(t('ui.update.failed.showing.saved.data')));
      target.setAttribute('aria-busy',String(Boolean(data.refreshing)));
      drawLogin(target);

  }
  async function showPage(page,refresh=false) {
    visiblePage=page;const request=++epoch,target=$("#native-page");
    if(!["account","usage","skills","connections"].includes(page))return;
    scopeSnapshots();const cached=snapshots.get(metadataKey(page));
    if(cached)drawPage(page,cached);else target.replaceChildren(note(t("ui.loading")));
    const alive=()=>request===epoch&&$("#account-dialog").open;
    const tasks=[restoreLogin(page),readMetadata(page,refresh,data=>drawPage(page,data),alive).catch(error=>{
      if(!alive())return;
      if(error.message==='workspace_missing'){
        target.replaceChildren(note(t('workspace_missing')),button(t('ui.working.directory'),()=>{$('#account-dialog').close();$('#edit-workdir').click();}));return;
      }
      if(snapshots.has(metadataKey(page)))target.append(note(t('ui.update.failed.showing.saved.data')));
      else target.replaceChildren(note(t("native_metadata_unavailable")),button(t("retry"),()=>showPage(page,true)));
    })];
    if(page==='usage')tasks.push(readMetadata('activity',refresh,drawActivity,alive).catch(()=>{
      if(!alive())return;
      const activity=$('#usage-activity');
      if(activity)activity.append(note(t(snapshots.has('activity')?'ui.update.failed.showing.saved.data':'native_metadata_unavailable')));
    }));
    await Promise.allSettled(tasks);
  }
  function loginControls(target){
    const section=node('section','account-auth'),actions=node('div','account-auth-methods');
    section.append(heading(t('login.start')));
    for(const [kind,label] of [['chatgptDeviceCode','login.device'],['chatgpt','login.browser']])actions.append(loginButton(t(label),()=>startLogin(kind)));
    const form=node('form','account-key-form'),label=node('label','',t('login.key.label')),controls=node('div','account-key-controls'),input=node('input');
    input.id='codex-api-key';input.type='password';input.autocomplete='off';input.maxLength=4096;input.required=true;input.placeholder=t('login.key.placeholder');label.htmlFor=input.id;
    const submit=loginButton(t('login.key'),()=>{});submit.type='submit';controls.append(input,submit);form.append(label,controls);
    form.addEventListener('submit',event=>{event.preventDefault();const apiKey=input.value;input.value='';startLogin('apiKey',apiKey);});
    const footer=node('div','account-auth-footer'),logout=loginButton(t('login.logout'),()=>startLogin('logout'));logout.classList.add('account-signout');
    footer.append(note(t('login.help')),logout);section.append(actions,form,footer);target.append(section);
  }
  async function accountChanged(){
    cacheGeneration++;basics++;snapshots.clear();metadataRequests.clear();
    for(const section of ['usage','activity'])try{localStorage.removeItem('lazyfish.metadata.v1:'+snapshotScope+':'+section);}catch{}
    await refreshStatus(true);
    const fresh=getStatus();if(!fresh)return;
    getStatus().metadata_scope=fresh.metadata_scope;snapshotScope='';scopeSnapshots();
    await refreshBasics();
  }
  const loginPending=session=>session&&['starting','pending'].includes(session.state);
  const loginOnPage=session=>session&&((visiblePage==='account'&&session.kind==='account')||(visiblePage==='connections'&&session.kind==='mcp'));
  function loginFeedback(message=''){
    const target=$('#native-page');target.querySelector('.native-login-feedback')?.remove();
    if(message){const feedback=note(message);feedback.classList.add('native-login-feedback');feedback.setAttribute('role','status');target.append(feedback);}
  }
  async function restoreLogin(page){
    if(!['account','connections'].includes(page))return;
    const revision=authRevision;
    try{
      const result=await api('/api/native/sessions');
      if(revision!==authRevision||visiblePage!==page||!getStatus())return;
      const session=result.sessions.find(s=>s.kind===(page==='account'?'account':'mcp'));
      if(session){authSession=session;++authRevision;drawLogin($('#native-page'));pollLogin();}
      else if(loginPending(authSession)&&loginOnPage(authSession))pollLogin();
    }catch{/* The next panel open retries discovery; an existing poll remains active. */}
  }
  async function startLogin(kind,value){
    if(authStarting)return;
    if(loginPending(authSession)&&authSession.kind===(kind==='mcp'?'mcp':'account')&&(kind!=='mcp'||authSession.server===value)){
      loginFeedback();drawLogin($('#native-page'));pollLogin();return;
    }
    authStarting=true;updateLoginButtons();++authRevision;loginFeedback(t('ui.loading'));
    const requestedPage=visiblePage;
    try{
      const session=await api(kind==='mcp'?'/api/native/mcp/login':'/api/native/login',kind==='mcp'?{name:value,conversation:getConversation()?.id}:{type:kind,...kind==='apiKey'?{apiKey:value}:{}});
      if(!getStatus())return;
      authSession=session;++authRevision;
      if(visiblePage===requestedPage)loginFeedback();
      drawLogin($('#native-page'));
      if(session.state==='completed'){
        if(session.kind==='account')await accountChanged();else await refreshBasics();
        if(visiblePage===requestedPage)await showPage(visiblePage,true);
      }else pollLogin();
    }catch(error){if(getStatus()&&visiblePage===requestedPage)loginFeedback(t(error.message));}
    finally{authStarting=false;updateLoginButtons();}
  }
  function drawLogin(target){
    target.querySelector('.native-login-session')?.remove();if(!loginOnPage(authSession))return;
    const session=authSession,box=node('section','native-login-session quota-card');box.dataset.session=session.id;
    box.setAttribute('role','status');box.append(note(t(session.state==='completed'?'login.completed':session.state==='cancelled'?'login.cancelled':session.state==='failed'?'login.failed':'login.pending')));
    if(loginPending(session)){
      const actions=node('div','native-login-actions');
      if(session.url){
        const link=node('a','account-button',t('login.open'));link.href=session.url;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);
        if(session.user_code)box.append(node('p','',t('login.code',{code:session.user_code})));
      }
      const cancel=button(t('login.cancel'),async()=>{
        cancel.disabled=true;++authRevision;
        try{await api(`/api/native/sessions/${session.id}/cancel`,{});if(authSession?.id===session.id){++authRevision;pollLogin();}}
        catch(error){loginFeedback(t(error.message));cancel.disabled=false;}
      });actions.append(cancel);box.append(actions);
    }
    if(session.error&&session.state!=='cancelled')box.append(note(t(session.error)));target.append(box);
  }
  async function pollLogin(){
    if(!authSession||authPolling===authSession.id)return;
    clearTimeout(authTimer);authTimer=0;
    const id=authSession.id,wasPending=loginPending(authSession);authPolling=id;
    try{
      const session=await api(`/api/native/sessions/${id}`);
      if(authSession?.id!==id)return;
      authSession=session;++authRevision;
      if($('#account-dialog').open&&!$('#native-page').hidden)drawLogin($('#native-page'));
      if(loginPending(session))authTimer=setTimeout(pollLogin,750);
      else if(wasPending&&session.state==='completed'){
        const requestedPage=visiblePage;
        if(session.kind==='account')await accountChanged();else await refreshBasics();
        if($('#account-dialog').open&&visiblePage===requestedPage)await showPage(visiblePage,true);
      }
    }catch(error){
      if(authSession?.id!==id)return;
      if(error.message==='not_found'){authSession=null;++authRevision;drawLogin($('#native-page'));}
      else if(getStatus())authTimer=setTimeout(pollLogin,1500);
    }finally{if(authPolling===id)authPolling=null;}
  }
  async function readSkill(skill) {
    const request=++epoch,target=$("#native-page");target.replaceChildren(note(t("ui.loading")));
    try {const data=await api(`/api/skills/document?path=${encodeURIComponent(skill.path)}&${getConversation() ? "conversation="+getConversation().id : ""}`);
      if(request!==epoch)return;
      if(data.editable)editor(data);else target.replaceChildren(heading(data.name,data.description),node("pre","skill-source",data.content),button(t("back"),()=>showPage("skills")));
    }catch(error){if(request===epoch)target.replaceChildren(note(t("skill_unavailable")),button(t("back"),()=>showPage("skills")));}
  }
  function editor(skill=null) {
    if(skill){
      ++epoch;const target=$('#native-page'),form=node('form','skill-editor'),source=node('textarea','skill-source'),feedback=note('');
      source.id='skill-source';source.value=skill.content;source.required=true;source.rows=18;source.spellcheck=false;
      source.setAttribute('aria-label',t('skills.source'));feedback.setAttribute('role','status');
      const save=button(t('save'),()=>{});save.type='submit';save.id='save-skill';const back=button(t('back'),()=>showPage('skills'));
      form.append(heading(t('editSkill'),t('skills.edit.hint')),note(skill.path),source,feedback,back,save);target.replaceChildren(form);source.focus({preventScroll:true});
      form.addEventListener('submit',async event=>{event.preventDefault();save.disabled=back.disabled=true;
        try{await api('/api/skills/source',{conversation:getConversation()?.id,path:skill.path,hash:skill.hash,content:source.value});forgetSection('skills');window.dispatchEvent(new Event('skillschanged'));await showPage('skills',true);}
        catch(error){feedback.textContent=t(error.message);save.disabled=back.disabled=false;}
      });return;
    }
    ++epoch;const target=$("#native-page"),form=node("form","skill-editor"),fields={};
    form.append(heading(skill ? t("editSkill") : t("createSkill"),t("skillSaveHelp")));
    const scope=node('select');scope.id='skill-scope';scope.setAttribute('aria-label',t('skills.scope'));
    for(const value of ['project','user']){const option=node('option','',t('skills.scope.'+value));option.value=value;scope.append(option);}
    scope.value=skill?.scope==='user'?'user':'project';scope.disabled=Boolean(skill);form.append(scope,note(t('skills.scope.hint')));
    let body=skill?.content || "",description=skill?.description || "";
    if(body.startsWith("---\n")){const end=body.indexOf("\n---",4);if(end>=0)body=body.slice(end+4).trim();}
    for(const [key,label,value] of [["name",t("skillName"),skill?.name || ""],["description",t("description"),description],["body",t("instructions"),body]]) {
      const field=node("label","skill-field",label),input=node(key==="body" ? "textarea" : "input",key==="body" ? "skill-source" : "");input.id="skill-"+key;input.value=value;input.required=true;
      if(key==="name"){input.pattern="[a-z0-9][a-z0-9-]{0,63}";input.maxLength=64;input.readOnly=Boolean(skill);}else input.maxLength=key==="body" ? 60000 : 1024;
      field.append(input);form.append(field);fields[key]=input;
    }
    const actions=node("div","skill-editor-actions"),feedback=note("");feedback.setAttribute("role","status");
    const save=button(t("save"),()=>{});save.id="save-skill";save.type="submit";
    actions.append(button(t("cancel"),()=>showPage("skills")),save);form.append(feedback,actions);
    form.addEventListener("submit",async event=>{event.preventDefault();save.disabled=true;
      try {await api("/api/skills",{conversation:getConversation()?.id,name:fields.name.value,description:fields.description.value,body:fields.body.value,replace:Boolean(skill),scope:scope.value});forgetSection('skills');window.dispatchEvent(new Event("skillschanged"));await showPage("skills",true);}
      catch(error){feedback.textContent=t(error.message);save.disabled=false;}
    });target.replaceChildren(form);fields[skill ? "body" : "name"].focus();
  }
  function addSkill(skill) {
    const state=draft();if(state.skills.some(s=>s.path===skill.path))return;
    if(state.skills.length>=12){report(new Error("invalid_inputs"));return;}
    state.skills.push({name:skill.name,path:skill.path});picker.drawSelection();
  }
  const images=window.LazyfishUI.images({document,window,navigator,node:(tag,text,cls)=>node(tag,cls,text),t,report,
    imageNode:(src,name,size={})=>{const img=node("img");img.alt=name || "";img.loading="lazy";img.decoding='async';if(Number.isSafeInteger(size.width)&&size.width>0&&Number.isSafeInteger(size.height)&&size.height>0){img.width=size.width;img.height=size.height;}img.src=src;return img;}});
  function imageNode(image) {
    const img=images.imageNode("/api/attachments/"+image.id,image.name,image);img.tabIndex=0;
    if(image.width&&image.height)img.style.aspectRatio=image.width+' / '+image.height;
    img.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();img.click();}});return img;
  }
  function preview(image) {image.click();}
  function renderImages() {
    const target=$("#image-previews");target.replaceChildren();
    for(const image of draft().images) {
      const box=node("div","image-preview"),img=imageNode(image),remove=node("button","","×");remove.type="button";remove.setAttribute("aria-label",t("removeImage"));
      remove.addEventListener("click",()=>{draft().images=draft().images.filter(i=>i.id!==image.id);renderImages();});box.append(img,remove);target.append(box);
    }
    $("#upload-state").hidden=!pending;$("#upload-state").textContent=t("uploading");
  }
  async function upload(files) {
    const id=current(),state=draft(id);
    if(files.length+state.images.length>8){report(new Error("invalid_inputs"));return;}
    $("#attachment-settings").open=false;picker.close();pending++;renderImages();onChange();
    try {for(const file of files) {
      if(file.size>10*1024*1024||!["image/png","image/jpeg","image/webp"].includes(file.type))throw new Error("invalid_image");
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(",")[1]);reader.onerror=reject;reader.readAsDataURL(file);});
      const image=await api("/api/attachments",{name:file.name,mime:file.type,data});state.images.push(image);
    }}catch(error){report(error);}finally{pending--;renderImages();onChange();}
  }
  function renderContext() {
    const conversation=getConversation(),usage=conversation?.context;
    const valid=Number.isSafeInteger(usage?.used)&&usage.used>=0&&Number.isSafeInteger(usage.window)&&usage.window>0;
    const fresh=!conversation?.native_thread_id&&!conversation?.jobs.length;
    const percent=valid ? Math.round(usage.used/usage.window*100) : fresh ? 0 : null;
    const label=percent==null ? t("ui.pending.update") : t("context.used",{percent});
    const description=percent==null ? t("context.pending") : t("context.open",{usage:percent+"%"});
    $("#context-ring-value").setAttribute("stroke-dasharray",`${Math.min(percent || 0,100)} 100`);
    $("#context-percent").textContent=label;$("#context-preview").textContent=description;$("#context-meter").value=Math.min(percent || 0,100);
    $("#context-settings summary").setAttribute("aria-label",description);
    $("#context-detail").textContent=valid ? t("context.details",{used:usage.used.toLocaleString(document.documentElement.lang),window:usage.window.toLocaleString(document.documentElement.lang)}) : fresh ? t("newContext") : t("contextUnknown");
    $("#compact-context").disabled=!conversation?.native_thread_id||getBusy()||pending>0;
    const settings=$("#context-settings");
    if(settings.open) {
      const panel=settings.querySelector(".context-panel"),anchor=settings.getBoundingClientRect(),width=panel.getBoundingClientRect().width;
      panel.style.left=(Math.max(12,Math.min(innerWidth-width-12,anchor.right-width))-anchor.left)+"px";panel.style.right="auto";
    }
  }
  const picker=window.LazyfishUI.skills({document,window,node:(tag,text,cls)=>node(tag,cls,text),t,request:async()=>{try{return await api(path("skills"));}catch(error){throw new Error(t(error.message));}},getWorkspace:()=>getConversation()?.workspace || getStatus()?.workspace,
    getSelected:()=>draft().skills,setSelected:value=>{draft().skills=value;},onChange:()=>{$("#attachment-settings").open=false;onChange();},onManage:()=>panels.open("skills")});picker.bind();
  $("#add-image").addEventListener("click",()=>{$("#attachment-settings").open=false;$("#image-input").click();});
  $("#image-input").addEventListener("change",event=>{upload([...event.target.files]);event.target.value="";});
  $("#prompt").addEventListener("paste",event=>{const files=[...event.clipboardData.files].filter(f=>f.type.startsWith("image/"));if(files.length){event.preventDefault();upload(files);}});
  const directory=$("#workdir-dialog");let directoryConversation=null;
  $("#edit-workdir").addEventListener("click",()=>{
    directoryConversation=current();$("#workdir-input").value=$("#workdir").value;$("#workdir-error").hidden=true;
    $("#attachment-settings").open=false;directory.showModal();$("#workdir-input").focus();
  });
  $("#workdir-cancel").addEventListener("click",()=>directory.close());
  directory.addEventListener("click",event=>{const r=directory.getBoundingClientRect();if(event.target===directory&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))directory.close();});
  directory.addEventListener("close",()=>$("#attachment-settings summary").focus({preventScroll:true}));
  $("#workdir-form").addEventListener("submit",async event=>{
    event.preventDefault();const value=$("#workdir-input").value.trim()||getStatus()?.workspace;
    $("#workdir-save").disabled=true;
    try {
      if(directoryConversation!==current())throw new Error("requestFailed");
      if(getConversation()){const result=await api(`/api/conversations/${getConversation().id}/settings`,{workspace:value});getConversation().workspace=result.workspace;}
      else {await api("/api/workspace/validate",{workspace:value});desiredWorkspace=value;}
      picker.close();directory.close();render();
    }catch(error){$("#workdir-error").textContent=t(error.message);$("#workdir-error").hidden=false;}
    finally{$("#workdir-save").disabled=false;}
  });
  $("#compact-context").addEventListener("click",()=>{$("#context-settings").open=false;onCompact();});
  $("#plan-toggle").addEventListener("click",()=>{preferences.togglePlan();render();});
  for(const button of document.querySelectorAll("[data-permission]"))button.addEventListener("click",()=>{preferences.permission(button.dataset.permission);$("#permission-settings").open=false;render();});
  $("#composer").addEventListener("dragover",event=>{if(event.dataTransfer.types.includes("Files")){event.preventDefault();event.dataTransfer.dropEffect="copy";}});
  $("#composer").addEventListener("drop",event=>{const files=[...event.dataTransfer.files];if(files.length){event.preventDefault();upload(files);}});
  window.addEventListener("resize",renderContext);window.visualViewport?.addEventListener("resize",renderContext);
  $("#context-settings").addEventListener("toggle",renderContext);
  $("#menu-toggle").addEventListener("click",()=>{if($("#workspace-menu").hidden)refreshBasics();});
  window.addEventListener("lazyfish-panel",event=>showPage(event.detail.page,event.detail.refresh));
  $("#account-dialog").addEventListener("close",()=>{++epoch;});
  function updateBusy(){
    $('#add-image').disabled=getBusy();$('#add-skill').disabled=false;$('#edit-workdir').disabled=getBusy();
    for(const button of document.querySelectorAll('[data-permission]'))button.disabled=getBusy();
  }
  function render() {
    picker.drawSelection();renderImages();renderContext();
    if(document.activeElement!==$("#workdir"))$("#workdir").value=getConversation()?.workspace || desiredWorkspace || preferences.settings().workspace || getStatus()?.workspace || "";
    $("#workdir-preview").textContent=$("#workdir").value.split("/").filter(Boolean).pop()||"/";$("#workdir-preview").title=$("#workdir").value;
    $("#edit-workdir").disabled=getBusy();
    const settings=preferences.settings();$("#plan-toggle").hidden=!settings.showPlan;$("#plan-toggle").setAttribute("aria-pressed",String(settings.plan));$("#plan-toggle").title=t(settings.plan ? "ui.switch.to.default.mode" : "ui.switch.to.plan.mode");
    $("#context-settings").hidden=!settings.showContext;
    for(const button of document.querySelectorAll("[data-permission]")) {button.setAttribute("aria-pressed",String(button.dataset.permission===(settings.permission||(getStatus()?.execution.sandbox==="danger-full-access"&&getStatus()?.execution.approval_policy==="never"?"full_access":getStatus()?.execution.sandbox==="read-only"?"read_only":getStatus()?.execution.sandbox==="workspace-write"&&getStatus()?.execution.approval_policy==="on-request"?"ask":null))));button.disabled=getBusy();}

  }
  return {render,renderContext,updateBusy,refreshBasics,imageNode,nativeImageNode:images.imageNode,preview,workspace:()=>desiredWorkspace || preferences.settings().workspace || getStatus()?.workspace,inputs:()=>({images:draft().images.map(i=>i.id),skills:draft().skills,...preferences.inputs()}),selectedImages:()=>draft().images.slice(),hasImages:()=>draft().images.length,hasInputs:()=>draft().images.length||draft().skills.length,busy:()=>pending>0,
    clear:()=>{cacheGeneration++;snapshots.clear();metadataRequests.clear();snapshotScope="";clearTimeout(authTimer);authSession=null;++authRevision;++epoch;++basics;drafts.clear();picker.close();desiredWorkspace="";$("#account-name").textContent=t("account");$("#account-plan").textContent="Codex CLI";$("#usage-remaining").textContent="";},
    sent:id=>{drafts.delete(id);picker.close();render();},
    move:(from,to)=>{if(drafts.has(from)){drafts.set(to,drafts.get(from));drafts.delete(from);}picker.close();},switch:()=>{picker.close();render();}};
};
