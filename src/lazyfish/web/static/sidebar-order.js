'use strict';
// Keep drag gestures and their temporary DOM order separate from stored conversations.
(function (root, create) {
  if (typeof module !== 'undefined' && module.exports) module.exports = create;
  else (root.LazyfishUI || (root.LazyfishUI = {})).sidebarOrder = create;
})(typeof globalThis !== 'undefined' ? globalThis : window,
function createSidebarOrder({document, onStart, onReorder, onEnd, report}) {
  const sidebar = document.getElementById('conversation-list');
  let gesture = null, hold = null, suppressClickUntil = 0, bound = false;
  const rows = group => Array.from(group.querySelectorAll('.conversation-row'));
  const order = group => rows(group).map(row => row.dataset.id);
  function prepare(target, x, y, touch) {
    if (gesture || sidebar.dataset.reordering || document.querySelector('#conversation-list input')) return;
    const button = target.closest('#pinned-conversations .conversation');
    if (!button) return;
    const row = button.closest('.conversation-row'), group = row.parentElement;
    gesture = {row, group, x, y, touch, ids:order(group), active:false};
    if (touch) hold = setTimeout(start, 350);
  }
  function start() {
    const state = gesture;
    if (!state || state.active) return;
    state.active = true; sidebar.dataset.reordering = 'true'; onStart();
    const box = state.row.getBoundingClientRect(), ghost = state.row.cloneNode(true);
    ghost.classList.add('conversation-drag-preview'); ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
    Object.assign(ghost.style, {left:box.left + 'px', top:box.top + 'px', width:box.width + 'px'});
    document.body.append(ghost); state.ghost = ghost; state.row.classList.add('is-dragging');
  }
  function move(x, y, event) {
    const state = gesture;
    if (!state) return;
    if (!state.active && Math.hypot(x - state.x, y - state.y) > 6) {
      if (state.touch) { clearTimeout(hold); gesture = null; return; }
      start();
    }
    if (!state.active) return;
    event.preventDefault();
    state.ghost.style.transform = `translate(${x - state.x}px, ${y - state.y}px)`;
    const target = document.elementFromPoint(x, y)?.closest('.conversation-row');
    if (target && target !== state.row && target.parentElement === state.group) {
      const current = rows(state.group);
      state.group.insertBefore(state.row, current.indexOf(target) > current.indexOf(state.row) ? target.nextSibling : target);
    }
    const box = sidebar.getBoundingClientRect();
    if (y < box.top + 24) sidebar.scrollTop -= 8;
    else if (y > box.bottom - 24) sidebar.scrollTop += 8;
  }
  async function finish(cancel = false) {
    clearTimeout(hold);
    const state = gesture; gesture = null;
    if (!state || !state.active) return;
    suppressClickUntil = Date.now() + 500;
    state.ghost.remove(); state.row.classList.remove('is-dragging');
    try {
      const ids = order(state.group);
      if (!cancel && ids.some((id, index) => id !== state.ids[index])) await onReorder(ids);
    } catch (error) { report(error); }
    finally { delete sidebar.dataset.reordering; onEnd(); }
  }
  function bind() {
    if (bound) return; bound = true;
    sidebar.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'touch' && event.button === 0) prepare(event.target, event.clientX, event.clientY, false);
    });
    document.addEventListener('pointermove', event => { if (gesture && !gesture.touch) move(event.clientX, event.clientY, event); });
    document.addEventListener('pointerup', () => { if (gesture && !gesture.touch) finish(); });
    document.addEventListener('pointercancel', () => { if (gesture && !gesture.touch) finish(true); });
    sidebar.addEventListener('touchstart', event => {
      if (event.touches.length !== 1) { finish(true); return; }
      const touch = event.touches[0]; prepare(event.target, touch.clientX, touch.clientY, true);
    }, {passive:true});
    sidebar.addEventListener('touchmove', event => {
      if (gesture && gesture.touch && event.touches.length === 1) move(event.touches[0].clientX, event.touches[0].clientY, event);
    }, {passive:false});
    sidebar.addEventListener('touchend', event => {
      if (!gesture || !gesture.touch) return;
      if (gesture.active) event.preventDefault(); finish();
    }, {passive:false});
    sidebar.addEventListener('touchcancel', () => finish(true));
    sidebar.addEventListener('contextmenu', event => { if (gesture?.active) event.preventDefault(); });
    for (const type of ['click', 'dblclick']) sidebar.addEventListener(type, event => {
      if (sidebar.dataset.reordering || Date.now() < suppressClickUntil && event.target.closest('.conversation')) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && gesture?.active) { event.preventDefault(); event.stopImmediatePropagation(); finish(true); }
    }, true);
    document.defaultView.addEventListener('blur', () => finish(true));
  }
  return {bind};
});
