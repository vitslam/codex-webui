"use strict";
window.LazyfishArchives=function({node,icon,t,api,onRestore}) {
  const root=document.querySelector('#data-management');
  let epoch=0,timer=0,rows=[],cursor=null,query='',workspace='',workspaces=[],counts={},language='',loading=false;
  const current=()=>document.querySelector('#account-dialog').open&&document.querySelector('#account-dialog').dataset.page==='dataManagement';
  function name(path){return path.split(/[\\/]/).filter(Boolean).at(-1)||t('archive.noProject');}
  function draw(){
    language=document.documentElement.lang;
    const search=node('label','archive-search'),input=node('input');
    input.type='search';input.id='archive-search';input.placeholder=t('archive.search');input.setAttribute('aria-label',t('archive.search'));input.value=query;
    search.append(icon('search'),input);
    input.addEventListener('input',()=>{query=input.value;clearTimeout(timer);++epoch;timer=setTimeout(()=>load(),180);});
    const filter=node('label','archive-filter'),select=node('select');select.id='archive-workspace';select.setAttribute('aria-label',t('archive.allProjects'));
    const all=node('option','',t('archive.allProjects'));all.value='';select.append(all);
    for(const path of workspaces){const option=node('option','',name(path));option.value=path;option.title=path;select.append(option);}
    select.value=workspace;select.addEventListener('change',()=>{workspace=select.value;clearTimeout(timer);load();});filter.append(icon('folder'),select);
    const controls=node('div','archive-controls');controls.append(search,filter);
    const status=node('p','archive-status');status.setAttribute('role','status');
    const list=node('div','archive-list');list.id='archive-list';
    root.replaceChildren(controls,status,list);
    renderRows();
  }
  function renderRows(){
    const list=root.querySelector('#archive-list');list.replaceChildren();
    const groups=new Map();for(const row of rows){if(!groups.has(row.workspace))groups.set(row.workspace,[]);groups.get(row.workspace).push(row);}
    for(const [path,entries] of groups){
      const group=node('section','archive-group'),header=node('div','archive-group-heading'),title=node('h3');
      title.title=path;title.append(icon('folder'),node('span','',name(path)));
      header.append(title,node('span','archive-count',t('archive.count',{count:counts[path]??entries.length})));group.append(header);
      const card=node('div','archive-card');
      for(const entry of entries){
        const row=node('div','archive-row');row.dataset.id=entry.id;
        const text=node('div','archive-row-text'),date=node('time','',new Date(entry.updated_at).toLocaleString(document.documentElement.lang,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}));date.dateTime=entry.updated_at;
        text.append(node('span','archive-title',entry.title||t('newChat')),date);
        const restore=node('button','archive-restore',t('archive.restore'));restore.type='button';restore.setAttribute('aria-label',t('archive.restoreNamed',{title:entry.title||t('newChat')}));
        restore.addEventListener('click',async()=>{
          restore.disabled=true;
          try{
            await api('/api/conversations/'+entry.id+'/restore',{});
            rows=rows.filter(row=>row.id!==entry.id);if(counts[entry.workspace])counts[entry.workspace]--;renderRows();
            (root.querySelector('.archive-restore')||root.querySelector('#archive-search')).focus({preventScroll:true});
            root.querySelector('.archive-status').textContent=t('archive.restored',{title:entry.title||t('newChat')});
            await onRestore();
          }catch{root.querySelector('.archive-status').textContent=t('requestFailed');restore.disabled=false;}
        });
        row.append(text,restore);card.append(row);
      }
      group.append(card);list.append(group);
    }
    if(!rows.length)list.append(node('p','archive-empty',t(loading?'ui.loading':query||workspace?'archive.noResults':'archive.empty')));
    if(cursor){const more=node('button','account-button archive-more',t('loadMore'));more.type='button';more.disabled=loading;more.addEventListener('click',()=>load(true));list.append(more);}
  }
  async function load(more=false){
    clearTimeout(timer);const request=++epoch;loading=true;
    root.setAttribute('aria-busy','true');root.querySelector('.archive-status').textContent='';
    try{
      const params=new URLSearchParams({limit:'50',q:query});if(workspace)params.set('workspace',workspace);if(more&&cursor)params.set('cursor',cursor);
      const data=await api('/api/conversations/archived?'+params);
      if(request!==epoch||!current())return;
      rows=more?[...rows,...data.conversations]:data.conversations;cursor=data.next_cursor;workspaces=data.workspaces;counts=data.counts;
      const select=root.querySelector('#archive-workspace');
      for(const option of [...select.options].slice(1))option.remove();
      for(const path of workspaces){const option=node('option','',name(path));option.value=path;option.title=path;select.append(option);}
      select.value=workspace;loading=false;renderRows();
    }catch{if(request===epoch&&current()){loading=false;renderRows();root.querySelector('.archive-status').textContent=t('requestFailed');}}
    finally{if(request===epoch){loading=false;root.setAttribute('aria-busy','false');}}
  }
  window.addEventListener('lazyfish-panel',event=>{
    if(event.detail.page==='dataManagement'){query='';workspace='';rows=[];cursor=null;draw();load();}
    else{++epoch;clearTimeout(timer);}
  });
  document.querySelector('#account-dialog').addEventListener('close',()=>{++epoch;clearTimeout(timer);});
  return {render(){if(current()&&language!==document.documentElement.lang){draw();load();}}};
};
