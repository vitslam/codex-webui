'use strict';
(function (root, create) {
  if (typeof module !== 'undefined' && module.exports) module.exports = create;
  else (root.LazyfishUI || (root.LazyfishUI = {})).workerMonitor = create;
})(typeof globalThis !== 'undefined' ? globalThis : window,
function createWorkerMonitor({document, window, node, icon, t, api, i18n, target, current, onConversation}) {
  const heading = node('h3', t('worker.heading')), note = node('p', '', 'account-note');
  const header = node('div', undefined, 'worker-header');
  const summary = node('div', undefined, 'worker-summary'), rows = node('div', undefined, 'worker-slots');
  header.append(heading, summary);
  const controls = node('div', undefined, 'worker-controls'), label = node('label', t('worker.concurrency'));
  const select = node('select'), save = node('button', t('ui.save'), 'account-button');
  select.id = 'worker-concurrency'; label.htmlFor = select.id; save.type = 'button'; save.id = 'worker-concurrency-save';
  const empty = node('option', '—'); empty.value = ''; select.append(empty);
  for (let count = 1; count <= 16; count++) { const option = node('option', String(count)); option.value = count; select.append(option); }
  const status = node('p', '', 'account-note'), error = node('p', '', 'account-error'), fetchError = node('p', '', 'account-error'); error.setAttribute('role', 'alert');
  const hint = node('p', t('worker.resize.hint'), 'account-note');
  controls.append(label, select, save); target.append(header, note, fetchError, rows, controls, status, hint, error);
  let dirty = false, saving = false, selectedId = null, latest = null;
  const entries = new Map();
  select.addEventListener('change', () => { dirty = true; save.disabled = !select.value || saving; });
  function duration(value) {
    const seconds = Math.max(0, Math.floor(value));
    return seconds >= 3600 ? t('duration.hours', {hours:Math.floor(seconds / 3600), minutes:Math.floor(seconds / 60) % 60, seconds:seconds % 60}) :
      seconds >= 60 ? t('duration.minutes', {minutes:Math.floor(seconds / 60), seconds:seconds % 60}) : t('duration.seconds', {seconds});
  }
  function slotHeading(slot) {
    return t('worker.slot', {number:slot.id + 1}) + ' · ' + t('worker.state.' + slot.state);
  }
  function showSelection() {
    for (const [id, card] of entries) {
      card.dataset.selected = String(id === selectedId);
      card.firstElementChild.setAttribute('aria-pressed', String(id === selectedId));
    }
  }
  function draw(data) {
    latest = data;
    const desired = data.target_concurrency || data.reported_target;
    if (!dirty && !saving) select.value = desired || '';
    save.disabled = saving || !select.value;
    note.textContent = !data.received_at ? t('worker.waiting') : data.stale ? t('worker.stale') :
      t('worker.updated', {time:localDate(data.received_at)});
    target.classList.toggle('is-stale', !!data.stale);
    const busy = data.slots.filter(slot => slot.job_id).length;
    summary.textContent = t('worker.summary', {busy:data.received_at ? busy : '—', total:data.received_at ? data.slots.length : '—', queued:data.queued});
    const ids = new Set(data.slots.map(slot => slot.id));
    for (const [id, row] of entries) if (!ids.has(id)) { row.remove(); entries.delete(id); }
    if (!ids.has(selectedId)) selectedId = (data.slots.find(slot => slot.job_id) || data.slots[0] || {}).id;
    for (const [index, slot] of data.slots.entries()) {
      let row = entries.get(slot.id);
      if (!row) {
        row = node('div', undefined, 'worker-slot'); row.dataset.slotId = slot.id;
        const choose = node('button', undefined, 'worker-slot-select'); choose.type = 'button';
        const meta = node('span', undefined, 'worker-slot-meta');
        meta.append(node('span', '', 'worker-slot-meta-text'), node('span', '', 'worker-slot-pid'));
        choose.append(node('span', '', 'worker-slot-heading'), node('span', '', 'worker-slot-title'), meta);
        const open = node('button', undefined, 'worker-conversation'); open.type = 'button';
        open.title = t('worker.open.conversation'); open.setAttribute('aria-label', open.title); open.append(icon('arrow'));
        open.addEventListener('click', event => {
          event.stopPropagation();
          const active = latest && latest.slots.find(item => item.id === slot.id);
          if (current() && active && active.job_id && active.conversation_id) onConversation(active.conversation_id);
        });
        row.append(choose, open);
        row.addEventListener('click', () => { if (current()) { selectedId = slot.id; showSelection(); } });
        entries.set(slot.id, row);
      }
      if (rows.children[index] !== row) rows.insertBefore(row, rows.children[index] || null);
      row.dataset.state = slot.state;
      row.dataset.retiring = String(!!slot.retiring);
      const choose = row.firstElementChild, open = row.lastElementChild;
      open.hidden = !slot.job_id || !slot.conversation_id;
      row.dataset.conversation = String(!open.hidden);
      choose.children[0].textContent = slotHeading(slot);
      choose.children[1].textContent = slot.job_id ? slot.title || t('worker.standalone') : t('worker.idle.hint');
      choose.children[2].children[0].textContent = slot.retiring ? t('worker.retiring') : slot.job_id && slot.started_at ? t('worker.elapsed', {duration:duration(data.server_time - slot.started_at)}) : '';
      choose.children[2].children[1].textContent = slot.job_id && slot.pid ? 'PID ' + slot.pid : '';
      for (const child of choose.children) child.title = child.textContent;
      choose.setAttribute('aria-label', [...choose.children].map(child => child.textContent).filter(Boolean).join(' · '));
    }
    showSelection();
    status.textContent = data.reload_pending ? t('worker.reload.pending') :
      desired && (data.reported_target !== desired || data.slots.length !== desired) ?
        t('worker.applying', {target:desired, effective:data.slots.length}) : desired ? t('worker.applied', {count:desired}) : '';
  }
  function localDate(value) { return i18n.date(value * 1000, {hour:'2-digit', minute:'2-digit', second:'2-digit'}); }
  save.addEventListener('click', async () => {
    if (saving || !select.value) return;
    saving = true; save.disabled = true; select.disabled = true; error.textContent = ''; save.textContent = t('ui.saving');
    try {
      const data = await api('/api/account/worker', {target_concurrency:Number(select.value)}, 'PATCH');
      if (!current()) return;
      dirty = false; draw(data);
    } catch (failure) { if (current()) error.textContent = failure.message; }
    finally { saving = false; if (current()) { select.disabled = false; save.disabled = !select.value; save.textContent = t('ui.save'); } }
  });
  async function refresh() {
    if (!current()) return;
    try {
      const data = await api('/api/account/worker');
      if (current()) { if (!saving) draw(data); fetchError.textContent = ''; }
    } catch (failure) {
      if (current()) { target.classList.add('is-stale'); note.textContent = t('worker.stale'); fetchError.textContent = failure.message; }
    } finally { if (current()) window.setTimeout(refresh, 3000); }
  }
  return refresh();
});
