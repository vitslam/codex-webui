"use strict";
// Dialog focus is retained; only keyboard navigation needs the visible focus ring.
const setInputMethod = method => { document.documentElement.dataset.inputMethod = method; };
setInputMethod("pointer");
document.addEventListener("pointerdown", () => setInputMethod("pointer"), true);
document.addEventListener("keydown", event => {
  if (!event.metaKey && !event.ctrlKey && !event.altKey &&
      ["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "].includes(event.key)) setInputMethod("keyboard");
}, true);
const translations = window.LazyfishReferenceI18n;


const $ = (selector) => document.querySelector(selector);


const node = (tag, className = "", text = "") => { const element = document.createElement(tag); element.className = className; element.textContent = text; return element; };
let language = navigator.language.startsWith("zh") ? "zh" : "en";
try { const stored = localStorage.getItem("lazyfish.language"); if (["en","zh"].includes(stored)) language = stored; } catch { /* optional */ }
let initializing = true,restorationFailed=false;
let status = null, conversation = null, conversations = [], sending = false, generation = 0, authenticationEpoch = 0, retry = null;
let loginMessage = "", notice = "", stream = null;
const views = new Map(), drafts = new Map(), branchKeys = new Map(), savedViews = new Map();
let listCursor = null, paging = false, listPaging = false, hintsHeld = false, hintCandidate = null;
let conversationStream=null,syncConnected=false,syncFlight=null,syncAgain=false,syncFailures=0,listSignature='',restoringSettings=false;
let listClickTimer=null;
const pendingSends=new Map(),stoppedJobs=new Map(),settingWrites=new Map(),readReceipts=new Map();
let expandedDetails = new Set();
try { const ids = JSON.parse(localStorage.getItem("lazyfish.details")); if (Array.isArray(ids)) expandedDetails = new Set(ids.filter((id)=>typeof id === "string").slice(-300)); } catch { /* optional */ }
const scroll = LazyfishScroll($("#messages"),$("#transcript"),{onRestore:()=>dock.settlePosition()});


const markdown = LazyfishMarkdown({document,node:(tag,text,cls)=>node(tag,cls,text),copyButton,imageNode:(...args)=>features.nativeImageNode(...args),t:(...args)=>t(...args)}).markdown;
const shortcuts = LazyfishShortcuts({entries:()=>conversations.slice(0,9),current:()=>conversation?.id,
  select:(id)=>loadConversation(id).catch(report),hints:showHints,toggleSidebar,
  enabled:()=>Boolean(status) && !sending && !document.querySelector("dialog[open]")});
$("#shortcut-prefix").value = shortcuts.prefix;




const t = (key,values={}) => {
  let text=translations[language][key] || translations[language].nativeError;
  if(typeof text==='object')text=text[new Intl.PluralRules(language).select(Number(values.count ?? 0))] || text.other;
  return String(text).replace(/\{(\w+)\}/g,(match,name)=>values[name] ?? match);
};
const panels = LazyfishPanels({node,icon,t,api,getStatus:()=>status,getConversation:()=>conversation,getConversations:()=>conversations,
  selectConversation:(id)=>loadConversation(id),onModel:renderModelPreview,
  refreshStatus:()=>refreshStatus(true).catch(report),report,closeMenu});
const preferences=LazyfishPreferences({node,t,panels,shortcuts,api,getStatus:()=>status,onDefaultWorkspace:applyDefaultWorkspace,getConversation:()=>conversation,onChange:()=>{features.render();renderControls();},onDisplayChange:()=>{conversation?.jobs.forEach(renderJob);sideChat.update();},onReset:()=>{language=navigator.language.startsWith("zh")?"zh":"en";appearance.set("system");render();}});
const features = LazyfishFeatures({node,icon,t,api,getStatus:()=>status,getConversation:()=>conversation,panels,report,preferences,refreshStatus,onWorkspaceChange:()=>{if(status)refreshList().catch(report);},getBusy:()=>sending||Boolean(activeJob()),onCompact:()=>compactContext().catch(report),onChange:()=>{resizePrompt();renderControls();}});
const sidebarProjects=LazyfishSidebarProjects({node,icon,t,api,row:conversationRow,getConversation:()=>conversation,redraw:()=>{listSignature="";renderList();}});
const archives=LazyfishArchives({node,icon,t,api,onRestore:()=>refreshList()});
const active = (job) => ["queued","running", "cancelling"].includes(job.status);
const activeJob = () => conversation?.jobs.find(active) || (conversation?.active_job && active(conversation.active_job) ? conversation.active_job : null);

const experience=LazyfishExperience({node,icon,t,api,markdown,copyButton,imageNode:features.nativeImageNode,getConversation:()=>conversation,getBusy:()=>sending||Boolean(activeJob()),showReasoning:()=>preferences.settings().showReasoning===true,onEdit:editJob,onFork:forkJob,onImplement:implementPlan,report,duration,onEditStart:()=>dock.reset(),onUserContentToggle:()=>scroll.pauseFollowing()});
const dock=window.LazyfishUI.composerDock({document,onCollapse:()=>scroll.remember(),onExpand:resizePrompt,onWake:()=>$('#prompt').focus(),onBottom:()=>scroll.bottom(),isFollowing:scroll.following});dock.bind();
const diagnostics=LazyfishDiagnostics({node,icon,t,api,selectConversation:async id=>{const chat=await api('/api/conversations/'+id);if(chat.side_parent_id){await loadConversation(chat.side_parent_id);sideChat.open();}else await loadConversation(id);},connected:()=>syncConnected});
const pinOrder=window.LazyfishUI.sidebarOrder({document,onStart:()=>shortcuts.clear(),onReorder:async ids=>{await api('/api/conversations/reorder',{ids});},onEnd:()=>refreshList().catch(report),report});pinOrder.bind();

const mainQuote=quote=>{if(!features.addQuote(quote))return false;dock.reset(false);$('#prompt').focus({preventScroll:true});resizePrompt();return true;};
const sideChat=LazyfishSideChat({node,icon,t,api,markdown,copyButton,getMain:()=>status&&!initializing&&conversation&&!conversation.side_parent_id?{id:conversation.id,title:conversation.title}:null,onMainQuote:mainQuote,getStatus:()=>status,preferences,imageNode:features.imageNode,prepare:flushChoices,replyLabel,replyMeta,replyStatus,duration,executionDetails:experience.executionDetails});
const textSelection=LazyfishTextSelection({node,t,getContext:source=>source?.closest('#side-chat')?sideChat.selectionContext():status&&!initializing?{id:conversation?.id||'new',epoch:generation}:null,
  onAdd:(quote,context)=>context.side?sideChat.addToMain(quote):mainQuote(quote),onSide:quote=>sideChat.open(quote)});
const sidebarResize=LazyfishSidebarResize({onResize:()=>{sideChat.reflow();resizePrompt();}});

