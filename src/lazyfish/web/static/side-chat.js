'use strict';
// Each parent owns an independent native conversation and an immutable text snapshot.
window.LazyfishSideChat=function({node,icon,t,api,markdown,copyButton,getMain,onMainQuote,getStatus,preferences,imageNode,prepare=async()=>{}}){
  const $=s=>document.querySelector(s),host=$('#side-chat'),list=$('#side-transcript'),states=new Map(),quoteUI=LazyfishQuoteUI({node,icon,t});
  let parent=null,timer=0,opened=new Set();
  try{opened=new Set(JSON.parse(localStorage.getItem('lazyfish.side.open')||'[]').filter(v=>/^[a-f0-9]{32}$/.test(v)).slice(-100));}catch{}
  const active=job=>job&&['queued','running','cancelling'].includes(job.status);
  const current=()=>states.get(parent),live=s=>states.get(s.id)===s;
  function state(id){if(!states.has(id))states.set(id,{id,open:opened.has(id),chat:null,text:'',quotes:[],pending:null,loading:false,error:'',revision:0,questionDrafts:new Map(),details:new Set()});return states.get(id);}
  const editor=LazyfishSideComposer({node,icon,t,api,getState:current,getStatus,preferences,imageNode,onChange:draw,onCompact:()=>compact(current())});
  const prompt=$('#side-prompt');
  function saveOpen(s,value){s.open=value;value?opened.add(s.id):opened.delete(s.id);while(opened.size>100)opened.delete(opened.values().next().value);try{localStorage.setItem('lazyfish.side.open',JSON.stringify([...opened]));}catch{}}
  function schedule(){clearTimeout(timer);const s=current();if(s?.open&&s.chat?.jobs.some(active))timer=setTimeout(()=>refresh(s).catch(error=>{s.error=error.message;draw();schedule();}),800);}
  function merge(s,chat){
    if(s.chat?.id===chat.id){const jobs=new Map(s.chat.jobs.map(job=>[job.id,job]));for(const job of chat.jobs){const old=jobs.get(job.id);if(!old||old.cursor<=job.cursor)jobs.set(job.id,job);}chat.jobs=[...jobs.values()].sort((a,b)=>a.history_position-b.history_position);if(s.chat.older_cursor)chat.older_cursor=s.chat.older_cursor;}
    s.chat=chat;
  }
  async function load(s,fresh=false){
    const revision=++s.revision;s.loading=true;s.error='';draw();
    const key=fresh?(s.freshKey||=LazyfishRequestId()):(s.openKey||=LazyfishRequestId());
    try{await prepare(s.id);const value=await api('/api/conversations/'+s.id+'/side-chat',{client_request_id:key,fresh});if(!live(s)||revision!==s.revision)return;merge(s,value.conversation);s.openKey=null;if(fresh){s.freshKey=null;s.quotes=[];s.text='';s.pending=null;quoteUI.clear();}}
    catch(error){if(live(s)&&revision===s.revision)s.error=error.message;}
    finally{if(live(s)&&revision===s.revision)s.loading=false;if(live(s)&&s.id===parent){prompt.value=s.text;draw();schedule();}}
  }
  async function refresh(s){
    const id=s.chat?.id,revision=s.revision;if(!id)return;
    const jobs=await Promise.all(s.chat.jobs.filter(active).map(job=>api('/api/jobs/'+job.id)));
    if(!live(s)||revision!==s.revision||s.chat?.id!==id)return;
    s.error='';for(const job of jobs){if('context' in job)s.chat.context=job.context;if(job.native_thread_id)s.chat.native_thread_id=job.native_thread_id;const index=s.chat.jobs.findIndex(old=>old.id===job.id);if(index>=0)s.chat.jobs[index]=job;}
    if(live(s)&&s.id===parent){draw();schedule();}
  }
  function update(){
    const main=getMain(),id=main?.id||null;
    if(parent!==id){editor.close();const old=current();if(old)old.text=prompt.value;clearTimeout(timer);parent=id;const s=id?state(id):null;prompt.value=s?.text||'';if(s?.open)load(s);}
    draw();
  }
  function open(quote){
    const main=getMain();if(!main?.id)return false;
    if(parent!==main.id)update();const s=state(main.id);if(s.loading&&s.freshKey)return false;
    if(quote){
      if(Array.from(quote.text).length>8000||s.quotes.length>=8||Array.from(quote.text).length+s.quotes.reduce((n,q)=>n+Array.from(q.text).length,0)>24000){s.error='invalid_quotes';saveOpen(s,true);draw();return false;}
      if(!s.quotes.some(q=>q.text===quote.text&&q.role===quote.role))s.quotes.push({...quote});
    }
    saveOpen(s,true);draw();if(!s.chat&&!s.loading)load(s);else if(s.chat){refresh(s).catch(error=>{s.error=error.message;draw();});schedule();}
    prompt.focus({preventScroll:true});return true;
  }
  function close(){editor.close();const s=current();if(s){s.text=prompt.value;saveOpen(s,false);}clearTimeout(timer);draw();$('#side-toggle').focus({preventScroll:true});}
  function quoteBlock(quotes,key,remove){return quoteUI.render(quotes,key,remove);}
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
    const s=current(),visible=Boolean(s?.open&&getMain()?.id===parent),changed=host.hidden===visible;host.hidden=!visible;$('#side-resizer').hidden=!visible;document.body.classList.toggle('side-chat-open',visible);if(changed)window.dispatchEvent(new Event('lazyfish:side-layout'));
    $('#side-toggle').hidden=!getMain()?.id;$('#side-toggle').setAttribute('aria-expanded',String(visible));if(!visible)return;
    $('#side-title').textContent=t('side.title');$('#side-parent').textContent=getMain()?.title||t('emptyTitle');
    $('#side-parent').title=t('side.snapshot');$('#side-prompt').placeholder=t('side.prompt');$('#side-close').setAttribute('aria-label',t('side.close'));
    $('#side-new').textContent=t('side.new');$('#side-new').disabled=s.loading||Boolean(s.pending)||s.chat?.jobs.some(active)||editor.busy()||s.compacting||false;
    $('#side-source').textContent=s.chat?.side_context?.truncated?t('side.truncated'):t('side.snapshot');
    const following=list.scrollHeight-list.scrollTop-list.clientHeight<80,top=list.scrollTop;
    const signature=JSON.stringify([s.chat?.jobs,s.chat?.older_cursor,s.pending,s.loading,s.error,document.documentElement.lang]);
    const selection=window.getSelection(),selecting=selection&&!selection.isCollapsed&&list.contains(selection.anchorNode)&&list.contains(selection.focusNode);
    if(signature!==s.rendered&&!selecting){
      const focused=list.contains(document.activeElement)&&document.activeElement.matches('input,select')?{name:document.activeElement.name,value:document.activeElement.value,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd}:null;
      s.rendered=signature;list.replaceChildren();
      if(s.chat?.older_cursor){const older=button(t(s.paging?'olderLoading':'older'),async()=>{
        if(s.paging)return;s.paging=true;s.rendered=null;draw();const revision=s.revision;
        try{const result=await api('/api/conversations/'+s.chat.id+'?before='+s.chat.older_cursor);if(!live(s)||revision!==s.revision)return;s.chat.jobs=[...result.jobs,...s.chat.jobs];s.chat.older_cursor=result.older_cursor;}
        catch(error){s.error=error.message;}finally{s.paging=false;s.rendered=null;draw();}
      },'side-older');older.disabled=Boolean(s.paging);list.append(older);}
      if(!s.chat?.jobs.length&&!s.pending)list.append(node('p','side-empty',t(s.loading?'side.loading':'side.empty')));
      for(const job of s.chat?.jobs||[]){
        const article=node('article','side-turn'),user=node('div','side-user message user');
        if(job.inputs?.quotes?.length)user.append(quoteBlock(job.inputs.quotes,'side-history:'+job.id));user.append(node('div','user-text',job.prompt));for(const skill of job.inputs?.skills||[])user.append(node('span','skill-chip',skill.name));if(job.inputs?.images?.length){const images=node('div','image-list');for(const image of job.inputs.images)images.append(imageNode(image));user.append(images);}if(job.inputs?.operation!=='compact')article.append(user);
        for(const instruction of job.instructions||[]){const card=node('div','side-user side-instruction');if(instruction.quotes?.length)card.append(quoteBlock(instruction.quotes,'side-instruction:'+instruction.id));card.append(node('div','user-text',instruction.text));for(const skill of instruction.skills||[])card.append(node('span','skill-chip',skill.name));card.append(node('p','instruction-delivery',t('instruction.'+instruction.state)));article.append(card);}
        const answer=node('div','side-answer');answer.append(node('div','side-role','Codex'));
        for(const item of job.items.filter(item=>item.kind==='assistant')){const text=node('div','assistant-text markdown');text.append(markdown(item.text));answer.append(text);}
        const progress=job.items.filter(item=>item.kind!=='assistant'&&item.kind!=='user_message');
        if(progress.length){const detail=node('details','side-progress');detail.open=s.details.has(job.id);detail.addEventListener('toggle',()=>detail.open?s.details.add(job.id):s.details.delete(job.id));detail.append(node('summary','',t('side.activity')));for(const item of progress)detail.append(node('pre','',item.text));answer.append(detail);}
        controls(s,job,answer);
        if(job.error_code)answer.append(node('p','side-error',t(job.error_code)));
        answer.append(node('div','side-status',t(job.status)));
        if(job.items.some(item=>item.kind==='assistant'))answer.append(copyButton(()=>job.items.filter(item=>item.kind==='assistant').map(item=>item.text).join('\n\n')));
        article.append(answer);list.append(article);
      }
      if(s.pending){const card=node('div','side-pending side-user');if(s.pending.quotes.length)card.append(quoteBlock(s.pending.quotes,'side-pending'));card.append(node('div','user-text',s.pending.text));for(const skill of s.pending.inputs?.skills||[])card.append(node('span','skill-chip',skill.name));for(const image of s.pending.images||[])card.append(imageNode(image));card.append(node('p','side-status',t(s.pending.failed?'side.sendFailed':'ui.sending')));if(s.pending.failed)card.append(button(t('ui.retry.send'),()=>send(s,s.pending)));list.append(card);}
      if(s.error){const error=node('div','side-error');error.setAttribute('role','status');error.append(node('p','',t(s.error)),button(t('ui.retry'),()=>s.chat?refresh(s).catch(e=>{s.error=e.message;draw();}):load(s,Boolean(s.freshKey))));list.append(error);}
      if(focused){const field=[...list.querySelectorAll('input,select')].find(el=>el.name===focused.name);if(field){field.value=focused.value;field.focus({preventScroll:true});if(field.setSelectionRange&&focused.start!==null)field.setSelectionRange(focused.start,focused.end);}}
      list.scrollTop=following?list.scrollHeight:top;
    }
    const refs=$('#side-quotes');refs.replaceChildren();refs.hidden=!s.quotes.length;if(s.quotes.length)refs.append(quoteBlock(s.quotes,'side-draft:'+s.id,index=>{s.quotes.splice(index,1);draw();}));
    editor.render();prompt.disabled=s.loading&&Boolean(s.freshKey);
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
    if(fresh){s.text='';s.quotes=[];editor.sent(s);if(parent===s.id)prompt.value='';}draw();
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
    finally{if(live(s)&&parent===s.id){draw();schedule();}}
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
  $('#side-new').addEventListener('click',()=>{const s=current();if(s&&!s.pending&&!s.chat?.jobs.some(active))load(s,true);});
  $('#side-parent').addEventListener('click',()=>{if(matchMedia('(max-width:1100px)').matches)close();$('#prompt').focus({preventScroll:true});});
  const resize=$('#side-resizer');let dragging=false;
  function width(value){const maximum=matchMedia('(min-width:1101px)').matches?Math.min(65,(innerWidth-(parseFloat(getComputedStyle($('#chat')).marginLeft)||0)-325)/innerWidth*100):65;value=Math.max(25,Math.min(maximum,value));document.documentElement.style.setProperty('--side-width',value+'%');resize.setAttribute('aria-valuenow',Math.round(value));try{localStorage.setItem('lazyfish.side.width',String(value));}catch{}}
  try{width(Number(localStorage.getItem('lazyfish.side.width'))||42);}catch{}
  resize.addEventListener('pointerdown',event=>{dragging=true;resize.setPointerCapture(event.pointerId);document.body.classList.add('side-resizing');event.preventDefault();});
  resize.addEventListener('pointermove',event=>{if(dragging)width((innerWidth-event.clientX)/$('#app').clientWidth*100);});
  function end(){dragging=false;document.body.classList.remove('side-resizing');}resize.addEventListener('pointerup',end);resize.addEventListener('pointercancel',end);
  window.addEventListener('resize',()=>width(Number(resize.getAttribute('aria-valuenow'))||42));
  resize.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();width(Number(resize.getAttribute('aria-valuenow'))+(event.key==='ArrowLeft'?2:-2));}});
  return {open,update,reflow:()=>{width(Number(resize.getAttribute('aria-valuenow'))||42);editor.resize();},clear:()=>{clearTimeout(timer);editor.clear();states.clear();parent=null;prompt.value='';host.hidden=true;$('#side-resizer').hidden=true;document.body.classList.remove('side-chat-open');quoteUI.clear();},selectionContext:()=>{const s=current();return s?.open&&s.chat?{id:s.chat.id,epoch:s.revision,parent:s.id,side:true}:null;},addToMain:quote=>{if(!onMainQuote(quote))return false;if(matchMedia('(max-width:1100px)').matches){const s=current();if(s)saveOpen(s,false);clearTimeout(timer);draw();$('#prompt').focus({preventScroll:true});}return true;}};
};
