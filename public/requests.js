(() => {
  const panel = () => document.getElementById('requests-panel');
  const workspace = () => document.getElementById('workspace');
  const labels = { queued: 'Queued', running: 'Working', 'awaiting-input': 'Answer needed', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' };
  const actions = { 'start-plan': 'New spec', 'plan-next': 'Next artifact', 'revise-plan': 'Spec revision', preview: 'Implementation preview', verify: 'Verification', explore: 'Question', 'update-specs': 'Review feedback', impact: 'File impact', archive: 'Archive' };
  let page = 1, pages = 1, opener, activityPending, activityAgain = false, agent = {}, listGeneration = 0;
  const saves = new Map(), saved = new Map(), saveFailures = new Map(), deletedDrafts = new Set();
  async function api(url, payload) {
    const response = await fetch(url, payload === undefined ? { headers: { Accept: 'application/json' } } : { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || '' }, body: JSON.stringify(payload), ...(url === '/api/drafts' ? { keepalive: true } : {}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The request could not be completed. Retry with the project server running.');
    return result;
  }
  function node(tag, text, className) {
    const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element;
  }
  function requestIcon(name) {
    const paths = { open: '<path d="M7 17 17 7M7 7h10v10"/>', delete: '<path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6m4-6v6"/>', chevron: '<path d="m9 5 7 7-7 7"/>' };
    const icon = node('span', undefined, 'request-action-icon'); icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
    return icon;
  }
  function requestTime(value) {
    const date = new Date(value), today = date.toDateString() === new Date().toDateString();
    const time = node('time', today ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) }));
    time.setAttribute('datetime', date.toISOString()); time.title = date.toLocaleString(); return time;
  }
  function feedback(text, error = false) {
    const target = panel()?.querySelector('[data-requests-feedback]');
    if (target) { target.textContent = text; target.className = error ? 'error-message' : 'success-message'; }
  }
  function close() {
    if (panel()) panel().hidden = true;
    for (const toggle of document.querySelectorAll('[data-requests-toggle]')) toggle.setAttribute('aria-expanded', 'false');
  }
  function openLink(job) {
    const stage = ['preview', 'impact'].includes(job.action) ? 'implement' : ['verify', 'sync-specs', 'archive'].includes(job.action) ? 'finish' : 'shape';
    const query = job.action === 'start-plan' ? { view: 'studio', new: '1', creation: job.id } : {
      change: job.change || '', view: 'studio', stage,
      ...(job.status === 'awaiting-input' ? { pane: 'conversation' } : {}),
      ...(job.action === 'preview' ? { job: job.id } : {}),
      ...(job.action === 'impact' ? { job: job.reviewPreview, file: job.reviewFile } : {})
    };
    const link = node('a', job.status === 'awaiting-input' ? 'Reply' : 'Open', 'button request-open');
    link.setAttribute('aria-label', job.status === 'awaiting-input' ? 'Reply to request' : 'Open request');
    link.append(requestIcon('open')); link.href = '/?' + new URLSearchParams(query); return link;
  }
  function button(text, action, id) {
    const control = node('button', action === 'delete' ? undefined : text, action === 'delete' ? 'button request-delete' : 'button');
    if (action === 'delete') { control.append(requestIcon('delete')); control.setAttribute('aria-label', 'Delete request'); control.title = 'Delete request'; }
    control.type = 'button'; control.dataset.requestAction = action; control.dataset.requestId = id; return control;
  }
  function emptyRequests(status) {
    const copy = {
      all: ['No requests yet', 'Start a new spec or work on an existing change. Follow your agent’s progress and reply to questions here.'],
      active: ['No active requests', 'When you send a request, follow its progress and reply to your agent here.'],
      completed: ['No completed requests', 'Requests appear here once your agent finishes the work.'],
      failed: ['No failed requests', 'Requests that need a retry will appear here if something goes wrong.'],
      cancelled: ['No cancelled requests', 'Requests you cancel will appear here.']
    }[status];
    const state = node('div', undefined, 'requests-empty');
    const icon = node('span', undefined, 'requests-empty-icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/></svg>';
    state.append(icon, node('h3', copy[0]), node('p', copy[1]));
    const action = node(status === 'all' ? 'a' : 'button', status === 'all' ? 'New spec' : 'Show all requests', 'button');
    action.setAttribute('data-request-empty-action', '');
    if (status === 'all') action.href = '/?view=studio&new=1';
    else { action.type = 'button'; action.setAttribute('data-request-show-all', ''); }
    state.append(action);
    return state;
  }
  async function loadRequests() {
    if (!panel() || panel().hidden) return;
    const generation = ++listGeneration;
    const list = panel().querySelector('[data-request-list]');
    list.setAttribute('aria-busy', 'true');
    if (!list.children.length) list.append(node('p', 'Loading requests…', 'requests-loading'));
    try {
      const status = panel().querySelector('[data-request-filter]').value;
      const result = await api('/api/requests?' + new URLSearchParams({ status, page }));
      if (generation !== listGeneration) return;
      page = result.page; pages = result.pages;
      const scroll = list.scrollTop;
      const expanded = new Set([...list.querySelectorAll('.request-row details[open]')].map(detail => detail.closest('.request-row').dataset.requestId));
      const focused = list.contains(document.activeElement) ? document.activeElement : null;
      const focus = focused ? { id: focused.closest('.request-row')?.dataset.requestId, action: focused.dataset.requestAction, tag: focused.tagName.toLowerCase(), empty: focused.hasAttribute('data-request-empty-action') } : null;
      list.replaceChildren();
      if (!result.items.length) list.append(emptyRequests(status));
      for (const job of result.items) {
        const row = node('section', undefined, 'request-row'), heading = node('div', undefined, 'request-heading');
        row.dataset.requestId = job.id;
        const status = node('span', labels[job.status] || job.status, 'request-state'); status.dataset.state = job.status;
        const name = node('strong', job.change || 'Project question'); name.title = name.textContent;
        heading.append(name, status);
        row.append(heading);
        const detail = node('details'); detail.open = expanded.has(job.id);
        const summary = node('summary'); summary.append(node('span', job.message || 'View request details', 'request-summary-text'), requestIcon('chevron')); detail.append(summary);
        const body = node('div', undefined, 'request-detail-body'), log = node('ol');
        for (const item of job.logs?.slice(-30) || []) log.append(node('li', item.message));
        if (log.children.length) body.append(node('h3', 'Activity'), log);
        if (job.result) body.append(node('h3', 'Result'), node('p', job.result, 'request-result'));
        detail.append(body); row.append(detail);
        const footer = node('div', undefined, 'request-footer'), meta = node('div', undefined, 'request-meta');
        const kind = node('span', actions[job.action] || job.action, 'request-kind'); kind.title = kind.textContent;
        meta.append(kind, requestTime(job.updatedAt));
        const controls = node('div', undefined, 'request-controls'); controls.append(openLink(job));
        if (['queued', 'awaiting-input'].includes(job.status) || job.status === 'running' && !job.origin && agent.queue?.active?.id === job.id && !agent.queue.active.ownerConnected) controls.append(button(job.status === 'running' ? 'End stalled request' : 'Cancel request', 'cancel', job.id));
        if (['failed', 'cancelled'].includes(job.status) && ['explore', 'preview', 'verify', 'impact'].includes(job.action)) controls.append(button('Retry', 'retry', job.id));
        if (!['queued', 'running', 'awaiting-input'].includes(job.status)) controls.append(button('Delete…', 'delete', job.id));
        footer.append(meta, controls); row.append(footer); list.append(row);
      }
      list.scrollTop = scroll;
      if (focus) {
        const row = [...list.querySelectorAll('.request-row')].find(row => row.dataset.requestId === focus.id);
        const control = focus.empty ? list.querySelector('[data-request-empty-action]') : focus.action ? [...(row?.querySelectorAll('[data-request-action]') || [])].find(control => control.dataset.requestAction === focus.action) : ['summary', 'a'].includes(focus.tag) ? row?.querySelector(focus.tag) : null;
        (control || row?.querySelector('summary') || panel().querySelector('[data-request-filter]')).focus({ preventScroll: true });
      }
      panel().querySelector('[data-request-pagination]').textContent = `${result.total} ${result.total === 1 ? 'request' : 'requests'}${pages > 1 ? ` · ${page} of ${pages}` : ''}`;
      panel().querySelector('footer').hidden = result.total === 0;
      const paging = panel().querySelector('[data-request-pages]'); if (paging) paging.hidden = pages <= 1;
      panel().querySelector('[data-request-page="previous"]').disabled = page <= 1;
      panel().querySelector('[data-request-page="next"]').disabled = page >= pages;
    } catch (error) {
      if (generation !== listGeneration) return;
      list.querySelector('.requests-loading')?.remove(); feedback(error.message, true);
    } finally { if (generation === listGeneration) list.removeAttribute('aria-busy'); }
  }
  function renderDrafts(drafts) {
    const section = document.querySelector('[data-drafts-navigation]'); if (!section) return;
    const signature = JSON.stringify(drafts); if (section.dataset.signature === signature) return;
    const previous = JSON.parse(section.dataset.signature || '[]');
    if (previous.some(item => item.hasPlan && !drafts.some(draft => draft.id === item.id))) document.dispatchEvent(new window.CustomEvent('workspace-updated'));
    section.dataset.signature = signature; section.hidden = !drafts.length;
    section.querySelector('[data-draft-count]').textContent = drafts.length;
    const list = section.querySelector('[data-draft-links]'); list.replaceChildren();
    const current = new URL(workspace()?.dataset.refreshUrl || location.href, location.href);
    for (const draft of drafts) {
      const href = '/?' + new URLSearchParams(draft.hasPlan ? { change: draft.change, view: 'studio', draft: draft.id } : draft.creationId ? { view: 'studio', new: '1', creation: draft.creationId, draft: draft.id } : { view: 'studio', new: '1', draft: draft.id });
      const link = node('a', undefined, 'change-link draft-link'); link.href = href;
      for (const [key, value] of Object.entries({ 'hx-get': href, 'hx-target': '#workspace', 'hx-swap': 'outerHTML', 'hx-push-url': 'true' })) link.setAttribute(key, value);
      if (current.searchParams.get('draft') === draft.id || draft.creationId && workspace()?.dataset.change === draft.change) link.classList.add('selected');
      const icon = node('span', undefined, 'nav-icon');
      icon.innerHTML = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M10 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8l6 6v4"/><path d="M14 2v6h6"/><path d="m16 22 6-6a2.12 2.12 0 0 0-3-3l-6 6-1 4Z"/><path d="m18 14 3 3"/></svg>';
      const copy = node('span', undefined, 'nav-change'); copy.append(node('span', draft.change || 'Untitled idea'), node('small', (['queued', 'running', 'awaiting-input'].includes(draft.status) ? labels[draft.status] : draft.hasPlan ? 'Continue planning' : 'Saved idea')));
      link.append(icon, copy); list.append(link);
    }
    window.htmx?.process(section);
  }
  async function activity() {
    if (activityPending) { activityAgain = true; return activityPending; }
    const current = workspace(); if (!current) return;
    const query = new URL(current.dataset.refreshUrl || location.href, location.href);
    activityPending = (async () => {
      const result = await api('/api/activity?' + new URLSearchParams({ change: current.dataset.change || '', creation: query.searchParams.get('creation') || '' }));
      agent = result.agent; document.dispatchEvent(new window.CustomEvent('agent-status', { detail: agent }));
      for (const count of document.querySelectorAll('[data-request-count]')) { count.textContent = result.active.length; count.hidden = !result.active.length; }
      renderDrafts(result.drafts);
      for (const status of document.querySelectorAll('[data-job-state]')) status.textContent = labels[result.active.find(job => job.change === status.dataset.jobState)?.status] || '';
      if (current !== workspace()) return;
      if (current.dataset.requestState !== result.revision) {
        current.dataset.requestState = result.revision;
        document.dispatchEvent(new window.CustomEvent('workspace-updated'));
        return;
      }
      const thread = document.getElementById('studio-thread');
      if (thread && !thread.contains(document.activeElement)) {
        const scroll = thread.scrollTop, nearBottom = thread.scrollHeight - thread.clientHeight - scroll < 32;
        const open = [...thread.querySelectorAll('details[open][id]')].map(item => item.id);
        thread.innerHTML = result.thread;
        for (const id of open) document.getElementById(id)?.setAttribute('open', '');
        thread.scrollTop = nearBottom ? thread.scrollHeight : scroll;
      }
    })().catch(error => { if (panel() && !panel().hidden) feedback(error.message, true); }).finally(() => {
      activityPending = null;
      if (activityAgain) { activityAgain = false; void activity(); }
    });
    return activityPending;
  }
  window.spequiSaveDraft = function (form) {
    const id = form.querySelector('[name="draftId"]')?.value;
    const stopped = () => deletedDrafts.has(id) || form.dataset.draftSubmitting === 'true' || Boolean(form.dataset.draftSubmitted);
    if (!id || stopped()) return Promise.resolve();
    const payload = { id, change: form.querySelector('[name="change"]').value, message: form.querySelector('[name="message"]').value, planMode: form.querySelector('[name="planMode"]:checked')?.value || 'next' };
    if (!payload.change.trim() && !payload.message.trim()) return Promise.resolve();
    const signature = JSON.stringify(payload), info = form.querySelector('[data-draft-save-state]');
    const save = (saves.get(id) || Promise.resolve()).catch(() => {}).then(async () => {
      if (stopped() || saved.get(id) === signature) return;
      if (info?.isConnected) info.textContent = 'Saving draft…';
      await api('/api/drafts', payload); saved.set(id, signature); saveFailures.delete(id);
      if (form.isConnected) {
        if (info) info.textContent = 'Draft saved';
        const remove = form.querySelector('[data-draft-delete]'); if (remove) remove.hidden = false;
        const url = new URL(workspace().dataset.refreshUrl || location.href, location.href); url.searchParams.set('draft', id);
        workspace().dataset.refreshUrl = url.pathname + url.search;
        history.replaceState(history.state, '', url.pathname + url.search);
      }
      void activity();
    }).catch(error => {
      if (info?.isConnected && !stopped()) {
        info.textContent = 'Draft not saved';
        const failure = signature + error.message;
        if (saveFailures.get(id) !== failure) {
          saveFailures.set(id, failure);
          document.dispatchEvent(new window.CustomEvent('spequi-toast', { detail: { message: `Draft could not be saved. ${error.message}` } }));
        }
      }
      error.draftNotification = true;
      throw error;
    });
    saves.set(id, save); return save;
  };
  let saveTimer;
  function scheduleSave(event) {
    const form = event.target.closest('[data-create-spec]'); if (!form || form.dataset.draftSubmitting || form.dataset.draftSubmitted) return;
    clearTimeout(saveTimer); saveTimer = setTimeout(() => { void window.spequiSaveDraft(form).catch(() => {}); }, 500);
  }
  document.addEventListener('input', scheduleSave); document.addEventListener('change', scheduleSave);
  document.addEventListener('htmx:beforeRequest', event => {
    if (!event.detail?.elt?.matches('a,form,input')) return;
    const form = document.querySelector('[data-create-spec]');
    if (form) { clearTimeout(saveTimer); void window.spequiSaveDraft(form).catch(() => {}); }
  });
  window.addEventListener('pagehide', () => {
    const form = document.querySelector('[data-create-spec]');
    if (form) { clearTimeout(saveTimer); void window.spequiSaveDraft(form).catch(() => {}); }
  });
  async function perform(control, action, id, payload = {}) {
    control.disabled = true;
    try {
      await api(`/api/jobs/${encodeURIComponent(id)}/${action}`, payload);
      if (action === 'retry') { feedback(''); document.dispatchEvent(new window.CustomEvent('spequi-toast', { detail: { message: 'Retry queued.' } })); }
      else feedback(action === 'delete' ? 'Request removed.' : 'Request cancelled.');
      await Promise.all([activity(), loadRequests()]);
    }
    catch (error) { feedback(error.message, true); }
    finally { control.disabled = false; }
  }
  document.addEventListener('click', event => {
    const toggle = event.target.closest('[data-requests-toggle]');
    if (toggle) {
      const visible = panel().hidden; close(); panel().hidden = !visible;
      if (visible) { opener = toggle; toggle.setAttribute('aria-expanded', 'true'); panel().querySelector('[data-requests-close]').focus(); void loadRequests(); }
      return;
    }
    if (event.target.closest('[data-requests-close]')) { close(); opener?.focus(); return; }
    if (event.target.closest('a[data-request-empty-action]') && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { close(); return; }
    if (event.target.closest('[data-request-show-all]')) {
      const filter = panel().querySelector('[data-request-filter]');
      filter.value = 'all'; filter.focus(); page = 1; void loadRequests(); return;
    }
    const paging = event.target.closest('[data-request-page]');
    if (paging) { page += paging.dataset.requestPage === 'next' ? 1 : -1; void loadRequests(); return; }
    const draftDelete = event.target.closest('[data-draft-delete]');
    if (draftDelete) {
      const dialog = document.getElementById('draft-delete-dialog'), id = draftDelete.dataset.draftDelete;
      dialog.querySelector('[data-delete-plan-choice]').hidden = draftDelete.dataset.hasPlan !== 'true';
      dialog.querySelector('[name=deletePlan]').checked = false; dialog.returnValue = ''; dialog.showModal();
      dialog.addEventListener('close', async () => {
        if (dialog.returnValue !== 'confirm') return;
        clearTimeout(saveTimer); deletedDrafts.add(id);
        try { await saves.get(id)?.catch(() => {}); await api(`/api/drafts/${encodeURIComponent(id)}/delete`, { deletePlan: draftDelete.dataset.hasPlan === 'true' && dialog.querySelector('[name=deletePlan]').checked }); location.assign('/?view=studio&new=1'); }
        catch (error) { deletedDrafts.delete(id); const info = document.querySelector('[data-draft-save-state]') || document.getElementById('studio-action-feedback'); if (info) info.textContent = error.message; }
      }, { once: true });
      return;
    }
    const control = event.target.closest('[data-request-action]'); if (!control) return;
    const { requestAction: action, requestId: id } = control.dataset;
    if (action !== 'delete') { void perform(control, action, id); return; }
    const dialog = document.getElementById('request-delete-dialog'); dialog.querySelector('[name=reviewData]').checked = true; dialog.returnValue = ''; dialog.showModal();
    dialog.addEventListener('close', () => { if (dialog.returnValue === 'confirm') void perform(control, action, id, { reviewData: dialog.querySelector('[name=reviewData]').checked }); }, { once: true });
  });
  document.addEventListener('change', event => { if (event.target.matches('[data-request-filter]')) { page = 1; void loadRequests(); } });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && panel() && !panel().hidden && !document.querySelector('dialog[open]')) { close(); opener?.focus(); } });
  document.addEventListener('requests-updated', () => { void activity(); void loadRequests(); });
  document.addEventListener('agent-status', event => { agent = event.detail; });
  document.addEventListener('htmx:afterSwap', () => { void activity(); });
  void activity();
})();
