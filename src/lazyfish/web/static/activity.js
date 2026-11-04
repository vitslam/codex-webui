"use strict";
window.LazyfishActivity=function({node,t}){
const i18n={get locale(){return document.documentElement.lang;},number:value=>value.toLocaleString(document.documentElement.lang)};
function usageCalendar(daily, today = new Date()) {
  // Calendar dates stay in UTC internally so DST never adds or skips a square.
  const end = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const dayMs = 86400000, start = end - 364 * dayMs, values = new Map();
  for (const item of daily) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || !Number.isSafeInteger(item.tokens) || item.tokens < 0) continue;
    const stamp = Date.parse(item.date + 'T00:00:00Z');
    if (stamp >= start && stamp <= end && new Date(stamp).toISOString().slice(0, 10) === item.date) values.set(item.date, item.tokens);
  }
  const peak = Math.max(1, ...values.values()), days = [];
  const first = start - new Date(start).getUTCDay() * dayMs;
  const last = end + (6 - new Date(end).getUTCDay()) * dayMs;
  for (let stamp = first; stamp <= last; stamp += dayMs) {
    const date = new Date(stamp).toISOString().slice(0, 10), tokens = values.get(date);
    days.push({date, tokens, outside: stamp < start || stamp > end,
      level: tokens == null ? 'unknown' : tokens === 0 ? 0 : Math.ceil(tokens / peak * 4)});
  }
  return {days, active: [...values.values()].filter(tokens => tokens > 0).length};
}
function renderActivityCalendar(daily) {
  const data = usageCalendar(daily), card = node('section', undefined, 'activity-calendar');
  card.setAttribute('aria-label', t('ui.daily.activity'));
  const heading = node('div', undefined, 'activity-heading');
  heading.append(node('h3', t('ui.daily.activity')), node('span', t('activity.active', {count:data.active}), 'account-note'));
  const scroll = node('div', undefined, 'activity-scroll'), chart = node('div', undefined, 'activity-chart');
  const months = node('div', undefined, 'activity-months'), grid = node('div', undefined, 'activity-grid');
  const weekdays = node('div', undefined, 'activity-weekdays');
  for (const day of [null, 1, null, 3, null, 5, null]) weekdays.append(node('span', day == null ? '' : t('activity.weekday.' + day)));
  const detail = node('p', undefined, 'account-note activity-detail');
  const buttons = [], columns = data.days.length / 7;
  let previousMonth = '';
  for (let week = 0; week < columns; week++) {
    const date = data.days[week * 7].date, month = date.slice(0, 7);
    const label = month !== previousMonth && (week > 0 || Number(date.slice(8, 10)) <= 20);
    months.append(node('span', label ? new Intl.DateTimeFormat(i18n.locale, {month:'short', timeZone:'UTC'}).format(new Date(date)) : ''));
    previousMonth = month;
  }
  function select(button) {
    for (const other of buttons) { other.tabIndex = other === button ? 0 : -1; other.removeAttribute('data-selected'); }
    button.dataset.selected = 'true'; detail.textContent = button.title;
  }
  for (const day of data.days) {
    if (day.outside) { grid.append(node('span', undefined, 'activity-spacer')); continue; }
    const button = node('button', undefined, 'activity-day'); button.type = 'button'; button.tabIndex = -1;
    button.dataset.level = day.level; button.dataset.date = day.date;
    button.title = day.date + ' · ' + (day.tokens == null ? t('ui.no.records') : i18n.number(day.tokens) + ' token');
    button.setAttribute('aria-label', button.title);
    for (const event of ['mouseenter', 'focus', 'click']) button.addEventListener(event, () => select(button));
    button.addEventListener('keydown', event => {
      const delta = {ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7}[event.key];
      if (delta == null) return;
      event.preventDefault(); buttons[Math.max(0, Math.min(buttons.length - 1, buttons.indexOf(button) + delta))].focus();
    });
    buttons.push(button); grid.append(button);
  }
  select(buttons[buttons.length - 1]);
  chart.append(months, weekdays, grid); scroll.append(chart);
  card.append(heading, scroll, detail);
  requestAnimationFrame(() => { scroll.scrollLeft = scroll.scrollWidth; });
  return card;
}

return renderActivityCalendar;
};
