"use strict";
// Original Lazyfish panel structures with callbacks into the local chat adapter.
window.LazyfishPanels = function({node,icon,t,api,getStatus,getConversation,selectConversation,onModel,refreshStatus,report,closeMenu}) {
  const $=selector=>document.querySelector(selector);
  const run=LazyfishRunSettings({node,icon,t,getStatus,getConversation,onModel});
  const account=$("#account-dialog"), search=$("#search-dialog");
  let page="settings", returnFocus=null, searchFocus=null, epoch=0, timer=0;
  function visible(element) { return element?.isConnected && element.getClientRects().length; }
  function restore(element) { (visible(element) ? element : visible($("#menu-toggle")) ? $("#menu-toggle") : $("#sidebar-toggle")).focus({preventScroll:true}); }
  function closePopovers() { for(const id of ["#model-options","#permission-settings","#attachment-settings","#context-settings"]) $(id).open=false; }
  function selectPage(next,load=true) {
    page=next;
    account.dataset.page=page;
    for(const id of ["settings","diagnostics","installation","data-management"]) $("#"+id).hidden=(id==='data-management'?'dataManagement':id)!==page;
    for(const button of account.querySelectorAll("[data-account-tab]")) {
      const selected=button.dataset.accountTab===page; button.classList.toggle("selected",selected);
      if(selected)button.setAttribute("aria-current","page");else button.removeAttribute("aria-current");
    }
    $("#account-dialog-title").textContent=t(page==='dataManagement'?'archive.heading':page);
    $("#native-page").hidden=["settings","diagnostics","installation","dataManagement"].includes(page);
    $("#account-reload").hidden=["settings","installation"].includes(page);
    if(load&&account.open)window.dispatchEvent(new CustomEvent("lazyfish-panel",{detail:{page}}));
  }
  function open(next) {
    returnFocus=document.activeElement.closest("details")?.querySelector("summary") || document.activeElement; closeMenu(); closePopovers(); selectPage(next,false);
    if(!account.open){
      account.showModal();
      account.querySelector('[data-account-tab="'+page+'"]')?.focus({preventScroll:true});
    }
    window.dispatchEvent(new CustomEvent("lazyfish-panel",{detail:{page}}));
  }
  function render() {
    selectPage(page,false); run.render();
    const status=getStatus(); $("#installation-codex").textContent=status?.codex.version || t("unknown");

  }
  function highlighted(text,query) {
    const root=node("span");if(!query){root.textContent=text;return root;}
    let offset=0,found;const lower=text.toLocaleLowerCase(),needle=query.toLocaleLowerCase();
    while((found=lower.indexOf(needle,offset))!==-1){root.append(document.createTextNode(text.slice(offset,found)),node("mark","",text.slice(found,found+query.length)));offset=found+query.length;}
    root.append(document.createTextNode(text.slice(offset)));return root;
  }
  async function find() {
    const request=++epoch,q=$("#conversation-search").value.trim(),target=$("#search-results");
    target.replaceChildren(node("p","search-loading",t("searching")));
    try {
      const result=await api(`/api/conversations?limit=30&q=${encodeURIComponent(q)}`);
      if(request!==epoch || !search.open)return;
      target.replaceChildren();
      if(!result.conversations.length) {
        const empty=node("div","search-empty");empty.append(icon("search"),node("p","",t("noConversations")));target.append(empty);
      }
      for(const entry of result.conversations) {
        const button=node("button","search-result");button.type="button";button.dataset.id=entry.id;
        const header=node("span","search-result-header");header.append(node("span","search-result-title",entry.title || t("newChat")),node("span","search-result-time",new Date(entry.updated_at).toLocaleDateString()));
        if(q){const title=header.querySelector(".search-result-title");title.replaceChildren(highlighted(entry.title||t("newChat"),q));}
        button.append(header);
        if(entry.snippet){const snippet=node("span","search-result-snippet");snippet.append(highlighted(entry.snippet.replace(/\s+/g," "),q));button.append(snippet);}button.addEventListener("click",async()=>{try{await selectConversation(entry.id);search.close();}catch(error){report(error);}});target.append(button);
      }
      if(result.next_cursor)target.append(node("p","search-limit",t("searchLimit")));
    } catch { if(request===epoch)target.replaceChildren(node("p","search-loading",t("requestFailed"))); }
  }
  for(const button of account.querySelectorAll("[data-account-tab]"))button.addEventListener("click",()=>selectPage(button.dataset.accountTab));
  for(const button of document.querySelectorAll("[data-native-page]"))button.addEventListener("click",()=>open(button.dataset.nativePage));
  $("#settings-toggle").addEventListener("click",()=>open("settings"));
  $("#diagnostics-toggle").addEventListener("click",()=>open("diagnostics"));

  $("#account-close").addEventListener("click",()=>account.close());
  $("#account-reload").addEventListener("click",()=>{if(page==="diagnostics")refreshStatus();else window.dispatchEvent(new CustomEvent("lazyfish-panel",{detail:{page,refresh:true}}));});
  account.addEventListener("close",()=>restore(returnFocus));
  search.addEventListener("close",()=>{++epoch;clearTimeout(timer);restore(searchFocus);});
  for(const dialog of [account,search])dialog.addEventListener("click",event=> {
    const bounds=dialog.getBoundingClientRect();
    if(event.target===dialog&&(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom))dialog.close();
  });
  for(const id of ["#model-options","#permission-settings","#attachment-settings","#context-settings"])$(id).addEventListener("toggle",()=>{
    if($(id).open) {for(const other of ["#model-options","#permission-settings","#attachment-settings","#context-settings"])if(other!==id)$(other).open=false;}

  });
  document.addEventListener("click",event=>{for(const id of ["#model-options","#permission-settings","#attachment-settings","#context-settings"])if(!event.composedPath().includes($(id)))$(id).open=false;});
  document.addEventListener("keydown",event=>{
    if(event.key!=="Escape"||account.open||search.open)return;
    const current=["#model-options","#permission-settings","#attachment-settings","#context-settings"].find(id=>$(id).open);
    if(current){event.preventDefault();event.stopImmediatePropagation();$(current).open=false;$(current+" summary").focus();}
  });
  $("#search-toggle").addEventListener("click",()=>{searchFocus=document.activeElement;closeMenu();closePopovers();search.showModal();$("#conversation-search").value="";$("#conversation-search").focus();find();});
  $("#conversation-search").addEventListener("input",()=>{clearTimeout(timer);++epoch;timer=setTimeout(find,150);});
  $("#conversation-search-form").addEventListener("submit",event=>{event.preventDefault();clearTimeout(timer);find();});
  function viewport() {
    const view=window.visualViewport;
    const adapt=matchMedia('(max-width:760px)').matches&&view&&Math.abs(view.scale-1)<.01;
    document.documentElement.style.setProperty("--viewport-height",`${adapt?view.height:innerHeight}px`);
    document.documentElement.style.setProperty("--viewport-top",`${adapt?view.offsetTop:0}px`);
    $('#chat').classList.toggle('keyboard-open',Boolean(adapt&&document.documentElement.clientHeight-view.height>120));
  }
  window.visualViewport?.addEventListener("resize",viewport);
  window.visualViewport?.addEventListener("scroll",viewport);
  window.addEventListener("resize",viewport); viewport();
  return {render,renderModel:run.render,runSettings:run.settings,restoreRunSettings:run.restore,restoreConversation:run.restoreConversation,runDefaults:run.defaults,applyDefaults:run.applyDefaults,open,addModels:run.catalog,closePopovers,close:()=>{account.close();search.close();closePopovers();}};
};
