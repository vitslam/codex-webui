'use strict';
(function (root, create) {
  if (typeof module !== 'undefined' && module.exports) module.exports = create;
  else (root.LazyfishUI || (root.LazyfishUI = {})).skills = create;
})(typeof globalThis !== 'undefined' ? globalThis : window,
function createSkills({document, window, node, t, request, getWorkspace, getSelected, setSelected, onChange, onManage}) {
  const prompt = document.getElementById('prompt'), panel = document.getElementById('skill-picker');
  const chips = document.getElementById('selected-skills');
  let epoch = 0, opened = false, match = null, rows = [], index = 0, catalog = [], catalogCwd = null;
  const scopeLabel = skill => t('skills.scope.' + (/repo|project/i.test(skill.scope || '') ? 'project' : /system|admin/i.test(skill.scope || '') ? 'system' : 'user'));
  function drawSelection() {
    chips.replaceChildren();
    for (const skill of getSelected()) {
      const chip = node('span', undefined, 'skill-chip'); chip.title = skill.path;
      const remove = node('button', '×'); remove.type = 'button'; remove.setAttribute('aria-label', t('skills.remove', {name:skill.name}));
      remove.addEventListener('click', () => { setSelected(getSelected().filter(value => value.path !== skill.path)); drawSelection(); onChange(); });
      chip.append(node('span', skill.name), remove); chips.append(chip);
    }
    chips.hidden = !getSelected().length;
  }
  function close() {
    opened = false; match = null; epoch++; panel.hidden = true; catalogCwd = null;
    prompt.setAttribute('aria-expanded', 'false'); prompt.removeAttribute('aria-activedescendant');
  }
  function choose(skill) {
    if (getSelected().length >= 12) { panel.replaceChildren(node('p', t('skills.limit'), 'meta')); return; }
    setSelected([...getSelected(), {name:skill.name, path:skill.path}]);
    if (match) prompt.setRangeText('', match.start, match.end, 'end');
    close(); drawSelection(); onChange(); prompt.focus({preventScroll:true});
  }
  function highlight() {
    panel.querySelectorAll('[role="option"]').forEach((row, i) => {
      row.setAttribute('aria-selected', String(i === index));
      if (i === index) { prompt.setAttribute('aria-activedescendant', row.id); row.scrollIntoView({block:'nearest'}); }
    });
  }
  function draw(query = '') {
    const heading = node('div', undefined, 'skill-picker-heading');
    const manage = node('button', t('skills.manage')); manage.type = 'button';
    manage.addEventListener('click', () => { close(); onManage(); });
    heading.append(node('span', t('skills.for.message')), manage);
    const list = node('div', undefined, 'skill-picker-list'); list.id = 'skill-options'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', t('ui.skills'));
    const needle = query.toLocaleLowerCase();
    rows = catalog.filter(s => s.enabled !== false && !getSelected().some(value => value.path === s.path)
      && [s.name, s.description].some(value => String(value || '').toLocaleLowerCase().includes(needle)));
    index = Math.min(index, Math.max(0, rows.length - 1));
    rows.forEach((skill, i) => {
      const row = node('button', undefined, 'skill-option'); row.type = 'button'; row.id = 'skill-option-' + i;
      row.setAttribute('role', 'option'); row.tabIndex = -1; row.title = skill.path;
      const name = node('span', undefined, 'skill-option-name'); name.append(node('strong', skill.name), node('small', scopeLabel(skill)));
      row.append(name, node('span', skill.description || skill.path, 'skill-option-description'));
      row.addEventListener('mousedown', event => event.preventDefault());
      row.addEventListener('click', () => choose(skill)); list.append(row);
    });
    if (!rows.length) list.append(node('p', t('skills.no.matches'), 'meta'));
    panel.replaceChildren(heading, list); highlight();
  }
  async function open(query, token) {
    opened = true; match = token; panel.hidden = false; prompt.setAttribute('aria-expanded', 'true');
    const current = ++epoch, cwd = getWorkspace();
    if (catalogCwd === cwd) { draw(query); return; }
    rows = []; panel.replaceChildren(node('p', t('ui.loading'), 'meta'));
    try {
      const active = () => epoch === current && opened && cwd === getWorkspace();
      const accept = data => {
        if (!data || !active()) return;
        catalog = data.skills || []; catalogCwd = cwd; index = 0; draw(query);
      };
      const data = await request('skills', {workdir:cwd, force:true}, active, accept);
      accept(data);
    } catch (error) {
      if (epoch === current && opened) {
        const retry = node('button', t('ui.retry'), 'review-retry'); retry.type = 'button'; retry.addEventListener('click', () => open(query, token));
        panel.replaceChildren(node('p', error.message, 'meta'), retry);
      }
    }
  }
  function update() {
    if (prompt.selectionStart !== prompt.selectionEnd) { close(); return; }
    const before = prompt.value.slice(0, prompt.selectionStart), found = /(?:^|\s)([@$])([^\s@$]*)$/.exec(before);
    if (!found) { close(); return; }
    const token = {start:before.length - found[2].length - 1, end:before.length};
    index = 0; open(found[2], token);
  }
  function bind() {
    prompt.setAttribute('aria-controls', 'skill-options'); prompt.setAttribute('aria-autocomplete', 'list');
    prompt.addEventListener('input', event => { if (!event.isComposing) update(); });
    prompt.addEventListener('compositionend', update); prompt.addEventListener('click', update);
    prompt.addEventListener('keydown', event => {
      if (!opened || event.isComposing || event.keyCode === 229) return;
      if (event.shiftKey && event.key === 'Enter') { close(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key) || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === 'Escape') close();
      else if (event.key === 'Enter') { if (rows[index]) choose(rows[index]); }
      else if (rows.length) { index = (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length; highlight(); }
    }, true);
    document.getElementById('add-skill').addEventListener('click', () => { onChange(); open('', null); prompt.focus({preventScroll:true}); });
    document.addEventListener('pointerdown', event => { if (opened && !panel.contains(event.target) && event.target !== prompt && !event.target.closest('#add-skill')) close(); });
    window.addEventListener('skillschanged', () => { catalogCwd = null; close(); });
    window.addEventListener('languagechange', () => { close(); drawSelection(); });
  }
  return {bind, close, drawSelection, reset:() => { close(); drawSelection(); }};
});
