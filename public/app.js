(() => {
  const dropdownTriggers = panel => [...document.querySelectorAll('[aria-controls]')].filter(button => button.getAttribute('aria-controls') === panel.id);
  function closeDropdowns(target = null, restoreFocus = false) {
    for (const detail of document.querySelectorAll('details[data-dropdown][open]')) {
      if (target && detail.contains(target)) continue;
      detail.open = false;
      if (restoreFocus && detail.contains(document.activeElement)) detail.querySelector('summary')?.focus();
    }
    for (const panel of document.querySelectorAll('.session-panel:not([hidden]), #requests-panel:not([hidden]), [data-dropdown-panel][data-open="true"]')) {
      const triggers = dropdownTriggers(panel);
      if (target && (panel.contains(target) || triggers.some(button => button.contains(target)))) continue;
      if (restoreFocus && panel.contains(document.activeElement)) triggers[0]?.focus();
      if (panel.hasAttribute('popover')) panel.hidePopover(); else panel.hidden = true;
      for (const button of triggers) button.setAttribute('aria-expanded', 'false');
    }
  }
  document.addEventListener('pointerdown', event => closeDropdowns(event.target), true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeDropdowns(null, true); }, true);
  function positionDropdown(panel) {
    const trigger = dropdownTriggers(panel)[0];
    if (!trigger) return;
    const anchor = trigger.getBoundingClientRect(), width = Math.min(Number(panel.dataset.dropdownWidth) || 380, window.innerWidth - 24);
    const below = window.innerHeight - anchor.bottom - 20, above = anchor.top - 20;
    const opensBelow = below >= Math.min(220, Math.max(below, above));
    panel.style.left = `${Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12))}px`;
    panel.style.top = opensBelow ? `${anchor.bottom + 8}px` : 'auto';
    panel.style.bottom = opensBelow ? 'auto' : `${window.innerHeight - anchor.top + 8}px`;
    panel.style.maxHeight = `${Math.max(0, Math.min(420, opensBelow ? below : above))}px`;
  }
  document.addEventListener('beforetoggle', event => {
    if (!event.target.matches('[data-dropdown-panel]')) return;
    const open = event.newState === 'open';
    event.target.dataset.open = String(open);
    for (const trigger of dropdownTriggers(event.target)) trigger.setAttribute('aria-expanded', String(open));
    if (open) { closeDropdowns(event.target); positionDropdown(event.target); }
  }, true);
  document.addEventListener('click', event => {
    const panel = event.target.closest('[data-dropdown-choice]')?.closest('[data-dropdown-panel]');
    if (panel?.dataset.open === 'true') panel.hidePopover();
  }, true);
  window.addEventListener('resize', () => { for (const panel of document.querySelectorAll('[data-dropdown-panel][data-open="true"]')) positionDropdown(panel); });
  let analyticsDay;
  const viewedPreviews = new Set();
  function recordUsage() {
    if (document.visibilityState !== 'visible') return;
    const send = payload => {
      void fetch('/api/analytics', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) }).catch(() => {});
    };
    const day = new Date().toISOString().slice(0, 10);
    if (analyticsDay !== day) { analyticsDay = day; send({ event: 'project_used' }); }
    const diff = document.querySelector('[data-diff-preview]');
    if (!diff?.getClientRects().length) return;
    const preview = diff.dataset.diffPreview, key = `spequi-diff-viewed:${preview}`;
    if (viewedPreviews.has(preview)) return;
    viewedPreviews.add(preview);
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch {}
    send({ event: 'file_diff_viewed', preview_id: preview, changed_file_count: Number(diff.dataset.diffCount), layout: diff.dataset.diffLayout });
  }
  for (const event of ['htmx:afterSettle', 'visibilitychange', 'click', 'keydown']) document.addEventListener(event, () => globalThis.requestAnimationFrame?.(recordUsage));
  globalThis.requestAnimationFrame?.(recordUsage);
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
  function updateNotificationControls() {
    const supported = 'Notification' in window;
    const permission = supported ? Notification.permission : 'unavailable';
    for (const button of document.querySelectorAll('[data-enable-notifications]')) button.hidden = permission !== 'default';
    for (const toggle of document.querySelectorAll('[data-notification-toggle]')) {
      toggle.dataset.notificationState = permission;
      toggle.setAttribute('aria-label', permission === 'granted' ? 'Desktop notifications enabled' : 'Desktop notification settings');
      toggle.title = permission === 'granted' ? 'Desktop notifications enabled' : 'Get notified when work finishes or your agent needs an answer';
    }
    for (const status of document.querySelectorAll('[data-notification-message]')) {
      status.textContent = { granted: 'Desktop notifications are enabled for this browser.', denied: 'Notifications are blocked. Allow them in your browser’s site settings to enable desktop alerts.', unavailable: 'This browser does not support desktop notifications. In-app updates still work.', default: 'Desktop alerts are optional. In-app updates always stay available.' }[permission];
    }
  }
  document.addEventListener('click', async event => {
    const notificationButton = event.target.closest('[data-enable-notifications]');
    if (notificationButton) {
      notificationButton.disabled = true;
      try {
        const permission = await Notification.requestPermission();
        toast(permission === 'granted' ? 'Desktop notifications enabled for this browser.' : 'Desktop notifications are off. Completion messages will still appear here.');
      } catch { toast('Desktop notifications are unavailable. Completion messages will still appear here.'); }
      finally { notificationButton.disabled = false; updateNotificationControls(); }
    }
    const toggle = event.target.closest('[data-spec-context-toggle]');
    if (toggle) {
      const quotes = [...toggle.closest('.file-diff').querySelectorAll('.spec-context-quote')];
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      for (const quote of quotes) { quote.open = open; specDisclosures.set(quote.id, open); }
      toggle.setAttribute('aria-expanded', String(open)); toggle.textContent = open ? 'Collapse quotes' : 'Expand quotes';
    }
  });
  function syncSpecToggle() {
    for (const toggle of document.querySelectorAll('[data-spec-context-toggle]')) {
      const open = [...toggle.closest('.file-diff').querySelectorAll('.spec-context-quote')].some(quote => quote.open);
      toggle.setAttribute('aria-expanded', String(open)); toggle.textContent = open ? 'Collapse quotes' : 'Expand quotes';
    }
  }
  document.addEventListener('toggle', event => {
    if (!event.target.matches?.('.spec-context-quote')) return;
    specDisclosures.set(event.target.id, event.target.open); syncSpecToggle();
  }, true);
  document.addEventListener('htmx:afterSwap', updateNotificationControls);
  window.addEventListener('focus', updateNotificationControls);
  document.addEventListener('beforetoggle', event => { if (event.target.id === 'notification-settings' && event.newState === 'open') updateNotificationControls(); }, true);
  updateNotificationControls();
  let pendingRefresh = false, refreshing = false, followUpRefresh = false, navigationRequests = 0, navigationGeneration = 0, backgroundXHR = null;
  const drafts = {};
  const specDisclosures = new Map();
  const sourceDrafts = new Map(), sourcePending = new Set(), sourceMessages = new Map();
  const initialDetailsToggle = document.getElementById('toggle-review-details');
  let reviewDetailsOpen = initialDetailsToggle ? initialDetailsToggle.getAttribute('aria-expanded') === 'true' : undefined, preserveReader = null;
  function toast(message, downloadUrl = '', href = '') {
    const node = document.getElementById('toast'); if (!node) return;
    node.textContent = message;
    if (/^\/api\/reviews\/[a-zA-Z0-9_-]+\/feedback\/[a-zA-Z0-9_-]+$/.test(downloadUrl)) {
      const link = document.createElement('a'); link.href = downloadUrl; link.download = 'openspec-review-feedback.md'; link.textContent = 'Download Markdown'; node.append(link);
    }
    if (typeof href === 'string' && href.startsWith('/?')) { const link = document.createElement('a'); link.href = href; link.textContent = 'Open result'; node.append(link); }
    node.classList.add('visible'); clearTimeout(node.hideTimer);
    const dismiss = () => { node.hideTimer = setTimeout(() => node.classList.remove('visible'), downloadUrl || href ? 9000 : 4500); };
    node.onpointerenter = node.onfocusin = () => clearTimeout(node.hideTimer);
    node.onpointerleave = node.onfocusout = dismiss; dismiss();
  }
  document.addEventListener('spequi-toast', event => {
    const { message, downloadUrl = '', href = '', persist = false } = event.detail || {};
    if (typeof message !== 'string' || !message) return;
    if (persist) try { sessionStorage.setItem('spequi-toast', JSON.stringify({ message, at: Date.now() })); } catch {}
    toast(message, downloadUrl, href);
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
    syncSpecToggle();
  }
  function readingViewport() { return document.querySelector('.diff-code-scroll') || document.querySelector('.reader'); }
  let filesLoading = null;
  function restoreFilesLoading(error = false) {
    const saved = filesLoading; filesLoading = null;
    if (!saved) return;
    clearTimeout(saved.timer);
    saved.link.removeAttribute('aria-busy');
    if (saved.label?.isConnected) saved.label.textContent = saved.text;
    if (error) toast('Could not load file changes. Try the Files tab again.');
  }
  function showFilesLoading(link, xhr) {
    restoreFilesLoading();
    const label = link.querySelector('span'), saved = { link, xhr, label, text: label?.textContent };
    filesLoading = saved;
    saved.timer = setTimeout(() => {
      if (filesLoading !== saved || !link.isConnected) return;
      link.setAttribute('aria-busy', 'true');
      if (label) label.textContent = 'Opening…';
    }, 400);
  }
  let applyingRequest = null;
  let refreshTimer;
  function refresh() {
    clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshWorkspace, 150);
  }
  function refreshWorkspace() {
    if (sourcePending.size || navigationRequests || applyingRequest) { pendingRefresh = true; return; }
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
    const applyForm = event.detail?.elt?.closest?.('[data-apply-form]');
    if (applyForm) {
      if (applyingRequest) { event.preventDefault(); return; }
      const button = applyForm.querySelector('button'), feedback = document.getElementById('apply-feedback');
      applyingRequest = { xhr, form: applyForm, button, html: button.innerHTML, disabled: button.disabled, feedback };
      navigationGeneration++; backgroundXHR?.abort(); backgroundXHR = null;
      applyForm.setAttribute('aria-busy', 'true'); button.disabled = true;
      button.innerHTML = '<span class="apply-spinner" aria-hidden="true"></span>Applying changes…';
      if (feedback) feedback.innerHTML = '<div class="applying-notice" role="status"><span class="apply-spinner" aria-hidden="true"></span><div><strong>Applying reviewed changes</strong><p>Saving the approved files to your project. This review will update when the operation finishes.</p></div></div>';
    }
    if (event.detail?.requestConfig?.headers?.['X-Spequi-Refresh'] === '1' && xhr) {
      xhr.spequiGeneration = navigationGeneration; backgroundXHR = xhr;
    } else if (event.detail?.target?.id === 'workspace' && event.detail?.elt?.matches('a,form,input')) {
      navigationGeneration++; navigationRequests++;
      if (xhr) { xhr.spequiNavigation = true; xhr.spequiGeneration = navigationGeneration; }
      backgroundXHR?.abort(); backgroundXHR = null;
    }
    remember();
    const filesTab = event.detail?.elt?.closest?.('a[data-files-tab]');
    if (filesTab) showFilesLoading(filesTab, xhr);
    else if (xhr?.spequiNavigation) restoreFilesLoading();
    if (event.detail.elt?.closest('[data-preserve-reader]')) { const reader = readingViewport(); preserveReader = reader ? { top: reader.scrollTop, left: reader.scrollLeft } : null; }
  });
  document.addEventListener('htmx:afterRequest', event => {
    if (applyingRequest?.xhr === event.detail?.xhr) {
      const { form, button, html, disabled, feedback } = applyingRequest;
      applyingRequest = null; form.removeAttribute('aria-busy');
      const success = event.detail.xhr.status >= 200 && event.detail.xhr.status < 300 && !event.detail.failed;
      button.innerHTML = success ? 'Changes applied' : html; button.disabled = success || disabled;
      if (success) { pendingRefresh = true; setTimeout(refresh, 100); }
      else {
        pendingRefresh = false;
        if (feedback?.querySelector('.applying-notice')) {
          feedback.replaceChildren();
          const error = document.createElement('p'); error.className = 'error-message'; error.setAttribute('role', 'alert');
          error.textContent = 'Could not confirm whether the files were applied. Refresh this review before trying again.';
          feedback.append(error);
        }
      }
    }
    if (filesLoading?.xhr === event.detail?.xhr) {
      if (event.detail.failed || event.detail.xhr.status === 0 || event.detail.xhr.status >= 400) restoreFilesLoading(true);
      else restoreFilesLoading();
    }
    if (!event.detail?.xhr?.spequiNavigation) return;
    navigationRequests = Math.max(0, navigationRequests - 1);
    if (!navigationRequests && pendingRefresh) setTimeout(refresh, 100);
  });
  document.addEventListener('htmx:beforeSwap', event => {
    const generation = event.detail?.xhr?.spequiGeneration;
    if (generation !== undefined && generation !== navigationGeneration) event.detail.shouldSwap = false;
    if (filesLoading?.xhr === event.detail.xhr && event.detail.xhr.status >= 400) event.detail.shouldSwap = false;
  });
  document.addEventListener('htmx:afterSwap', () => {
    restore(); initializeDiff();
    if (preserveReader) { const reader = readingViewport(); if (reader) { reader.scrollTop = preserveReader.top; reader.scrollLeft = preserveReader.left; } preserveReader = null; }
  });
  // HTMX restores incoming class attributes during settling, after afterSwap.
  document.addEventListener('htmx:afterSettle', initializeDiff);
  document.addEventListener('htmx:beforeSwap', event => { if (event.detail.xhr.status >= 400 && event.detail.xhr.status < 500 && event.detail.xhr.spequiGeneration === undefined) { event.detail.shouldSwap = true; event.detail.isError = false; } });
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
    if (form && applyingRequest) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (!form || form.dataset.confirmed) { if (form) delete form.dataset.confirmed; return; }
    event.preventDefault(); event.stopImmediatePropagation();
    const dialog = document.getElementById('apply-dialog');
    dialog.returnValue = ''; dialog.showModal();
    const action = form.getAttribute('hx-post');
    dialog.addEventListener('close', () => {
      if (dialog.returnValue !== 'confirm') return;
      const current = [...document.querySelectorAll('[data-apply-form]')].find(item => item.getAttribute('hx-post') === action);
      if (current && !current.querySelector('button').disabled) { current.dataset.confirmed = 'true'; current.requestSubmit(); }
    }, { once: true });
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
    socket.addEventListener('open', () => {
      retry = 1000;
      if (hasConnected) { pendingRefresh = true; refresh(); }
      hasConnected = true;
    });
    socket.addEventListener('message', event => { try { const message = JSON.parse(event.data); if (message.type === 'changed' && (!message.change || message.change === document.getElementById('workspace')?.dataset.change)) refresh(); if (message.type === 'requests') document.dispatchEvent(new window.CustomEvent('requests-updated')); if (message.type === 'readiness' && message.change === document.getElementById('workspace')?.dataset.change) refresh(); if (['agent', 'heartbeat', 'connected'].includes(message.type)) updateAgent(); } catch {} });
    socket.addEventListener('close', () => { setTimeout(connect, retry); retry = Math.min(retry * 2, 15000); });
    socket.addEventListener('error', () => socket.close());
  }
  function loadHTMX() {
    const script = document.createElement('script');
    script.src = '/vendor/htmx.js';
    script.addEventListener('load', () => { window.htmx.config.defaultSettleDelay = 0; window.htmx.config.attributesToSettle = []; if (pendingRefresh) refresh(); });
    script.addEventListener('error', () => toast('HTMX could not load. Reload the viewer to retry.'));
    document.head.append(script);
  }
  initializeDiff();
  // Dynamically loading HTMX between DOMContentLoaded and load can miss its ready callback.
  if (document.readyState === 'complete') loadHTMX();
  else window.addEventListener('load', loadHTMX, { once: true });
  connect();
})();