function closeStream() { if (stream) stream.close(); stream = null; }
function unauthenticated() {
  textSelection.hide();sideChat.clear();
  restorationFailed=false;
  authenticationEpoch++;
  scroll.suspend(); shortcuts.clear(); ++generation; closeStream(); status = null; conversation = null; conversations = []; views.clear(); savedViews.clear(); drafts.clear(); retry = null;
  closeConversationStream();sidebarProjects.clear();pendingSends.clear();stoppedJobs.clear();readReceipts.clear();listSignature='';
  for(const value of settingWrites.values())clearTimeout(value.timer);settingWrites.clear();
  $("#messages").querySelectorAll(".turn").forEach((element) => element.remove());
  $("#prompt").value = ""; panels.close(); experience.close(); features.clear(); render();
}
async function api(path, data) {
  const epoch=authenticationEpoch;
  const response = await fetch(path, data === undefined ? {cache:"no-store"} : {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  let result;
  try { result = await response.json(); } catch { throw new Error("requestFailed"); }
  if (response.status === 401 && epoch===authenticationEpoch) { loginMessage = "expired"; unauthenticated(); }
  if (!response.ok) throw new Error(result.error || "requestFailed");
  return result;
}
function runChoices(){return {model:$('#model').value||null,effort:$('#effort').value||null,...panels.runSettings(),permission_mode:preferences.settings().permission||null,collaboration_mode:preferences.inputs().collaboration_mode||'default'};}
function restoreChoices(chat){
  if(!chat)return;const pending=settingWrites.get(chat.id),values=pending?.value||JSON.parse(chat.run_settings||'{}');
  restoringSettings=true;
  try{panels.restoreConversation(values);preferences.restoreConversation(values);}finally{restoringSettings=false;}
}
function scheduleChoices(){
  if(restoringSettings||!status||!conversation)return;
  const id=conversation.id,value=runChoices(),old=settingWrites.get(id);
  clearTimeout(old?.timer);const entry=old||{};entry.value=value;entry.sequence=(entry.sequence||0)+1;entry.dirty=true;
  entry.timer=setTimeout(()=>flushChoices(id).catch(report),180);settingWrites.set(id,entry);
  conversation.run_settings=JSON.stringify(value);
}
async function flushChoices(id=conversation?.id){
  const entry=settingWrites.get(id);if(!entry)return;
  clearTimeout(entry.timer);if(entry.pending){await entry.pending;if(entry.dirty)return flushChoices(id);return;}
  if(!entry.dirty)return;
  const seq=entry.sequence,epoch=authenticationEpoch;entry.dirty=false;
  entry.pending=api('/api/conversations/'+id+'/settings',{run_settings:entry.value}).catch(error=>{entry.dirty=true;throw error;}).finally(()=>{entry.pending=null;});
  await entry.pending;if(epoch!==authenticationEpoch)return;
  if(seq===entry.sequence&&!entry.dirty)settingWrites.delete(id);else return flushChoices(id);
}
window.addEventListener('lazyfish-run-settings',scheduleChoices);
function sidebarStatus(entry){return !['queued','running','cancelling'].includes(entry.status)&&entry.last_job_id&&(entry.read_job_id===entry.last_job_id||readReceipts.get(entry.id)===entry.last_job_id)?null:entry.status;}
async function markRead(){
  if(document.hidden||!conversation)return;
  const entry=conversations.find(c=>c.id===conversation.id),latest=conversation.jobs.at(-1);
  if(entry&&latest&&latest.created_at>=entry.updated_at){entry.last_job_id=latest.id;entry.status=latest.status;entry.updated_at=latest.created_at;}
  const id=entry?.last_job_id||latest?.id,state=entry?.status||latest?.status;
  if(!id||['queued','running','cancelling'].includes(state)||entry?.read_job_id===id||conversation.jobs.some(j=>j.id===id&&active(j)))return;
  readReceipts.set(conversation.id,id);renderList();
  try{await api('/api/conversations/read',{receipts:{[conversation.id]:id}});if(entry)entry.read_job_id=id;}
  catch{/* Keep the optimistic mark; the next foreground sync retries it. */}
}
function closeConversationStream(){conversationStream?.close();conversationStream=null;syncConnected=false;}
function connectConversation(){
  closeConversationStream();if(!conversation||!status)return;
  const id=conversation.id,epoch=generation,source=new EventSource('/api/conversations/'+id+'/events?since='+conversation.revision);conversationStream=source;
  const current=()=>conversationStream===source&&epoch===generation&&conversation?.id===id;
  source.onopen=()=>{if(current())syncConnected=true;};source.onerror=()=>{if(current())syncConnected=false;};
  source.addEventListener('sync',()=>{if(current())refreshCurrent().catch(()=>{});});
  source.addEventListener('gone',()=>{if(current()){newConversation();refreshList().catch(report);}});
}
async function refreshCurrent(force=false){
  if(!conversation||!status||document.querySelector('.message-editor'))return;
  if(syncFlight){syncAgain=true;return syncFlight;}
  const id=conversation.id,epoch=generation;
  syncFlight=(async()=>{
    try{
      const changed=await api('/api/conversations/'+id+'/sync?since='+conversation.revision);
      if(epoch!==generation||conversation?.id!==id)return;
      if(force||changed.changed){
        const snapshot=conversation;savePosition();const bookmark=scroll.read(id);
        const result=await api('/api/conversations/'+id+'?view=summary'+(bookmark&&!bookmark.bottom?'&anchor='+bookmark.job:''));
        if(epoch!==generation||conversation?.id!==id)return;
        drafts.set(id,$('#prompt').value);
        const live=snapshot.jobs.find(active)||snapshot.active_job;
        if(live&&!result.jobs.some(j=>j.id===live.id)&&result.active_job?.id!==live.id){const fresh=await api('/api/jobs/'+live.id);if(epoch!==generation)return;mergeJob(live,fresh);}
        applyConversation(result,bookmark,snapshot,true);
      }
      syncFailures=0;markRead();
    }catch(error){if(epoch===generation){if(error.message==='not_found'){await newConversation();await refreshList();}else if(++syncFailures===3)report(error);}}
  })().finally(()=>{syncFlight=null;if(syncAgain){syncAgain=false;refreshCurrent().catch(()=>{});}});
  return syncFlight;
}
function renderPending(){
  $('#transcript').querySelectorAll('.pending-send').forEach(el=>el.remove());
  for(const [key,record] of pendingSends){
    const accepted=conversation?.jobs.some(j=>j.client_request_id===key||j.id===record.jobId||(j.instructions||[]).some(i=>i.id===record.instructionId));
    if(accepted){pendingSends.delete(key);continue;}
    if(record.conversationId!==(conversation?.id||null))continue;
    const card=node('article','pending-send message user'),bubble=experience.userContent(card,{id:key,content:record.text,quotes:record.inputs.quotes});
    for(const skill of record.inputs.skills||[])bubble.append(node('span','skill-chip',skill.name));
    const images=node('div','image-list');for(const image of record.images||[])images.append(features.imageNode(image));bubble.append(images);card.append(bubble);
    const state=node('div','instruction-delivery',record.state==='failed'?t('send.failed',{error:t(record.error)}):t('ui.sending'));
    if(record.state==='failed'){const retryButton=node('button','send-retry',t('ui.retry.send'));retryButton.type='button';retryButton.disabled=sending;retryButton.addEventListener('click',()=>sendPending(record));state.append(retryButton);}card.append(state);
    $('#transcript').insertBefore(card,$('#newer'));
  }
}
function applyDefaultWorkspace(value) {
  if(!status||!value||typeof value.workspace!=='string'||!Number.isSafeInteger(value.revision)||value.revision<(status.workspace_revision||0))return;
  const before=status.workspace;status.workspace=value.workspace;status.workspace_revision=value.revision;
  if(before!==value.workspace){features.defaultWorkspaceChanged(before,value.workspace);preferences.render();}
}
async function refreshDefaultWorkspace(){
  const epoch=authenticationEpoch,value=await api('/api/workspace/default');
  if(epoch===authenticationEpoch)applyDefaultWorkspace(value);
}
function report(error) { notice = translations[language][error.message] ? error.message : "requestFailed"; renderControls(); }
async function refreshStatus(recheck=false) {
  const epoch=authenticationEpoch;
  if(recheck)await api('/api/environment/check',{});
  const fresh=await api('/api/status');
  if(epoch!==authenticationEpoch||!status)return;
  const prior={workspace:status.workspace,revision:status.workspace_revision};
  status={...fresh,workspace:prior.workspace,workspace_revision:prior.revision};
  applyDefaultWorkspace({workspace:fresh.workspace,revision:fresh.workspace_revision});render();
}
function render() {
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-text]").forEach((element) => { element.textContent = t(element.dataset.text); });
  document.querySelectorAll("[data-label]").forEach((element) => { element.setAttribute("aria-label",t(element.dataset.label)); });
  document.querySelectorAll("[data-title]").forEach(element=>{element.title=t(element.dataset.title);});
  document.querySelectorAll("[data-placeholder]").forEach((element) => { element.placeholder = t(element.dataset.placeholder); });
  $("#language").value = language;
  document.body.classList.toggle("signed-in",Boolean(status));
  renderAppearance();
  $("#login-screen").hidden = initializing || Boolean(status); $("#app").hidden = initializing || !status;
  $("#settings-toggle").hidden = !status;
  $("#logout").hidden = !status || status.web_auth_required === false; $("#diagnostics-toggle").hidden = !status; $("#sidebar-toggle").hidden = !status;
  $("#message").textContent = loginMessage ? t(loginMessage) : "";
  $("#conversation-title").textContent = conversation?.title || "";
  $(".topbar-separator").hidden = !conversation?.title;
  if (status) { renderDiagnostics(); renderList(); conversation?.jobs.forEach(renderJob); }
  document.querySelectorAll(".copy").forEach((button)=>{
    button.title=t(button.dataset.copyFeedback !== undefined ? "copied" : button.dataset.copy);
    button.setAttribute("aria-label",button.title);
  });
  document.querySelectorAll(".branch").forEach((button)=>{button.title=`${t("branch")} · ${t("branchHelp")}`;button.setAttribute("aria-label",t("branch"));});
  panels.render();features.render();preferences.render();archives.render();sideChat.update();
  renderControls();renderPending();
}
function renderDiagnostics() {
  $("#version").textContent = status.version;
  $("#readiness").textContent = t(status.codex.ready && !status.execution.recovery_blocked ? "ready" : "degraded");
  $("#details").replaceChildren();
  for (const [key,value] of [["version",status.version],["codexVersion",status.codex.version || t("unknown")],["workspace",status.workspace],["data_dir",status.data_dir]]) {
    $("#details").append(node("dt","",t(key)),node("dd","",value));
  }
  $("#checks").replaceChildren();
  for (const [key,good] of Object.entries(status.codex.checks)) {
    const row = node("li"); row.append(node("span","",t(key)),node("span",`check-state${good ? "" : " failed"}`,t(good ? "ok" : "fail"))); $("#checks").append(row);
  }
  $("#workspace-label").textContent = status.workspace;
}
function listButton(entry,index,compact=false,onRename=null) {
  const button = node("button",`conversation${conversation?.id === entry.id ? " selected" : ""}${hintCandidate === entry.id ? " preselected" : ""}`);
  button.type = "button"; button.dataset.id = entry.id;
  const activity=sidebarStatus(entry);button.append(node("span",`dot ${activity || ""}`),node("span","conversation-name",entry.title || t("emptyTitle")));
  button.title = `${entry.title || t("emptyTitle")}${activity ? " · "+t(activity) : ""}`;
  const kbd = node("kbd","shortcut-number",`${shortcuts.label()} ${index+1}`);
  kbd.hidden = !hintsHeld || index < 0 || index >= 9; button.append(kbd);
  button.addEventListener("click",event => {clearTimeout(listClickTimer);shortcuts.clear();if(event.detail===0)loadConversation(entry.id).catch(report);else if(event.detail===1&&entry.id!==conversation?.id)listClickTimer=setTimeout(()=>loadConversation(entry.id).catch(report),300);});
  if(onRename)button.addEventListener('dblclick',event=>{event.preventDefault();clearTimeout(listClickTimer);onRename();});
  if (compact) button.setAttribute("aria-pressed",String(hintCandidate === entry.id));
  return button;
}
function conversationRow(entry,index) {
      const row=node("div",`conversation-row${conversation?.id === entry.id ? " active" : ""}`);row.dataset.id=entry.id;
      const button=node("button","conversation-action conversation-pin");button.type="button";button.disabled=sending;
      button.setAttribute("aria-label",t(entry.pinned ? "unpin" : "pin"));button.title=t(entry.pinned ? "unpin" : "pin");button.setAttribute("aria-pressed",String(Boolean(entry.pinned)));button.append(icon("pin"));
      button.addEventListener("click",async()=> {
        button.disabled=true;
        try {const result=await api(`/api/conversations/${entry.id}/settings`,{pinned:!entry.pinned});if(conversation?.id===entry.id)conversation.pinned=result.pinned;await refreshList();$("#conversation-list").querySelector(`.conversation-row[data-id="${entry.id}"]`)?.scrollIntoView({block:"nearest"});}
        catch(error){report(error);}finally{button.disabled=false;}
      });
      const rename=()=>{
        const input=node("input","conversation-rename-input");input.value=entry.title;input.maxLength=100;input.setAttribute("aria-label",t("rename"));
        const original=row.querySelector(".conversation");original.replaceWith(input);input.focus();input.select();let busy=false;
        async function save(){if(busy)return;busy=true;const title=input.value.trim();try{if(title){await api(`/api/conversations/${entry.id}/settings`,{title});entry.title=title;sidebarProjects.update(entry.id,{title});const current=conversations.find(chat=>chat.id===entry.id);if(current)current.title=title;if(conversation?.id===entry.id){conversation.title=title;$("#conversation-title").textContent=title;}}}catch(error){report(error);}finally{input.remove();listSignature='';renderList();}}
        input.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();save();}else if(event.key==="Escape"){event.preventDefault();busy=true;input.remove();listSignature='';renderList();}});input.addEventListener("blur",save);
      };
      const remove=node("button","conversation-action conversation-archive");remove.type="button";remove.title=t("archive.action");remove.setAttribute("aria-label",t("archive.action"));remove.append(icon("archive"));
      remove.disabled=sending||["queued","running","cancelling"].includes(entry.status);
      remove.addEventListener("click",async()=>{remove.disabled=true;
        try{await api(`/api/conversations/${entry.id}/archive`,{});conversations=conversations.filter(c=>c.id!==entry.id);if(conversation?.id===entry.id)await newConversation();else renderList();savedViews.delete(entry.id);readReceipts.delete(entry.id);await refreshList();}catch(error){report(error);remove.disabled=false;}
      });
      row.append(listButton(entry,index,false,rename),button,remove);return row;
}
function groupedList(container,entries,compact=false) {
  container.replaceChildren(); let previous = null,parent=container;
  entries.forEach((entry,index) => {
    const group = entry.pinned ? "pinned" : "recent";
    if (group !== previous) { container.append(node("div",`list-group${previous ? " separated" : ""}`,t(group)));parent=node("div","conversation-group");if(!compact)parent.id=group==="pinned"?"pinned-conversations":"recent-conversations";container.append(parent);previous=group; }
    if (compact) parent.append(listButton(entry,index,true));
    else {
      parent.append(conversationRow(entry,index));
    }
  });
}
function showHints(held,candidate) {
  hintsHeld = held; hintCandidate = candidate;
  $("#conversation-list").querySelectorAll(".conversation").forEach((button,index) => {
    button.classList.toggle("preselected",candidate === button.dataset.id);
    const shortcutIndex=conversations.findIndex(entry=>entry.id===button.dataset.id);
    const kbd = button.querySelector("kbd"); kbd.hidden = !held || shortcutIndex < 0 || shortcutIndex >= 9;
    kbd.textContent = `${shortcuts.label()} ${shortcutIndex+1}`;
  });
  const popup = $("#shortcut-hints");
  const selected = [...$("#conversation-list").querySelectorAll(".conversation")].find((button)=>button.dataset.id === candidate && button.getClientRects().length);
  const bounds = selected?.getBoundingClientRect(), listBounds = $("#conversation-list").getBoundingClientRect();
  popup.hidden = !held || (!document.body.classList.contains("sidebar-hidden") && (!selected || (bounds.top >= listBounds.top && bounds.bottom <= listBounds.bottom)));
  if (!held) popup.replaceChildren();
  if (!popup.hidden) {
    const entries = conversations.slice(0,9);
    if (candidate && !entries.some((entry)=>entry.id === candidate)) { const other = conversations.find((entry)=>entry.id === candidate); if (other) entries.push(other); }
    groupedList(popup,entries,true);
  }
}
function renderList() {
  if($("#conversation-list").dataset.reordering || $("#conversation-list .conversation-rename-input"))return;
  const signature=JSON.stringify([language,conversation?.id,conversation?.workspace,sidebarProjects.version(),conversations.map(c=>[c.id,c.title,c.workspace,c.pinned,c.pin_order,sidebarStatus(c)])]);
  if(signature===listSignature){showHints(hintsHeld,hintCandidate);return;}listSignature=signature;
  const top = $("#conversation-list").scrollTop;
  const focused = document.activeElement?.closest("#conversation-list .conversation")?.dataset.id;
  sidebarProjects.render($("#conversation-list"),conversations);
  $("#conversation-list").scrollTop = top;
  if (focused) [...$("#conversation-list").querySelectorAll(".conversation")].find((button)=>button.dataset.id===focused)?.focus({preventScroll:true});
  $("#more-conversations").hidden = !listCursor || !sidebarProjects.recentOpen(); $("#more-conversations").disabled = listPaging;
  showHints(hintsHeld,hintCandidate);
}
function syncSidebar() {
  sidebarResize.refresh();
  const hidden = document.body.classList.contains("sidebar-hidden");
  $("#sidebar-toggle").setAttribute("aria-expanded",String(!hidden));
  $("#sidebar-backdrop").hidden = hidden || !matchMedia("(max-width:760px)").matches || !status;
  showHints(hintsHeld,hintCandidate);
}
function toggleSidebar() {
  closeMenu(); document.body.classList.toggle("sidebar-hidden");
  try { localStorage.setItem("lazyfish.sidebarHidden",String(document.body.classList.contains("sidebar-hidden"))); } catch { /* optional */ }
  syncSidebar();
}
function closeMenu() { $("#workspace-menu").hidden=true; $("#menu-toggle").setAttribute("aria-expanded","false"); }
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("class","icon"); svg.setAttribute("aria-hidden","true");
  const use = document.createElementNS(svg.namespaceURI,"use"); use.setAttribute("href",`#i-${name}`); svg.append(use); return svg;
}
async function copyText(content) {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(content); return; } catch { /* Try the selection-based fallback. */ }
  }
  const active=document.activeElement,selection=window.getSelection();
  const ranges=selection ? Array.from({length:selection.rangeCount},(_,i)=>selection.getRangeAt(i).cloneRange()) : [];
  const inputSelection=typeof active?.selectionStart === "number" ? [active.selectionStart,active.selectionEnd,active.selectionDirection] : null;
  const area=node("textarea","",content);area.readOnly=true;area.tabIndex=-1;
  area.style.cssText="position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0";
  (active?.closest("dialog[open]") || document.body).append(area);
  try {
    area.focus({preventScroll:true});area.select();
    if (!document.execCommand("copy")) throw new Error("ui.copy.failed");
  } finally {
    area.remove();
    if (active?.isConnected) {
      active.focus({preventScroll:true});
    }
    if (selection) { selection.removeAllRanges();for(const range of ranges)selection.addRange(range); }
    if (inputSelection && active?.isConnected) active.setSelectionRange(...inputSelection);
  }
}
function copyButton(content,label=t("copy")) {
  const button = node("button","copy copy-button"); button.type="button";
  button.dataset.copy = label === t("copyCode") ? "copyCode" : "copy";
  let feedback = 0;
  function showCopied(copied) {
    button.replaceChildren(icon(copied ? "check" : "copy"));
    if (copied) button.dataset.copyFeedback=""; else delete button.dataset.copyFeedback;
    button.title=t(copied ? "copied" : button.dataset.copy); button.setAttribute("aria-label",button.title);
  }
  showCopied(false);
  button.addEventListener("click",async ()=> {
    const version=++feedback;
    try {
      await copyText(typeof content === "function" ? content() : content);
      if (version !== feedback) return;
      if (notice === "ui.could.not.copy.select.the.text.and.copy.it") { notice="";renderControls(); }
      showCopied(true); setTimeout(()=>{if(version===feedback)showCopied(false);},1500);
    } catch {
      if (version !== feedback) return;
      showCopied(false); notice="ui.could.not.copy.select.the.text.and.copy.it"; renderControls();
    }
  }); return button;
}
function renderAppearance() {
  const selection=$("#appearance"); selection.replaceChildren();
  for (const theme of [{id:"system"},...appearance.themes]) {
    const option=node("option","",translations[language][`theme.${theme.id}`] || theme.name || theme.id);
    option.value=theme.id; selection.append(option);
  }
  selection.value=appearance.value;
}
function renderModelPreview() {
  panels.renderModel();
}
function resizePrompt() {
  const prompt=$("#prompt");if(document.querySelector('.message-editor'))return;
  prompt.style.height="auto";
  const viewport=window.visualViewport;
  const height=matchMedia('(max-width:760px)').matches&&viewport&&Math.abs(viewport.scale-1)<.01?viewport.height:innerHeight;
  prompt.style.height=`${Math.min(prompt.scrollHeight,260,height*.3)}px`;
}
function duration(seconds) {
  const value=Math.max(0,Math.floor(seconds));
  return t(value<60?'elapsed.seconds':'elapsed.minutes',{minutes:Math.floor(value/60),seconds:value<60?value:value%60});
}
async function forkJob(job) {
  const source=conversation.id,signature=`${source}:${job.id}`;
  if(!branchKeys.has(signature))branchKeys.set(signature,LazyfishRequestId());
  const result=await api(`/api/conversations/${source}/branch`,{before_job_id:job.id,client_request_id:branchKeys.get(signature),title:`${t('branchTitle')} · ${conversation.title||t('emptyTitle')}`.slice(0,100)});
  await refreshList();await loadConversation(result.id);
}
async function editJob(id,text,key){
  if(sending||activeJob())throw new Error('conversation_busy');
  const source=conversation.id;sending=true;renderControls();
  try{await api(`/api/conversations/${source}/edit`,{before_job_id:id,text,client_request_id:key});await loadConversation(source,true);scroll.bottom();await refreshList();}
  finally{sending=false;renderControls();}
}
async function implementPlan(job){
  if(sending||activeJob())return;
  const source=conversation.id;sending=true;renderControls();
  try{
    const next=await api(`/api/conversations/${source}/turns`,{text:t('plan.implement.prompt'),model:job.model,effort:job.effort,...panels.runSettings(),...preferences.inputs(),collaboration_mode:'default',images:[],skills:[],client_request_id:LazyfishRequestId()});
    if(conversation?.id!==source)return;conversation.jobs.push(next);renderJob(next);subscribe(next);scroll.bottom();await refreshList();
  }finally{sending=false;renderControls();}
}
function renderControls() {
  const job = activeJob();
  $('#composer').dataset.jobStatus=job?.status||'idle';
  const occupied=Boolean(conversation?.jobs.length)||[...pendingSends.values()].some(r=>r.conversationId===(conversation?.id||null));
  $("#empty").hidden = occupied || initializing || restorationFailed;
  $("#chat").classList.toggle("is-empty",!occupied&&!initializing&&!restorationFailed);
  renderModelPreview(); syncSidebar();
  const canSteer=job?.status==='running'&&job?.inputs?.operation!=='compact',showSupplement=canSteer&&Boolean($('#prompt').value.trim()||features.hasQuotes());
  $('#prompt').placeholder=t(canSteer?'ui.add.instructions':'prompt');
  $("#cancel").hidden = !job||showSupplement;
  $("#cancel").disabled = job?.status === "cancelling"||Boolean(stoppedJobs.get(job?.id)?.pending);
  $("#send").hidden = Boolean(job)&&!showSupplement;
  $("#send").setAttribute("aria-label",t(job?"ui.supplementary.instruction":"send"));
  $("#send").disabled = sending || features.busy() || ['queued','cancelling'].includes(job?.status) || !status?.execution.available;
  features.renderContext();features.updateBusy();
  document.querySelectorAll(".implement-plan").forEach(button=>{button.disabled=sending||Boolean(job);});
  $("#new-chat").disabled = false;
  $("#prompt").disabled = false;
  $("#older").hidden = !conversation?.older_cursor; $("#older").disabled = paging;
  $("#newer").hidden = !conversation?.newer_cursor; $("#newer").disabled = paging;
  for(const direction of ['older','newer']){const busy=paging===direction;$('#'+direction).textContent=t(busy?(direction==='older'?'loadingOlder':'loadingNewer'):direction);$('#'+direction).setAttribute('aria-busy',String(busy));}
  $("#latest").hidden = !conversation?.newer_cursor;
  $("#notice").textContent = status?.execution.recovery_blocked ? t("recoveryBlocked") : (notice ? t(notice) : status&&!status.codex.ready?t('codex_unavailable'):"");
  if(status&&!status.codex.ready&&!notice&&!status.execution.recovery_blocked){
    const link=node("a","",t("codexOfficial"));link.href="https://learn.chatgpt.com/docs/codex/cli";link.target="_blank";link.rel="noopener noreferrer";
    $("#notice").append(document.createTextNode(" "),link);
  }
}
function replyModel(job) {
  return [job.model||t('nativeDefaultShort'),job.effort?t('effort.'+job.effort):'',job.inputs?.fast_mode?t('fastMode'):''].filter(Boolean).join(' · ');
}
function replyMeta(job) {
  const meta=node('div','meta reply-footer');
  meta.append(copyButton(()=>job.items.filter(item=>item.kind==='assistant').map(item=>item.text).join('\n\n')),node('span','reply-separator','·'),node('span','reply-model',replyModel(job)));
  experience.appendTokenUsage(meta,job.report?.token_usage);
  meta.hidden=!job.items.some(item=>item.kind==='assistant'&&item.text);
  return meta;
}
function replyStatus(job,host=node('div','message-status')) {
  if(!host.children.length)host.append(node('span','task-status status'),node('span','completed-at'));
  const state=host.querySelector('.task-status');state.textContent=t(job.status);state.dataset.state=job.status;
  host.querySelector('.completed-at').textContent=job.finished_at?new Date(job.finished_at).toLocaleString(language==='zh'?'zh-CN':'en-US'):'';
  return host;
}
function replyLabel() {
  const label=node('div','assistant-label message-role'),avatar=node('span','assistant-avatar');
  avatar.append(icon('terminal'));label.append(avatar,node('span','','Codex'));return label;
}
function renderJob(job) {
  if (!conversation?.jobs.some((entry)=>entry.id === job.id)) return;
  scroll.mutate(()=>renderJobContent(job));
}
function renderJobContent(job) {
  job=visibleJob(job);
  const container = $("#transcript");
  let view = views.get(job.id);
  if (!view) {
    const article = node("article","turn message assistant"); article.dataset.job = job.id;
    const label = replyLabel();
    const elapsed=node("div","elapsed"), footer=node("div","assistant-footer"), meta=replyMeta(job), taskStatus=replyStatus(job);
    footer.append(meta,taskStatus);
    const items = node("div","assistant-items"), approvals = node("div","approvals"), error = node("p","job-error");
    const user = node("div","user-turn message user"), bubble = experience.userContent(user,{id:job.id,content:job.prompt,quotes:job.inputs?.quotes});
    bubble.dataset.anchor = "user";
    for(const skill of job.inputs?.skills || [])bubble.append(node("span","skill-chip",skill.name));
    const images=node("div","image-list");for(const image of job.inputs?.images || []) {const box=node("div","image-preview");if(image.width&&image.height){box.style.width=Math.min(220,200*image.width/image.height)+'px';box.style.aspectRatio=image.width+' / '+image.height;}box.append(features.imageNode(image));images.append(box);}bubble.append(images);
    user.hidden=job.inputs?.operation==="compact";bubble.classList.add("user-content");user.append(bubble);experience.userActions(user,job); article.append(user,label,elapsed,items,approvals,error,footer);
    container.insertBefore(article,$("#newer")); view = {article,label,elapsed,items,approvals,error,footer,itemViews:new Map()}; views.set(job.id,view);
  }
  const signature=JSON.stringify([job.cursor,job.status,language,job.model,job.effort,job.finished_at,Boolean(job.steps_deferred),job.stop_error,preferences.settings().showReasoning===true]);
  if(!active(job)&&view.signature===signature)return;
  view.signature=signature;
  if (!active(job) && !job.finished_at) job.observedFinishedAt=job.observedFinishedAt || Date.now();
  const end=active(job) ? Date.now() : (job.finished_at ? Date.parse(job.finished_at) : job.observedFinishedAt);
  view.elapsed.textContent=`${t(active(job) ? "elapsed" : "duration")} ${duration((end-Date.parse(job.created_at))/1000)}`;
  replyStatus(job,view.footer.querySelector('.message-status'));
  view.footer.querySelector(".reply-model").textContent=replyModel(job);
  view.footer.querySelector(".reply-footer").hidden=!job.items.some((item)=>item.kind === "assistant" && item.text);
  experience.render(view,job);
  renderModelPreview();
  view.approvals.replaceChildren();
  view.error.textContent = job.stop_error?t('stop.retry.help'):job.error_code ? t(job.error_code) : "";
  view.footer.querySelector('.stop-retry')?.remove();
  if(job.stop_error){const retryButton=node('button','stop-retry',t('ui.retry'));retryButton.addEventListener('click',()=>stopJob(conversation.jobs.find(j=>j.id===job.id)));view.footer.append(retryButton);}

}
function applyEvent(job,event) {
  if(event.type==='detail'){const item=job.items.find(i=>i.id===event.id);if(item)item.detail=event.detail;}
  else if(event.type==='report'){job.report=event.report;job.artifacts=event.report.artifacts||job.artifacts;}
  else if(event.type==='question'){job.questions ||= [];if(!job.questions.some(q=>q.id===event.question.id))job.questions.push(event.question);}
  else if(event.type==='question_state'){const q=(job.questions||[]).find(q=>q.id===event.id);if(q)q.state=event.state;}
  else if(event.type==='instruction'){job.instructions ||= [];if(!job.instructions.some(i=>i.id===event.instruction.id))job.instructions.push(event.instruction);}
  else if(event.type==='instruction_state'){const i=(job.instructions||[]).find(i=>i.id===event.id);if(i)i.state=event.state;}
  else   if(event.type==="context"){conversation.context=event.usage;features.renderContext();}
  else if(event.type==="native_thread"){conversation.native_thread_id=event.id;}
  else if (event.type === "delta" || event.type === "item") {
    let item = job.items.find((entry) => entry.id === event.id);
    if (!item) { item = {id:event.id,text:""}; job.items.push(item); }
    item.text = event.type === "delta" ? item.text + event.text : event.text;
    item.kind = event.kind; item.status = event.status;
    if(event.detail)item.detail=event.detail;
  } else if (event.type === "status") {
    job.status = event.status;job.finished_at=event.finished_at||job.finished_at; job.error_code = event.error_code || null;
    if (!active(job)) {
      (job.questions||[]).forEach(q=>{if(["pending","answering"].includes(q.state))q.state="expired";});
      (job.instructions||[]).forEach(i=>{if(i.state==="pending")i.state="failed";});
      job.approvals.forEach((entry) => { if (entry.state === "pending") entry.state = "expired"; });
      job.items.forEach((entry) => { if (entry.status === "running") entry.status = job.status; });
    }
  } else if (event.type === "approval") {
    if (!job.approvals.some((entry) => entry.id === event.id)) job.approvals.push(event);
  } else if (event.type === "approval_state") {
    const approval = job.approvals.find((entry) => entry.id === event.id); if (approval) approval.state = event.state;
  }
}
function subscribe(job) {
  closeStream();
  if (!active(job)) return;
  const connection = new EventSource(`/api/jobs/${job.id}/events?after=${job.cursor}`); stream = connection;
  connection.onopen = () => { $("#connection-state").textContent = ""; };
  connection.onmessage = (message) => {
    if (stream !== connection || Number(message.lastEventId) <= job.cursor) return;
    applyEvent(job,JSON.parse(message.data)); job.cursor = Number(message.lastEventId);
    renderJob(job); renderControls();
    if (!active(job)) { closeStream(); refreshList().catch(report); }
  };
  connection.addEventListener("done",() => { if (stream === connection) closeStream(); });
  connection.onerror = () => {
    if (stream !== connection) return;
    $("#connection-state").textContent = t("reconnecting");
    api("/api/status").catch(() => {}); // Expired login returns to sign-in; network errors keep the stream retryable.
  };
}
function sortConversations(entries) {
  return entries.sort((a,b)=>Number(b.pinned)-Number(a.pinned)||(b.pin_order||0)-(a.pin_order||0)||b.updated_at.localeCompare(a.updated_at)||b.id.localeCompare(a.id));
}
async function refreshList(more=false) {
  if (more && !listCursor) return;
  const result = await api(`/api/conversations${more ? "?cursor="+encodeURIComponent(listCursor) : ""}`);
  applyDefaultWorkspace(result.default_workspace);sidebarProjects.sync(result.projects);
  const merged = new Map((more?conversations:conversations.filter(entry=>!entry.archived)).map((entry)=>[entry.id,entry]));
  if(!more){
    const first=result.conversations.at(-1);
    for(const [id,entry] of merged)if(!first||sortConversations([entry,{...first}])[0].id===entry.id)merged.delete(id);
  }
  for(const id of result.removed_ids||[])merged.delete(id);
  result.conversations.forEach((entry)=>merged.set(entry.id,entry));
  conversations = sortConversations([...merged.values()]);
  if (more || conversations.length <= 50) listCursor = result.next_cursor;
  renderList();
  markRead();
}
function savePosition() {
  if (conversation)scroll.remember();drafts.set(conversation?.id||'new',$("#prompt").value);
}
function cacheView(){
  if(!conversation||document.querySelector('.message-editor'))return;
  savedViews.delete(conversation.id);
  savedViews.set(conversation.id,{conversation,views:new Map(views),composerCollapsed:dock.collapsed});
  while(savedViews.size>6)savedViews.delete(savedViews.keys().next().value);
}
function resetMessages() { dock.reset();scroll.suspend(); closeStream(); views.clear(); $("#transcript").querySelectorAll(".turn").forEach((element)=>element.remove()); $("#connection-state").textContent = ""; }
function mergeJob(old,fresh){
  if(!old)return fresh;
  if(old.cursor>fresh.cursor)return old;
  if(old.cursor===fresh.cursor&&!old.steps_deferred&&fresh.steps_deferred){
    const {items,report,steps_deferred,...rest}=fresh;Object.assign(old,rest);
  }else Object.assign(old,fresh);
  return old;
}
function applyConversation(result,bookmark,previous,background=false,composerCollapsed=null){
  const retain=previous&&previous.history_revision===result.history_revision;
  if(retain){
    const merged=new Map(previous.jobs.map(j=>[j.id,j]));
    for(const job of result.jobs)merged.set(job.id,mergeJob(merged.get(job.id),job));
    const jobs=[...merged.values()].sort((a,b)=>a.history_position-b.history_position);
    const first=result.jobs[0],last=result.jobs.at(-1);
    if(first&&jobs[0].history_position<first.history_position)result.older_cursor=previous.older_cursor;
    if(last&&jobs.at(-1).history_position>last.history_position)result.newer_cursor=previous.newer_cursor;
    result.jobs=jobs;
  }else{
    views.clear();$("#transcript").querySelectorAll('.turn').forEach(el=>el.remove());
  }
  const wanted=new Set(result.jobs.map(j=>j.id));
  for(const [id,view] of views)if(!wanted.has(id)){view.article.remove();views.delete(id);}
  conversation=result;
  for(const job of result.jobs)if(job.context&&(!conversation.context||job.context.updated_at>conversation.context.updated_at))conversation.context=job.context;
  if(!background){notice="";retry=null;restorationFailed=false;paging=false;}
  $("#prompt").value=drafts.get(result.id)||"";resizePrompt();
  history.replaceState(null,"",'?conversation='+result.id);try{localStorage.setItem('lazyfish.activeConversation',result.id);}catch{}shortcuts.visit(result.id);
  if(!background&&matchMedia("(max-width:760px)").matches)document.body.classList.add('sidebar-hidden');
  if(!background)panels.closePopovers();
  if(!background||previous?.run_settings!==result.run_settings)restoreChoices(result);
  features.switch();render();
  for(const job of conversation.jobs)$("#transcript").insertBefore(views.get(job.id).article,$("#newer"));
  if(composerCollapsed!==null)dock.reset(composerCollapsed);
  scroll.activate(result.id,bookmark);
  const job=activeJob();if(job)subscribe(job);
  if(!background)connectConversation();renderPending();markRead();
}
async function loadConversation(id,latest=false,prepared=null) {
  textSelection.hide();
  clearTimeout(listClickTimer);closeConversationStream();
  savePosition();cacheView();const request=++generation;
  let bookmark=latest?null:scroll.read(id),cached=latest?null:savedViews.get(id);
  closeStream();
  if(cached){
    resetMessages();conversation=cached.conversation;
    for(const [key,value] of cached.views){views.set(key,value);$("#transcript").insertBefore(value.article,$("#newer"));}
    savedViews.delete(id);
    applyConversation({...conversation,jobs:[...conversation.jobs]},bookmark,conversation,false,cached.composerCollapsed===true);
  }
  let result;
  const fetchPage=()=>api('/api/conversations/'+id+'?view=summary'+(bookmark&&!bookmark.bottom?'&anchor='+bookmark.job:''));
  try{result=prepared?await prepared:await fetchPage();}
  catch(error){
    if(error.message==='invalid_cursor'){bookmark=null;result=await api('/api/conversations/'+id+'?view=summary');}
    else{if(error.message==='not_found')savedViews.delete(id);throw error;}
  }
  if(request!==generation||!status)return;
  const previous=cached?conversation:null,oldLive=previous?.jobs.find(active)||previous?.active_job;
  if(oldLive&&!result.jobs.some(j=>j.id===oldLive.id)&&result.active_job?.id!==oldLive.id){
    const finished=await api('/api/jobs/'+oldLive.id);
    if(request!==generation||!status)return;
    const old=previous.jobs.find(j=>j.id===finished.id);
    if(old)mergeJob(old,finished);else result.active_job=finished;
  }
  if(!cached)resetMessages();
  applyConversation(result,bookmark,previous);
}
async function pageHistory(direction) {
  if (paging || !conversation?.[`${direction}_cursor`]) return;
  const id = conversation.id, request = generation; paging = direction; renderControls();
  try {
    const parameter = direction === "older" ? "before" : "after";
    const result = await api(`/api/conversations/${id}?view=summary&${parameter}=${conversation[`${direction}_cursor`]}`);
    if (request !== generation) return;
    scroll.mutate(()=> {
      const merged = new Map(conversation.jobs.map((job)=>[job.id,job]));
      if (conversation.active_job) merged.set(conversation.active_job.id,conversation.active_job);
      const jobs = direction === "older" ? [...result.jobs,...conversation.jobs] : [...conversation.jobs,...result.jobs];
      conversation.jobs = jobs.filter((job,index)=>jobs.findIndex((entry)=>entry.id === job.id)===index).map((job)=>merged.get(job.id)||job);
      if (conversation.jobs.some((job)=>job.id === conversation.active_job?.id)) conversation.active_job = null;
      conversation[`${direction}_cursor`] = result[`${direction}_cursor`];
      conversation.jobs.forEach(renderJobContent);
      for (const job of conversation.jobs) $("#transcript").insertBefore(views.get(job.id).article,$("#newer"));
      renderControls();
    });
  } catch (error) { report(error); } finally { if (request === generation) { paging=false; renderControls(); } }
}
async function newConversation() {
  textSelection.hide();
  savePosition();cacheView();++generation;closeConversationStream();resetMessages();conversation=null;notice='';restorationFailed=false;
  try{localStorage.removeItem('lazyfish.activeConversation');}catch{}
  history.replaceState(null,'','/');preferences.applyDefaults();$('#prompt').value=drafts.get('new')||'';resizePrompt();panels.closePopovers();features.switch();render();renderPending();$('#prompt').focus({preventScroll:true});refreshDefaultWorkspace().catch(report);
}
async function authenticate() {
  const epoch=++authenticationEpoch;
  let requested=new URL(location.href).searchParams.get("conversation");
  if(!requested)try{requested=localStorage.getItem('lazyfish.activeConversation');}catch{}
  const target=requested&&/^[a-f0-9]{32}$/.test(requested)?requested:null;
  const listed=api('/api/conversations');listed.catch(()=>{});
  const bookmark=target?scroll.read(target):null;
  const prepared=target?api('/api/conversations/'+target+'?view=summary'+(bookmark&&!bookmark.bottom?'&anchor='+bookmark.job:'')):null;prepared?.catch(()=>{});
  const verified=await api('/api/status');if(epoch!==authenticationEpoch)return;
  status=verified;loginMessage="";notice="";
  $("#model").value=status.execution.model||"";$("#effort").value=status.execution.effort||"";
  panels.restoreRunSettings();render();features.refreshBasics();
  const listDone=listed.then(result=>{if(epoch!==authenticationEpoch)return;applyDefaultWorkspace(result.default_workspace);sidebarProjects.sync(result.projects);conversations=sortConversations(result.conversations);listCursor=result.next_cursor;renderList();});
  listDone.catch(()=>{});
  if(target){try{await loadConversation(target,false,prepared);}catch(error){if(error.message==='not_found')await newConversation();else throw error;}}
  else{await listDone;preferences.applyDefaults();}
  await listDone;
}
$("#language").addEventListener("change",(event) => { language = event.target.value; try { localStorage.setItem("lazyfish.language",language); } catch { /* optional */ } render(); });
$("#sidebar-toggle").addEventListener("click",toggleSidebar);
$("#login").addEventListener("submit",async (event) => {
  event.preventDefault(); const button = event.submitter || $("#login button");
  if(button.disabled)return;
  button.disabled = true;
  initializing=true;restorationFailed=false;render();
  let accepted = false;
  try { await api("/api/session",{token:$("#token").value.trim()}); accepted = true; $("#token").value = ""; await authenticate(); }
  catch (error) {
    if(status){restorationFailed=true;notice='restoreFailed';render();}
    else {loginMessage = accepted && error.message === "authentication_required" ? "sessionMissing" : translations[language][error.message] ? error.message : "error"; render();}
  } finally { button.disabled = false;initializing=false;render(); }
});
$("#logout").addEventListener("click",async () => { try { await api("/api/logout",{}); loginMessage = ""; unauthenticated(); } catch (error) { report(error); } });
$("#new-chat").addEventListener("click",() => newConversation().catch(report));
async function sendPending(record){
  if(sending)return;sending=true;record.state='sending';record.error=null;notice='';
  renderPending();renderControls();scroll.bottom();
  try{
    if(!record.conversationId){
      const created=await api('/api/conversations',{workspace:record.workspace,run_settings:record.settings,client_request_id:record.key});record.conversationId=created.id;
      if(!conversation&&generation===record.epoch){
        conversation={...created,jobs:[],active_job:null,history_revision:0};history.replaceState(null,'','?conversation='+created.id);
        try{localStorage.setItem('lazyfish.activeConversation',created.id);}catch{}
        shortcuts.visit(created.id);scroll.activate(created.id,null);connectConversation();render();renderPending();
      }
    }
    await flushChoices(record.conversationId);
    if(record.targetJob){
      const instruction=await api('/api/jobs/'+record.targetJob+'/instructions',{text:record.text,skills:record.inputs.skills,quotes:record.inputs.quotes,client_request_id:record.key});record.instructionId=instruction.id;
      if(conversation?.id===record.conversationId){const job=conversation.jobs.find(j=>j.id===record.targetJob);if(job){job.instructions||=[];if(!job.instructions.some(i=>i.id===instruction.id))job.instructions.push(instruction);renderJob(job);}}
    }else{
      const settings={...record.settings};if(settings.permission_mode===null)delete settings.permission_mode;
      const job=await api('/api/conversations/'+record.conversationId+'/turns',{text:record.text,...settings,...record.inputs,client_request_id:record.key});record.jobId=job.id;
      if(conversation?.id===record.conversationId){
        conversation.native_thread_id=job.native_thread_id||conversation.native_thread_id;
        if(!conversation.jobs.some(j=>j.id===job.id))conversation.jobs.push(job);
        render();scroll.bottom();renderJob(job);subscribe(job);
      }
    }
    pendingSends.delete(record.key);
    // A sidebar/history read failure cannot turn an accepted message into a failed send.
    refreshList().catch(()=>{});refreshCurrent().catch(()=>{});
  }catch(error){
    const accepted=conversation?.id===record.conversationId&&conversation.jobs.some(j=>j.client_request_id===record.key);
    if(accepted)pendingSends.delete(record.key);
    else{record.state='failed';record.error=translations[language][error.message]?error.message:'requestFailed';}
  }finally{sending=false;renderPending();renderControls();renderList();}
}
$('#composer').addEventListener('submit',event=>{
  event.preventDefault();const running=activeJob();
  if(sending||features.busy()||running&&(running.status!=='running'||!$('#prompt').value.trim()&&!features.hasQuotes())||(!$('#prompt').value.trim()&&!features.hasInputs()))return;
  if(running&&features.hasImages()){report(new Error('supplement_text_only'));return;}
  const record={key:LazyfishRequestId(),epoch:generation,conversationId:conversation?.id||null,targetJob:running?.id,
    text:$('#prompt').value,inputs:{...features.inputs(),...panels.runSettings()},settings:runChoices(),workspace:features.newWorkspace(),images:features.selectedImages(),state:'sending'};
  pendingSends.set(record.key,record);$('#prompt').value='';drafts.delete(conversation?.id||'new');features.sent(conversation?.id||'new');resizePrompt();dock.reset();sendPending(record);
});
$("#prompt").addEventListener("keydown",event=>preferences.keydown(event,()=>$("#composer").requestSubmit()));
async function compactContext() {
  if(!conversation?.native_thread_id||sending||activeJob())return;
  const id=conversation.id;sending=true;renderControls();
  try {
    const job=await api(`/api/conversations/${id}/compact`,{client_request_id:LazyfishRequestId()});
    if(conversation?.id!==id)return;
    conversation.jobs.push(job);renderJob(job);subscribe(job);scroll.bottom();
  }finally{sending=false;renderControls();}
}
function visibleJob(job){const stopped=stoppedJobs.get(job.id);if(!stopped)return job;if(!active(job)&&job.status!=='cancelled'){stoppedJobs.delete(job.id);return job;}return {...stopped.snapshot,status:'cancelled',finished_at:stopped.at,stop_error:stopped.error,local_stopped:true,approvals:[]};}
async function stopJob(job){
  if(!job||stoppedJobs.get(job.id)?.pending)return;
  const record=stoppedJobs.get(job.id)||{snapshot:JSON.parse(JSON.stringify(job)),at:new Date().toISOString()};record.pending=true;record.error=null;stoppedJobs.set(job.id,record);renderJob(job);renderControls();
  try{const result=await api('/api/jobs/'+job.id+'/cancel',{});if(result.cursor>=job.cursor)Object.assign(job,result);}
  catch(error){record.error=error.message;}
  finally{record.pending=false;renderJob(job);renderControls();}
}
$('#cancel').addEventListener('click',()=>stopJob(activeJob()));
setInterval(() => { if (status && activeJob()) renderJob(activeJob()); },1000);
setInterval(() => { if (status && !sending) refreshList().catch(() => {}); },5000);
setInterval(()=>{if(status&&conversation&&!syncConnected)refreshCurrent().catch(()=>{});},2000);
window.addEventListener('pagehide',()=>{closeStream();closeConversationStream();for(const [id,value] of settingWrites)if(value.dirty)fetch('/api/conversations/'+id+'/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_settings:value.value}),keepalive:true}).catch(()=>{});});
window.addEventListener('pageshow',event=>{if(event.persisted&&status){connectConversation();const job=activeJob();if(job)subscribe(job);refreshCurrent(true).catch(()=>{});refreshList().catch(()=>{});}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&status){markRead();refreshCurrent().catch(()=>{});}});
$('#messages').addEventListener('scroll',()=>{if(conversation?.older_cursor&&!paging&&$('#messages').scrollTop<100&&!document.querySelector('.message-editor'))pageHistory('older');},{passive:true});
if (matchMedia("(max-width:760px)").matches) document.body.classList.add("sidebar-hidden");
matchMedia("(max-width:760px)").addEventListener("change",(event) => { if (event.matches) document.body.classList.add("sidebar-hidden"); syncSidebar(); });
try { if (localStorage.getItem("lazyfish.sidebarHidden") === "true") document.body.classList.add("sidebar-hidden"); } catch { /* optional */ }
render(); authenticate().catch(error => {if(status){restorationFailed=true;notice='restoreFailed';}else if(error.message!=='authentication_required')loginMessage='error';}).finally(() => { initializing = false; render(); });

$("#more-conversations").addEventListener("click",async ()=> {
  if (listPaging) return; listPaging = true; renderList();
  try { await refreshList(true); } catch (error) { report(error); } finally { listPaging=false; renderList(); }
});
$("#older").addEventListener("click",()=>pageHistory("older"));
$("#newer").addEventListener("click",()=>pageHistory("newer"));
$("#latest").addEventListener("click",()=>loadConversation(conversation.id,true).catch(report));
$("#shortcut-prefix").addEventListener("change",(event)=>shortcuts.set(event.target.value));
$("#menu-toggle").addEventListener("click",()=> {
  const open=$("#workspace-menu").hidden;
  $("#workspace-menu").hidden=!open; $("#menu-toggle").setAttribute("aria-expanded",String(open));
});
document.addEventListener("click",(event)=>{if (!event.target.closest(".sidebar-bottom")) closeMenu();});
document.addEventListener("keydown",(event)=> {
  if (event.key === "Escape") {
    if (!$("#workspace-menu").hidden) { closeMenu(); $("#menu-toggle").focus(); }
    else if (matchMedia("(max-width:760px)").matches && !document.querySelector("dialog[open]")) { document.body.classList.add("sidebar-hidden"); syncSidebar(); }
  }
});
for (const id of ["#sidebar-close","#sidebar-backdrop"]) $(id).addEventListener("click",()=>{document.body.classList.add("sidebar-hidden");syncSidebar();});
$("#appearance").addEventListener("change",(event)=>appearance.set(event.target.value));
$("#theme-toggle").addEventListener("click",()=>appearance.toggle());
appearance.subscribe(()=>{renderAppearance();});
$("#model").addEventListener("input",renderModelPreview);
$("#effort").addEventListener("change",renderModelPreview);
for(const id of ['#effort','#model'])$(id).addEventListener('change',scheduleChoices);
$("#prompt").addEventListener("input",resizePrompt);
window.addEventListener('resize',resizePrompt);window.visualViewport?.addEventListener('resize',resizePrompt);
$('#prompt').addEventListener('input',renderControls);
// Preserve native long-press/selection/pinch gestures; intercept only an unfocused short tap.
let promptTap=null;
$('#prompt').addEventListener('touchstart',event=>{const touch=event.touches[0];promptTap=event.touches.length===1&&document.activeElement!==$('#prompt')?{id:touch.identifier,x:touch.clientX,y:touch.clientY,time:Date.now()}:null;},{passive:true});
$('#prompt').addEventListener('touchmove',event=>{const touch=event.touches[0];if(promptTap&&(event.touches.length!==1||Math.hypot(touch.clientX-promptTap.x,touch.clientY-promptTap.y)>10))promptTap=null;},{passive:true});
$('#prompt').addEventListener('touchcancel',()=>{promptTap=null;},{passive:true});
$('#prompt').addEventListener('touchend',event=>{const tap=promptTap;promptTap=null;if(!tap||event.touches.length||!event.cancelable||Date.now()-tap.time>500||document.activeElement===$('#prompt')||![...event.changedTouches].some(touch=>touch.identifier===tap.id))return;event.preventDefault();$('#prompt').focus({preventScroll:true});},{passive:false});
