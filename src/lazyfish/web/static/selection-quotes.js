'use strict';
// Excerpts remain plain text; selection never starts a model request.
window.LazyfishQuoteUI=function({node,icon,t}){
  const expanded=new Set();
  let editor=null;
  function editQuote(quotes,quote,edit,trigger){
    if(editor?.open)return;
    const dialog=node('dialog','quote-editor-dialog'),form=node('form','quote-editor-form'),title=node('h2','',t('quote.edit')),field=node('textarea','quote-editor-text'),actions=node('div','quote-editor-actions');
    const id='quote-editor-'+Math.random().toString(36).slice(2);title.id=id;dialog.setAttribute('aria-labelledby',id);field.setAttribute('aria-label',t('quote.selected'));field.value=quote.text;field.required=true;field.maxLength=8000;field.rows=6;
    const cancel=node('button','',t('cancel')),save=node('button','',t('save'));cancel.type='button';save.type='submit';actions.append(cancel,save);form.append(title,field,actions);dialog.append(form);document.body.append(dialog);editor=dialog;
    field.addEventListener('input',()=>field.setCustomValidity(''));
    cancel.addEventListener('click',()=>dialog.close());
    form.addEventListener('submit',event=>{
      event.preventDefault();const text=field.value,index=quotes.indexOf(quote),length=Array.from(text).length;
      const invalid=!text.trim()||length>8000||quotes.reduce((total,value)=>total+Array.from(value===quote?text:value.text).length,0)>24000;
      const duplicate=quotes.some(value=>value!==quote&&value.role===quote.role&&value.text===text);
      if(invalid||duplicate){field.setCustomValidity(t(duplicate?'quote.duplicate':'invalid_quotes'));field.reportValidity();return;}
      if(index<0){dialog.close();return;}edit(index,text);dialog.close();
    });
    dialog.addEventListener('close',()=>{dialog.remove();if(editor===dialog)editor=null;if(trigger.isConnected)trigger.focus({preventScroll:true});});
    dialog.showModal();field.focus();
  }
  function render(quotes,key,remove=null,edit=null,clear=null){
    const draft=Boolean(remove),details=node('details','quote-context'+(draft?' quote-draft':'')),summary=node('summary','quote-summary');
    summary.append(icon('comment'),node('span','',t(draft?'quote.draftCount':'quote.count',{count:quotes.length})));details.append(summary);details.open=expanded.has(key);
    const list=node('div','quote-passages');
    if(draft){list.setAttribute('popover','auto');list.setAttribute('aria-label',t('quote.selected'));}
    if(clear){
      const button=node('button','quote-clear','×');button.type='button';button.setAttribute('aria-label',t('quote.clear'));button.title=t('quote.clear');
      button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(list.matches(':popover-open'))list.hidePopover();details.open=false;expanded.delete(key);clear();});summary.append(button);
    }
    quotes.forEach((quote,index)=>{
      const row=node('div','quote-passage'),heading=node('div','quote-passage-heading');
      if(draft)row.append(node('span','quote-number',String(index+1)+'.'));
      heading.append(node('span','',t(draft?'quote.selected':quote.role==='user'?'quote.source.user':'quote.source.assistant')));
      if(edit){const button=node('button','quote-edit');button.append(icon('edit'));button.type='button';button.setAttribute('aria-label',t('quote.edit'));button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(list.matches(':popover-open'))list.hidePopover();details.open=false;expanded.delete(key);editQuote(quotes,quote,edit,summary);});heading.append(button);}
      if(remove){const button=node('button','quote-remove');button.append(icon('trash'));button.type='button';button.setAttribute('aria-label',t('quote.remove',{index:index+1}));button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();remove(index);});heading.append(button);}
      row.append(heading,node('div','quote-text',quote.text));list.append(row);
    });
    function position(){
      const viewport=window.visualViewport,left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0,width=viewport?.width||innerWidth,height=viewport?.height||innerHeight,rect=summary.getBoundingClientRect();
      list.style.width=Math.min(520,width-24)+'px';
      const above=rect.top-top-16,below=top+height-rect.bottom-16,up=above>=Math.min(200,below);
      list.style.maxHeight=Math.max(72,Math.min(360,up?above:below))+'px';
      const bounds=list.getBoundingClientRect();
      list.style.left=Math.max(left+12,Math.min(rect.left,left+width-bounds.width-12))+'px';
      list.style.top=(up?Math.max(top+8,rect.top-bounds.height-8):rect.bottom+8)+'px';
    }
    if(draft){
      let closeTimer=0;
      const cancelClose=()=>clearTimeout(closeTimer);
      function leave(){cancelClose();closeTimer=setTimeout(()=>{if(!details.isConnected||summary.matches(':hover')||list.matches(':hover')||details.contains(document.activeElement))return;if(list.matches(':popover-open'))list.hidePopover();details.open=false;expanded.delete(key);},180);}
      summary.addEventListener('pointerenter',event=>{if(event.pointerType!=='mouse'||editor?.open)return;cancelClose();details.open=true;});
      summary.addEventListener('pointerleave',leave);list.addEventListener('pointerenter',cancelClose);list.addEventListener('pointerleave',leave);
      details.addEventListener('focusin',cancelClose);details.addEventListener('focusout',leave);
      list.addEventListener('toggle',event=>{if(event.newState==='closed'&&details.isConnected){details.open=false;expanded.delete(key);}});
      // Native popovers escape composer clipping and close on outside click or Escape.
      details.addEventListener('keydown',event=>{if(event.key==='Escape'&&details.open){event.preventDefault();event.stopPropagation();if(list.matches(':popover-open'))list.hidePopover();details.open=false;expanded.delete(key);summary.focus({preventScroll:true});}},true);
    }
    details.append(list);details.addEventListener('toggle',()=>{
      if(!details.isConnected)return;
      if(details.open)expanded.add(key);else expanded.delete(key);
      if(expanded.size>200)expanded.delete(expanded.values().next().value);
      if(draft&&list.showPopover){if(details.open){if(!list.matches(':popover-open'))list.showPopover();position();}else if(list.matches(':popover-open'))list.hidePopover();}
    });return details;
  }
  return {render,clear:()=>{expanded.clear();if(editor?.open)editor.close();}};
};
window.LazyfishTextSelection=function({node,t,getContext,onAdd,onSide}){
  const toolbar=node('div','text-selection-toolbar'),add=node('button','selection-add'),side=node('button','selection-add selection-side');
  toolbar.hidden=true;toolbar.setAttribute('role','toolbar');add.type='button';side.type='button';toolbar.append(add,side);document.body.append(toolbar);
  let selected=null,pointer=false,timer=0;
  const contextMatches=context=>{const now=getContext(selected?.root);return now&&context&&now.id===context.id&&now.epoch===context.epoch;};
  function hide(){toolbar.hidden=true;selected=null;clearTimeout(timer);}
  function source(node){const element=node?.nodeType===1?node:node?.parentElement;return element?.closest('.assistant-text,.user-text');}
  function constrainMultiClick(event){
    if(event.detail<2)return;
    const root=source(event.target),selection=window.getSelection();
    if(!root?.closest('#messages,#side-transcript')||root.closest('.is-editing')||!selection||selection.isCollapsed||selection.rangeCount!==1)return;
    // Native triple-click can end at the next block, including its separators.
    // Keep native word/paragraph segmentation, but contain it within the text block.
    const block=event.detail>=3?event.target.closest('p,li,pre,blockquote,h1,h2,h3,h4,h5,h6,td,th'):null;
    const scope=block&&root.contains(block)?block:root,bounds=document.createRange();bounds.selectNodeContents(scope);
    const range=selection.getRangeAt(0).cloneRange();
    if(!range.intersectsNode(scope))return;
    if(range.compareBoundaryPoints(Range.START_TO_START,bounds)<0)range.setStart(bounds.startContainer,bounds.startOffset);
    if(range.compareBoundaryPoints(Range.END_TO_END,bounds)>0)range.setEnd(bounds.endContainer,bounds.endOffset);
    if(event.detail>=3){
      // Text-node endpoints avoid block-edge selection painting in WebKit.
      const walker=document.createTreeWalker(scope,NodeFilter.SHOW_TEXT),parts=[];
      while(walker.nextNode()){
        const text=walker.currentNode;if(!range.intersectsNode(text))continue;
        const start=text===range.startContainer?range.startOffset:0,end=text===range.endContainer?range.endOffset:text.length;
        if(start<end)parts.push({text,start,end});
      }
      while(parts.length){const part=parts[0];while(part.start<part.end&&/[\r\n\u2028\u2029]/.test(part.text.data[part.start]))part.start++;if(part.start<part.end)break;parts.shift();}
      while(parts.length){const part=parts.at(-1);while(part.end>part.start&&/[\r\n\u2028\u2029]/.test(part.text.data[part.end-1]))part.end--;if(part.end>part.start)break;parts.pop();}
      if(parts.length){range.setStart(parts[0].text,parts[0].start);range.setEnd(parts.at(-1).text,parts.at(-1).end);}
    }
    selection.removeAllRanges();selection.addRange(range);
  }
  document.addEventListener('click',constrainMultiClick);
  function update(){
    clearTimeout(timer);if(pointer||toolbar.contains(document.activeElement))return;
    const selection=window.getSelection();
    if(!selection||selection.isCollapsed||selection.rangeCount!==1)return hide();
    const range=selection.getRangeAt(0),start=source(range.startContainer),end=source(range.endContainer);
    if(!start||start!==end||!start.closest('#messages,#side-transcript')||start.closest('.pending-send,.side-pending,.is-editing')||!start.isConnected)return hide();
    const context=getContext(start);if(!context)return hide();
    const text=selection.toString();if(!text.trim())return hide();
    const viewport=window.visualViewport,left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0,width=viewport?.width||innerWidth,height=viewport?.height||innerHeight;
    const rects=[...range.getClientRects()].filter(rect=>rect.width&&rect.height&&rect.bottom>top&&rect.top<top+height);
    if(!rects.length)return hide();
    const rect=rects.at(-1);selected={context,root:start,quote:{text,role:start.closest('.user-turn,.supplementary-instruction,.side-user')?'user':'assistant'}};
    add.textContent=t(context.side?'side.addToMain':'quote.add');side.textContent=t('side.ask');side.hidden=Boolean(context.side||!onSide);toolbar.setAttribute('aria-label',t('quote.selection'));toolbar.hidden=false;
    const bounds=toolbar.getBoundingClientRect(),x=Math.max(left+8,Math.min(rect.left,left+width-bounds.width-8));
    let y=rect.bottom+8;if(y+bounds.height>top+height-8)y=rects[0].top-bounds.height-8;
    toolbar.style.left=x+'px';toolbar.style.top=Math.max(top+8,y)+'px';
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(update,100);}
  toolbar.addEventListener('pointerdown',event=>event.preventDefault());
  add.addEventListener('click',()=>{const value=selected;if(!value||!contextMatches(value.context))return hide();if(onAdd(value.quote,value.context)){window.getSelection()?.removeAllRanges();hide();}});
  side.addEventListener('click',()=>{const value=selected;if(!value||!contextMatches(value.context))return hide();if(onSide?.(value.quote)){window.getSelection()?.removeAllRanges();hide();}});
  document.querySelector('#side-transcript').addEventListener('scroll',hide,{passive:true});
  document.addEventListener('pointerdown',event=>{if(toolbar.contains(event.target))return;pointer=true;hide();},true);
  document.addEventListener('pointerup',()=>{pointer=false;schedule();});
  document.addEventListener('pointercancel',()=>{pointer=false;hide();});
  document.addEventListener('selectionchange',schedule);
  document.addEventListener('keyup',event=>{if(event.key!=='Escape')schedule();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!toolbar.hidden){hide();event.preventDefault();}},true);
  document.querySelector('#messages').addEventListener('scroll',hide,{passive:true});
  window.addEventListener('resize',schedule);window.visualViewport?.addEventListener('resize',schedule);
  return {hide};
};
