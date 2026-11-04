"use strict";
// Native timing chart and slot cards reuse the reference components.
window.LazyfishDiagnostics=function({node:makeNode,icon,t,api,selectConversation,connected}){
 const node=(tag,text,cls)=>makeNode(tag,cls,text),accountNote=text=>node('p',text,'account-note');
 const i18n={number:(v,o)=>Number(v).toLocaleString(document.documentElement.lang,o),date:(v,o)=>new Date(v).toLocaleString(document.documentElement.lang,o)};
 const localTime=value=>i18n.date(value*1000);
function performanceChart(requests) {
  const ordered = [...requests].sort((a, b) => a.finished_at - b.finished_at);
  const chart = node('div', undefined, 'performance-chart'), graph = node('div', undefined, 'performance-graph');
  chart.setAttribute('role', 'group'); chart.setAttribute('aria-label', t('ui.recent.model.requests'));
  const scale = node('div', undefined, 'performance-scale'), plot = node('div', undefined, 'performance-plot');
  scale.setAttribute('aria-hidden', 'true');
  const peak = Math.max(1, ...ordered.map(request => request.duration_ms / 1000));
  const step = 10 ** Math.floor(Math.log10(peak)), ceiling = Math.ceil(peak / step) * step;
  const seconds = (value, precise = false) => t('duration.seconds', {seconds:i18n.number(value,
    {minimumFractionDigits:precise ? 1 : 0, maximumFractionDigits:1})});
  for (const value of [ceiling, ceiling / 2, 0]) scale.append(node('span', seconds(value)));
  const selection = node('div', undefined, 'performance-selection');
  const time = node('time'), model = node('span', '', 'performance-model'), duration = node('span', '', 'performance-duration');
  selection.append(time, model, duration); selection.setAttribute('role', 'status');
  const buttons = [];
  function choose(index) {
    const request = ordered[index];
    buttons.forEach((button, position) => { button.setAttribute('aria-pressed', String(position === index)); button.tabIndex = position === index ? 0 : -1; });
    time.dateTime = new Date(request.finished_at * 1000).toISOString(); time.textContent = localTime(request.finished_at);
    model.textContent = request.model || t('ui.unknown.model'); model.title = model.textContent;
    duration.replaceChildren(node('span', seconds(request.duration_ms / 1000, true)));
    if (request.failed) duration.append(node('span', t('ui.failed'), 'performance-failed'));
  }
  ordered.forEach((request, index) => {
    const button = node('button', undefined, 'performance-bar'), fill = node('span'); button.type = 'button';
    button.dataset.failed = String(!!request.failed); fill.style.height = (request.duration_ms / 1000 / ceiling * 100) + '%';
    button.setAttribute('aria-label', [localTime(request.finished_at), request.model || t('ui.unknown.model'),
      seconds(request.duration_ms / 1000, true), request.failed && t('ui.failed')].filter(Boolean).join(' · '));
    button.append(fill); buttons.push(button); plot.append(button);
    for (const event of ['pointerenter', 'focus', 'click']) button.addEventListener(event, () => choose(index));
    button.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const next = {ArrowLeft:index - 1, ArrowRight:index + 1, Home:0, End:ordered.length - 1}[event.key];
      if (next == null) return;
      event.preventDefault(); buttons[Math.max(0, Math.min(ordered.length - 1, next))].focus();
    });
  });
  const range = node('div', undefined, 'performance-range');
  for (const request of [ordered[0], ordered[ordered.length - 1]]) {
    const label = node('span', i18n.date(request.finished_at * 1000,
      {month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}));
    label.title = localTime(request.finished_at); range.append(label);
  }
  graph.append(scale, plot); chart.append(graph, range, selection, accountNote(t('ui.request.chart.hint')));
  choose(ordered.length - 1); return chart;
}

 const container=document.querySelector('#diagnostics'),host=node('div',undefined,'local-runtime-diagnostics');container.append(host);
 let epoch=0,cached=null;
 window.addEventListener('lazyfish-panel',event=>{
   const generation=++epoch;if(event.detail.page!=='diagnostics')return;
   const current=()=>generation===epoch&&document.querySelector('#account-dialog').open&&!container.hidden;
   const connection=node('p',t(connected()?'ui.live.updates.connected':'ui.polling'),'account-note');
   const slots=node('div',undefined,'worker-monitor'),performance=node('div',undefined,'account-performance');
   host.replaceChildren(connection,slots,performance);
   window.LazyfishUI.workerMonitor({document,window,node,icon,t,i18n,target:slots,current,
     api:async(path,data)=>{try{return await api('/api/runtime',data);}catch(error){throw new Error(t(error.message));}},
     onConversation:id=>{document.querySelector('#account-dialog').close();selectConversation(id);}});
   function draw(data){performance.replaceChildren(node('h3',t('ui.recent.model.requests')),accountNote(t('ui.the.last.20.completed.model.requests.a.request.duration')));performance.append(data.requests.length?performanceChart(data.requests):accountNote(t('ui.no.model.request.timings.recorded')));}
   if(cached)draw(cached);
   async function refresh(){if(!current())return;try{const data=await api('/api/performance');if(current()){cached=data;draw(data);connection.textContent=t(connected()?'ui.live.updates.connected':'ui.polling');}}catch(error){if(current()&&!cached)performance.replaceChildren(accountNote(t(error.message)));}finally{if(current())setTimeout(refresh,3000);}}
   refresh();
 });
};
