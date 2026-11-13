(() => {
  const themeToggle = document.getElementById('theme-toggle');
  function applyTheme(theme) {
    const dark = theme === 'dark' || theme === 'developer';
    document.documentElement.dataset.theme = dark ? 'dark' : 'enterprise';
    const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
    themeToggle?.setAttribute('aria-label', label);
    themeToggle?.setAttribute('title', label);
  }
  try { applyTheme(localStorage.getItem('spequi-theme')); } catch { applyTheme('enterprise'); }
  themeToggle?.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'enterprise' : 'dark');
    try { localStorage.setItem('spequi-theme', document.documentElement.dataset.theme); } catch {}
  });
  let pendingRefresh = false, refreshing = false, followUpRefresh = false, navigationRequests = 0, navigationGeneration = 0, backgroundXHR = null;
  const drafts = {};
  const specDisclosures = new Map();
  const sourceDrafts = new Map(), sourcePending = new Set(), sourceMessages = new Map();
  const initialDetailsToggle = document.getElementById('toggle-review-details');
  let reviewDetailsOpen = initialDetailsToggle ? initialDetailsToggle.getAttribute('aria-expanded') === 'true' : undefined, preserveReader = null;
  function toast(message, downloadUrl = '') {
    const node = document.getElementById('toast'); if (!node) return;
    node.textContent = message;
    if (/^\/api\/reviews\/[a-zA-Z0-9_-]+\/feedback\/[a-zA-Z0-9_-]+$/.test(downloadUrl)) {
      const link = document.createElement('a'); link.href = downloadUrl; link.download = 'openspec-review-feedback.md'; link.textContent = 'Download Markdown'; node.append(link);
    }
    node.classList.add('visible'); clearTimeout(node.hideTimer);
    const dismiss = () => { node.hideTimer = setTimeout(() => node.classList.remove('visible'), downloadUrl ? 9000 : 4500); };
    node.onpointerenter = node.onfocusin = () => clearTimeout(node.hideTimer);
    node.onpointerleave = node.onfocusout = dismiss; dismiss();
  }
  document.addEventListener('spequi-toast', event => {
    const { message, downloadUrl = '', persist = false } = event.detail || {};
    if (typeof message !== 'string' || !message) return;
    if (persist) try { sessionStorage.setItem('spequi-toast', JSON.stringify({ message, at: Date.now() })); } catch {}
    toast(message, downloadUrl);
  });
  try {
    const saved = JSON.parse(sessionStorage.getItem('spequi-toast')); sessionStorage.removeItem('spequi-toast');
    if (saved && typeof saved.message === 'string' && Date.now() - saved.at < 10000) toast(saved.message);
  } catch {}
  function remember() {
    for (const node of document.querySelectorAll('.spec-context-quote[id]')) specDisclosures.set(node.id, node.open);
    for (const name of ['instructions', 'workflow-action', 'file-filter']) { const input = document.getElementById(name); if (input) drafts[name] = input.value; }
    const scope = document.getElementById('workspace')?.dataset.change;
    const tools = document.querySelector('.source-preview-body');
    if (tools && scope) sourceDrafts.set(scope, { patch: document.getElementById('source-preview-patch')?.value || '', analysisId: tools.dataset.analysisId, files: [...tools.querySelectorAll('input[name="files"]:checked')].map(input => input.value) });
  }
  function restore() {
    for (const node of document.querySelectorAll('.spec-context-quote[id]')) if (specDisclosures.has(node.id)) node.open = specDisclosures.get(node.id);
    for (const [name, value] of Object.entries(drafts)) { const input = document.getElementById(name); if (input) input.value = value; }
    const scope = document.getElementById('workspace')?.dataset.change, saved = sourceDrafts.get(scope);
    const tools = document.querySelector('.source-preview-body');
    if (saved && tools) {
      const patch = document.getElementById('source-preview-patch'); if (patch) patch.value = saved.patch;
      if (saved.analysisId === tools.dataset.analysisId) for (const input of tools.querySelectorAll('input[name="files"]')) input.checked = saved.files.includes(input.value);
    }
    if (sourcePending.has(scope)) for (const button of document.querySelectorAll('[data-source-action] button')) button.disabled = true;
    const message = sourceMessages.get(scope), feedback = document.getElementById('source-preview-feedback');
    if (message && feedback) { feedback.textContent = message.text; feedback.className = message.error ? 'error-message' : 'success-message'; }
  }
  function readingViewport() { return document.querySelector('.diff-code-scroll') || document.querySelector('.reader'); }
  function refresh() {
    if (sourcePending.size || navigationRequests) { pendingRefresh = true; return; }
    if (refreshing) { pendingRefresh = true; followUpRefresh = true; return; }
    if (!window.htmx) { pendingRefresh = true; return; }
    if (document.activeElement?.matches('input,textarea,select') || document.getElementById('apply-dialog')?.open || document.querySelector('dialog[open]')) { pendingRefresh = true; return; }
    refreshing = true; pendingRefresh = false; remember();
    const reader = readingViewport(), top = reader?.scrollTop || 0, left = reader?.scrollLeft || 0;
    const disclosures = [...document.querySelectorAll('#workspace details[id]')].filter(node => node.id !== 'review-comment-composer').map(node => ({ id: node.id, open: node.hasAttribute('open') }));
    const focused = document.activeElement;
    const focusID = focused?.id;
    const focusHref = focused?.closest('a')?.getAttribute('href');
    const focusDetails = focused?.matches('summary') ? focused.closest('details')?.id : null;
    const menuOpen = document.getElementById('workspace').classList.contains('navigation-open');
    const refreshURL = document.getElementById('workspace').dataset.refreshUrl || location.pathname + location.search;
    const generation = navigationGeneration;
    window.htmx.ajax('GET', refreshURL, { target: '#workspace', swap: 'outerHTML', headers: { 'X-Spequi-Refresh': '1' } }).then(() => {
      if (generation !== navigationGeneration) return;
      restore(); const updated = readingViewport(); if (updated) { updated.scrollTop = top; updated.scrollLeft = left; }
      for (const state of disclosures) { const node = document.getElementById(state.id); if (node) node.toggleAttribute('open', state.open); }
      if (menuOpen) { document.getElementById('workspace').classList.add('navigation-open'); document.querySelector('.mobile-menu')?.setAttribute('aria-expanded', 'true'); }
      const target = focusID ? document.getElementById(focusID) : focusHref ? [...document.querySelectorAll('#workspace a')].find(node => node.getAttribute('href') === focusHref) : focusDetails ? document.getElementById(focusDetails)?.querySelector('summary') : null;
      if (target && !target.disabled) target.focus({ preventScroll: true });
      else if (focused?.closest('#workspace')) document.getElementById('document')?.focus({ preventScroll: true });
    }).catch(() => { if (generation === navigationGeneration) pendingRefresh = true; }).finally(() => {
      refreshing = false;
      if (followUpRefresh) { followUpRefresh = false; setTimeout(refresh, 100); }
    });
  }
  document.addEventListener('htmx:configRequest', event => { event.detail.headers['X-CSRF-Token'] = document.querySelector('meta[name="csrf-token"]').content; });
  document.addEventListener('htmx:beforeRequest', event => {
    const xhr = event.detail?.xhr;
    if (event.detail?.requestConfig?.headers?.['X-Spequi-Refresh'] === '1' && xhr) {
      xhr.spequiGeneration = navigationGeneration; backgroundXHR = xhr;
    } else if (event.detail?.target?.id === 'workspace' && event.detail?.elt?.matches('a,form,input')) {
      navigationGeneration++; navigationRequests++;
      if (xhr) xhr.spequiNavigation = true;
      backgroundXHR?.abort(); backgroundXHR = null;
    }
    remember();
    if (event.detail.elt?.closest('[data-preserve-reader]')) { const reader = readingViewport(); preserveReader = reader ? { top: reader.scrollTop, left: reader.scrollLeft } : null; }
  });
  document.addEventListener('htmx:afterRequest', event => {
    if (!event.detail?.xhr?.spequiNavigation) return;
    navigationRequests = Math.max(0, navigationRequests - 1);
    if (!navigationRequests && pendingRefresh) setTimeout(refresh, 100);
  });
  document.addEventListener('htmx:beforeSwap', event => {
    const generation = event.detail?.xhr?.spequiGeneration;
    if (generation !== undefined && generation !== navigationGeneration) event.detail.shouldSwap = false;
  });
  document.addEventListener('htmx:afterSwap', () => {
    restore(); initializeDiff();
    if (preserveReader) { const reader = readingViewport(); if (reader) { reader.scrollTop = preserveReader.top; reader.scrollLeft = preserveReader.left; } preserveReader = null; }
  });
  // HTMX restores incoming class attributes during settling, after afterSwap.
  document.addEventListener('htmx:afterSettle', initializeDiff);
  document.addEventListener('htmx:beforeSwap', event => { if (event.detail.xhr.status >= 400 && event.detail.xhr.status < 500) { event.detail.shouldSwap = true; event.detail.isError = false; } });
  document.addEventListener('htmx:sendError', () => toast('Could not reach the viewer. Check that the local server is running.'));
  document.addEventListener('workspace-updated', () => { pendingRefresh = true; refresh(); });
  document.addEventListener('focusout', () => { if (pendingRefresh) setTimeout(refresh, 100); });
  let navigationOpener;
  function setNavigation(open, opener) {
    if (open) navigationOpener = opener || document.querySelector('.mobile-menu');
    document.getElementById('workspace')?.classList.toggle('navigation-open', open);
    document.querySelector('.mobile-menu')?.setAttribute('aria-expanded', String(open));
    if (!open) (navigationOpener?.isConnected ? navigationOpener : document.querySelector('.mobile-menu'))?.focus({ preventScroll: true });
  }
  function filterFiles() {
    const query = (document.getElementById('file-filter')?.value || '').toLowerCase();
    const links = [...document.querySelectorAll('[data-file-path]')];
    for (const link of links) link.hidden = !link.dataset.filePath.toLowerCase().includes(query);
    const empty = document.getElementById('file-filter-empty');
    if (empty) empty.hidden = !links.length || links.some(link => !link.hidden);
  }
  function initializeDiff() {
    const workspace = document.getElementById('workspace');
    const toggle = document.getElementById('toggle-review-details'), panel = document.getElementById('review-details');
    if (toggle && panel) {
      reviewDetailsOpen ??= toggle.getAttribute('aria-expanded') === 'true';
      workspace?.classList.toggle('review-details-open', reviewDetailsOpen);
      toggle.setAttribute('aria-expanded', String(reviewDetailsOpen));
      if (toggle.classList.contains('details-icon-toggle')) {
        const label = `${reviewDetailsOpen ? 'Hide' : 'Show'} review details`;
        toggle.setAttribute('aria-label', label);
        toggle.setAttribute('title', label);
      }
      panel.hidden = !reviewDetailsOpen;
    } else workspace?.classList.remove('review-details-open');
    filterFiles();
  }
  document.addEventListener('input', event => { if (event.target.id === 'file-filter') { drafts['file-filter'] = event.target.value; filterFiles(); } });
  document.addEventListener('click', event => {
    const filesButton = event.target.closest('[data-studio-files]');
    if (filesButton) {
      if (window.matchMedia?.('(max-width:760px)').matches) setNavigation(true, filesButton);
      document.querySelector('[data-preview-navigation]')?.scrollIntoView?.({ block: 'nearest' });
      const files = document.querySelector('.studio-changed-files');
      (document.getElementById('file-filter') || files?.querySelector('[aria-current=page]') || files?.querySelector('[data-file-path]') || files)?.focus();
      return;
    }
    if (event.target.closest('#navigation [data-file-path]') && document.getElementById('workspace')?.classList.contains('navigation-open')) { setNavigation(false); return; }
    if (event.target.closest('[data-review-details]')) { reviewDetailsOpen = !reviewDetailsOpen; initializeDiff(); return; }
    const jump = event.target.closest('[data-diff-jump]');
    if (jump) {
      const panel = document.querySelector('.diff-panel');
      const hunks = [...(panel?.querySelectorAll('[data-diff-hunk]') || [])];
      if (hunks.length) {
        const previous = Number(panel.dataset.hunkIndex ?? -1);
        const index = jump.dataset.diffJump === 'next' ? (previous + 1) % hunks.length : previous < 0 ? hunks.length - 1 : (previous - 1 + hunks.length) % hunks.length;
        panel.dataset.hunkIndex = index;
        hunks[index].scrollIntoView({ block: 'center', behavior: 'instant' });
        const position = panel.querySelector('.hunk-position'); if (position) position.textContent = `Change ${index + 1} of ${hunks.length}`;
      }
      return;
    }
    const menu = event.target.closest('.mobile-menu');
    if (menu) { setNavigation(!document.getElementById('workspace').classList.contains('navigation-open'), menu); return; }
    if (event.target.closest('.navigation-close')) { setNavigation(false); return; }
    if (document.getElementById('workspace')?.classList.contains('navigation-open') && !event.target.closest('#navigation')) setNavigation(false);
  });
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setNavigation(true); document.getElementById('search')?.focus(); }
    if (event.key === 'Escape' && document.getElementById('workspace')?.classList.contains('navigation-open')) setNavigation(false);
  });
  document.addEventListener('input', event => { if (event.target.closest('.source-preview-tools')) remember(); });
  document.addEventListener('change', event => { if (event.target.closest('.source-preview-tools')) remember(); });
  document.addEventListener('submit', async event => {
    const form = event.target.closest('[data-source-action]');
    if (!form) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const change = form.querySelector('[name="change"]').value;
    if (sourcePending.has(change)) return;
    const kind = form.dataset.sourceAction, feedback = document.getElementById('source-preview-feedback');
    const files = [...document.querySelectorAll('.source-preview-tools input[name="files"]:checked')].map(input => input.value);
    if (kind === 'model' && (!files.length || files.length > 12)) { feedback.textContent = 'Select between 1 and 12 source files for model context.'; feedback.className = 'error-message'; return; }
    remember(); sourcePending.add(change);
    const buttons = [...document.querySelectorAll('[data-source-action] button')].map(button => ({ button, disabled: button.disabled }));
    for (const { button } of buttons) button.disabled = true;
    form.setAttribute('aria-busy', 'true');
    feedback.className = ''; feedback.textContent = kind === 'analyze' ? 'Analyzing project files locally…' : 'Preparing proposed edits in a temporary copy…';
    let navigate = '';
    try {
      const payload = { change, ...(kind === 'patch' ? { patch: form.querySelector('[name="patch"]').value } : {}), ...(kind === 'model' ? { analysisId: form.querySelector('[name="analysisId"]').value, files } : {}) };
      const response = await fetch(form.getAttribute('action'), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The request failed. Retry with the local viewer running.');
      if (result.url) { navigate = result.url; if (kind === 'patch') sourceDrafts.delete(change); }
      else { feedback.className = 'success-message'; feedback.textContent = 'Affected-file analysis saved.'; sourceMessages.set(change, { text: feedback.textContent }); pendingRefresh = true; }
    } catch (error) { feedback.className = 'error-message'; feedback.textContent = error.message || 'Could not reach the viewer. Retry when it is running.'; sourceMessages.set(change, { text: feedback.textContent, error: true }); }
    finally {
      sourcePending.delete(change); form.removeAttribute('aria-busy');
      for (const { button, disabled } of buttons) button.disabled = disabled;
      if (navigate && form.isConnected) location.assign(navigate);
      else if (navigate) toast('The proposed file preview is ready on Files.');
      else if (pendingRefresh) { if (window.htmx) refresh(); else location.reload(); }
    }
  }, true);
  document.addEventListener('submit', event => {
    const form = event.target.closest('[data-apply-form]');
    if (!form || form.dataset.confirmed) { if (form) delete form.dataset.confirmed; return; }
    event.preventDefault(); event.stopImmediatePropagation();
    const dialog = document.getElementById('apply-dialog');
    dialog.returnValue = ''; dialog.showModal();
    dialog.addEventListener('close', () => { if (dialog.returnValue === 'confirm') { form.dataset.confirmed = 'true'; form.requestSubmit(); } }, { once: true });
  }, true);
  let retry = 1000, hasConnected = false;
  let agentRequest;
  async function updateAgent() {
    if (agentRequest) return agentRequest;
    agentRequest = (async () => {
    try {
      const response = await fetch('/api/agent-status', { signal: globalThis.AbortSignal?.timeout?.(10000) });
      if (!response.ok) return null;
      const agent = await response.json(); document.dispatchEvent(new window.CustomEvent('agent-status', {detail:agent})); const node = document.querySelector('.agent-state');
      if (node) { node.classList.toggle('online', agent.connected); node.querySelector('span').textContent = agent.connected ? agent.agent || 'Agent attached' : 'Waiting for your agent'; }

      for (const form of document.querySelectorAll('[data-studio-stalled-action]')) form.hidden = agent.queue?.active?.id === form.dataset.requestOwner ? Boolean(agent.queue.active.ownerConnected) : Boolean(agent.connected);
      for (const caption of document.querySelectorAll('[data-lifecycle-agent-caption]')) caption.textContent = agent.connected ? 'Same agent session' : 'Requests wait until your agent is attached';
      return agent;
    } catch { return null; }
    })();
    try { return await agentRequest; } finally { agentRequest = null; }
  }
  window.spequiRefreshAgent = updateAgent;
  function connect() {
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/live`);
    const status = document.getElementById('connection');
    socket.addEventListener('open', () => {
      retry = 1000; status.textContent = 'Local workspace'; status.classList.add('online');
      if (hasConnected) { pendingRefresh = true; refresh(); }
      hasConnected = true;
    });
    socket.addEventListener('message', event => { try { const message = JSON.parse(event.data); if (message.type === 'changed' && (!message.change || message.change === document.getElementById('workspace')?.dataset.change)) refresh(); if (message.type === 'requests') document.dispatchEvent(new window.CustomEvent('requests-updated')); if (message.type === 'readiness' && message.change === document.getElementById('workspace')?.dataset.change) refresh(); if (['agent', 'heartbeat', 'connected'].includes(message.type)) updateAgent(); } catch {} });
    socket.addEventListener('close', () => { status.textContent = 'Reconnecting to server'; status.classList.remove('online'); setTimeout(connect, retry); retry = Math.min(retry * 2, 15000); });
    socket.addEventListener('error', () => socket.close());
  }
  function loadHTMX() {
    const script = document.createElement('script');
    script.src = '/vendor/htmx.js';
    script.addEventListener('load', () => { if (pendingRefresh) refresh(); });
    script.addEventListener('error', () => toast('HTMX could not load. Reload the viewer to retry.'));
    document.head.append(script);
  }
  initializeDiff();
  // Dynamically loading HTMX between DOMContentLoaded and load can miss its ready callback.
  if (document.readyState === 'complete') loadHTMX();
  else window.addEventListener('load', loadHTMX, { once: true });
  connect();
})();
