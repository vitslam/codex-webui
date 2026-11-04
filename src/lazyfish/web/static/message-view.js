'use strict';
// Render individual messages and live text; user actions are callbacks.
(function (root, create) {
  if (typeof module !== 'undefined' && module.exports) module.exports = create;
  else (root.LazyfishUI || (root.LazyfishUI = {})).messageView = create;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global,
function createMessageView({document, node, icon, t, i18n, markdown, copyButton, imageNode, artifactList = () => null, executionDetails, appendDeferredSteps,
  appendChangePanel, jobFinished, executionActivity, questionLabel, onQuestion, onStop, onImplement, onEdit, onFork, onEditStart = () => {}, canEdit = () => false, newRequestId}) {
  let selectedActions = null, actionsBound = false;
  function bindUserActions() {
    if (actionsBound) return;
    actionsBound = true;
    document.addEventListener('click', event => {
      const card = event.target.closest('.message.user');
      if (selectedActions && selectedActions !== card) { selectedActions.classList.remove('actions-open'); selectedActions = null; }
      if (card && event.target.closest('.user-actions .copy-button:not(.user-edit-button)')) {
        card.classList.remove('actions-open');
        if (selectedActions === card) selectedActions = null;
        return;
      }
      if (!card || event.target.closest('button, a, textarea, input, select, form')) return;
      if (event.pointerType !== 'touch' && !document.defaultView.matchMedia('(hover: none), (pointer: coarse)').matches) return;
      const open = !card.classList.contains('actions-open');
      card.classList.toggle('actions-open', open); selectedActions = open ? card : null;
    });
  }
  function updateUserActions() {
    if (selectedActions && !selectedActions.isConnected) selectedActions = null;
    for (const button of document.querySelectorAll('.user-edit-button')) {
      button.disabled = !canEdit(button.dataset.messageId);
      button.title = t(button.disabled ? 'ui.edit.after.task' : 'ui.edit.message');
    }
  }
  function resizeEditor(input) {
    input.style.height = 'auto'; input.style.height = input.scrollHeight + 'px';
  }
  function resizeEditors() {
    for (const input of document.querySelectorAll('.message-editor textarea')) resizeEditor(input);
  }
  function appendUserActions(card, message) {
    const actions = node('div', undefined, 'user-actions');
    if (onFork && !message.pending && !message.id.startsWith('pending-')) {
      const branch = node('button', undefined, 'copy-button user-fork-button branch'); branch.type = 'button';
      branch.append(icon('fork')); branch.disabled = !!message.instruction_state;
      branch.title = t(branch.disabled ? 'conversation.fork_instruction' : 'conversation.fork');
      branch.setAttribute('aria-label', t('conversation.fork'));
      branch.addEventListener('click', async () => {
        if (branch.disabled) return;
        branch.disabled = true;
        try { await onFork(message); }
        finally { branch.disabled = false; }
      });
      actions.append(branch);
    }
    const copy = copyButton(message.content || ''); copy.disabled = !message.content;
    const edit = node('button', undefined, 'copy-button user-edit-button'); edit.type = 'button';
    edit.append(icon('edit')); edit.dataset.messageId = message.id;
    edit.setAttribute('aria-label', t('ui.edit.message'));
    edit.disabled = !canEdit(message.id); edit.title = t(edit.disabled ? 'ui.edit.after.task' : 'ui.edit.message');
    edit.addEventListener('click', () => {
      if (!canEdit(message.id) || card.classList.contains('is-editing')) return;
      onEditStart();
      const content = card.querySelector('.user-content');
      const form = node('form', undefined, 'message-editor');
      const input = node('textarea'); input.value = message.content || ''; input.rows = 1;
      input.setAttribute('aria-label', t('ui.edit.message')); input.enterKeyHint = 'enter';
      input.addEventListener('input', () => resizeEditor(input));
      const status = node('p', '', 'message-editor-error'); status.setAttribute('role', 'status');
      const buttons = node('div', undefined, 'message-editor-buttons');
      const cancel = node('button', t('ui.cancel')); cancel.type = 'button';
      const send = node('button', t('ui.send')); send.type = 'submit'; send.className = 'message-edit-send';
      function close() { form.remove(); content.hidden = false; card.classList.remove('is-editing'); edit.focus(); }
      cancel.addEventListener('click', close);
      form.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !event.isComposing && !send.disabled) { event.preventDefault(); event.stopPropagation(); close(); }
      });
      let requestId = null, sentContent = null;
      form.addEventListener('submit', async event => {
        event.preventDefault(); if (send.disabled) return;
        if (!input.value.trim() && !(message.images || []).length) { input.focus(); return; }
        if (input.value === message.content) { close(); return; }
        if (sentContent !== input.value) { requestId = newRequestId(); sentContent = input.value; }
        send.disabled = cancel.disabled = input.disabled = true; status.textContent = '';
        try { await onEdit(message, sentContent, requestId); if (form.isConnected) close(); }
        catch (error) { status.textContent = error.message; }
        finally { send.disabled = cancel.disabled = input.disabled = false; }
      });
      buttons.append(cancel, send); form.append(input, status, buttons);
      content.hidden = true; card.classList.add('is-editing'); card.insertBefore(form, content);
      resizeEditor(input);
    });
    actions.append(copy, edit); card.append(actions);
  }
  function validTokenUsage(usage) {
    return usage && ['input_tokens', 'cached_input_tokens', 'output_tokens'].every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0)
      && usage.cached_input_tokens <= usage.input_tokens;
  }
  function appendTokenUsage(card, usage) {
    if (!validTokenUsage(usage)) return;
    const format = value => i18n.number(value);
    const rate = usage.input_tokens > 0 ? `${Number((usage.cached_input_tokens / usage.input_tokens * 100).toFixed(1))}%` : '—';
    const summary = node('span', `token ${format(usage.input_tokens + usage.output_tokens)} · hit ${rate}`, 'token-usage');
    summary.title = t('tokens.details', {input:format(usage.input_tokens), output:format(usage.output_tokens), cached:format(usage.cached_input_tokens)});
    card.append(summary);
  }
  function elapsedTime(start, end) {
    if (!Number.isFinite(start) || !Number.isFinite(end)) return '';
    const seconds = Math.max(0, Math.floor(end - start));
    if (seconds < 60) return t('duration.seconds', {seconds});
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return t('duration.minutes', {minutes, seconds:seconds % 60});
    return t('duration.hours', {hours:Math.floor(minutes / 60), minutes:minutes % 60, seconds:seconds % 60});
  }
  function executionLabel(job) {
    if (!job) return t('ui.process');
    const finished = jobFinished(job);
    // updated_at is frozen when the gateway accepts completion. Include queue time.
    const duration = elapsedTime(job.created_at, finished ? job.updated_at : Date.now() / 1000);
    if (finished) return duration ? t('process.finished', {duration}) : t('ui.process');
    return duration ? t('process.elapsed', {duration}) : t('ui.process');
  }
  function updateExecutionTimers() {
    for (const summary of document.querySelectorAll('.execution-process>summary[data-started-at]')) {
      summary.textContent = executionLabel({status: summary.dataset.state, created_at: Number(summary.dataset.startedAt)});
    }
  }
  function appendJobStatus(card, job) {
    const footer = node('div', undefined, 'message-status');
    const status = card.activityStatus || node('span', jobFinished(job)
      ? {cancelled:t('ui.stopped'), done:t('ui.completed'), failed:t('ui.failed.to.run')}[job.status] : executionActivity(job, []), 'status');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    status.dataset.state = job.status; footer.append(status);
    if (jobFinished(job) && Number.isFinite(job.updated_at)) {
      const date = new Date(job.updated_at * 1000);
      const timestamp = node('time', date.toLocaleString(i18n.locale, {year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false}), 'completed-at');
      timestamp.dateTime = date.toISOString();
      timestamp.title = t(job.status === 'cancelled' ? 'time.stopped' : 'time.finished'); footer.append(timestamp);
    }
    card.append(footer);
  }
  function appendAssistant(card, message, job, instructions = []) {
    const finished = jobFinished(job);
    const activity = finished ? null : node('span', executionActivity(job, []), 'status');
    if (activity) card.activityStatus = activity;
    const hasSteps = !!(message.has_logs && job && job.id);
    const answer = finished ? (job && typeof job.final_answer === 'string'
      ? job.final_answer : message.answer || '') : '';
    const fallback = job && job.status === 'queued' ? t('ui.queued.with_ellipsis')
      : job && job.status === 'running' ? t('ui.processing.with_ellipsis')
      : job && job.status === 'cancelling' ? t('ui.stopping.with_ellipsis')
      : job && job.status === 'cancelled' ? t('ui.reply.stopped')
      : job && job.status === 'failed' ? (job.error === 'conversation.fork_missing_history' ? t(job.error) : job.error || t('ui.task.failed.please.retry'))
      : t('ui.the.task.ended.without.a.final.answer');
    if (instructions.length) {
      // Each disclosure covers the execution between two instructions. The
      // messages stay outside disclosures, so they remain visible when folded.
      let after = -1;
      // Old records have no boundary. Keep them in order immediately before
      // the next known boundary, or after the recorded steps if none exists.
      const boundaries = instructions.map((instruction, index) => {
        const next = instructions.slice(index).find(item => Number.isSafeInteger(item.instruction_step_position));
        return next ? next.instruction_step_position : Infinity;
      });
      for (let index = 0; index <= instructions.length; index++) {
        const through = index < instructions.length ? boundaries[index] : Infinity;
        const segmentJob = job && {...job, created_at: index ? instructions[index - 1].created_at : job.created_at,
          ...(index < instructions.length ? {status: 'done', updated_at: instructions[index].created_at} : {})};
        if (index > 0) card.append(node('div', 'Codex', 'message-role continuation-role'));
        if ((hasSteps || job && !finished) && (after < through || index === instructions.length)) {
          const process = executionDetails(message.id + ':process:' + (finished ? 'finished' : 'active') + ':' + index,
            executionLabel(segmentJob), 'execution-process', !finished && index === instructions.length);
          if (index === instructions.length && job && !finished && Number.isFinite(segmentJob.created_at)) {
            process.children[0].dataset.startedAt = segmentJob.created_at; process.children[0].dataset.state = job.status;
          }
          const lastText = index < instructions.length ? node('div', undefined, 'interrupted-message') : null;
          appendDeferredSteps(process, message, job, answer, fallback, index === instructions.length ? activity : null,
            {after, through, lastText});
          card.append(process);
          if (lastText) card.append(lastText);
        }
        if (index < instructions.length) { card.append(messageCard(instructions[index], null)); after = through; }
      }
    } else if (hasSteps || (job && !finished)) {
      // Separate states ensure completion collapses even a manually opened live process.
      const process = executionDetails(message.id + ':process:' + (finished ? 'finished' : 'active'),
        executionLabel(job), 'execution-process', !finished);
      const summary = process.children[0];
      if (job && !finished && Number.isFinite(job.created_at)) {
        summary.dataset.startedAt = job.created_at; summary.dataset.state = job.status;
      }
      appendDeferredSteps(process, message, job, answer, finished ? t('ui.no.intermediate.steps.recorded') : fallback, activity);
      card.append(process);
    }
    const stoppedAnswer = job && job.local_stopped && job.live_message && job.live_message.text &&
      job.live_message.phase === 'final_answer' && job.live_message.delivery !== 'async';
    const renderedAnswer = answer ? markdown(answer) : null;
    // A linked image already present in the final answer needs no second preview.
    const inlineImages = renderedAnswer && renderedAnswer.querySelectorAll
      ? Array.from(renderedAnswer.querySelectorAll('img')).map(image => image.getAttribute('src')) : [];
    const outputs = artifactList(job && job.artifacts, inlineImages);
    if (renderedAnswer) card.append(renderedAnswer);
    else if (finished && !stoppedAnswer && !outputs) card.append(markdown(fallback));
    if (outputs) card.append(outputs);
    const actions = node('div', undefined, 'reply-actions meta');
    if (finished && answer && job && job.collaboration_mode === 'plan' && job.status === 'done') {
      const implement = node('button', t('ui.start.implementation'), 'implement-plan'); implement.type = 'button';
      implement.addEventListener('click', onImplement);
      actions.append(implement);
    }
    for (const question of job && job.questions || []) {
      if (question.kind === 'approval' && question.state !== 'pending') continue;
      const button = node('button', questionLabel(question.state, question.kind), 'question-reopen');
      button.dataset.questionId = question.id;
      button.type = 'button';
      button.addEventListener('click', () => onQuestion(question.id));
      actions.append(button);
    }
    if (actions.children.length) card.append(actions);
    const footer = node('div', undefined, 'reply-footer meta');
    if (answer) footer.append(copyButton(answer));
    const info = node('div', undefined, 'reply-info');
    if (job && finished) {
      const metadata = [job.model, job.reasoning_effort, job.fast_mode ? 'fast' : ''].filter(Boolean).join(' · ');
      if (metadata) info.append(node('span', metadata, 'reply-model'));
    }
    if (finished) appendTokenUsage(info, job && job.token_usage);
    if (info.children.length) {
      if (answer) {
        const separator = node('span', '·', 'reply-separator'); separator.setAttribute('aria-hidden', 'true');
        footer.append(separator);
      }
      footer.append(info);
    }
    appendChangePanel(card, message, job);
    if (footer.children.length) card.append(footer);
    if (job && job.log_truncated) card.append(node('div', t('ui.the.log.reached.its.storage.limit.some.steps.may'), 'meta'));
  }
  function messageCard(message, job, instructions = []) {
    const card = node('article', undefined, 'message ' + message.role);
    card.dataset.messageId = message.id;
    if (message.role === 'assistant' && message.job_id) card.dataset.jobId = message.job_id;
    card.append(node('div', message.role === 'user' ? t('ui.you') : 'Codex', 'message-role'));
    if (message.role === 'assistant') appendAssistant(card, message, job, instructions);
    else card.append(node('div', message.content || '', 'user-content'));
    if (message.role === 'user' && message.skills && message.skills.length) {
      const skills = node('div', undefined, 'message-skills'); skills.setAttribute('aria-label', t('ui.skills'));
      for (const skill of message.skills) {
        const chip = node('span', t(message.pending ? 'skills.selected' : 'skills.attached', {name:skill.name}), 'skill-chip');
        chip.title = skill.path; skills.append(chip);
      }
      card.append(skills);
    }
    if (message.images && message.images.length) {
      const images = node('div', undefined, 'image-list message-images');
      for (const image of message.images) {
        const link = node('a'); link.href = image.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        const preview = imageNode(image.url, image.name, image);
        if (preview.width && preview.height) {
          const width = Math.min(220, 200 * preview.width / preview.height) + 'px';
          link.style.width = link.style.flexBasis = width;
          link.style.aspectRatio = preview.width + ' / ' + preview.height;
        }
        link.append(preview); images.append(link);
      }
      card.append(images);
    }
    if (message.instruction_state && message.instruction_state !== 'delivered') card.append(node('p', t('instruction.status', {status: {pending: t('ui.waiting.for.delivery'), delivered: t('ui.delivered'), failed: t('ui.delivery.failed'), expired: t('ui.task.ended.delivery.unconfirmed')}[message.instruction_state] || message.instruction_state}), 'instruction-delivery'));
    if (message.role === 'user') appendUserActions(card, message);
    if (message.role === 'assistant' && job) appendJobStatus(card, job);
    if (job && job.stop_error) {
      const warning = node('div', undefined, 'stop-warning meta');
      warning.append(node('span', t('ui.the.stop.request.was.not.delivered.the.task.may')));
      const retry = node('button', t('ui.retry.stop'), 'review-retry'); retry.type = 'button';
      retry.addEventListener('click', () => onStop(job)); warning.append(retry); card.append(warning);
    }
    return card;
  }
  function applyLiveMessage(card, job) {
    const live = (!jobFinished(job) || job.local_stopped) && job.live_message;
    let preview = card.querySelector('.live-message');
    if (!live || !live.text) { if (preview) preview.remove(); return !!preview; }
    const parent = live.phase === 'final_answer' && live.delivery !== 'async' ? card : Array.from(card.querySelectorAll(':scope > .execution-process')).pop() || card;
    if (!preview) {
      preview = node('div', undefined, 'live-message');
      if (parent === card) card.insertBefore(preview, card.querySelector('.reply-actions, .reply-footer, .message-status'));
      else parent.append(preview);
    }
    else if (preview.parentNode !== parent) parent.append(preview);
    if (preview.dataset.text === live.text) return;
    preview.dataset.text = live.text;
    preview.replaceChildren(markdown(live.text));
    return true;
  }

  return {appendUserActions,validTokenUsage, appendTokenUsage, elapsedTime, executionLabel, updateExecutionTimers,
    appendJobStatus, appendAssistant, messageCard, applyLiveMessage, updateUserActions, resizeEditors, bindUserActions};
});
