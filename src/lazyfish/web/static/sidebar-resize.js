'use strict';
// Desktop sidebar width is a browser preference; mobile keeps its overlay layout.
window.LazyfishSidebarResize=function({onResize=()=>{}}={}){
  const root=document.documentElement,handle=document.querySelector('#sidebar-resizer'),sidebar=document.querySelector('#sidebar');
  const key='lazyfish.sidebar.width';let preferred=null,drag=null,notified=null;
  try{const saved=Number(localStorage.getItem(key));if(Number.isFinite(saved)&&saved>=180&&saved<=480)preferred=saved;}catch{}
  function enabled(){return matchMedia('(min-width:761px)').matches&&!document.body.classList.contains('sidebar-hidden');}
  function maximum(){const side=document.body.classList.contains('side-chat-open')&&matchMedia('(min-width:1101px)').matches?Math.max(300,innerWidth*.25)+5:0;return Math.max(180,Math.min(480,innerWidth-side-320));}
  function remember(){try{preferred===null?localStorage.removeItem(key):localStorage.setItem(key,String(preferred));}catch{}}
  function refresh(){
    if(!enabled()){end();if(notified!==0){notified=0;onResize();}return;}
    const limit=maximum();
    if(preferred===null)root.style.removeProperty('--sidebar-user-width');else root.style.setProperty('--sidebar-user-width',Math.min(limit,Math.max(180,preferred))+'px');
    const width=sidebar.getBoundingClientRect().width||parseFloat(getComputedStyle(sidebar).width);
    handle.setAttribute('aria-valuenow',Math.round(width));handle.setAttribute('aria-valuemax',Math.floor(limit));
    const signature=width+':'+innerWidth+':'+document.body.classList.contains('side-chat-open');if(signature!==notified){notified=signature;onResize();}
  }
  function set(value){preferred=Math.min(maximum(),Math.max(180,value));refresh();}
  function end(){if(!drag)return;const pointer=drag.pointer;drag=null;document.body.classList.remove('sidebar-resizing');try{if(handle.hasPointerCapture(pointer))handle.releasePointerCapture(pointer);}catch{}remember();}
  handle.addEventListener('pointerdown',event=>{if(event.button!==0||!enabled())return;drag={pointer:event.pointerId,x:event.clientX,width:sidebar.getBoundingClientRect().width};handle.setPointerCapture(event.pointerId);document.body.classList.add('sidebar-resizing');event.preventDefault();});
  handle.addEventListener('pointermove',event=>{if(drag?.pointer===event.pointerId)set(drag.width+event.clientX-drag.x);});
  handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);handle.addEventListener('lostpointercapture',end);window.addEventListener('blur',end);
  handle.addEventListener('dblclick',()=>{end();preferred=null;remember();refresh();});
  handle.addEventListener('keydown',event=>{if(!enabled()||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const width=sidebar.getBoundingClientRect().width;set(event.key==='Home'?180:event.key==='End'?maximum():width+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?24:8));remember();});
  window.addEventListener('resize',refresh);window.addEventListener('lazyfish:side-layout',refresh);
  refresh();return {refresh};
};
