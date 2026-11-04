'use strict';
(function (root, create) {
  if (typeof module !== 'undefined' && module.exports) { module.exports = create; return; }
  let storage;
  try { storage = root.localStorage; } catch (_) {}
  root.appearance = create({document:root.document, window:root, storage, registry:root.LazyfishThemeRegistry});
})(typeof globalThis !== 'undefined' ? globalThis : window,
function createAppearance({document, window, storage, registry}) {
  const themes = registry.themes, listeners = new Set();
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let value, theme;
  function apply(next) {
    value = next === 'system' || themes.some(item => item.id === next) ? next : registry.default;
    const identifier = value === 'system' ? registry.system[system.matches ? 'dark' : 'light'] : value;
    theme = themes.find(item => item.id === identifier);
    document.documentElement.dataset.theme = theme.id;
    document.documentElement.dataset.colorScheme = theme.scheme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme.color;
    for (const listener of listeners) listener(theme);
  }
  function set(next) {
    apply(next);
    try { if (storage) storage.setItem('lazyfish.appearance', value); } catch (_) {}
  }
  if (system.addEventListener) system.addEventListener('change', () => { if (value === 'system') apply(value); });
  let saved;
  try { saved = storage && storage.getItem('lazyfish.appearance'); } catch (_) {}
  apply(saved || 'system');
  return {apply, set, toggle:() => set(registry.system[theme.scheme === 'dark' ? 'light' : 'dark']),
    subscribe(listener) { listeners.add(listener); listener(theme); return () => listeners.delete(listener); },
    get themes() { return themes; }, get value() { return value; }, get theme() { return theme; },
    get defaultTheme() { return registry.default; }};
});
