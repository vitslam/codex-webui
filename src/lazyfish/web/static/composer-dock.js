'use strict';
// Own composer visibility during history navigation and explicit user gestures.
(function (root, create) {
  if (typeof module !== 'undefined' && module.exports) module.exports = create;
  else (root.LazyfishUI || (root.LazyfishUI = {})).composerDock = create;
})(typeof globalThis !== 'undefined' ? globalThis : window,
function createComposerDock({document, onCollapse, onExpand, onWake, onBottom, isFollowing = () => false}) {
  const thread = document.getElementById('messages');
  const dock = document.querySelector('.composer-dock');
  const form = document.getElementById('composer');
  const handle = document.getElementById('composer-handle');
  const workspace = document.getElementById('chat');
  let collapsed = false, bound = false, lastTop = 0, animation = null;
  const distance = () => thread.scrollHeight - thread.clientHeight - thread.scrollTop;
  const editing = () => !!document.querySelector('.message-editor');
  const obstructed = () => editing() || !!document.querySelector('dialog[open], #workspace-menu:not([hidden])') || (!document.body.classList.contains('sidebar-hidden') && document.defaultView.matchMedia('(max-width:760px)').matches);
  function lineTarget() {
    const box = dock.getBoundingClientRect();
    const style = document.defaultView.getComputedStyle(handle);
    const line = document.defaultView.getComputedStyle(handle, '::before');
    const width = parseFloat(line.width), height = parseFloat(line.height);
    return {x:box.left + handle.offsetLeft + handle.offsetWidth / 2,
      bottom:box.top + handle.offsetTop + (handle.offsetHeight + height) / 2 + parseFloat(style.getPropertyValue('--handle-offset')),
      width, height};
  }
  function animateForm(show, immediate, target) {
    const current = animation && document.defaultView.getComputedStyle(form);
    const previous = current && {opacity:current.opacity, transform:current.transform};
    if (animation) { animation.cancel(); animation = null; }
    form.inert = !show;
    if (immediate || !form.animate) {
      form.hidden = !show; return;
    }
    form.hidden = false;
    const box = form.getBoundingClientRect();
    const reduced = document.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const folded = reduced ? 'none' : `translate(${target.x - box.left - box.width / 2}px, ${target.bottom - box.bottom}px) scale(${target.width / box.width}, ${target.height / box.height})`;
    const from = previous || {opacity:show ? 0 : 1, transform:show ? folded : 'none'};
    if (reduced) from.transform = 'none';
    const middleOpacity = reduced ? (show ? .55 : Number(from.opacity) * .45) : (show ? 1 : Math.min(Number(from.opacity), .9));
    const next = form.animate([
      {...from, transformOrigin:'50% 100%', offset:0},
      {opacity:middleOpacity, offset:!reduced && !show ? .8 : .55},
      {opacity:show ? 1 : 0, transform:show ? 'none' : folded, transformOrigin:'50% 100%', offset:1},
    ], {duration:reduced ? 160 : 360, easing:'cubic-bezier(.25, .1, .25, 1)', fill:'both'});
    animation = next;
    next.onfinish = () => {
      if (animation !== next) return;
      form.hidden = !show; animation = null; next.cancel();
    };
  }
  function expand(bottom = false, immediate = false) {
    if (!collapsed) return;
    const target = lineTarget();
    const top = thread.scrollTop;
    collapsed = false;
    form.hidden = false; handle.hidden = true; dock.classList.remove('is-collapsed');
    workspace.classList.remove('composer-collapsed'); workspace.style.removeProperty('--composer-reserve');
    onExpand();
    animateForm(true, immediate, target);
    if (bottom) onBottom();
    thread.scrollTop = bottom ? thread.scrollHeight : top;
    lastTop = thread.scrollTop;
  }
  function collapse(manual = false, immediate = false) {
    const active = document.activeElement;
    if (collapsed || !immediate && (obstructed() || form.querySelector('details[open]'))) return;
    // Auto-growing fields and mobile focus panning can emit scroll events while typing.
    if (!manual && (workspace.classList.contains('is-empty') ||
        form.contains(active) && active.matches('input, textarea, [contenteditable]:not([contenteditable="false"])'))) return;
    const top = thread.scrollTop;
    // Keep the scroll maximum unchanged when the dock leaves the flex layout.
    workspace.style.setProperty('--composer-reserve', dock.offsetHeight + 'px');
    onCollapse(); collapsed = true;
    if (form.contains(active)) { active.blur(); thread.focus({preventScroll:true}); }
    handle.style.animation = immediate ? 'none' : '';
    handle.hidden = false; dock.classList.add('is-collapsed');
    workspace.classList.add('composer-collapsed');
    animateForm(false, immediate, immediate ? null : lineTarget());
    thread.scrollTop = top; lastTop = thread.scrollTop;
  }
  function reset(restoreCollapsed = false) {
    // Restore the draft's expanded dimensions and saved visibility in one paint.
    expand(false, true);
    if (restoreCollapsed) collapse(true, true);
    else animateForm(true, true);
    settlePosition();
  }
  function settlePosition() { lastTop = thread.scrollTop; }
  function wake() { expand(); onWake(); }
  function syncPosition() {
    const top = thread.scrollTop;
    if (Math.abs(top - lastTop) < .01) return;
    lastTop = top;
    if (obstructed() || form.querySelector('details[open]')) return;
    // Match conversation-view's bottom tolerance; Safari can leave fractional pixels after layout/zoom.
    // Deferred content can move the scroll position before the timeline's resize
    // observer restores the bottom. Let it settle while bottom following is active.
    if (distance() < 4) expand(true);
    else if (!isFollowing()) collapse();
  }
  function bind() {
    if (bound || !thread) return;
    bound = true; lastTop = thread.scrollTop;
    handle.addEventListener('click', wake);
    thread.addEventListener('scroll', syncPosition, {passive:true});
    document.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || obstructed()) return;
      const control = event.target.closest('input, textarea, select, button, a, summary, [contenteditable]:not([contenteditable="false"]), [role="slider"]');
      if (event.key === 'Escape' && !collapsed) {
        if (control && !form.contains(control)) return;
        event.preventDefault(); collapse(true); return;
      }
      if (control) return;
      if (collapsed && event.key === ' ' && !event.shiftKey) { event.preventDefault(); wake(); }
    });
  }
  return {bind, reset, expand, settlePosition, get collapsed() { return collapsed; }};
});
