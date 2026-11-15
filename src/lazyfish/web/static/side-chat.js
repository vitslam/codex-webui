'use strict';
// Side tabs retain separate native conversations, snapshots and drafts for each parent.
window.LazyfishSideChat=function({node,icon,t,api,markdown,copyButton,getMain,onMainQuote,getStatus,preferences,imageNode,prepare=async()=>{},replyLabel,replyMeta,replyStatus,duration,executionDetails}){
  const $=s=>document.querySelector(s),host=$('#side-chat'),list=$('#side-transcript'),states=new Map(),quoteUI=LazyfishQuoteUI({node,icon,t});
  let parent=null,timer=0,opened=new Set(),savedTabs={},renderedId=null;
  const groups=new Map(),validId=id=>typeof id==='string'&&/^[a-f0-9]{32}$/.test(id);
  try{opened=new Set(JSON.parse(localStorage.getItem('lazyfish.side.open')||'[]').filter(validId).slice(-100));const saved=JSON.parse(localStorage.getItem('lazyfish.side.tabs')||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))savedTabs=saved;}catch{}
  const active=job=>job&&['queued','running','cancelling'].includes(job.status);
  function state(id,owner){if(!states.has(id))states.set(id,{id,parent:owner,chat:null,text:'',quotes:[],pending:null,loading:false,error:'',revision:0,questionDrafts:new Map(),details:new Set()});return states.get(id);}
  function group(id){
    if(!groups.has(id)){const saved=savedTabs[id],ids=Array.isArray(saved?.ids)?[...new Set(saved.ids.filter(validId))].slice(-100):[];groups.set(id,{id,ids,selected:ids.includes(saved?.selected)?saved.selected:ids.at(-1),freshNext:saved?.freshNext===true,open:opened.has(id),loading:false});}
    return groups.get(id);
  }
  const current=()=>parent?state(group(parent).selected||'new:'+parent,parent):null,live=s=>states.get(s.id)===s;
  const editor=LazyfishSideComposer({node,icon,t,api,getState:current,getStatus,preferences,imageNode,onChange:draw,onCompact:()=>compact(current())});
  const prompt=$('#side-prompt');
  function persist(g){savedTabs[g.id]={ids:g.ids,selected:g.selected,freshNext:g.freshNext};const ids=Object.keys(savedTabs);for(const id of ids.slice(0,Math.max(0,ids.length-100)))delete savedTabs[id];try{localStorage.setItem('lazyfish.side.tabs',JSON.stringify(savedTabs));}catch{}}
  function saveOpen(g,value){g.open=value;value?opened.add(g.id):opened.delete(g.id);while(opened.size>100)opened.delete(opened.values().next().value);try{localStorage.setItem('lazyfish.side.open',JSON.stringify([...opened]));}catch{}}
  function schedule(){
    clearTimeout(timer);const g=parent&&group(parent);if(!g?.open)return;
    const running=g.ids.map(id=>states.get(id)).filter(s=>s?.chat?.jobs.some(active));
    if(running.length)timer=setTimeout(async()=>{await Promise.all(running.map(s=>refresh(s,false).catch(error=>{s.error=error.message;})));if(parent===g.id){draw();schedule();}},800);
  }
  function merge(s,chat){
    if(s.chat?.id===chat.id){const jobs=new Map(s.chat.jobs.map(job=>[job.id,job]));for(const job of chat.jobs){const old=jobs.get(job.id);if(!old||old.cursor<=job.cursor)jobs.set(job.id,job);}chat.jobs=[...jobs.values()].sort((a,b)=>a.history_position-b.history_position);if(s.chat.older_cursor)chat.older_cursor=s.chat.older_cursor;}
    s.chat=chat;
  }
  async function fetchTab(s){
    const revision=++s.revision;s.loading=true;s.error='';draw();
    try{const chat=await api('/api/conversations/'+s.id);if(!live(s)||revision!==s.revision)return;if(chat.side_parent_id!==s.parent)throw new Error('not_found');merge(s,chat);}
    catch(error){if(live(s)&&revision===s.revision)s.error=error.message;}
    finally{if(live(s)&&revision===s.revision)s.loading=false;if(current()===s){draw();schedule();}}
  }
  function activate(g,id){
    if(g.loading||!g.ids.includes(id))return;const old=current();if(g.id===parent&&old){old.text=prompt.value;old.scroll=list.scrollTop;}editor.close();g.selected=id;persist(g);
    const s=state(id,g.id);if(g.id===parent){prompt.value=s.text;draw();list.scrollTop=s.scroll??list.scrollHeight;}if(!s.chat&&!s.loading)fetchTab(s);else{refresh(s).catch(error=>{s.error=error.message;draw();});schedule();}
  }
  async function load(g,fresh=false){
    if(g.loading)return;if(!fresh&&g.ids.length){activate(g,g.selected||g.ids.at(-1));return;}
    const placeholder=state('new:'+g.id,g.id),key=fresh||g.freshNext?(g.freshKey||=LazyfishRequestId()):(g.openKey||=LazyfishRequestId());
    g.loading=true;placeholder.loading=true;placeholder.error='';draw();
    try{await prepare(g.id);const value=await api('/api/conversations/'+g.id+'/side-chat',{client_request_id:key,fresh:fresh||g.freshNext});if(groups.get(g.id)!==g)return;
      const old=current();if(g.id===parent&&old)old.text=prompt.value;const s=state(value.conversation.id,g.id);merge(s,value.conversation);
      if(!g.ids.length){s.text=placeholder.text;s.quotes=placeholder.quotes;placeholder.text='';placeholder.quotes=[];}
      if(!g.ids.includes(s.id))g.ids.push(s.id);g.selected=s.id;g.freshNext=false;g.freshKey=null;g.openKey=null;persist(g);
      if(g.id===parent){editor.close();prompt.value=s.text;renderedId=null;}
    }catch(error){placeholder.error=error.message;if(g.id===parent)current().error=error.message;}
    finally{g.loading=false;placeholder.loading=false;if(g.id===parent){draw();schedule();}}
  }
  async function refresh(s,redraw=true){
    const id=s.chat?.id,revision=s.revision;if(!id)return;
    const jobs=await Promise.all(s.chat.jobs.filter(active).map(job=>api('/api/jobs/'+job.id)));
    if(!live(s)||revision!==s.revision||s.chat?.id!==id)return;
    s.error='';for(const job of jobs){if('context' in job)s.chat.context=job.context;if(job.native_thread_id)s.chat.native_thread_id=job.native_thread_id;const index=s.chat.jobs.findIndex(old=>old.id===job.id);if(index>=0)s.chat.jobs[index]=job;}
    if(redraw&&s.parent===parent){draw();schedule();}
  }
  function update(){
    const main=getMain(),id=main?.id||null;
    if(parent!==id){editor.close();const old=current();if(old){old.text=prompt.value;old.scroll=list.scrollTop;}clearTimeout(timer);parent=id;const g=id?group(id):null,s=current();prompt.value=s?.text||'';renderedId=null;if(g?.open)load(g);}
    draw();
  }
  function open(quote){
    const main=getMain();if(!main?.id)return false;if(parent!==main.id)update();const g=group(main.id),s=current();if(g.loading&&g.freshKey)return false;
    if(quote){
      if(Array.from(quote.text).length>8000||s.quotes.length>=8||Array.from(quote.text).length+s.quotes.reduce((n,q)=>n+Array.from(q.text).length,0)>24000){s.error='invalid_quotes';saveOpen(g,true);draw();return false;}
      if(!s.quotes.some(q=>q.text===quote.text&&q.role===quote.role))s.quotes.push({...quote});
    }
    saveOpen(g,true);draw();if(!s.chat&&!s.loading)load(g);else if(s.chat){refresh(s).catch(error=>{s.error=error.message;draw();});schedule();}
    prompt.focus({preventScroll:true});return true;
  }
  function close(){editor.close();const s=current(),g=parent&&group(parent);if(s)s.text=prompt.value;if(g)saveOpen(g,false);clearTimeout(timer);draw();$('#side-toggle').focus({preventScroll:true});}
  function closeTab(g,id){
    if(g.loading)return;const index=g.ids.indexOf(id);if(index<0)return;const s=states.get(id);if(current()===s){s.text=prompt.value;s.scroll=list.scrollTop;editor.close();}g.ids.splice(index,1);
    if(g.selected===id)g.selected=g.ids[Math.min(index,g.ids.length-1)];if(!g.ids.length){g.freshNext=true;saveOpen(g,false);}persist(g);
    if(g.id===parent){prompt.value=current()?.text||'';renderedId=null;draw();if(g.selected)activate(g,g.selected);else $('#side-toggle').focus({preventScroll:true});schedule();}
  }
  function drawTabs(g){
    const tabs=$('#side-tabs'),items=g.ids.map((id,index)=>{const s=states.get(id),job=s?.chat?.jobs.find(active),title=s?.chat?.jobs.find(job=>job.inputs?.operation!=='compact'&&job.prompt)?.prompt||s?.chat?.title||t('side.tab',{number:index+1});return {id,title:title.replace(/\s+/g,' ').slice(0,60),status:job?.status||'',error:Boolean(s?.error)};});
    const signature=JSON.stringify([items,g.selected,g.loading,document.documentElement.lang]);if(tabs.dataset.signature===signature)return;tabs.dataset.signature=signature;
    const focus=document.activeElement?.closest('[data-side-tab]'),focused=focus?.dataset.sideTab,closing=focus?.classList.contains('side-tab-close');tabs.replaceChildren();tabs.setAttribute('aria-label',t('side.tabs'));
    for(const item of items){
      const row=node('div','side-tab'),select=button(item.title,()=>activate(g,item.id),'side-tab-select'),remove=button('×',()=>closeTab(g,item.id),'side-tab-close');
      row.dataset.selected=String(item.id===g.selected);row.dataset.status=item.status;row.dataset.error=String(item.error);select.dataset.sideTab=item.id;select.id='side-tab-'+item.id;select.setAttribute('role','tab');select.setAttribute('aria-selected',String(item.id===g.selected));select.setAttribute('aria-controls','side-transcript');select.tabIndex=item.id===g.selected?0:-1;select.title=item.title;select.disabled=g.loading;
      remove.dataset.sideTab=item.id;remove.title=t('side.closeTab',{title:item.title});remove.setAttribute('aria-label',remove.title);remove.disabled=g.loading;row.append(select,remove);tabs.append(row);
    }
    $('#side-transcript').setAttribute('aria-labelledby',g.selected?'side-tab-'+g.selected:'side-title');if(focused)tabs.querySelector('[data-side-tab="'+focused+'"]'+(closing?'.side-tab-close':'.side-tab-select'))?.focus({preventScroll:true});
  }
  function quoteBlock(quotes,key,remove,edit,clear){return quoteUI.render(quotes,key,remove,edit,clear);}
  function button(label,action,cls=''){const el=node('button',cls,label);el.type='button';el.addEventListener('click',action);return el;}
  function controls(s,job,article){
    for(const approval of job.approvals||[])if(approval.state==='pending'){
      const box=node('div','side-approval');box.append(node('p','',approval.description||t('approvalCommand')));
      for(const [decision,choice] of (approval.choices||[]).entries()){
        const action=button(t(choice.label),async()=>{action.disabled=true;try{await api('/api/jobs/'+job.id+'/approvals',{id:approval.id,decision});await refresh(s);}catch(error){s.error=error.message;draw();}});if(choice.detail)action.title=choice.detail;box.append(action);if(choice.detail)box.append(node('pre','side-approval-detail',choice.detail));
      }article.append(box);
    }
    for(const question of job.questions||[])if(question.state==='pending'){
      const form=node('form','side-question'),fields=[];
      for(const q of question.questions||[]){
        const label=node('label','',q.question||q.header||q.id),input=node('input'),key=question.id+':'+q.id;
        input.type=q.isSecret?'password':'text';input.name=key;input.autocomplete='off';input.maxLength=8000;
        const saved=s.questionDrafts.get(key)||{};let select=null;
        if(q.options?.length){select=node('select');select.name=key+':choice';select.append(node('option','',''));for(const option of q.options)select.append(node('option','',option.label));select.value=saved.choice||'';label.append(select);}
        input.value=q.isSecret?'':saved.text||'';
        const remember=()=>{if(!q.isSecret)s.questionDrafts.set(key,{text:input.value,choice:select?.value||''});};input.addEventListener('input',remember);select?.addEventListener('change',remember);
        label.append(input);fields.push({q,input,select,key});form.append(label);
      }
      const submit=node('button','',t('ui.submit.answer'));submit.type='submit';form.append(submit);
      form.addEventListener('submit',async event=>{event.preventDefault();submit.disabled=true;try{await api('/api/jobs/'+job.id+'/questions',{id:question.id,answers:Object.fromEntries(fields.map(({q,input,select})=>[q.id,{answers:[[select?.value,input.value].filter(Boolean).join('\n')]}]))});fields.forEach(({key})=>s.questionDrafts.delete(key));await refresh(s);}catch(error){s.error=error.message;draw();}});article.append(form);
    }
  }
  function draw(){
    const s=current(),g=parent&&group(parent),visible=Boolean(g?.open&&getMain()?.id===parent),changed=host.hidden===visible;host.hidden=!visible;$('#side-resizer').hidden=!visible;document.body.classList.toggle('side-chat-open',visible);if(changed)window.dispatchEvent(new Event('lazyfish:side-layout'));
    $('#side-toggle').hidden=!getMain()?.id;$('#side-toggle').setAttribute('aria-expanded',String(visible));if(!visible)return;
    $('#side-title').textContent=t('side.title');$('#side-parent').textContent=getMain()?.title||t('emptyTitle');
    $('#side-parent').title=t('side.snapshot');$('#side-prompt').placeholder=t('side.prompt');$('#side-close').setAttribute('aria-label',t('side.close'));
    $('#side-new').title=t('side.new');$('#side-new').setAttribute('aria-label',t('side.new'));$('#side-new').disabled=g.loading||s.loading;drawTabs(g);
    $('#side-source').textContent=s.chat?.side_context?.truncated?t('side.truncated'):t('side.snapshot');
    const following=list.scrollHeight-list.scrollTop-list.clientHeight<80,top=list.scrollTop;
    const signature=JSON.stringify([s.chat?.jobs,s.chat?.older_cursor,s.pending,s.loading,s.error,document.documentElement.lang,preferences.settings().showReasoning===true,s.chat?.jobs.some(active)?Math.floor(Date.now()/1000):null]);
    const selection=window.getSelection(),selecting=selection&&!selection.isCollapsed&&list.contains(selection.anchorNode)&&list.contains(selection.focusNode);
    if((renderedId!==s.id||signature!==s.rendered)&&(!selecting||renderedId!==s.id)){
      const focused=list.contains(document.activeElement)&&document.activeElement.matches('input,select')?{name:document.activeElement.name,value:document.activeElement.value,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd}:null;
      s.rendered=signature;renderedId=s.id;list.replaceChildren();
      if(s.chat?.older_cursor){const older=button(t(s.paging?'olderLoading':'older'),async()=>{
        if(s.paging)return;s.paging=true;s.rendered=null;draw();const revision=s.revision;
        try{const result=await api('/api/conversations/'+s.chat.id+'?before='+s.chat.older_cursor);if(!live(s)||revision!==s.revision)return;s.chat.jobs=[...result.jobs,...s.chat.jobs];s.chat.older_cursor=result.older_cursor;}
        catch(error){s.error=error.message;}finally{s.paging=false;s.rendered=null;draw();}
      },'side-older');older.disabled=Boolean(s.paging);list.append(older);}
      if(!s.chat?.jobs.length&&!s.pending&&s.loading)list.append(node('p','side-empty',t('side.loading')));
      for(const job of s.chat?.jobs||[]){
        const article=node('article','side-turn'),user=node('div','side-user message user');article.dataset.job=job.id;
        if(job.inputs?.quotes?.length)user.append(quoteBlock(job.inputs.quotes,'side-history:'+job.id));user.append(node('div','user-text',job.prompt));for(const skill of job.inputs?.skills||[])user.append(node('span','skill-chip',skill.name));if(job.inputs?.images?.length){const images=node('div','image-list');for(const image of job.inputs.images)images.append(imageNode(image));user.append(images);}if(job.inputs?.operation!=='compact')article.append(user);
        for(const instruction of job.instructions||[]){const card=node('div','side-user side-instruction');if(instruction.quotes?.length)card.append(quoteBlock(instruction.quotes,'side-instruction:'+instruction.id));card.append(node('div','user-text',instruction.text));for(const skill of instruction.skills||[])card.append(node('span','skill-chip',skill.name));card.append(node('p','instruction-delivery',t('instruction.'+instruction.state)));article.append(card);}
        const answer=node('div','side-answer');answer.append(replyLabel());
        const progress=job.items.filter(item=>item.kind!=='assistant'&&item.kind!=='user_message'&&typeof item.text==='string'&&item.text.trim()&&(item.kind!=='reasoning'||preferences.settings().showReasoning===true));
        const end=job.finished_at?Date.parse(job.finished_at):Date.now(),seconds=(end-Date.parse(job.created_at))/1000;
        const elapsed=t(active(job)?'elapsed':'duration')+' '+duration(Number.isFinite(seconds)?seconds:0);
        if(progress.length){
          const process=executionDetails('side:'+job.id+':'+(active(job)?'active':'finished'),elapsed,'execution-process',active(job));
          const timeline=node('div','execution-timeline');for(const item of progress)timeline.append(node('pre','',item.text));process.append(timeline);answer.append(process);
        }else answer.append(node('div','elapsed',elapsed));
        for(const item of job.items.filter(item=>item.kind==='assistant')){const text=node('div','assistant-text markdown');text.append(markdown(item.text));answer.append(text);}
        controls(s,job,answer);
        if(job.error_code)answer.append(node('p','side-error',t(job.error_code)));
        const footer=node('div','assistant-footer'),meta=replyMeta(job),status=replyStatus(job);
        status.querySelector('.task-status').classList.add('side-status');
        footer.append(meta,status);answer.append(footer);
        article.append(answer);list.append(article);
      }
      if(s.pending){const card=node('div','side-pending side-user');if(s.pending.quotes.length)card.append(quoteBlock(s.pending.quotes,'side-pending'));card.append(node('div','user-text',s.pending.text));for(const skill of s.pending.inputs?.skills||[])card.append(node('span','skill-chip',skill.name));for(const image of s.pending.images||[])card.append(imageNode(image));card.append(node('p','side-status',t(s.pending.failed?'side.sendFailed':'ui.sending')));if(s.pending.failed)card.append(button(t('ui.retry.send'),()=>send(s,s.pending)));list.append(card);}
      if(s.error){const error=node('div','side-error');error.setAttribute('role','status');error.append(node('p','',t(s.error)),button(t('ui.retry'),()=>s.chat?refresh(s).catch(e=>{s.error=e.message;draw();}):g.ids.length?fetchTab(s):load(g,Boolean(g.freshKey))));list.append(error);}
      if(focused){const field=[...list.querySelectorAll('input,select')].find(el=>el.name===focused.name);if(field){field.value=focused.value;field.focus({preventScroll:true});if(field.setSelectionRange&&focused.start!==null)field.setSelectionRange(focused.start,focused.end);}}
      list.scrollTop=following?list.scrollHeight:top;
    }
    const refs=$('#side-quotes');refs.replaceChildren();refs.hidden=!s.quotes.length;if(s.quotes.length)refs.append(quoteBlock(s.quotes,'side-draft:'+s.id,index=>{s.quotes.splice(index,1);draw();},(index,text)=>{s.quotes[index]={...s.quotes[index],text};draw();},()=>{s.quotes=[];draw();}));
    editor.render();prompt.disabled=s.loading||g.loading&&!s.chat;
    const running=s.chat?.jobs.find(active),canSteer=running?.status==='running'&&running.inputs?.operation!=='compact',supplement=canSteer&&Boolean(prompt.value.trim()||s.quotes.length);$('#side-form').dataset.jobStatus=running?.status||'idle';prompt.placeholder=t(canSteer?'ui.add.instructions':'prompt');$('#side-send').hidden=Boolean(running)&&!supplement;$('#side-send').setAttribute('aria-label',t(running?'ui.supplementary.instruction':'send'));$('#side-send').disabled=!getStatus()?.execution.available||!s.chat||s.loading||Boolean(s.pending)||s.compacting||editor.busy()||Boolean(running&&!supplement)||(!prompt.value.trim()&&!s.quotes.length&&!editor.hasInputs());
    $('#side-stop').hidden=!running||supplement;$('#side-stop').setAttribute('aria-label',t(running?.status==='cancelling'?'cancelling':'stop'));$('#side-stop').disabled=running?.status==='cancelling';
    editor.resize();
  }
  async function send(s,record){
    const running=s.chat?.jobs.find(active);
    if(!s.chat||s.loading||editor.busy()||s.compacting||s.pending&&!s.pending.failed&&s.pending!==record||running&&(running.status!=='running'||running.inputs?.operation==='compact'))return;
    if(!record&&running&&editor.hasImages()){s.error='supplement_text_only';draw();return;}
    const fresh=!record;record||={key:LazyfishRequestId(),text:s.text,quotes:s.quotes.map(q=>({...q})),targetJob:running?.id,...editor.snapshot(s)};
    record.failed=false;s.pending=record;s.error='';
    if(fresh){s.text='';s.quotes=[];editor.sent(s);if(current()===s)prompt.value='';}draw();
    try{
      const chatId=s.chat.id;await editor.flush(s);
      if(record.targetJob){
        const instruction=await api('/api/jobs/'+record.targetJob+'/instructions',{text:record.text,quotes:record.quotes,skills:record.inputs.skills,client_request_id:record.key});
        if(!live(s)||s.chat?.id!==chatId)return;const job=s.chat.jobs.find(job=>job.id===record.targetJob);if(job){job.instructions||=[];if(!job.instructions.some(old=>old.id===instruction.id))job.instructions.push(instruction);}
      }else{
        const job=await api('/api/conversations/'+chatId+'/turns',{text:record.text,quotes:record.quotes,...record.settings,...record.inputs,client_request_id:record.key});
        if(!live(s)||s.chat?.id!==chatId)return;if(!s.chat.jobs.some(old=>old.id===job.id))s.chat.jobs.push(job);
      }
      s.pending=null;editor.resave(s,record.version);
    }catch(error){if(live(s)){if(s.chat.jobs.some(job=>job.client_request_id===record.key)){s.pending=null;s.error='';}else{record.failed=true;s.error=error.message;}}}
    finally{if(live(s)&&parent===s.parent){draw();schedule();}}
  }
  async function compact(s){
    if(!s?.chat?.native_thread_id||s.pending||s.chat.jobs.some(active)||s.compacting||editor.busy())return;
    s.compacting=true;s.error='';draw();try{const job=await api('/api/conversations/'+s.chat.id+'/compact',{client_request_id:LazyfishRequestId()});if(live(s))s.chat.jobs.push(job);}catch(error){if(live(s))s.error=error.message;}finally{s.compacting=false;if(live(s)){draw();schedule();}}
  }
  document.addEventListener('selectionchange',()=>{if(!host.hidden&&window.getSelection()?.isCollapsed)draw();});
  prompt.addEventListener('input',()=>{const s=current();if(s)s.text=prompt.value;draw();});
  $('#side-form').addEventListener('submit',event=>{event.preventDefault();const s=current();if(s&&(s.text.trim()||s.quotes.length||editor.hasInputs())&&!s.pending)send(s);});
  $('#side-stop').addEventListener('click',async()=>{const s=current(),job=s?.chat?.jobs.find(active);if(!job)return;try{await api('/api/jobs/'+job.id+'/cancel',{});await refresh(s);}catch(error){s.error=error.message;draw();}});
  host.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!document.querySelector('dialog[open]')){event.preventDefault();close();}});
  $('#side-toggle').addEventListener('click',()=>host.hidden?open():close());$('#side-close').addEventListener('click',close);
  $('#side-new').addEventListener('click',()=>{if(parent)load(group(parent),true);});
  $('#side-tabs').addEventListener('keydown',event=>{const g=parent&&group(parent);if(!g||g.loading||!event.target.matches('[role=tab]'))return;const index=g.ids.indexOf(g.selected);if(event.key==='Delete'){event.preventDefault();closeTab(g,g.selected);return;}if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=g.ids[event.key==='Home'?0:event.key==='End'?g.ids.length-1:(index+(event.key==='ArrowLeft'?-1:1)+g.ids.length)%g.ids.length];activate(g,next);$('#side-tab-'+next)?.focus({preventScroll:true});});
  $('#side-parent').addEventListener('click',()=>{if(matchMedia('(max-width:1100px)').matches)close();$('#prompt').focus({preventScroll:true});});
  const resize=$('#side-resizer');let dragging=false;
  function width(value){const maximum=matchMedia('(min-width:1101px)').matches?Math.min(65,(innerWidth-(parseFloat(getComputedStyle($('#chat')).marginLeft)||0)-325)/innerWidth*100):65;value=Math.max(25,Math.min(maximum,value));document.documentElement.style.setProperty('--side-width',value+'%');resize.setAttribute('aria-valuenow',Math.round(value));try{localStorage.setItem('lazyfish.side.width',String(value));}catch{}}
  try{width(Number(localStorage.getItem('lazyfish.side.width'))||42);}catch{}
  resize.addEventListener('pointerdown',event=>{dragging=true;resize.setPointerCapture(event.pointerId);document.body.classList.add('side-resizing');event.preventDefault();});
  resize.addEventListener('pointermove',event=>{if(dragging)width((innerWidth-event.clientX)/$('#app').clientWidth*100);});
  function end(){dragging=false;document.body.classList.remove('side-resizing');}resize.addEventListener('pointerup',end);resize.addEventListener('pointercancel',end);
  window.addEventListener('resize',()=>width(Number(resize.getAttribute('aria-valuenow'))||42));
  resize.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();width(Number(resize.getAttribute('aria-valuenow'))+(event.key==='ArrowLeft'?2:-2));}});
  return {open,update,reflow:()=>{width(Number(resize.getAttribute('aria-valuenow'))||42);editor.resize();},clear:()=>{clearTimeout(timer);editor.clear();states.clear();groups.clear();renderedId=null;parent=null;prompt.value='';host.hidden=true;$('#side-resizer').hidden=true;document.body.classList.remove('side-chat-open');quoteUI.clear();},selectionContext:()=>{const s=current();return parent&&group(parent).open&&s?.chat?{id:s.chat.id,epoch:s.revision,parent,side:true}:null;},addToMain:quote=>{if(!onMainQuote(quote))return false;if(matchMedia('(max-width:1100px)').matches){if(parent)saveOpen(group(parent),false);clearTimeout(timer);draw();$('#prompt').focus({preventScroll:true});}return true;}};
};