(() => {
  const panel = document.getElementById('privacy-settings');
  if (!panel) return;
  const form = panel.querySelector('[data-consent-form]');
  const marker = () => {
    const update = panel.dataset.updateAvailable === 'true', pending = panel.dataset.consentPending === 'true';
    const toggle = document.querySelector('[data-privacy-toggle]'), dot = document.querySelector('[data-privacy-dot]');
    if (dot) dot.hidden = !update && !pending;
    const label = update ? 'Usage sharing — Spequi update available' : pending ? 'Usage sharing — choose a preference for this project' : 'Usage sharing for this project';
    toggle?.setAttribute('aria-label', label); toggle?.setAttribute('title', label);
  };
  marker();
  if (panel.dataset.consentPending === 'true') panel.showPopover?.();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (form.hasAttribute('aria-busy')) return;
    const feedback = form.querySelector('[data-consent-feedback]'), button = form.querySelector('[type=submit]');
    form.setAttribute('aria-busy', 'true'); button.disabled = true; feedback.textContent = '';
    try {
      const response = await fetch('/api/privacy', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name=csrf-token]').content }, body: JSON.stringify({ choice: new FormData(form).get('choice') }) });
      if (!response.ok) throw new Error('Could not save your preference. Reload the viewer and retry.');
      const saved = await response.json();
      panel.dataset.consentPending = 'false'; marker();
      feedback.textContent = saved.choice === 'off' ? 'Saved. No usage events will be sent.' : 'Saved for this project.';
      document.dispatchEvent(new CustomEvent('spequi-toast', { detail: { message: feedback.textContent } }));
      panel.hidePopover?.();
    } catch (error) { feedback.textContent = error.message; }
    finally { form.removeAttribute('aria-busy'); button.disabled = false; }
  });
  void fetch('/api/update-status').then(response => response.ok ? response.json() : null).then(info => {
    if (!info?.available) return;
    panel.dataset.updateAvailable = 'true';
    const note = panel.querySelector('[data-update-note]');
    if (note) { note.hidden = false; note.textContent = `Update available: ${info.latest} (running ${info.current}). ${info.development ? 'Update your local checkout; published updates do not replace local source.' : 'Run /spequi update in your coding agent when idle.'}`; }
    marker();
  }).catch(() => {});
})();
