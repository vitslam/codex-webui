'use strict';
// Group by each chat's saved directory; only disclosure preferences stay in the browser.
window.LazyfishSidebarProjects=function({node,icon,t,api,row,getConversation,redraw}){
  const key='lazyfish.sidebar.groups.v1',groups=new Map();let projects=[],epoch=0,version=0;
  let preferences={recent:false,projects:true,paths:{}};
  try{const saved=JSON.parse(localStorage.getItem(key));if(saved&&typeof saved==='object')preferences={recent:saved.recent===true,projects:saved.projects!==false,paths:saved.paths&&typeof saved.paths==='object'?saved.paths:{}};}catch{}
  function save(){try{preferences.paths=Object.fromEntries(Object.entries(preferences.paths).slice(-200));localStorage.setItem(key,JSON.stringify(preferences));}catch{}}
  const name=path=>path.split(/[\\/]/).filter(Boolean).at(-1)||path||t('archive.noProject');
  function parentLabel(path){
    const parts=path.split(/[\\/]/).filter(Boolean).slice(0,-1),others=projects.filter(p=>p.workspace!==path&&name(p.workspace)===name(path));
    for(let depth=1;depth<=parts.length;depth++){
      const tail=parts.slice(-depth).join('/');
      if(!others.some(p=>p.workspace.split(/[\\/]/).filter(Boolean).slice(0,-1).slice(-depth).join('/')===tail))return tail;
    }
    return parts.join('/')||'/';
  }
  const compare=(a,b)=>b.pinned-a.pinned||b.pin_order-a.pin_order||b.updated_at.localeCompare(a.updated_at)||b.id.localeCompare(a.id);
  function state(path){if(!groups.has(path))groups.set(path,{rows:[],cursor:null,loaded:false,loading:false,error:false,request:0});return groups.get(path);}
  function open(path){return Object.hasOwn(preferences.paths,path)?preferences.paths[path]===true:path===(getConversation()?.workspace||projects[0]?.workspace);}
  async function load(path,more=false){
    const current=state(path);if(current.loading||more&&!current.cursor)return;
    const feedback=more||!current.loaded||current.error,before=JSON.stringify([current.rows,current.cursor,current.error]);
    current.loading=true;current.error=false;const request=++current.request,revision=epoch;if(feedback)redraw();
    try{
      const limit=more?10:Math.min(100,Math.max(10,current.rows.length)),query=new URLSearchParams({workspace:path,limit:String(limit)});if(more)query.set('cursor',current.cursor);
      const result=await api('/api/conversations?'+query);
      if(revision!==epoch||request!==current.request||!groups.has(path))return;
      const boundary=result.conversations.at(-1);
      const keep=more?current.rows:current.rows.length>limit&&boundary?current.rows.filter(entry=>compare(entry,boundary)>0):[];
      const removed=new Set(result.removed_ids||[]),rows=new Map(keep.filter(entry=>!removed.has(entry.id)).map(entry=>[entry.id,entry]));
      result.conversations.forEach(entry=>rows.set(entry.id,entry));
      current.rows=[...rows.values()].sort(compare);
      if(more||current.rows.length<=limit)current.cursor=result.next_cursor;current.loaded=true;
    }catch{if(revision===epoch&&request===current.request)current.error=true;}
    finally{if(revision===epoch&&request===current.request){current.loading=false;if(feedback||before!==JSON.stringify([current.rows,current.cursor,current.error]))redraw();}}
  }
  function disclosure(title,className,expanded,toggle){
    const section=node('section',className),button=node('button','sidebar-disclosure');button.type='button';button.setAttribute('aria-expanded',String(expanded));
    button.append(node('span','',title),icon('chevron'));button.addEventListener('click',toggle);section.append(button);return section;
  }
  function render(container,entries){
    const focused=document.activeElement,focusPath=focused?.closest('.sidebar-project')?.dataset.workspace;
    const focusToggle=focused?.classList.contains('sidebar-project-toggle'),focusMore=focused?.classList.contains('sidebar-project-more');
    const focusSection=focused?.classList.contains('sidebar-disclosure')?focused.parentElement.id:null;
    container.replaceChildren();
    const pinned=entries.filter(entry=>entry.pinned);
    if(pinned.length){container.append(node('div','list-group',t('pinned')));const list=node('div','conversation-group');list.id='pinned-conversations';pinned.forEach(entry=>list.append(row(entry,entries.findIndex(c=>c.id===entry.id))));container.append(list);}
    const projectSection=disclosure(t('sidebar.projects'),'sidebar-projects',preferences.projects,()=>{preferences.projects=!preferences.projects;save();redraw();});
    projectSection.id='sidebar-projects';container.append(projectSection);
    if(preferences.projects){
      if(!projects.length)projectSection.append(node('p','sidebar-project-empty',t('sidebar.noProjects')));
      const names=new Map();for(const project of projects)names.set(name(project.workspace),(names.get(name(project.workspace))||0)+1);
      for(const project of projects){
        const path=project.workspace,current=state(path),expanded=open(path);
        const group=node('section','sidebar-project');group.dataset.workspace=path;
        const button=node('button','sidebar-project-toggle');button.type='button';button.title=path;button.setAttribute('aria-expanded',String(expanded));
        const title=node('span','sidebar-project-name',name(path));
        if(names.get(name(path))>1)title.append(node('small','sidebar-project-path',parentLabel(path)));
        button.append(icon('folder'),title,node('span','sidebar-project-count',String(project.count)),icon('chevron'));
        button.addEventListener('click',()=>{preferences.paths[path]=!open(path);save();redraw();});group.append(button);
        if(expanded){
          const list=node('div','conversation-group sidebar-project-chats');
          const active=getConversation(),visible=current.rows.slice();
          if(active?.workspace===path&&!visible.some(entry=>entry.id===active.id)){
            const latest=active.active_job||active.jobs?.at(-1);visible.unshift({...active,status:latest?.status,last_job_id:latest?.id});
          }
          for(const entry of visible)list.append(row(entry,entries.findIndex(c=>c.id===entry.id)));group.append(list);
          if(current.error){const retry=node('button','sidebar-project-more',t('sidebar.projectFailed')+' '+t('ui.retry'));retry.type='button';retry.addEventListener('click',()=>load(path));group.append(retry);}
          else if(current.loading&&!current.rows.length)group.append(node('p','sidebar-project-empty',t('sidebar.projectLoading')));
          if(current.cursor){const more=node('button','sidebar-project-more',t(current.loading?'sidebar.projectLoading':'sidebar.projectMore'));more.type='button';more.disabled=current.loading;more.addEventListener('click',()=>load(path,true));group.append(more);}
          if(!current.loaded&&!current.loading&&!current.error)queueMicrotask(()=>{if(open(path))load(path);});
        }
        projectSection.append(group);
      }
    }
    const recent=disclosure(t('recent'),'sidebar-recent',preferences.recent,()=>{preferences.recent=!preferences.recent;save();redraw();});recent.id='sidebar-recent';container.append(recent);
    if(preferences.recent){const list=node('div','conversation-group');list.id='recent-conversations';entries.filter(entry=>!entry.pinned).forEach(entry=>list.append(row(entry,entries.findIndex(c=>c.id===entry.id))));recent.append(list);}
    if(focusSection)container.querySelector('#'+focusSection+'>.sidebar-disclosure')?.focus({preventScroll:true});
    if(focusPath&&(focusToggle||focusMore)){
      const group=[...container.querySelectorAll('.sidebar-project')].find(el=>el.dataset.workspace===focusPath);
      (focusMore?group?.querySelector('.sidebar-project-more')||group?.querySelector('.sidebar-project-toggle'):group?.querySelector('.sidebar-project-toggle'))?.focus({preventScroll:true});
    }
  }
  return {render,recentOpen:()=>preferences.recent,version:()=>version,
    sync(values){if(!Array.isArray(values))return;if(JSON.stringify(projects)!==JSON.stringify(values))++version;projects=values;const paths=new Set(projects.map(p=>p.workspace));for(const path of groups.keys())if(!paths.has(path))groups.delete(path);for(const path of paths)if(preferences.projects&&open(path))load(path);},
    update(id,values){for(const group of groups.values())for(const entry of group.rows)if(entry.id===id)Object.assign(entry,values);},
    clear(){++epoch;++version;projects=[];groups.clear();}
  };
};
