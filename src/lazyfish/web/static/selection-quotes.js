'use strict';
// Excerpts remain plain text; selection never starts a model request.
window.LazyfishQuoteUI=function({node,icon,t}){
  const expanded=new Set();
  function render(quotes,key,remove=null){
    const details=node('details','quote-context'),summary=node('summary','quote-summary');
    summary.append(icon('quote'),node('span','',t('quote.count',{count:quotes.length})));details.append(summary);details.open=expanded.has(key);
    const list=node('div','quote-passages');
    quotes.forEach((quote,index)=>{
      const row=node('div','quote-passage'),heading=node('div','quote-passage-heading');
      heading.append(node('span','',t(quote.role==='user'?'quote.source.user':'quote.source.assistant')));
      if(remove){const button=node('button','quote-remove','×');button.type='button';button.setAttribute('aria-label',t('quote.remove',{index:index+1}));button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();remove(index);});heading.append(button);}
      row.append(heading,node('div','quote-text',quote.text));list.append(row);
    });
    details.append(list);details.addEventListener('toggle',()=>{if(details.open)expanded.add(key);else expanded.delete(key);if(expanded.size>200)expanded.delete(expanded.values().next().value);});return details;
  }
  return {render,clear:()=>expanded.clear()};
};
window.LazyfishTextSelection=function({node,t,getContext,onAdd}){
  const toolbar=node('div','text-selection-toolbar'),add=node('button','selection-add');
  toolbar.hidden=true;toolbar.setAttribute('role','toolbar');add.type='button';toolbar.append(add);document.body.append(toolbar);
  let selected=null,pointer=false,timer=0;
  const contextMatches=context=>{const now=getContext();return now&&context&&now.id===context.id&&now.epoch===context.epoch;};
  function hide(){toolbar.hidden=true;selected=null;clearTimeout(timer);}
  function source(node){const element=node?.nodeType===1?node:node?.parentElement;return element?.closest('.assistant-text,.user-text');}
  function update(){
    clearTimeout(timer);if(pointer||toolbar.contains(document.activeElement))return;
    const selection=window.getSelection(),context=getContext();
    if(!context||!selection||selection.isCollapsed||selection.rangeCount!==1)return hide();
    const range=selection.getRangeAt(0),start=source(range.startContainer),end=source(range.endContainer);
    if(!start||start!==end||!start.closest('#messages')||start.closest('.pending-send,.is-editing')||!start.isConnected)return hide();
    const text=selection.toString();if(!text.trim())return hide();
    const viewport=window.visualViewport,left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0,width=viewport?.width||innerWidth,height=viewport?.height||innerHeight;
    const rects=[...range.getClientRects()].filter(rect=>rect.width&&rect.height&&rect.bottom>top&&rect.top<top+height);
    if(!rects.length)return hide();
    const rect=rects.at(-1);selected={context,quote:{text,role:start.closest('.user-turn,.supplementary-instruction')?'user':'assistant'}};
    add.textContent=t('quote.add');toolbar.setAttribute('aria-label',t('quote.selection'));toolbar.hidden=false;
    const bounds=toolbar.getBoundingClientRect(),x=Math.max(left+8,Math.min(rect.left,left+width-bounds.width-8));
    let y=rect.bottom+8;if(y+bounds.height>top+height-8)y=rects[0].top-bounds.height-8;
    toolbar.style.left=x+'px';toolbar.style.top=Math.max(top+8,y)+'px';
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(update,100);}
  toolbar.addEventListener('pointerdown',event=>event.preventDefault());
  add.addEventListener('click',()=>{const value=selected;if(!value||!contextMatches(value.context))return hide();if(onAdd(value.quote)){window.getSelection()?.removeAllRanges();hide();}});
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
