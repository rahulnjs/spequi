(() => {
  const drafts = new Map(), feedback = new Map(), busy = new Set();
  const scope = () => document.getElementById('workspace')?.dataset.change || 'project';
  const key = form => `${scope()}:${form.id}`;
  function remember(form) {
    drafts.set(key(form), [...form.querySelectorAll('textarea,input:not([type=hidden])')].map(input => ({ name: input.name, value: input.value, checked: input.checked, type: input.type })));
  }
  function show(form, text, error = false, id = key(form)) {
    feedback.set(id, { text, error });
    const node = form.closest('.studio-footer')?.querySelector('#studio-action-feedback') || form.querySelector('[data-lifecycle-feedback]');
    if (node) { node.textContent = text; node.className = error ? 'error-message' : 'success-message'; }
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
    remember(form); busy.add(id); form.setAttribute('aria-busy', 'true');
    const buttons = [...form.querySelectorAll('button[type=submit]'), ...document.querySelectorAll(`button[type=submit][form="${form.id}"]`)].map(button => ({ button, disabled: button.disabled }));
    for (const { button } of buttons) button.disabled = true;
    show(form, 'Working…');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': document.querySelector('meta[name=csrf-token]')?.content || '' }, body: JSON.stringify(payload) });
      if (response.status === 403) throw new Error('Local session verification failed. Reload the viewer and retry.');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The workflow could not run. Refresh readiness and retry.');
      const message = result.summary || (result.job ? 'Queued for your attached agent.' : result.validation ? (result.validation.valid ? 'Specification validation passed.' : 'Validation found issues. See Spec validation below.') : result.cancelled ? 'Workflow cancelled.' : payload.questionId ? 'Answer saved. The same agent session can resume.' : 'Readiness refreshed.');
      show(form, message, false, id);
      if (result.job) {
        feedback.delete(id);
        const notice = form.closest('.studio-footer')?.querySelector('#studio-action-feedback') || form.querySelector('[data-lifecycle-feedback]');
        if (notice) { notice.textContent = ''; notice.className = ''; }
      }
      if (result.job || payload.questionId) drafts.delete(id);
      // Do not redirect a response belonging to a page the user has already left.
      if (result.url && workspace === document.getElementById('workspace')) {
        const isCurrentChange = result.job?.change && result.job.change === workspace.dataset.change;
        if (!isCurrentChange) { location.assign(form.closest('[data-studio]') ? result.url.replace('view=lifecycle', 'view=studio') : result.url); return; }
        for (const input of form.querySelectorAll('textarea')) input.value = '';
      }
      if (workspace === document.getElementById('workspace')) {
        if (form.contains(document.activeElement)) document.activeElement.blur();
        document.dispatchEvent(new window.CustomEvent('workspace-updated'));
      }
    } catch (error) {
      show(form, error.message || 'Could not connect to the local viewer. Retry when it is running.', true, id);
    } finally {
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
