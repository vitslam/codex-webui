"use strict";
// Reference timeline, diff, outputs, message actions and native questions.
window.LazyfishExperience=function({node,icon,t,api,markdown,copyButton,imageNode,getConversation,getBusy,showReasoning=()=>false,onEdit,onFork,onImplement,report,duration,onEditStart,onUserContentToggle}) {
  const quoteUI=LazyfishQuoteUI({node,icon,t});
  const $=s=>document.querySelector(s),legacy={command:'command_execution',file:'file_change',reasoning:'reasoning',skill:'skill_invocation',compact:'context_compaction',assistant:'agent_message',commentary:'agent_message'};
  const sourceNode=(tag,text,cls)=>node(tag,cls,text),finished=job=>!['queued','running','cancelling'].includes(job.status);
  const {artifactList}=window.LazyfishUI.artifacts({node:sourceNode,imageNode,t});
  const steps=window.LazyfishUI.steps({document,node:sourceNode,t,api,markdown,copyButton,imageNode,artifactList,jobFinished:finished,getFollowBottom:()=>false,showReasoning});
  const changes=window.LazyfishUI.changes({document,node:sourceNode,icon,t,api,executionDetails:steps.executionDetails,jobFinished:finished,legacyNotices:window.LazyfishLegacyChangeNotices});
  const users=window.LazyfishUI.messageView({document,node:sourceNode,icon,t,i18n:{get locale(){return document.documentElement.lang;},number:v=>v.toLocaleString(document.documentElement.lang)},markdown,copyButton,imageNode,artifactList,executionDetails:steps.executionDetails,jobFinished:finished,
    onFork:message=>onFork(getConversation().jobs.find(j=>j.id===message.id)),onEdit:(message,text,key)=>onEdit(message.id,text,key),canEdit:id=>!getBusy()&&getConversation()?.jobs.some(j=>j.id===id),newRequestId:()=>LazyfishRequestId(),onEditStart,onUserContentToggle});
  users.bindUserActions();
  function userContent(card,message){const content=users.appendUserContent(card,message);content.classList.add('user-message');if(message.quotes?.length)content.prepend(quoteUI.render(message.quotes,'history:'+message.id));return content;}
  function userActions(card,job){users.appendUserActions(card,{id:job.id,content:job.prompt,images:job.inputs?.images});}
  function detail(item){
    const value={...item.detail,id:item.id,eventStatus:item.status};
    if(!value.type)value.type=legacy[item.kind]||'dynamic_tool_call';
    if(['assistant','commentary','reasoning'].includes(item.kind))value.text=item.text;
    if(item.kind==='command'&&!item.detail?.type){const [command,...output]=item.text.split('\n');value.command=command;value.aggregated_output=output.join('\n');}
    return value;
  }
  function deferred(view,job,process,index,start,through){
    view.deferred ||=new Map();
    const signature=JSON.stringify([job.cursor,document.documentElement.lang,start,through]);
    let entry=view.deferred.get(index);
    if(!entry||entry.signature!==signature){entry={signature,items:[],offset:start,more:true,loading:false,host:node('div','execution-timeline')};view.deferred.set(index,entry);}
    const host=entry.host;process.append(host);
    const draw=()=>{const timeline=steps.appendSteps({id:job.id,job_id:job.id},entry.items.filter(i=>i.kind!=='assistant').map(detail),'',view.toolNodes);host.replaceChildren(...timeline.children);};
    async function load(){
      if(!process.open||entry.loading||!entry.more||!process.isConnected)return;
      entry.loading=true;if(!entry.items.length)host.replaceChildren(node('p','meta',t('ui.loading')));
      try{
        while(entry.more&&process.open&&process.isConnected){
          const page=await api('/api/jobs/'+job.id+'/steps?view=summary&offset='+entry.offset+(through==null?'':'&through='+through));
          if(page.next_offset<entry.offset||page.has_more&&page.next_offset===entry.offset)throw new Error('requestFailed');
          entry.items.push(...page.items);entry.offset=page.next_offset;entry.more=page.has_more;draw();
        }
      }catch(error){const retry=node('button','review-retry',t('ui.retry'));retry.addEventListener('click',load);host.replaceChildren(node('p','meta',t('requestFailed')),retry);}
      finally{entry.loading=false;}
    }
    process.addEventListener('toggle',load);
    if(entry.items.length)draw();
    if(process.open)queueMicrotask(load);
  }
  function render(view,job){
    view.elapsed.hidden=true;view.toolNodes ||=new Map();
    const adapted=job.items.map(detail),answer=job.items.filter(i=>i.kind==='assistant').map(i=>i.text).filter(Boolean).join('\n\n');
    const intermediate=adapted.filter((value,index)=>job.items[index].kind!=='assistant');
    const state=finished(job)?'finished':'active';
    const nodes=[],instructions=job.instructions||[];
    let start=0;
    for(let index=0;index<=instructions.length;index++){
      const instruction=instructions[index],end=instruction?instruction.position:job.steps_deferred?null:job.items.length;
      const segment=adapted.slice(start,end).filter((value,i)=>job.items[start+i]?.kind!=='assistant');
      const key=job.id+':process:'+state+':'+index;
      if(job.steps_deferred||segment.length||!instruction&&index===instructions.length){
        const endTime=instruction?Date.parse(instruction.created_at):job.finished_at?Date.parse(job.finished_at):Date.now();
        const started=index?Date.parse(instructions[index-1].created_at):Date.parse(job.created_at);
        const process=steps.executionDetails(key,`${t(finished(job)||instruction?'duration':'elapsed')} ${duration((endTime-started)/1000)}`,'execution-process',!finished(job)&&!instruction);
        if(job.steps_deferred)deferred(view,job,process,index,start,end);
        else {const timeline=steps.appendSteps({id:job.id,job_id:job.id},segment,'',view.toolNodes);process.append(timeline);}
        nodes.push(process);
      }
      if(instruction){
        const card=node('div','message user supplementary-instruction'),content=userContent(card,{id:instruction.id,content:instruction.text,quotes:instruction.quotes});
        for(const skill of instruction.skills||[])content.append(node('span','skill-chip',skill.name));
        content.append(node('p','instruction-delivery',t('instruction.'+instruction.state)));
        users.appendUserActions(card,{id:instruction.id,content:instruction.text,instruction_state:instruction.state});nodes.push(card);start=end;
      }
    }
    if(answer){for(const item of job.items.filter(i=>i.kind==='assistant'&&i.text)){const body=markdown(item.text);body.classList.add('assistant-text');[...body.children].forEach((block,index)=>block.dataset.anchor=item.id+':'+index);nodes.push(body);}}
    // Only actual inline images replace thumbnails; text links keep the image visible.
    const referencedOutputs=nodes.filter(el=>el.classList.contains('assistant-text')).flatMap(el=>
      [...el.querySelectorAll('img[src]')].map(image=>image.getAttribute('src').split(/[?#]/)[0]));
    const gallery=artifactList(job.artifacts||job.report?.artifacts,referencedOutputs);if(gallery)nodes.push(gallery);
    const actions=node('div','reply-actions meta');
    if(finished(job)&&job.status==='completed'&&job.inputs?.collaboration_mode==='plan'){
      const implement=node('button','implement-plan',t('ui.start.implementation'));implement.type='button';implement.disabled=getBusy();implement.addEventListener('click',async()=>{implement.disabled=true;try{await onImplement(job);}catch(error){report(error);implement.disabled=false;}});actions.append(implement);
    }
    for(const question of job.questions||[]){
      if(question.state!=='pending')questionDrafts.delete(job.id+':'+question.id);
      const button=node('button','question-reopen',t(question.state==='pending'?'ui.codex.has.a.question':question.state==='answered'?'ui.answered':'question_expired'));button.type='button';button.dataset.questionId=question.id;button.addEventListener('click',()=>ask(job,question));actions.append(button);
      if(question.state==='pending'&&!seen(question.id)&&!document.querySelector('dialog[open]')){remember(question.id);queueMicrotask(()=>{if(question.state==='pending')ask(job,question);});}
    }
    for(const approval of job.approvals||[]){if(approval.state!=='pending'||finished(job))continue;
      const button=node('button','question-reopen approval-reopen',t('ui.awaiting.approval'));button.type='button';button.dataset.approval=approval.id;button.addEventListener('click',()=>askApproval(job,approval));actions.append(button);
      if(!seen(approval.id)&&!document.querySelector('dialog[open]')){remember(approval.id);queueMicrotask(()=>{if(approval.state==='pending')askApproval(job,approval);});}
    }
    if(actions.children.length)nodes.push(actions);
    // Preserve expansion state, cached tool nodes and prose anchors across streaming updates.
    view.items.replaceChildren(...nodes);
    let host=view.footer.querySelector('.changes-host');if(!host){host=node('div','changes-host');view.footer.prepend(host);}
    const signature=JSON.stringify([document.documentElement.lang,job.status,job.report?.changes]);if(host.dataset.signature!==signature){host.dataset.signature=signature;host.replaceChildren();changes.appendChangePanel(host,{id:job.id},{...job,changes:job.report?.changes});}
    const info=view.footer.querySelector('.reply-footer');info.querySelector('.token-usage')?.remove();users.appendTokenUsage(info,job.report?.token_usage);
    if((job.artifacts||[]).length)info.hidden=false;
    users.updateUserActions();
    if(selected?.job.id===job.id){
      const updated=(selected.kind==='approval'?job.approvals:job.questions)?.find(item=>item.id===selected.question.id);
      selected.job=job;selected.question=updated||{...selected.question,state:'expired'};
    }
    if(selected?.job.id===job.id&&selected.question.state!=='pending'){
      if(selected.kind==='approval'){$('#question-dialog').close();return;}
      $('#question-submit').disabled=true;$('#question-status').textContent=t(selected.question.state==='answered'?'ui.answered':'question_expired');for(const field of fields)if(field.input.type==='password')field.input.value='';
    }
  }
  const shown=new Set(),questionDrafts=new Map();let selected=null,fields=[];
  const questionKey=value=>value.job.id+':'+value.question.id;
  function saveQuestionDraft(){
    if(!selected||selected.kind==='approval'||selected.question.state!=='pending')return;
    const key=questionKey(selected),draft={};
    for(const field of fields)if(!field.secret)draft[field.id]={text:field.input.value,choice:field.choices.find(input=>input.checked)?.value||''};
    questionDrafts.delete(key);questionDrafts.set(key,draft);
    if(questionDrafts.size>100)questionDrafts.delete(questionDrafts.keys().next().value);
  }
  function clearFields(){for(const field of fields)field.input.value='';fields=[];selected=null;}
  function dismiss(){saveQuestionDraft();clearFields();$('#question-dialog').close();}
  function seen(id){if(shown.has(id))return true;try{return sessionStorage.getItem('question-seen:'+id)==='1';}catch{return false;}}
  function remember(id){shown.add(id);try{sessionStorage.setItem('question-seen:'+id,'1');}catch{}}
  function askApproval(job,approval){
    saveQuestionDraft();
    selected={job,question:approval,kind:'approval'};fields=[];remember(approval.id);
    $('#question-dialog').dataset.kind='approval';$('#question-heading').textContent=t('ui.codex.needs.your.approval');$('#question-submit').textContent=t('ui.confirm.choice');$('#question-hint').textContent=t('ui.this.operation.is.waiting.for.your.decision.closing.this');
    const target=$('#question-fields');target.replaceChildren(node('pre','approval-detail',approval.description));
    for(const [index,choice] of (approval.choices||[]).entries()){
      const label=node('label','question-option'),radio=node('input');radio.type='radio';radio.name='approval';radio.value=String(index);radio.disabled=approval.state!=='pending';
      const copy=node('span','',t(choice.label));if(choice.detail)copy.append(node('small','account-note',choice.detail));label.append(radio,copy);target.append(label);
    }
    $('#question-status').textContent='';$('#question-submit').disabled=approval.state!=='pending';if(!$('#question-dialog').open)$('#question-dialog').showModal();
  }
  function ask(job,question){
    saveQuestionDraft();
    selected={job,question};fields=[];remember(question.id);const target=$('#question-fields');target.replaceChildren();
    const draft=question.state==='pending'?questionDrafts.get(questionKey(selected))||{}:{};
    $('#question-dialog').dataset.kind='question';$('#question-heading').textContent=t('ui.codex.has.a.question');$('#question-submit').textContent=t('ui.submit.answer');$('#question-hint').textContent=t(question.blocking?'ui.codex.is.waiting.for.your.answer.you.can.close':'ui.codex.will.keep.working.while.you.consider.your.answer');
    for(const questionItem of question.questions||[]){
      const group=node('fieldset');group.append(node('legend','',questionItem.question));const name='question-'+questionItem.id;
      const saved=questionItem.isSecret?{}:draft[questionItem.id]||{};
      const choices=[];
      for(const option of questionItem.options||[]){
        const label=node('label','question-option'),radio=node('input');radio.type='radio';radio.name=name;radio.value=option.label;radio.checked=saved.choice===option.label;radio.disabled=question.state!=='pending';
        const copy=node('span','',option.label);if(option.description)copy.append(node('small','account-note',option.description));label.append(radio,copy);group.append(label);choices.push(radio);
      }
      const input=node(questionItem.isSecret?'input':'textarea');if(questionItem.isSecret)input.type='password';input.maxLength=8000;input.setAttribute('aria-label',questionItem.question);input.disabled=question.state!=='pending';input.autocomplete='off';
      input.value=saved.text||'';group.append(input);target.append(group);fields.push({id:questionItem.id,choices,input,secret:questionItem.isSecret===true});
    }
    $('#question-status').textContent=question.state==='pending'?'':t('question_expired');$('#question-submit').disabled=question.state!=='pending';
    if(!$('#question-dialog').open)$('#question-dialog').showModal();
  }
  $('#question-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!selected)return;
    if(selected.kind==='approval'){
      const choice=$('#question-fields input[name=approval]:checked');if(!choice){$('#question-status').textContent=t('invalid_answers');return;}
      $('#question-submit').disabled=true;
      try{await api('/api/jobs/'+selected.job.id+'/approvals',{id:selected.question.id,decision:Number(choice.value)});selected.question.state='answered';$('#question-dialog').close();}
      catch(error){$('#question-status').textContent=t(error.message);$('#question-submit').disabled=false;}return;
    }
    const submitted=selected,answers={};for(const field of fields){const choice=field.choices.find(input=>input.checked)?.value,text=field.input.value.trim();const value=[choice,text].filter(Boolean).join('\n'+t('question.addendum'));if(!value){$('#question-status').textContent=t('invalid_answers');return;}answers[field.id]={answers:[value]};}
    $('#question-submit').disabled=true;
    try{await api(`/api/jobs/${submitted.job.id}/questions`,{id:submitted.question.id,answers});questionDrafts.delete(questionKey(submitted));if(selected===submitted){submitted.question.state='answered';dismiss();}}
    catch(error){if(selected===submitted){$('#question-status').textContent=t(error.message);$('#question-submit').disabled=false;}}
  });
  for(const id of ['#question-close','#question-later'])$(id).addEventListener('click',dismiss);
  $('#question-dialog').addEventListener('cancel',event=>{event.preventDefault();dismiss();});
  $('#question-dialog').addEventListener('close',()=>{if(!$('#question-dialog').open){saveQuestionDraft();clearFields();}});
  return {render,userContent,userActions,appendTokenUsage:users.appendTokenUsage,executionDetails:steps.executionDetails,close:()=>{dismiss();questionDrafts.clear();quoteUI.clear();}};
};
