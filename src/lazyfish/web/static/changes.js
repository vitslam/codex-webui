'use strict';
// Own lazy change reports and file diffs; reuse the injected disclosure UI.
(function (root, create) {
  if (typeof module !== 'undefined' && module.exports) module.exports = create;
  else (root.LazyfishUI || (root.LazyfishUI = {})).changes = create;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global,
function createChanges({document, node, icon, t, api, executionDetails, jobFinished}) {
  const changeReports = new Map();
  function renderChangeReport(body, report, job) {
    body.replaceChildren();
    if (!report) {
      body.append(node('p', t('ui.this.reply.has.no.file.snapshot.new.tasks.capture'), 'meta')); return;
    }
    const repositories = report.repositories || [{repo: report.repo, git: report.git}];
    for (const repository of repositories) {
      const git = repository.git;
      if (!git) continue;
      const commits = node('div', undefined, 'review-commits');
      const branch = git.branch || t('ui.detached.head');
      for (const commit of git.commits) {
        const row = node('p', branch + ' · commit · '); row.append(node('code', commit.id.slice(0, 8)), node('br'), document.createTextNode(commit.subject)); commits.append(row);
      }
      if (git.commits.length === 30) commits.append(node('p', t('ui.showing.up.to.30.commits'), 'meta'));
      if (!git.commits.length) commits.append(node('p', branch));
      body.append(commits);
    }
    if (report.reason) body.append(node('p', t(report.state==='unavailable' ? 'changes.unavailable' : 'changes.partial'), 'meta'));
    const files = node('div', undefined, 'review-files');
    for (const file of report.files) {
      const details = executionDetails(job.id + ':file:' + file.path, '', 'review-file');
      const summary = details.children[0];
      summary.title = {added: t('ui.added'), deleted: t('ui.deleted'), modified: t('ui.modified')}[file.status] + ' · ' + file.path;
      const separator = node('span', '·'); separator.setAttribute('aria-hidden', 'true');
      const counts = node('span', undefined, 'change-counts');
      counts.append(node('span', '+' + file.additions, 'change-additions'), node('span', '-' + file.deletions, 'change-deletions'));
      summary.append(icon('file'), separator, node('span', file.path, 'file-path'), counts);
      const diff = node('pre', undefined, 'review-diff'); diff.tabIndex = 0;
      diff.setAttribute('aria-label', t('diff.label', {path:file.path}));
      let drawn = false;
      function draw() {
        if (!details.open || drawn) return;
        drawn = true;
        for (const line of file.diff.split('\n')) {
          const kind = line.startsWith('+++') || line.startsWith('---') ? 'header'
            : line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : line.startsWith('@@') ? 'hunk' : 'context';
          diff.append(node('span', line + '\n', 'diff-' + kind));
        }
      }
      details.addEventListener('toggle', draw); draw();
      if (file.notice) details.append(node('p', t(file.notice==='Diff 已截断。'?'changes.truncated':file.notice==='文件模式或换行发生变化。'?'changes.mode':'changes.binary'), 'meta'));
      details.append(diff);
      files.append(details);
    }
    if (!report.files.length) files.append(node('p', report.state === 'unavailable' ? t('ui.no.file.snapshots.available') : t('ui.no.file.content.or.mode.changes.detected'), 'meta'));
    body.append(files);
  }
  function appendChangePanel(card, message, job) {
    if (!job || !job.id || !jobFinished(job) || !job.changes || !(job.changes.file_count > 0 || ['partial','unavailable'].includes(job.changes.state))) return;
    const summary = job.changes;
    const panel = executionDetails(message.id + ':changes', '', 'change-panel');
    const separator = node('span', '·'); separator.setAttribute('aria-hidden', 'true');
    const counts = node('span', undefined, 'change-counts');
    counts.append(node('span', '+' + summary.additions, 'change-additions'), node('span', '-' + summary.deletions, 'change-deletions'));
    panel.children[0].append(icon('file'), separator,
      node('span', summary.state==='unavailable'?t('changes.unavailable'):t('changes.count',{count:summary.file_count})), counts);
    const body = node('div', undefined, 'change-panel-body');
    let loading = false, loaded = false;
    async function load() {
      if (!panel.open || loaded || loading) return;
      loading = true; body.replaceChildren(node('p', t('ui.loading.file.changes'), 'meta'));
      try {
        if (!changeReports.has(job.id)) {
          const pending = api('/api/jobs/' + encodeURIComponent(job.id) + '/changes');
          changeReports.set(job.id, pending);
          if (changeReports.size > 10) changeReports.delete(changeReports.keys().next().value);
        }
        const result = await changeReports.get(job.id);
        renderChangeReport(body, result.report, job); loaded = true;
      } catch (error) {
        changeReports.delete(job.id);
        const retry = node('button', t('ui.retry'), 'review-retry'); retry.type = 'button'; retry.addEventListener('click', load);
        body.replaceChildren(node('p', t('error.read', {error:error.message}), 'meta'), retry);
      } finally { loading = false; }
    }
    panel.addEventListener('toggle', load);
    panel.append(body); card.append(panel);
    if (panel.open) load();
  }
  return {renderChangeReport, appendChangePanel};
});
