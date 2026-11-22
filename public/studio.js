(() => {
  const locations = new Map(), positions = new Map();
  let pendingFileNavigation = null;
  const workspace = () => document.getElementById('workspace');
  const canonical = () => workspace()?.dataset.refreshUrl || location.pathname + location.search;
  const scope = () => workspace()?.dataset.change || 'project';
  const mode = () => workspace()?.dataset.workspaceMode || 'review';
  const state = () => { if (!locations.has(scope())) locations.set(scope(), { stages: {} }); return locations.get(scope()); };
  function setURL(link, value) { link.setAttribute('href', value); link.setAttribute('hx-get', value); }
  function withSearch(value) {
    const url = new URL(value, location.href), query = document.getElementById('search')?.value || '';
    if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
    return url.pathname + url.search;
  }
  function synchronizeSearch() {
    const form = document.querySelector('#navigation .search'); if (!form || !workspace()) return;
    const url = new URL(canonical(), location.href);
    for (const name of ['change', 'view', 'doc', 'stage', 'plan', 'compare', 'pane', 'job', 'file', 'mode', 'wrap', 'new', 'creation', 'created', 'draft']) {
      const value = name === 'change' ? workspace().dataset.change : name === 'view' ? workspace().dataset.view : url.searchParams.get(name);
      let input = form.querySelector(`input[type=hidden][name="${name}"]`);
      if (!value) { input?.remove(); continue; }
      if (!input) { input = document.createElement('input'); input.type = 'hidden'; input.name = name; form.append(input); }
      input.value = value;
    }
  }
  function remember() {
    if (!workspace()) return;
    const saved = state(), url = canonical();
    saved[mode()] = url;
    const studio = document.getElementById('studio');
    if (studio) saved.stages[studio.dataset.stage] = url;
    const canvas = document.getElementById('studio-canvas-body'), thread = document.getElementById('studio-thread'), sidebar = document.getElementById('navigation'), code = document.querySelector('.studio-diff-panel .diff-code-scroll'), files = document.querySelector('#navigation .changed-files-nav');
    saved.sidebar = sidebar?.scrollTop || 0;
    if (files) saved.files = { preview: files.dataset.previewJob, scroll: files.scrollTop || 0 };
    positions.set(url, { canvas: canvas?.scrollTop || 0, code: code?.scrollTop || 0, codeLeft: code?.scrollLeft || 0, thread: thread?.scrollTop || 0, question: studio?.querySelector('[data-studio-question]')?.dataset.studioQuestion, bottom: thread ? thread.scrollHeight - thread.clientHeight - thread.scrollTop < 48 : true, sidebar: sidebar?.scrollTop || 0 });
  }
  function revealQuestion(studio, focus = false) {
    const question = studio?.querySelector('[data-studio-question]'), thread = document.getElementById('studio-thread');
    if (!question || !thread) return;
    const questionBox = question.getBoundingClientRect?.(), threadBox = thread.getBoundingClientRect?.();
    if (threadBox?.height === 0) return;
    if (questionBox && threadBox) thread.scrollTop += questionBox.top - threadBox.top - 18;
    if (focus) question.focus({ preventScroll: true });
  }
  function synchronizeExpansion() {
    const studio = document.getElementById('studio'); if (!studio) return;
    const expanded = Boolean(state().conversationExpanded);
    studio.dataset.conversationExpanded = String(expanded);
    const button = studio.querySelector('[data-studio-expand]');
    button?.setAttribute('aria-expanded', String(expanded));
    if (button) (button.querySelector('[data-studio-expand-label]') || button).textContent = expanded ? 'Show document' : 'Expand conversation';
  }
  function initialize() {
    if (!workspace()) return;
    if (workspace().dataset.creationComplete === 'true' || workspace().dataset.artifactFollowComplete === 'true') window.history?.replaceState(null, '', canonical());
    const saved = state(), currentMode = mode();
    saved[currentMode] = canonical();
    const studio = document.getElementById('studio');
    if (studio) saved.stages[studio.dataset.stage] = canonical();
    for (const node of document.querySelectorAll('.workspace-modes [data-workspace-mode]')) {
      const target = node.dataset.workspaceMode, active = target === currentMode;
      node.classList.toggle('selected', active);
      node.setAttribute('aria-current', active ? 'page' : 'false');
      setURL(node, withSearch(saved[target] || `/?${new URLSearchParams({ ...(workspace().dataset.change ? { change: workspace().dataset.change } : {}), view: target === 'build' ? 'studio' : 'rendered' })}`));
    }
    for (const node of document.querySelectorAll('[data-studio-stage]')) {
      const previous = saved.stages[node.dataset.studioStage];
      if (previous) setURL(node, withSearch(previous));
    }
    const place = positions.get(canonical());
    const sidebar = document.getElementById('navigation'), canvas = document.getElementById('studio-canvas-body'), thread = document.getElementById('studio-thread');
    if (sidebar) sidebar.scrollTop = place?.sidebar ?? saved.sidebar ?? 0;
    if (place && canvas) canvas.scrollTop = place.canvas;
    const code = document.querySelector('.studio-diff-panel .diff-code-scroll'), files = document.querySelector('#navigation .changed-files-nav');
    if (place && code) { code.scrollTop = place.code || 0; code.scrollLeft = place.codeLeft || 0; }
    if (files && saved.files?.preview === files.dataset.previewJob) files.scrollTop = saved.files.scroll;
    const question = studio?.querySelector('[data-studio-question]');
    if (thread) thread.scrollTop = question ? place?.thread || 0 : !place || place.bottom ? thread.scrollHeight : place.thread;
    synchronizeExpansion();
    synchronizePane();
    if (question && (!place || place.question !== question.dataset.studioQuestion)) revealQuestion(studio);
    if (pendingFileNavigation) {
      const requested = pendingFileNavigation;
      if (requested.change === workspace().dataset.change && studio?.dataset.stage === 'implement' && studio.querySelector('[data-diff-file]')?.dataset.diffFile === requested.file && files?.dataset.previewJob === requested.preview) {
        pendingFileNavigation = null;
        const heading = studio.querySelector('[data-file-heading]');
        heading?.focus({ preventScroll: true });
        const current = files?.querySelector('[aria-current=page]');
        const rowBox = current?.getBoundingClientRect?.(), listBox = files?.getBoundingClientRect?.();
        if (rowBox && listBox) {
          if (rowBox.top < listBox.top) files.scrollTop += rowBox.top - listBox.top;
          else if (rowBox.bottom > listBox.bottom) files.scrollTop += rowBox.bottom - listBox.bottom;
        }
      }
    }
  }
  function synchronizePane() {
    const studio = document.getElementById('studio'); if (!studio) { synchronizeSearch(); return; }
    for (const node of studio.querySelectorAll('[data-studio-pane]')) node.setAttribute('aria-pressed', String(node.dataset.studioPane === studio.dataset.pane));
    // Keep refreshes, stage links, and picker submissions in the selected pane.
    const url = new URL(canonical(), location.href);
    url.searchParams.set('pane', studio.dataset.pane);
    workspace().dataset.refreshUrl = url.pathname + url.search;
    for (const input of studio.querySelectorAll('.studio-picker input[name=pane]')) input.value = studio.dataset.pane;
    for (const link of studio.querySelectorAll('a[hx-get]')) {
      const destination = new URL(link.getAttribute('href'), location.href);
      if (destination.searchParams.get('view') === 'studio') { destination.searchParams.set('pane', link.closest('.diff-file-paging') ? 'document' : studio.dataset.pane); setURL(link, destination.pathname + destination.search); }
    }
    synchronizeSearch();
  }
  document.addEventListener('htmx:beforeRequest', event => {
    remember();
    const file = event.detail?.elt?.closest?.('.studio-changed-files .changed-file-link, .studio-diff-panel .diff-file-paging a');
    if (file) {
      const url = new URL(file.getAttribute('href'), location.href);
      pendingFileNavigation = { change: workspace()?.dataset.change, file: url.searchParams.get('file'), preview: url.searchParams.get('job') };
    } else if (event.detail?.elt?.matches?.('a,form')) pendingFileNavigation = null;
  });
  document.addEventListener('htmx:beforeSwap', event => {
    if (event.detail.shouldSwap === false || !event.detail.serverResponse || event.detail.xhr?.status >= 400) return;
    const template = document.createElement('template'); template.innerHTML = event.detail.serverResponse;
    const incoming = template.content.querySelector('#workspace'), current = workspace();
    const fileNavigation = pendingFileNavigation && incoming?.querySelector('#studio[data-stage=implement] [data-diff-file]')?.dataset.diffFile === pendingFileNavigation.file && incoming?.querySelector('.changed-files-nav')?.dataset.previewJob === pendingFileNavigation.preview && current?.querySelector('#studio[data-stage=implement]');
    if (!incoming || !current || incoming.dataset.change !== current.dataset.change || incoming.dataset.workspaceMode === current.dataset.workspaceMode && !fileNavigation) return;
    // Native HTMX preservation keeps the exact project-panel node during mode changes.
    incoming.querySelector('#navigation')?.setAttribute('hx-preserve', 'true');
    const oldProject = current.querySelector('#navigation > nav'), newProject = incoming.querySelector('#navigation > nav');
    if (oldProject && newProject) oldProject.innerHTML = newProject.innerHTML;
    event.detail.serverResponse = incoming.outerHTML;
  });
  document.addEventListener('htmx:afterSwap', initialize);
  document.addEventListener('htmx:afterSettle', () => {
    const active = document.activeElement, studio = document.getElementById('studio');
    if (!studio || !active?.closest?.('#studio')) return;
    const narrow = window.matchMedia?.('(max-width:760px)').matches || document.querySelector('.studio-mobile-panes')?.offsetHeight > 0;
    if (narrow && (active.closest('.studio-canvas') && studio.dataset.pane === 'conversation' || active.closest('.studio-conversation') && studio.dataset.pane === 'document')) studio.querySelector(`[data-studio-pane="${studio.dataset.pane}"]`)?.focus();
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-studio-pane]'), studio = document.getElementById('studio');
    if (button && studio) {
      studio.dataset.pane = button.dataset.studioPane;
      synchronizePane();
      if (button.dataset.studioPane === 'conversation') revealQuestion(studio);
      remember();
      return;
    }
    const command = event.target.closest('[data-studio-insert-command]');
    if (command && studio) {
      const composer = studio.querySelector('#studio-composer'), message = studio.querySelector('#studio-message');
      if (!composer?.hidden && message && !message.disabled) {
        studio.dataset.pane = 'conversation'; synchronizePane();
        message.value = command.dataset.studioInsertCommand;
        message.dispatchEvent(new window.Event('input', {bubbles:true}));
        message.focus();
      }
      return;
    }
    if (event.target.closest('[data-studio-expand]') && studio) {
      state().conversationExpanded = !state().conversationExpanded;
      synchronizeExpansion();
      remember();
      return;
    }
    const requestJump = event.target.closest('[data-studio-conversation-jump]');
    if (requestJump && studio) {
      studio.dataset.pane = 'conversation'; state().conversationExpanded = true;
      synchronizeExpansion(); synchronizePane();
      const thread = document.getElementById('studio-thread');
      const request = requestJump.dataset.studioRequest ? document.getElementById(`studio-job-${requestJump.dataset.studioRequest}`) : studio.querySelector('.studio-progress')?.closest('.studio-exchange') || thread?.querySelector('.studio-exchange:last-of-type');
      request?.closest('.studio-request-history')?.setAttribute('open', '');
      request?.querySelector('.studio-history')?.setAttribute('open', '');
      const requestBox = request?.getBoundingClientRect?.(), threadBox = thread?.getBoundingClientRect?.();
      if (thread) thread.scrollTop = requestBox && threadBox ? thread.scrollTop + requestBox.top - threadBox.top - 18 : thread.scrollHeight;
      const target = request || thread;
      target?.setAttribute('tabindex', '-1'); target?.focus({ preventScroll: true });
      remember();
      return;
    }
    if (event.target.closest('[data-studio-question-jump]') && studio) {
      studio.dataset.pane = 'conversation'; synchronizePane();
      revealQuestion(studio, true);
      remember();
    }
    if (event.target.closest('[data-studio-change-jump]')) { const change = studio?.querySelector('.studio-revision-mark'); change?.scrollIntoView?.({ block: 'center' }); change?.focus(); }
  });
  initialize();
})();
