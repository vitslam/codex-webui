'use strict';
// Render typed output attachments, independently of the Skill that produced them.
(function (root, create) {
  if (typeof module !== 'undefined' && module.exports) module.exports = create;
  else (root.LazyfishUI || (root.LazyfishUI = {})).artifacts = create;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global,
function createArtifacts({node, imageNode, t}) {
  function artifactList(artifacts, exclude = []) {
    const list = node('div', undefined, 'output-artifacts'), seen = new Set(exclude);
    for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
      const url = artifact && artifact.url;
      if (typeof url !== 'string' || !/^\/api\/jobs\/[a-f0-9]{32}\/artifacts\/[a-f0-9]{64}$/.test(url) || seen.has(url)) continue;
      seen.add(url);
      const card = node('figure', undefined, 'output-artifact');
      const name = typeof artifact.name === 'string' ? artifact.name : t('outputs.image');
      if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(artifact.mime)) {
        const link = node('a', undefined, 'output-image');
        link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label', t('image.original_name', {name}));
        const image = imageNode(url, name, artifact);
        const error = node('p', t('ui.could.not.load.the.image.please.retry'), 'meta'); error.hidden = true;
        image.addEventListener('error', () => { error.hidden = false; });
        image.addEventListener('load', () => { error.hidden = true; });
        link.append(image); card.append(link, error);
      }
      const caption = node('figcaption'), download = node('a', t('outputs.download'));
      download.href = url + '?download=1'; download.download = name;
      caption.append(node('span', name, 'output-name'), download); card.append(caption); list.append(card);
      if (list.children.length >= 16) break;
    }
    return list.children.length ? list : null;
  }
  return {artifactList};
});
