(() => {
  const identities = new Map();
  const drafts = new Map(), feedback = new Map(), busy = new Set();
  const scope = () => document.getElementById('workspace')?.dataset.change || 'project';
  const key = form => `${form.dataset.requestScope || scope()}:${form.id}`;
  window.spequiQuestionForm = (job, question, prefix = 'request') => {
    const node = (tag, text, className) => {
      const item = document.createElement(tag);
      if (text) item.textContent = text;
      if (className) item.className = className;
      return item;
    };
    const section = node('section', '', 'request-question');
    section.dataset.questionKey = `${job.id}:${question.id}`;
    const heading = node('h3', 'Your answer is needed');
    const message = node('p', question.message, 'request-question-text');
    const form = node('form');
    form.id = `${prefix}-answer-${job.id}-${question.id}`;
    form.dataset.lifecycleForm = ''; form.dataset.requestScope = job.id;
    form.action = `/api/lifecycle/jobs/${encodeURIComponent(job.id)}/reply`; form.method = 'post';
    const identity = node('input'); identity.type = 'hidden'; identity.name = 'questionId'; identity.value = question.id;
    form.append(identity);
    const options = question.options || [];
    if (options.length) {
      const choices = node('fieldset'), legend = node('legend', 'Choose an answer');
      choices.append(legend);
      for (const option of options) {
        const label = node('label', '', 'studio-choice'), input = node('input');
        input.type = 'radio'; input.name = 'choice'; input.value = option;
        label.append(input, node('span', option)); choices.append(label);
      }
      form.append(choices);
    }
    const label = node('label', options.length ? 'Additional context (optional)' : 'Your answer');
    const answer = node('textarea'); answer.id = `${form.id}-text`; answer.name = 'answer'; answer.rows = 3; answer.maxLength = 6000; answer.required = !options.length;
    label.htmlFor = answer.id;
    const submit = node('button', 'Reply & continue', 'button primary'); submit.type = 'submit';
    const feedback = node('div'); feedback.dataset.lifecycleFeedback = ''; feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
    form.append(label, answer, submit, feedback);
    section.append(heading, message, form);
    return section;
  };
  function remember(form) {
    drafts.set(key(form), [...form.querySelectorAll('textarea,input:not([type=hidden])')].map(input => ({ name: input.name, value: input.value, checked: input.checked, type: input.type })));
  }
  function show(form, text, error = false, id = key(form)) {
    if (error && form.hasAttribute('data-create-spec')) {
      clearFeedback(form, id);
      document.dispatchEvent(new window.CustomEvent('spequi-toast', { detail: { message: text } }));
      return;
    }
    feedback.set(id, { text, error });
    const node = form.closest('.studio-footer')?.querySelector('#studio-action-feedback') || form.querySelector('[data-lifecycle-feedback]');
    if (node) { node.textContent = text; node.className = error ? 'error-message' : 'success-message'; }
  }
  function clearFeedback(form, id) {
    feedback.delete(id);
    const node = form.closest('.studio-footer')?.querySelector('#studio-action-feedback') || form.querySelector('[data-lifecycle-feedback]');
    if (node) { node.textContent = ''; node.className = ''; }
  }
  function restore() {
    for (const form of document.querySelectorAll('[data-lifecycle-form]')) {
      const id = key(form), saved = drafts.get(id);
      for (const field of saved || []) {
        for (const input of form.querySelectorAll('textarea,input:not([type=hidden])')) if (input.name === field.name) {
          if (field.type === 'radio') { if (input.value === field.value) input.checked = field.checked; }
          else input.value = field.value;
        }
      }
      const message = feedback.get(id); if (message) show(form, message.text, message.error);
      if (busy.has(id)) { form.setAttribute('aria-busy', 'true'); for (const button of form.querySelectorAll('button[type=submit]')) { if (!button.disabled) button.dataset.lifecycleBusy = 'true'; button.disabled = true; } }
    }
  }
  document.addEventListener('input', event => { const form = event.target.closest('[data-lifecycle-form]'); if (form) remember(form); });
  document.addEventListener('change', event => { const form = event.target.closest('[data-lifecycle-form]'); if (form) remember(form); });
  document.addEventListener('htmx:beforeRequest', () => { for (const form of document.querySelectorAll('[data-lifecycle-form]')) remember(form); });
  document.addEventListener('htmx:afterSwap', restore);
  document.addEventListener('submit', async event => {
    const form = event.target.closest('[data-lifecycle-form]'); if (!form) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const id = key(form), workspace = document.getElementById('workspace');
    if (busy.has(id)) return;
    const payload = {};
    for (const input of form.querySelectorAll('[name]')) if (input.type !== 'radio' || input.checked) payload[input.name] = input.value;
    if (form.hasAttribute('data-studio-composer')) { payload.action = payload.intent; delete payload.intent; }
    let endpoint = form.getAttribute('action');
    if (form.hasAttribute('data-studio-composer') && payload.message?.trim().startsWith('/')) { endpoint = '/api/lifecycle/command'; payload.command = payload.message.trim(); delete payload.action; delete payload.message; }
    if (payload.questionId) {
      payload.answer = [payload.choice, payload.answer?.trim()].filter(Boolean).join('\n\n');
      if (!payload.answer) { show(form, 'Choose an option or write an answer to continue.', true); return; }
      delete payload.choice;
    }
    if (form.hasAttribute('data-plan-publish') && !window.confirm(`Commit only this change’s planning files and push branch ${form.dataset.branch}? Earlier commits on the branch will also be published. Unrelated staged edits are kept.`)) return;
    remember(form); busy.add(id); form.setAttribute('aria-busy', 'true');
    const buttons = [...form.querySelectorAll('button[type=submit]'), ...document.querySelectorAll(`button[type=submit][form="${form.id}"]`)].map(button => ({ button, disabled: button.disabled }));
    for (const { button } of buttons) button.disabled = true;
    clearFeedback(form, id);
    try {
      if (form.hasAttribute('data-create-spec')) {
        if (window.spequiSaveDraft) await window.spequiSaveDraft(form);
        form.dataset.draftSubmitting = 'true';
      }
      if (endpoint === '/api/lifecycle/actions' || endpoint === '/api/lifecycle/command' || endpoint === '/api/jobs') {
        const signature = JSON.stringify(payload), previous = identities.get(id);
        const identity = previous?.signature === signature ? previous : { signature, value: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}` };
        identities.set(id, identity); payload.requestKey = identity.value;
      }
      const sendRequest = () => fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': document.querySelector('meta[name=csrf-token]')?.content || '' }, body: JSON.stringify(payload) });
      let response = await sendRequest();
      if (response.status === 403) throw new Error('Local session verification failed. Reload the viewer and retry.');
      let result = await response.json();
      if (!response.ok && result.code === 'branch_confirmation_required') {
        if (!window.confirm(result.error)) return;
        payload.confirmBranch = true;
        response = await sendRequest(); result = await response.json();
      }
      if (response.status === 403) throw new Error('Local session verification failed. Reload the viewer and retry.');
      if (!response.ok) throw new Error(result.error || 'The workflow could not run. Refresh readiness and retry.');
      const message = result.summary || (result.job ? 'Queued for your attached agent.' : result.validation ? (result.validation.valid ? 'Specification validation passed.' : 'Validation found issues. See Spec validation below.') : result.cancelled ? 'Workflow cancelled.' : payload.questionId ? 'Answer saved. The same agent session can resume.' : 'Readiness refreshed.');
      if (payload.questionId || endpoint.endsWith('/cancel')) {
        document.dispatchEvent(new window.CustomEvent('requests-updated'));
        void window.spequiRefreshAgent?.();
      }
      if (result.job) {
        if (form.hasAttribute('data-create-spec')) form.dataset.draftSubmitted = result.job.id;
        clearFeedback(form, id);
        const persist = Boolean(result.url && workspace === document.getElementById('workspace') && result.job.change !== workspace?.dataset.change);
        document.dispatchEvent(new window.CustomEvent('spequi-toast', { detail: { message, persist } }));
      } else show(form, message, false, id);
      if (result.job || payload.questionId) { drafts.delete(id); identities.delete(id); }
      // Do not redirect a response belonging to a page the user has already left.
      if (result.url && workspace === document.getElementById('workspace')) {
        const isCurrentChange = result.job?.change && result.job.change === workspace.dataset.change;
        if (!isCurrentChange || result.finishedPlanning) { location.assign(result.url); return; }
        for (const input of form.querySelectorAll('textarea')) input.value = '';
      }
      if (workspace === document.getElementById('workspace')) {
        if (['plan-next', 'preview'].includes(result.job?.action)) {
          const url = new URL(workspace.dataset.refreshUrl || location.href, location.href);
          url.searchParams.set('follow', result.job.id);
          workspace.dataset.refreshUrl = url.pathname + url.search;
        }
        if (form.contains(document.activeElement)) document.activeElement.blur();
        document.dispatchEvent(new window.CustomEvent('workspace-updated'));
      }
    } catch (error) {
      if (!error.draftNotification) show(form, error.message || 'Could not connect to the local viewer. Retry when it is running.', true, id);
    } finally {
      delete form.dataset.draftSubmitting;
      busy.delete(id); form.removeAttribute('aria-busy');
      for (const { button, disabled } of buttons) button.disabled = disabled;
      for (const current of document.querySelectorAll('[data-lifecycle-form]')) if (key(current) === id) {
        current.removeAttribute('aria-busy');
        for (const button of current.querySelectorAll('[data-lifecycle-busy]')) { button.disabled = false; delete button.dataset.lifecycleBusy; }
        const message = feedback.get(id); if (message) show(current, message.text, message.error, id);
      }
    }
  }, true);
})();
