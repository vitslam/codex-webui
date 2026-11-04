"use strict";
// Store only a message ID and geometry, never message text or credentials.
window.LazyfishScroll = function(container, content, {onRestore = () => {}} = {}) {
  const key = "lazyfish.scroll.v1";
  let saved = {}, id = null, current = null, frame = 0, applying = false, timer = 0;
  try { saved = JSON.parse(localStorage.getItem(key)) || {}; } catch { /* storage may be disabled */ }
  if (typeof saved !== "object" || Array.isArray(saved)) saved = {};
  function read(cid) {
    const value = saved[cid];
    return value && typeof value.bottom === "boolean" && Number.isFinite(value.offset) &&
      (value.bottom || /^[a-f0-9]{32}$/.test(value.job)) && typeof value.anchor === "string" ? value : null;
  }
  function capture() {
    const top = container.getBoundingClientRect().top;
    const anchors = [...content.querySelectorAll("[data-anchor]")];
    const element = anchors.find((item) => item.getBoundingClientRect().bottom > top + 2);
    return {bottom:container.scrollHeight-container.scrollTop-container.clientHeight < 8,
      job:element?.closest("[data-job]")?.dataset.job || "", anchor:element?.dataset.anchor || "",
      offset:element ? element.getBoundingClientRect().top-top : 0};
  }
  function persist() {
    if (!id || !current) return;
    delete saved[id]; saved[id] = current;
    const entries = Object.entries(saved).slice(-80);
    saved = Object.fromEntries(entries);
    try { localStorage.setItem(key,JSON.stringify(saved)); } catch { /* best effort */ }
  }
  function apply() {
    if (!id || !current) return;
    applying = true;
    if (current.bottom) container.scrollTop = container.scrollHeight;
    else {
      const element = [...content.querySelectorAll("[data-anchor]")].find((item) =>
        item.dataset.anchor === current.anchor && item.closest("[data-job]")?.dataset.job === current.job);
      if (element) container.scrollTop += element.getBoundingClientRect().top-container.getBoundingClientRect().top-current.offset;
    }
    onRestore();
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { applying = false; });
  }
  function remember() { if (id) { current = capture(); persist(); } }
  container.addEventListener("scroll",() => {
    if (!applying && id) { current = capture(); clearTimeout(timer); timer = setTimeout(persist,60); }
  });
  // Take over immediately when a person scrolls, including during a late reflow.
  for (const name of ["wheel","touchstart","pointerdown","keydown"]) container.addEventListener(name,() => {
    applying = false; clearTimeout(timer); current = capture();
  },{passive:true});
  const resize = new ResizeObserver(() => apply());
  resize.observe(content); resize.observe(container);
  document.fonts?.ready.then(apply);
  window.addEventListener("pagehide",remember);
  window.addEventListener("beforeunload",remember);
  return {
    read, remember,following:()=>current?.bottom===true,
    suspend() { clearTimeout(timer); id = null; current = null; },
    activate(cid,value) { id = cid; current = value || {bottom:true,job:"",anchor:"",offset:0}; apply(); persist(); },
    mutate(callback) { clearTimeout(timer); if (id && !applying) current = capture(); callback(); apply(); },
    bottom() { if (id) { current = {bottom:true,job:"",anchor:"",offset:0}; apply(); persist(); } },
  };
};
