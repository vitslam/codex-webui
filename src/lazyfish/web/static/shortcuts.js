"use strict";
window.LazyfishShortcuts = function({entries,current,select,hints,toggleSidebar,enabled}) {
  const presets={ctrlShift:['ctrlKey','shiftKey'],ctrl:['ctrlKey'],alt:['altKey'],metaAlt:['metaKey','altKey'],ctrlAlt:['ctrlKey','altKey'],altShift:['altKey','shiftKey'],ctrlAltShift:['ctrlKey','altKey','shiftKey'],meta:['metaKey'],disabled:[]};
  const modifiers=['ctrlKey','shiftKey','altKey','metaKey'];
  let prefix='ctrlShift',sidebarPrefix='ctrlShift',candidate=null,pending=null,held=false,mru=[];
  try{prefix=localStorage.getItem('lazyfish.shortcut')||prefix;sidebarPrefix=localStorage.getItem('lazyfish.sidebarShortcut')||sidebarPrefix;}catch{}
  if(!presets[prefix]||prefix==='meta')prefix='ctrlShift';if(!presets[sidebarPrefix])sidebarPrefix='ctrlShift';
  const match=(event,name)=>presets[name].length&&modifiers.every(key=>!!event[key]===presets[name].includes(key));
  const blocked=event=>!enabled()||document.querySelector('.message-editor,.conversation-rename-input,#conversation-list[data-reordering]')||event.target?.closest?.('input:not(#prompt),textarea:not(#prompt),select,[contenteditable]:not([contenteditable="false"])');
  function clear(){candidate=null;pending=null;held=false;hints(false,null);}
  function identity(event){return event.code||(event.key==='Tab'?'Tab':/^[1-9]$/.test(event.key)?'Digit'+event.key:['\\','|'].includes(event.key)?'Backslash':null);}
  window.addEventListener('keydown',event=>{
    if(event.isComposing||event.keyCode===229||event.getModifierState?.('AltGraph')){clear();return;}
    if(event.key==='Escape'){if(pending){event.preventDefault();event.stopPropagation();}clear();return;}
    if(event.defaultPrevented)return;
    if(identity(event)==='Tab'&&!event.ctrlKey&&!event.metaKey&&!event.altKey){clear();if(enabled()&&!document.querySelector('dialog[open]'))event.preventDefault();return;}
    if(blocked(event)){clear();return;}
    held=Boolean(match(event,prefix));hints(held,candidate);
    const code=identity(event),digit=/^(?:Digit|Numpad)([1-9])$/.exec(code||''),sidebar=code==='Backslash';
    if(!digit&&code!=='Tab'&&!sidebar){if(!['Control','Alt','Shift','Meta'].includes(event.key)){pending=null;candidate=null;hints(held,null);}return;}
    const chosen=sidebar?sidebarPrefix:prefix;
    if(!match(event,chosen)){clear();return;}
    event.preventDefault();if(event.repeat)return;
    candidate=sidebar?null:code==='Tab'?mru.find(id=>id!==current()):entries()[Number(digit[1])-1]?.id;
    pending=sidebar||candidate?{code,prefix:chosen,sidebar}:null;hints(held,candidate);
  },true);
  window.addEventListener('keyup',event=>{
    if(!pending){if(held&&!match(event,prefix))clear();return;}
    if(event.isComposing||event.getModifierState?.('AltGraph')||!match(event,pending.prefix)){clear();return;}
    if(identity(event)!==pending.code)return;
    event.preventDefault();const id=candidate,sidebar=pending.sidebar;pending=null;candidate=null;hints(held,null);
    if(blocked(event)||document.hidden)return;
    if(sidebar)toggleSidebar();else if(id!==current())select(id);
  },true);
  window.addEventListener('blur',clear);document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();});
  document.addEventListener('pointerdown',clear);document.addEventListener('focusin',event=>{if(event.target?.closest?.('input:not(#prompt),textarea:not(#prompt),select'))clear();});
  return {clear,get prefix(){return prefix;},get sidebarPrefix(){return sidebarPrefix;},
    set(value){if(presets[value]&&value!=='meta'){clear();prefix=value;try{localStorage.setItem('lazyfish.shortcut',value);}catch{}}},
    setSidebar(value){if(presets[value]){clear();sidebarPrefix=value;try{localStorage.setItem('lazyfish.sidebarShortcut',value);}catch{}}},
    visit(id){mru=[id,...mru.filter(value=>value!==id)].slice(0,50);},
    label(){return {ctrlShift:'Ctrl ⇧',ctrl:'Ctrl',alt:'⌥',metaAlt:'⌘ ⌥',ctrlAlt:'Ctrl ⌥',altShift:'⌥ ⇧',ctrlAltShift:'Ctrl ⌥ ⇧',disabled:''}[prefix];}};
};
