'use strict';
// Own execution disclosure state and lazy step/detail/image caches.
(function (root, create) {
  if (typeof module !== 'undefined' && module.exports) module.exports = create;
  else (root.LazyfishUI || (root.LazyfishUI = {})).steps = create;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global,
function createSteps({document, node, t, api, markdown, copyButton, imageNode, artifactList = () => null, jobFinished, getFollowBottom,
  showReasoning = () => false,
  setTimeout = (typeof globalThis !== 'undefined' ? globalThis : global).setTimeout,
  clearTimeout = (typeof globalThis !== 'undefined' ? globalThis : global).clearTimeout}) {
  function executionActivity(job, items) {
    items = items.filter(item => item.type !== 'user_message');
    if (jobFinished(job)) return '';
    if ((job.questions || []).some(question => question.kind === 'approval' && ['pending', 'answered'].includes(question.state))) return t('ui.waiting.for.your.approval');
    if ((job.questions || []).some(question => question.blocking && question.state === 'pending')) return t('ui.waiting.for.your.choice');
    if (job.status === 'queued') return t('ui.queued');
    if (job.status === 'cancelling') return t('ui.stopping');
    if (job.job_kind === 'compact') return t('ui.compacting.context');
    const running = items.filter(item => item.eventStatus === 'running');
    const current = [...running].reverse().find(item => !['reasoning', 'agent_message'].includes(item.type)) || running[running.length - 1];
    const labels = {command_execution: t('ui.running.a.command'), file_change: t('ui.editing.files'), web_search: t('ui.searching.the.web'), image_view: t('ui.viewing.an.image'),
      mcp_tool_call: t('ui.calling.a.tool'), dynamic_tool_call: t('ui.calling.a.tool'), context_compaction: t('ui.compacting.context'),
      sub_agent_activity: t('steps.agent.working'), collab_tool_call: t('ui.collaboration.task'), collab_agent_tool_call: t('ui.collaboration.task'), sleep: t('steps.waiting'),
      image_generation:t('outputs.generating'), skill_invocation:t('skills.loading.action'), plan: t('ui.generating.a.plan'), agent_message: t('ui.generating.a.reply'), reasoning: t('ui.thinking')};
    if (current && current.type === 'web_search') {
      if (webKind(current) === 'openPage') return t('steps.web.opening');
      if (webKind(current) === 'findInPage') return t('steps.web.finding');
    }
    return current ? labels[current.type] || t('ui.working') : t('ui.thinking');
  }
  const executionExpansion = new Map();
  function executionDetails(key, label, className, defaultOpen = false) {
    const details = node('details', undefined, className);
    details.expansionKey = key;
    details.open = executionExpansion.has(key) ? executionExpansion.get(key) : defaultOpen;
    details.addEventListener('toggle', () => {
      // Ignore queued toggle events from nodes replaced by polling.
      if (details.isConnected === false) return;
      executionExpansion.set(details.expansionKey, details.open);
      // Parent disclosures also control visibility of lazy child content.
      if (details.querySelectorAll) for (const step of details.querySelectorAll('.tool-step')) {
        if (step.refreshVisibility) step.refreshVisibility();
      }
    });
    details.append(node('summary', label));
    return details;
  }
  function stepFailed(item) {
    return !!(item.artifact_state === 'failed' || item.status === 'failed' || item.status === 'declined'
      || (typeof item.exit_code === 'number' && item.exit_code !== 0) || item.error);
  }
  const commandDetailCache = new Map();
  function commandBody(item) {
    return [item.command, item.aggregated_output, typeof item.exit_code === 'number' ? t('command.exit', {code:item.exit_code}) : '']
      .filter(value => value !== undefined && value !== '').join('\n\n');
  }
  async function commandDetail(message, item) {
    const key = JSON.stringify([message.job_id, item.id, document.documentElement.lang]);
    let entry = commandDetailCache.get(key);
    if (!entry) { entry = {version: -1, body: '', offset: 0, hash: '', pending: null}; commandDetailCache.set(key, entry); }
    commandDetailCache.delete(key); commandDetailCache.set(key, entry);
    while (entry.version < item.detail_version) {
      if (!entry.pending) {
        entry.pending = api('/api/jobs/' + encodeURIComponent(message.job_id) + '/steps/detail?item_id=' + encodeURIComponent(item.id)
          + '&offset=' + entry.offset + '&prefix_hash=' + entry.hash+'&lang='+document.documentElement.lang)
          .then(result => {
            if (result.version < item.detail_version) throw new Error(t('ui.command.details.are.not.ready.please.retry'));
            if (result.reset) { entry.body = ''; entry.offset = 0; }
            if (result.offset !== entry.offset || result.next_offset < result.offset) throw new Error(t('ui.invalid.command.detail.offset'));
            entry.body += result.text; entry.offset = result.next_offset; entry.hash = result.prefix_hash; entry.version = result.version;
          }).finally(() => { entry.pending = null; });
      }
      await entry.pending;
    }
    let size = Array.from(commandDetailCache.values()).reduce((total, cached) => total + cached.body.length * 2, 0);
    for (const [id, cached] of commandDetailCache) {
      if (commandDetailCache.size <= 64 && size <= 16 * 1024 * 1024) break;
      if (id !== key && !cached.pending) { commandDetailCache.delete(id); size -= cached.body.length * 2; }
    }
    return entry.body;
  }
  function agentAction(item) {
    const actions = {started:'steps.agent.start', interacted:'steps.agent.interact', completed:'steps.agent.complete'};
    return actions[item.kind] ? t(actions[item.kind]) : item.kind
      ? t('steps.agent.other', {kind:item.kind}) : t('steps.agent.activity');
  }
  function agentName(item) {
    return typeof item.agentPath === 'string' ? item.agentPath.split('/').filter(Boolean).pop() || '' : '';
  }
  const text = value => typeof value === 'string' ? value.trim() : '';
  function webKind(item) { return text(item.action && item.action.type) || 'search'; }
  function webQueries(item) {
    const action = item.action || {};
    const queries = Array.isArray(action.queries) ? action.queries.map(text).filter(Boolean) : [];
    return [...new Set(queries.length ? queries : [text(action.query) || text(item.query)].filter(Boolean))];
  }
  function webUrl(value) {
    if (!/^https?:\/\//i.test(text(value))) return null;
    try { return new URL(value); } catch (_) { return null; }
  }
  function webLink(label, url, className) {
    const safe = webUrl(url), element = node(safe ? 'a' : 'span', label, className);
    if (safe) { element.href = safe.href; element.target = '_blank'; element.rel = 'noopener noreferrer'; }
    return element;
  }
  function rawRecord(key, getItem) {
    const raw = executionDetails(key + ':raw', t('steps.raw.record'), 'step-raw');
    const body = node('div'); raw.append(body);
    let previous = null;
    function draw() {
      if (!raw.open) return;
      const value = JSON.stringify(getItem(), null, 2);
      if (value === previous) return;
      body.replaceChildren(node('pre', value, 'execution-log'), copyButton(value, t('ui.copy.step'))); previous = value;
    }
    raw.addEventListener('toggle', draw); raw.refreshRecord = draw; draw();
    return raw;
  }
  function toolLabel(item, grouped = false) {
    if (item.type === 'skill_invocation') return [t(grouped ? 'skills.loading.action' : item.status === 'provided' ? 'skills.provided' : item.status === 'loaded' ? 'skills.loaded' : item.status === 'failed' ? 'skills.load.failed' : item.eventStatus === 'cancelled' ? 'skills.load.unconfirmed' : 'skills.loading.action'), item.name].filter(Boolean).join(' · ');
    const agent = item.type === 'sub_agent_activity';
    const labels = {command_execution: t('ui.run.command'), file_change: t('ui.edit.files'), mcp_tool_call: t('ui.call.tool'), dynamic_tool_call: t('ui.call.tool'),
      web_search: t('ui.search.web'), image_generation:t('outputs.generate'), image_view: t('ui.view.image'), reasoning: t('ui.reasoning.summary'), todo_list: t('ui.update.plan'),
      collab_tool_call: t('ui.collaboration.task'), collab_agent_tool_call: t('ui.collaboration.task'), context_compaction: t('ui.context.compaction'), sleep:t('steps.wait')};
    // A completed activity record (e.g. "started") does not mean the agent's task is complete.
    const state = item.eventStatus === 'cancelled' ? t('ui.stopped') : stepFailed(item) ? t('ui.failed') : item.eventStatus === 'running' ? t('ui.in.progress') : agent ? '' : t('ui.completed');
    let name = agent ? agentName(item) : item.tool;
    let label = agent ? agentAction(item) : labels[item.type] || (item.type ? t('steps.other', {type:item.type}) : t('ui.execution.step'));
    if (item.type === 'web_search') {
      const kind = webKind(item), action = item.action || {};
      label = grouped ? t('steps.web.browse') : kind === 'search' ? t('ui.search.web')
        : kind === 'openPage' ? t('steps.web.open') : kind === 'findInPage' ? t('steps.web.find') : t('steps.web.browse');
      name = grouped ? '' : kind === 'search' ? webQueries(item).join(' / ')
        : kind === 'openPage' ? (webUrl(action.url)?.hostname || text(action.url)) : text(action.pattern);
    }
    return [label, state, name].filter(Boolean).join(' · ');
  }
  function toolStep(message, item) {
    const key = message.id + ':' + item.id;
    const details = executionDetails(key + (item.type === 'reasoning' ? ':' + (item.eventStatus === 'running' ? 'active' : 'finished') : ''), toolLabel(item), 'tool-step',
      item.type === 'reasoning' && item.eventStatus === 'running');
    function updateSummary() {
      const summary = details.children[0];
      summary.replaceChildren(); summary.textContent = toolLabel(item);
      if (item.type === 'command_execution' && typeof item.command === 'string') {
        summary.append(node('span', ' · ' + item.command.replace(/\s+/g, ' ').trim()));
        summary.className = 'command-summary';
        summary.title = item.command;
      }
    }
    updateSummary();
    if (item.type === 'command_execution') {
      const body = node('div', undefined, 'tool-step-body');
      let loading = false, loaded = false, drawnText = '';
      async function load() {
        if (!details.open || loading || loaded) return;
        loading = true;
        const requestedVersion = item.detail_version;
        try {
          let text;
          if (item.details_deferred) {
            if (!body.children.length || body.children[0].tagName !== 'PRE') body.replaceChildren(node('p', t('ui.loading.command.details'), 'meta'));
            text = await commandDetail(message, item);
          } else text = commandBody(item);
          // Closing during a request keeps the cache, without drawing hidden text.
          if (!details.open || details.isConnected === false) return;
          let pre = body.children[0];
          if (pre && pre.tagName === 'PRE' && text.startsWith(drawnText)) {
            if (text.length > drawnText.length) pre.append(document.createTextNode(text.slice(drawnText.length)));
          } else pre = node('pre', text, 'execution-log');
          body.replaceChildren(pre, copyButton(text, t('ui.copy.step'))); drawnText = text;
          loaded = requestedVersion === item.detail_version;
        } catch (error) {
          const retry = node('button', t('ui.retry'), 'review-retry'); retry.type = 'button'; retry.addEventListener('click', load);
          body.replaceChildren(node('p', t('error.read', {error:error.message}), 'meta'), retry);
        } finally {
          loading = false;
          if (requestedVersion !== item.detail_version) load();
        }
      }
      details.refreshStep = updated => { item = updated; updateSummary(); loaded = false; load(); };
      details.append(body); details.addEventListener('toggle', load);
      if (details.open) load();
    } else if (item.type === 'image_generation') {
      const body = node('div', undefined, 'tool-step-body output-step-body'); let signature;
      function draw() {
        const next = JSON.stringify([item.artifacts, item.artifact_state, item.artifact_error, item.revisedPrompt]);
        if (signature === next) return;
        signature = next;
        const gallery = artifactList(item.artifacts);
        const errors = ['outputs.image.invalid', 'outputs.image.too_large', 'outputs.upload.failed', 'outputs.image.unavailable', 'outputs.generation.failed'];
        body.replaceChildren(gallery || node('p', t(item.artifact_state === 'failed'
          ? errors.includes(item.artifact_error) ? item.artifact_error : 'outputs.image.unavailable' : 'outputs.generating'), 'meta'));
        if (item.revisedPrompt) {
          const prompt = executionDetails(key + ':prompt', t('outputs.prompt'), 'output-prompt');
          prompt.append(node('p', item.revisedPrompt)); body.append(prompt);
        }
      }
      details.refreshStep = updated => { item = updated; updateSummary(); draw(); };
      details.append(body); draw();
    } else if (item.type === 'image_view') {
      const body = node('div', undefined, 'tool-step-body step-image-body');
      let loaded = false, loading = false, timer = null, attempts = 0;
      function unavailable(text) {
        const retry = node('button', t('ui.retry'), 'review-retry'); retry.type = 'button';
        retry.addEventListener('click', () => { attempts = 0; load(); });
        body.replaceChildren(node('p', text, 'meta'), retry);
      }
      async function load() {
        if (!details.open || details.isConnected === false || loading || loaded) return;
        for (let parent = details.parentElement; parent; parent = parent.parentElement) {
          if (parent.tagName === 'DETAILS' && !parent.open) return;
        }
        clearTimeout(timer); loading = true;
        try {
          if (item.image_error) { unavailable(item.image_error); return; }
          body.replaceChildren(node('p', t('ui.loading.image'), 'meta'));
          const result = await api('/api/jobs/' + encodeURIComponent(message.job_id) + '/steps/image?item_id=' + encodeURIComponent(item.id));
          if (!details.open || details.isConnected === false) return;
          if (result.state !== 'ready') {
            if ((result.state === 'pending' || result.state === 'unavailable' && item.image_pending) && attempts++ < 20) {
              body.replaceChildren(node('p', t('ui.syncing.image'), 'meta'));
              timer = setTimeout(load, 1000);
            } else unavailable(result.error || t('ui.image.sync.timed.out.please.retry'));
            return;
          }
          const link = node('a', undefined, 'step-image-link');
          link.href = result.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
          link.title = t('ui.view.original.image'); link.setAttribute('aria-label', t('image.original_name', {name:result.name}));
          const image = imageNode(result.url, result.name);
          image.addEventListener('error', () => { loaded = false; unavailable(t('ui.could.not.load.the.image.please.retry')); });
          link.append(image); body.replaceChildren(link, node('p', result.name, 'meta')); loaded = true;
        } catch (error) { if (details.open) unavailable(t('error.read', {error:error.message})); }
        finally { loading = false; }
      }
      details.refreshStep = updated => { item = updated; updateSummary(); load(); };
      details.refreshVisibility = () => { clearTimeout(timer); load(); };
      details.addEventListener('toggle', () => { if (details.open) load(); else clearTimeout(timer); });
      details.append(body);
      if (details.open) load();
    } else if (item.type === 'web_search') {
      const body = node('div', undefined, 'web-step-body'), content = node('div');
      const raw = rawRecord(key, () => item);
      function resultCard(result, index, kind) {
        const card = node('article', undefined, 'web-result');
        const title = text(result.title), url = text(result.url), safe = webUrl(url);
        if (title || url) card.append(webLink(title || url, url, 'web-result-title'));
        const domain = text(result.domain) || (safe && safe.hostname);
        if (domain) card.append(node('p', domain, 'web-result-domain'));
        const snippet = text(result.snippet);
        const linesOnly = kind !== 'search' && /^Total lines:\s*(\d+)$/i.exec(snippet);
        if (linesOnly) card.append(node('p', t('steps.web.lines_only', {count:Number(linesOnly[1])}), 'web-page-info meta'));
        else if (snippet) {
          const preview = node(kind === 'search' ? 'p' : 'span', snippet, 'web-result-snippet');
          if (kind === 'search' && safe) card.append(preview);
          else {
            const expanded = executionDetails(key + ':content:' + (text(result.ref_id) || text(result.url) || index), undefined, 'web-content');
            const summary = expanded.children[0], toggle = node('span', undefined, 'web-content-toggle');
            summary.append(preview, toggle);
            const full = node('div'); expanded.append(full);
            function drawContent() {
              toggle.textContent = t(expanded.open ? 'steps.web.collapse_content' : 'steps.web.expand_content');
              if (expanded.open && !full.children.length) full.append(node('p', snippet, 'web-full-snippet'));
            }
            expanded.addEventListener('toggle', drawContent); drawContent(); card.append(expanded);
          }
        }
        return card;
      }
      function draw() {
        const kind = webKind(item), action = item.action || {}, metadata = node('dl', undefined, 'step-metadata');
        function field(label, value, url = false) {
          if (!value) return;
          const row = node('div'), data = node('dd');
          data.append(url ? webLink(value, value) : node('span', value));
          row.append(node('dt', t(label)), data); metadata.append(row);
        }
        if (kind === 'search') field('steps.web.queries', webQueries(item).join('\n'));
        field('steps.web.page', text(action.url), true);
        if (kind === 'findInPage') field('steps.web.pattern', text(action.pattern) || text(item.query));
        content.replaceChildren(); if (metadata.children.length) content.append(metadata);
        const error = text(item.error) || text(item.error && item.error.message);
        if (error) content.append(node('p', error, 'step-error'));
        const seen = new Set();
        const results = (Array.isArray(item.results) ? item.results : []).filter(result => {
          if (!result || ![result.title, result.url, result.domain, result.snippet].some(value => text(value))) return false;
          const url = text(result.url), safe = webUrl(url);
          // Citation IDs can differ for identical visible results. Keep distinct excerpts and pages.
          const signature = JSON.stringify([text(result.title) || url, safe ? safe.href : url,
            text(result.domain) || (safe && safe.hostname) || '', text(result.snippet)]);
          if (seen.has(signature)) return false;
          seen.add(signature); return true;
        });
        const list = node('div', undefined, 'web-results');
        results.slice(0, 5).forEach((result, index) => list.append(resultCard(result, index, kind)));
        if (results.length) content.append(list);
        else content.append(node('p', t(item.eventStatus === 'running' ? 'steps.web.pending' : 'steps.web.no_details'), 'meta'));
        if (results.length > 5) {
          const more = executionDetails(key + ':more', t('steps.web.more_results', {count:results.length - 5}), 'web-more');
          const remaining = node('div', undefined, 'web-results'); more.append(remaining);
          function drawMore() {
            more.children[0].textContent = t(more.open ? 'steps.web.fewer_results' : 'steps.web.more_results', {count:results.length - 5});
            if (more.open && !remaining.children.length) results.slice(5).forEach((result, index) => remaining.append(resultCard(result, index + 5, kind)));
          }
          more.addEventListener('toggle', drawMore); drawMore(); content.append(more);
        }
        raw.refreshRecord();
      }
      details.refreshStep = updated => { item = updated; updateSummary(); draw(); };
      body.append(content, raw); details.append(body); draw();
    } else if (item.type === 'skill_invocation') {
      const body = node('div', undefined, 'skill-step-body');
      function draw() {
        body.replaceChildren(node('p', t(item.status === 'failed' ? item.error || 'skills.error.load' : item.status === 'provided' ? 'skills.provided.hint' : item.status === 'loaded' ? 'skills.loaded.hint' : 'skills.loading.hint'), 'meta'), node('p', item.path || '', 'account-path'));
      }
      details.refreshStep = updated => { item = updated; updateSummary(); draw(); };
      details.append(body); draw();
    } else if (item.type === 'sub_agent_activity') {
      const body = node('div', undefined, 'agent-step-body');
      const description = node('p', undefined, 'meta');
      const metadata = node('dl', undefined, 'step-metadata');
      const raw = rawRecord(key, () => item);
      function draw() {
        const descriptions = {started:'steps.agent.started.description', interacted:'steps.agent.interacted.description', completed:'steps.agent.completed.description'};
        description.textContent = t(descriptions[item.kind] || 'steps.agent.description');
        const effort = item.reasoningEffort;
        const fields = [['steps.agent.task', agentName(item)], ['steps.agent.path', item.agentPath], ['ui.model', item.model],
          ['ui.reasoning.effort.level', ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(effort) ? t('effort.' + effort) : effort]];
        metadata.replaceChildren();
        for (const [label, value] of fields) if (typeof value === 'string' && value) {
          const row = node('div'); row.append(node('dt', t(label)), node('dd', value)); metadata.append(row);
        }
        metadata.hidden = !metadata.children.length;
        raw.refreshRecord();
      }
      details.refreshStep = updated => { item = updated; updateSummary(); draw(); };
      body.append(description, metadata, raw); details.append(body); draw();
    } else if (item.type === 'reasoning') {
      const body = node('div', undefined, 'tool-step-body reasoning-body');
      let text = item.text || '';
      const content = markdown(text);
      body.append(content, copyButton(text, t('ui.copy.step'))); details.append(body);
      details.refreshStep = updated => {
        const wasRunning = item.eventStatus === 'running';
        item = updated; updateSummary();
        if (wasRunning && item.eventStatus !== 'running') {
          details.expansionKey = key + ':finished';
          details.open = false;
          executionExpansion.set(details.expansionKey, false);
        }
        const next = item.text || '';
        if (next === text) return;
        const previous = Array.from(content.children);
        const blocks = Array.from(markdown(next).children);
        // Reparse the growing Markdown, retaining blocks that did not change.
        content.replaceChildren(...blocks.map((block, index) => previous[index] && previous[index].isEqualNode(block) ? previous[index] : block));
        text = next;
        body.replaceChildren(content, copyButton(text, t('ui.copy.step')));
      };
    } else {
      const body = JSON.stringify(item, null, 2);
      details.append(node('pre', body, 'execution-log'), copyButton(body, t('ui.copy.step')));
    }
    return details;
  }
  function appendSteps(message, steps, answer, toolNodes = null) {
    // Previously saved user echoes belong to the user bubble, not the tool timeline.
    steps = steps.filter(item => item.type !== 'user_message');
    // Filter before grouping: hidden summaries must not split adjacent commands.
    if (!showReasoning()) steps = steps.filter(item => item.type !== 'reasoning');
    const timeline = node('div', undefined, 'execution-timeline');
    function tool(item) {
      if (!toolNodes) return toolStep(message, item);
      const signature = JSON.stringify(item), previous = toolNodes.get(item.id);
      if (previous && previous.signature === signature) return previous.element;
      if (previous && previous.element.refreshStep) {
        previous.signature = signature; previous.element.refreshStep(item); return previous.element;
      }
      const element = toolStep(message, item);
      toolNodes.set(item.id, {signature, element});
      return element;
    }
    for (let index = 0; index < steps.length; index++) {
      const item = steps[index];
      if (item.type === 'agent_message' || item.type === 'plan') {
        if (typeof item.text !== 'string' || !item.text.trim()) continue;
        // The dedicated final answer is rendered below, exactly once.
        if (answer && index === steps.length - 1 && item.text.trim() === answer.trim()) continue;
        timeline.append(markdown(item.text));
        continue;
      }
      if (item.type === 'error') {
        timeline.append(node('p', item.text, 'step-error')); continue;
      }
      let end = index + 1;
      while (end < steps.length && steps[end].type === item.type) end++;
      if (end - index > 1) {
        const batch = steps.slice(index, end);
        const running = batch.some(step => step.eventStatus === 'running');
        const failures = batch.filter(stepFailed).length;
        const stopped = batch.some(step => step.eventStatus === 'cancelled');
        const eventStatus = running ? 'running' : failures ? 'completed' : stopped ? 'cancelled' : 'completed';
        const countKey = {command_execution:'commands', web_search:'web_operations', image_generation:'images', image_view:'images', file_change:'changes',
          reasoning:'summaries', todo_list:'updates', mcp_tool_call:'calls', dynamic_tool_call:'calls',
          collab_tool_call:'tasks', collab_agent_tool_call:'tasks', sub_agent_activity:'activities', sleep:'waits', context_compaction:'compactions'}[item.type] || 'steps';
        const label = toolLabel({type:item.type, eventStatus, status:!running && failures ? 'failed' : undefined}, true) +
          ' · ' + t('steps.count.' + countKey, {count:batch.length}) + (failures ? ' · ' + t('steps.count.failures', {count:failures}) : '');
        const className = item.type === 'command_execution' ? 'command-group' : 'step-group';
        // The first step's ID stays stable as more adjacent operations arrive.
        const group = executionDetails(message.id + ':' + className + ':' + item.id, label, className,
          item.type === 'reasoning' && running);
        for (const step of batch) group.append(tool(step));
        timeline.append(group);
        index = end - 1;
        continue;
      }
      timeline.append(tool(item));
    }
    return timeline;
  }
  const processLogCache = new Map();
  function appendDeferredSteps(process, message, job, answer, fallback, activity = null, range = null) {
    const timeline = node('div', undefined, 'execution-timeline'); process.append(timeline);
    const toolNodes = new Map();
    let loading = false, drawn = null;
    async function load() {
      if ((!process.open && !(range && range.lastText)) || loading) return;
      loading = true;
      let entry = processLogCache.get(job.id);
      if (!entry) {
        entry = {items: new Map(), sizes: new Map(), size: 0, version: 0, logVersion: null,
          hasMore: true, pending: null, structured: false, text: ''};
        processLogCache.set(job.id, entry);
      }
      processLogCache.delete(job.id); processLogCache.set(job.id, entry);
      function draw() {
        const signature = JSON.stringify([entry.version, entry.logVersion, job.status, job.live_message && job.live_message.id, showReasoning()]);
        if (process.isConnected === false || drawn === signature) return;
        const live = job.live_message;
        const snapshots = Array.from(entry.items.values()).sort((a, b) => a.position - b.position);
        const label = executionActivity(job, snapshots);
        if (activity) {
          if (activity.textContent !== label) activity.textContent = label;
          activity.hidden = !label;
        }
        const items = snapshots
          .filter(item => !range || (item.position > range.after && item.position <= range.through))
          .filter(item => (item.type !== 'reasoning' || typeof item.text === 'string' && item.text.trim()) && (!live || item.id !== live.id))
          .map(item => job.status === 'cancelled' && item.eventStatus === 'running' ? {...item, eventStatus: 'cancelled'} : item);
        const last = range && range.lastText && [...items].reverse().find(item => item.type === 'agent_message' && typeof item.text === 'string' && item.text.trim() && (!answer || item.text.trim() !== answer.trim()));
        if (range && range.lastText) {
          const text = last ? last.text : '';
          if (range.lastText.dataset.text !== text) {
            range.lastText.dataset.text = text;
            range.lastText.replaceChildren(...(text ? [markdown(text)] : []));
          }
        }
        if (!process.open) { drawn = signature; return; }
        const content = appendSteps({...message, job_id: job.id}, last ? items.filter(item => item !== last) : items, answer, toolNodes);
        if (!content.children.length && !last && !(items.some(item => item.type === 'reasoning') && !showReasoning()) && (!range || range.after === -1 && !entry.structured && entry.text) && (jobFinished(job) || !entry.structured && entry.text)) content.append(node(entry.structured || !entry.text ? 'p' : 'pre',
          entry.structured || !entry.text ? fallback : entry.text, entry.structured || !entry.text ? 'meta' : 'execution-log'));
        const thread = document.getElementById('thread-scroll');
        const follow = !jobFinished(job) && thread && getFollowBottom();
        timeline.replaceChildren(...content.children); drawn = signature;
        if (follow) thread.scrollTop = thread.scrollHeight;
      }
      try {
        if (entry.logVersion !== null) draw();
        else timeline.replaceChildren(node('p', t('ui.loading.execution.steps'), 'meta'));
        while ((process.open || range && range.lastText) && process.isConnected !== false &&
               (entry.hasMore || entry.logVersion === null || entry.logVersion < job.log_version)) {
          if (!entry.pending) {
            const since = entry.version;
            entry.pending = api('/api/jobs/' + encodeURIComponent(job.id) + '/steps?since=' + since).then(result => {
              if (result.version < since && !result.reset || result.has_more && result.version === since) throw new Error(t('ui.invalid.execution.step.version'));
              if (result.reset) { entry.items.clear(); entry.sizes.clear(); entry.size = entry.text.length * 2; }
              for (const item of result.items) {
                const size = JSON.stringify(item).length * 2;
                entry.size += size - (entry.sizes.get(item.id) || 0);
                entry.items.set(item.id, item); entry.sizes.set(item.id, size);
              }
              entry.version = result.version; entry.hasMore = result.has_more; entry.logVersion = result.log_version;
              entry.size += ((result.text || '').length - entry.text.length) * 2;
              entry.structured = result.structured; entry.text = result.text || '';
            }).finally(() => { entry.pending = null; });
          }
          await entry.pending;
          draw();
        }
        draw();
        // Compact previews are cached independently of full command details.
        let size = Array.from(processLogCache.values()).reduce((total, cached) => total + cached.size, 0);
        while (processLogCache.size > 8 || size > 16 * 1024 * 1024) {
          const candidate = Array.from(processLogCache).find(([id, cached]) => id !== job.id && !cached.pending);
          if (!candidate) break;
          processLogCache.delete(candidate[0]); size -= candidate[1].size;
        }
      } catch (error) {
        const retry = node('button', t('ui.retry'), 'review-retry'); retry.type = 'button'; retry.addEventListener('click', load);
        timeline.replaceChildren(node('p', t('error.read', {error:error.message}), 'meta'), retry); drawn = null;
      } finally { loading = false; }
    }
    process.refreshLogs = updated => {
      job = updated;
      if (activity && !process.open) {
        const waiting = (job.questions || []).some(question => question.blocking && ['pending', 'answered'].includes(question.state));
        activity.textContent = job.status === 'running' && !waiting ? t('ui.processing') : executionActivity(job, []);
        activity.hidden = jobFinished(job);
      }
      return load();
    };
    process.addEventListener('toggle', () => { drawn = null; return process.refreshLogs(job); });
    if (range && range.lastText) Promise.resolve().then(load);
    else if (process.open) load();
  }
  return {executionActivity, executionDetails, stepFailed, commandBody, commandDetail, toolLabel, toolStep, appendSteps, appendDeferredSteps};
});
