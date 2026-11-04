'use strict';
// Shared image preview and actions for replies, user attachments and tool steps.
(function (root, create) {
  if (typeof module !== 'undefined' && module.exports) module.exports = create;
  else (root.LazyfishUI || (root.LazyfishUI = {})).images = create;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global,
function createImages({document, window, navigator, node, imageNode: baseImageNode, t, report}) {
  let viewer = null, dismissMenu = () => {};

  function source(image) { return image.currentSrc || image.src; }
  function imageMenu(event, image) {
    event.preventDefault(); event.stopPropagation(); dismissMenu();
    const menu = node('div', undefined, 'image-menu'); menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', image.alt || t('ui.images'));
    const opener = image.closest('a') || image;
    function close(restore = false) {
      menu.remove();
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', outside);
      window.removeEventListener('scroll', outside, true);
      if (restore && opener.isConnected) opener.focus({preventScroll: true});
      if (dismissMenu === close) dismissMenu = () => {};
    }
    function outside(event) { if (event.type !== 'pointerdown' || !menu.contains(event.target)) close(); }
    dismissMenu = close;
    const actions = [
      ['images.open.tab', () => window.open(source(image), '_blank', 'noopener,noreferrer')],
      ['images.copy', async () => {
        try {
          const canvas = node('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          canvas.getContext('2d').drawImage(image, 0, 0);
          const blob = new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error()), 'image/png'));
          await navigator.clipboard.write([new window.ClipboardItem({'image/png': blob})]);
        } catch (_) { report(new Error(t('images.copy.failed'))); }
      }],
      ['images.download', async () => {
        try {
          const response = await window.fetch(source(image), {credentials: 'same-origin'});
          if (!response.ok) throw new Error();
          const blob = await response.blob(), url = window.URL.createObjectURL(blob);
          const download = node('a'); download.href = url;
          const extension = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif'}[blob.type] || '';
          download.download = (image.alt || 'image') + (/\.(png|jpe?g|webp|gif)$/i.test(image.alt) ? '' : extension);
          document.body.append(download); download.click(); download.remove();
          window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
        } catch (_) { report(new Error(t('images.download.failed'))); }
      }],
    ];
    for (const [label, action] of actions) {
      const button = node('button', t(label)); button.type = 'button'; button.setAttribute('role', 'menuitem');
      button.disabled = label === 'images.copy' && (!navigator.clipboard || !navigator.clipboard.write || !window.ClipboardItem || !image.naturalWidth);
      button.addEventListener('click', () => { close(true); action(); }); menu.append(button);
    }
    menu.addEventListener('keydown', event => {
      const buttons = Array.from(menu.querySelectorAll('button:not(:disabled)'));
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.stopPropagation(); if (event.key === 'Escape') event.preventDefault(); close(true);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const index = buttons.indexOf(document.activeElement), step = event.key === 'ArrowDown' ? 1 : -1;
        buttons[(index + step + buttons.length) % buttons.length].focus();
      }
    });
    (viewer && viewer.open ? viewer : document.body).append(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(event.clientX, window.innerWidth - rect.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(event.clientY, window.innerHeight - rect.height - 8)) + 'px';
    menu.querySelector('button').focus({preventScroll: true});
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', outside);
    window.addEventListener('scroll', outside, true);
  }

  function preview(image) {
    dismissMenu();
    if (viewer) viewer.close();
    const dialog = node('dialog', undefined, 'image-viewer');
    dialog.setAttribute('aria-label', image.alt || t('ui.images'));
    const original = baseImageNode(source(image), image.alt); original.loading = 'eager'; original.className = 'image-viewer-original';
    original.tabIndex = -1;
    original.addEventListener('contextmenu', event => imageMenu(event, original));
    dialog.append(original);
    dialog.addEventListener('click', event => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('keydown', event => {
      // Keep Escape in the top layer; underlying composer menus must not consume it.
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault(); event.stopPropagation(); dialog.close();
    });
    dialog.addEventListener('close', () => {
      dialog.remove(); if (viewer === dialog) { dismissMenu(); viewer = null; }
    });
    document.body.append(dialog); viewer = dialog; dialog.showModal();
  }

  function imageNode(src, name, size) {
    const image = baseImageNode(src, name, size);
    image.dataset.preview = 'true';
    image.addEventListener('click', event => {
      if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); event.stopPropagation(); preview(image);
    });
    image.addEventListener('contextmenu', event => imageMenu(event, image));
    return image;
  }
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.target.tagName !== 'A') return;
    const image = event.target.querySelector('img[data-preview]');
    if (image) { event.preventDefault(); preview(image); }
  });
  return {imageNode};
});
