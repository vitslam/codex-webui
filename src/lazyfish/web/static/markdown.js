'use strict';
// DOM-only Markdown: raw HTML stays text, links accept only safe protocols.
(function (root, create) {
  if (typeof module !== 'undefined' && module.exports) module.exports = create;
  else root.LazyfishMarkdown = create;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global,
function createMarkdown({document, node, copyButton, imageNode, t}) {
  // Raw HTML stays text; only safe protocols and authenticated attachments become links.
  function inlineMarkdown(text, parent, renderedImages = new Set(), allowLinks = true, depth = 0) {
    if (depth >= 16) {
      parent.append(document.createTextNode(text));
      return !!text.trim();
    }
    const pattern = /(`[^`\n]+`|\*\*(?:(?!\*\*)[^\n])+\*\*|\*[^*\n]+\*|!?\[[^\]]*\]\([^)]+\))/g;
    let last = 0, visible = false;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const prefix = text.slice(last, match.index);
      parent.append(document.createTextNode(prefix));
      if (prefix.trim()) visible = true;
      let hidden = false;
      const token = match[0];
      if (token.startsWith('`')) parent.append(node('code', token.slice(1, -1)));
      else if (token.startsWith('*')) {
        const strong = token.startsWith('**'), width = strong ? 2 : 1;
        const formatted = node(strong ? 'strong' : 'em');
        hidden = !inlineMarkdown(token.slice(width, -width), formatted, renderedImages, allowLinks, depth + 1);
        if (!hidden) parent.append(formatted);
      } else if (!allowLinks) parent.append(document.createTextNode(token));
      else {
        const link = /^(!?)\[([^\]]*)\]\(([^)]+)\)$/.exec(token);
        const href = link[3].trim().replace(/^<|>$/g, '');
        const attachment = /^\/api\/jobs\/[a-f0-9]{32}\/artifacts\/[a-f0-9]{64}(?:\?download=1)?(?:#[^\s]*)?$/.test(href);
        if (link[1] && attachment) {
          renderedImages.add(href.split(/[?#]/)[0]);
          const a = node('a', undefined, 'reply-image');
          a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
          const image = imageNode(href, link[2]);
          image.addEventListener('error', () => {
            a.classList.add('reply-image-failed'); a.textContent = image.alt;
          });
          a.append(image); parent.append(a);
        } else if (attachment && href.includes('?download=1') && renderedImages.has(href.split(/[?#]/)[0])) {
          hidden = true; // Image downloads are available in the image context menu.
        } else if (!link[1] && (attachment || /^(https?:\/\/|mailto:)/i.test(href))) {
          const a = node('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
          inlineMarkdown(link[2], a, renderedImages, false, depth + 1); parent.append(a);
        } else parent.append(document.createTextNode(token));
      }
      if (!hidden) visible = true;
      last = match.index + token.length;
    }
    const suffix = text.slice(last);
    parent.append(document.createTextNode(suffix));
    return visible || !!suffix.trim();
  }
  function tableCells(line) {
    const cells = [];
    let cell = '', hasPipe = false;
    for (const char of line.trim()) {
      if (char === '|') {
        const slashes = /\\*$/.exec(cell)[0].length;
        if (slashes % 2) cell = cell.slice(0, -1) + '|';
        else { cells.push(cell.trim()); cell = ''; hasPipe = true; }
      } else cell += char;
    }
    if (!hasPipe) return null;
    cells.push(cell.trim());
    if (cells[0] === '') cells.shift();
    if (cells[cells.length - 1] === '') cells.pop();
    return cells;
  }
  function markdown(content, depth = 0, renderedImages = new Set()) {
    const root = node('div', undefined, 'markdown');
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    let list = null, lastItem = null, listIndent = 0, contentIndent = 0, listMarker = '';
    const indent = line => (/^[ \t]*/.exec(line)[0]).replace(/\t/g, '    ').length;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue; // Blank lines do not end a loose list.
      if (list && lastItem && depth < 16 && indent(line) >= contentIndent) {
        // Paragraphs, code, tables and nested lists indented under an item
        // belong to that item, rather than breaking the outer numbering.
        const continuation = [];
        let end = i;
        while (end < lines.length && (!lines[end].trim() || indent(lines[end]) >= contentIndent)) {
          continuation.push(lines[end].replace(/^[ \t]*/, prefix => prefix.replace(/\t/g, '    ')).slice(contentIndent)); end++;
        }
        const blocks = markdown(continuation.join('\n'), depth + 1, renderedImages);
        if (blocks.children.length && !Array.from(list.children).includes(lastItem)) list.append(lastItem);
        lastItem.append(...Array.from(blocks.children));
        i = end - 1; continue;
      }
      if (/^\s*```/.test(line)) {
        list = null;
        const language = line.replace(/^\s*```/, '').trim(); const code = [];
        while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
        const block = node('div', undefined, 'code-block');
        const header = node('div', undefined, 'code-header'); header.append(node('span', language), copyButton(code.join('\n'), t('ui.copy.code')));
        const pre = node('pre'); pre.append(node('code', code.join('\n'))); block.append(header, pre); root.append(block); continue;
      }
      if (/^\s*> ?/.test(line) && depth < 16) {
        list = null; const quote = node('blockquote'), quoted = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) quoted.push(lines[i++].replace(/^\s*> ?/, ''));
        i--; quote.append(...markdown(quoted.join('\n'), depth + 1, renderedImages).childNodes); root.append(quote); continue;
      }
      if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { list = null; root.append(node('hr')); continue; }
      const headers = tableCells(line), divider = tableCells(lines[i + 1] || '');
      if (headers && headers.length && divider && headers.length === divider.length && divider.every(cell => /^:?-{3,}:?$/.test(cell))) {
        list = null;
        const wrapper = node('div', undefined, 'markdown-table');
        wrapper.tabIndex = 0; wrapper.setAttribute('role', 'region'); wrapper.setAttribute('aria-label', t('ui.table.scroll.horizontally'));
        const table = node('table'), head = node('thead'), body = node('tbody');
        const alignments = divider.map(cell => cell.endsWith(':') ? cell.startsWith(':') ? 'center' : 'right' : 'left');
        function row(cells, header = false) {
          const tr = node('tr');
          for (let column = 0; column < headers.length; column++) {
            const td = node(header ? 'th' : 'td', undefined, 'table-align-' + alignments[column]);
            if (header) td.setAttribute('scope', 'col');
            inlineMarkdown(cells[column] || '', td, renderedImages); tr.append(td);
          }
          return tr;
        }
        head.append(row(headers, true)); i++;
        while (i + 1 < lines.length) {
          const cells = tableCells(lines[i + 1]);
          if (!cells || /^\s*(```|~~~)/.test(lines[i + 1])) break;
          body.append(row(cells)); i++;
        }
        table.append(head, body); wrapper.append(table); root.append(wrapper); continue;
      }
      const bullet = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/.exec(line);
      if (bullet) {
        const ordered = /^\d/.test(bullet[2]), tag = ordered ? 'ol' : 'ul';
        const marker = ordered ? bullet[2].slice(-1) : bullet[2];
        const base = indent(line);
        if (!list || list.tagName.toLowerCase() !== tag || listIndent !== base || listMarker !== marker) {
          list = node(tag); listIndent = base; listMarker = marker;
          if (ordered && Number(bullet[2].slice(0, -1)) !== 1) list.setAttribute('start', String(Number(bullet[2].slice(0, -1))));
          root.append(list);
        }
        contentIndent = base + bullet[2].length + bullet[3].replace(/\t/g, '    ').length;
        lastItem = node('li'); if (inlineMarkdown(bullet[4], lastItem, renderedImages)) list.append(lastItem); continue;
      }
      list = null;
      const heading = /^(#{1,6}) (.*)$/.exec(line);
      const p = node(heading ? 'h' + heading[1].length : 'p');
      if (inlineMarkdown(heading ? heading[2] : line, p, renderedImages)) root.append(p);
    }
    return root;
  }
  return {markdown, inlineMarkdown, tableCells};
});
