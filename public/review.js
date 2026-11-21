(() => {
  const drafts = new Map();
  const imageDrafts = new Map(), imageUploads = new Set();
  const saving = new Set();
  const deleting = new Set();
  const deleteMessages = new Map();
  const exporting = new Set(), exportMessages = new Map();
  const updating = new Set(), updateMessages = new Map();
  const commentViews = new Map(), composerStates = new Map();
  const inlineTargets = new Map();
  const diffTargets = new Map();
  let refreshGeneration = 0;
  let anchor = null, focusedLocation = '';
  const form = () => document.getElementById('review-comment-form');
  const field = (node, name) => node.querySelector(`[name="${name}"]`);
  const key = node => `${node.dataset.preview}:${node.dataset.file}`;
  function renderImageDraft(node) {
    const host = node.querySelector('[data-comment-images]'); if (!host) return;
    const images = imageDrafts.get(key(node)) || [];
    host.replaceChildren();
    for (const image of images) {
      const tile = document.createElement('div'), picture = document.createElement('img'), remove = document.createElement('button');
      tile.className = 'comment-image-draft'; picture.src = image.url; picture.alt = image.name;
      remove.type = 'button'; remove.dataset.commentImageRemove = image.id; remove.textContent = 'Remove'; remove.setAttribute('aria-label', `Remove ${image.name}`);
      tile.append(picture, remove); host.append(tile);
    }
    field(node, 'body').required = !images.length;
    node.querySelector('[type=submit]').disabled = saving.has(key(node)) || imageUploads.has(key(node));
  }
  async function uploadImages(node, files) {
    const id = key(node), selected = [...files];
    if (imageUploads.has(id) || saving.has(id)) return;
    const report = node.querySelector('[data-composer-feedback]');
    if ((imageDrafts.get(id)?.length || 0) + selected.length > 4) { report.textContent = 'Attach up to four images per comment.'; return; }
    imageUploads.add(id); renderImageDraft(node); report.textContent = 'Adding image…';
    try {
      for (const file of selected) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose PNG, JPEG or WebP images up to 5 MiB each.');
        const image = await createImageBitmap(file);
        const pixels = image.width * image.height; image.close();
        if (pixels > 40000000) throw new Error('Choose an image smaller than 40 megapixels.');
        const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(new Error('Could not read this image.')); reader.readAsDataURL(file); });
        const response = await fetch(`/api/reviews/${encodeURIComponent(node.dataset.preview)}/images`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': document.querySelector('meta[name=csrf-token]').content }, body: JSON.stringify({ name: file.name, type: file.type, data }) });
        const result = await response.json();
        if (!response.ok || !result.image) throw new Error(result.error || 'Could not upload this image.');
        imageDrafts.set(id, [...imageDrafts.get(id) || [], result.image]);
      }
      report.textContent = '';
    } catch (error) { report.textContent = error.message; }
    finally { imageUploads.delete(id); const active = form(); if (active && key(active) === id) { renderImageDraft(active); showSelection(active); } }
  }
  document.addEventListener('paste', event => {
    const node = event.target.closest('#review-comment-form'); if (!node) return;
    const images = [...event.clipboardData?.files || []].filter(file => file.type.startsWith('image/'));
    if (images.length) { event.preventDefault(); void uploadImages(node, images); }
  });
  document.addEventListener('change', event => {
    if (!event.target.matches('[data-comment-image-input]')) return;
    const files = [...event.target.files]; event.target.value = '';
    void uploadImages(event.target.closest('form'), files);
  });
  document.addEventListener('click', event => {
    const choose = event.target.closest('[data-comment-image-choose]');
    if (choose) choose.closest('form').querySelector('[data-comment-image-input]').click();
    const remove = event.target.closest('[data-comment-image-remove]');
    if (remove) { const node = remove.closest('form'), id = key(node); imageDrafts.set(id, (imageDrafts.get(id) || []).filter(image => image.id !== remove.dataset.commentImageRemove)); renderImageDraft(node); showSelection(node); }
  });
  function remember() {
    const node = form(); if (!node) return;
    drafts.set(key(node), { ...Object.fromEntries(['body', 'side', 'start', 'end'].map(name => [name, field(node, name).value])), ...(node.dataset.sourceHash ? { sourceHash: node.dataset.sourceHash } : {}) });
  }
  function showSelection(node) {
    const side = field(node, 'side').value;
    const start = Number(field(node, 'start').value), end = Number(field(node, 'end').value) || start;
    const lines = side !== 'file';
    node.querySelector('[data-line-fields]').hidden = true;
    field(node, 'start').disabled = !lines; field(node, 'start').required = lines;
    field(node, 'end').disabled = !lines;
    for (const button of document.querySelectorAll('[data-review-line]')) button.classList.toggle('review-line-selected', lines && button.dataset.reviewSide === side && Number(button.dataset.reviewLine) <= end && Number(button.dataset.reviewEnd || button.dataset.reviewLine) >= start);
    const context = node.querySelector('[data-inline-comment-anchor]');
    const stale = Boolean(node.dataset.sourceHash && node.dataset.sourceHash !== document.querySelector('[data-document-content]')?.dataset.sourceHash);
    const sideLabel = side === 'current' ? 'Current' : side === 'proposed' ? 'Proposed' : '';
    if (context) { context.hidden = false; context.textContent = stale ? 'The document changed since this draft. Select a passage or add a document comment to review the latest version.' : side === 'file' ? node.dataset.sourceHash ? 'Entire document' : 'Entire file' : sideLabel ? `${sideLabel} ${start === end ? `line ${start}` : `lines ${start}–${end}`}` : start === end ? `Comment on line ${start}` : `Comment on lines ${start}–${end}`; }
    const reset = node.querySelector('[data-reset-comment-context]'); if (reset) reset.hidden = side === 'file' && !stale;
    const contextRow = node.querySelector('.comment-context-row');
    if (contextRow) contextRow.hidden = Boolean(node.dataset.sourceHash && side === 'file' && !stale && node.closest('[data-document-composer-home]'));
    const general = document.querySelector('[data-general-document-comment]');
    if (general) general.hidden = !node.closest('.document-inline-thread') && side === 'file' && !stale;
    const draft = field(node, 'body').value.trim().length > 0 || Boolean(imageDrafts.get(key(node))?.length);
    const label = document.querySelector('[data-composer-label]'), marker = document.querySelector('[data-comment-draft]');
    if (label) label.textContent = draft ? 'Continue comment' : 'Add a comment';
    if (marker) marker.hidden = !draft;
  }
  function setComposer(node, open) {
    composerStates.set(key(node), open);
    document.getElementById('review-comment-composer')?.toggleAttribute('open', open);
  }
  function updateCommentView() {
    const section = document.getElementById('review-comments'); if (!section) return;
    const selected = section.dataset.currentFile ? commentViews.get(section.dataset.preview) || 'all' : 'all';
    let visible = 0;
    for (const group of section.querySelectorAll('[data-comment-file-group]')) {
      group.hidden = selected === 'current' && group.dataset.commentFileGroup !== section.dataset.currentFile;
      if (!group.hidden) visible++;
    }
    for (const button of section.querySelectorAll('[data-comment-filter]')) button.setAttribute('aria-pressed', String(button.dataset.commentFilter === selected));
    const empty = document.getElementById('review-comments-empty');
    if (empty) {
      empty.hidden = visible > 0;
      empty.querySelector('[data-comment-empty-title]').textContent = selected === 'current' ? 'No comments on this file' : 'No comments yet';
      empty.querySelector('[data-comment-empty-copy]').textContent = selected === 'current' ? 'Add a file note or select a line to leave feedback here.' : 'Comments from every file in this preview will appear here, grouped by file.';
    }
    const now = Date.now();
    for (const time of document.querySelectorAll('#review-comments time[datetime], [data-document-comment-time]')) {
      const date = new Date(time.getAttribute('datetime')), minutes = Math.max(0, Math.floor((now - date.getTime()) / 60000));
      if (!Number.isFinite(minutes)) continue;
      time.textContent = minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
      time.title = date.toLocaleString();
    }
  }
  function initialize() {
    restoreDeleteMessages();
    updateCommentView();
    restoreExportState();
    restoreUpdateState();
    for (const node of document.querySelectorAll('[data-delete-comment]')) if (deleting.has(`${node.dataset.reviewScope}:${node.dataset.commentId}`)) setDeleteBusy(node.dataset.reviewScope, node.dataset.commentId, true);
    const node = form(); if (!node) return;
    let saved = drafts.get(key(node));
    if (saved?.sourceHash && saved.sourceHash !== node.dataset.sourceHash && !saved.body?.trim()) { drafts.delete(key(node)); inlineTargets.delete(key(node)); saved = null; }
    if (saved) {
      for (const name of ['body', 'side', 'start', 'end']) field(node, name).value = saved[name];
      if (saved.sourceHash) node.dataset.sourceHash = saved.sourceHash;
    }
    renderImageDraft(node);
    placeDocumentComposer(inlineTargets.get(key(node)));
    placeDiffComposer(diffTargets.get(key(node)));
    showSelection(node);
    setComposer(node, composerStates.get(key(node)) ?? (Boolean(saved?.body) || document.getElementById('review-comment-composer').hasAttribute('data-default-open')));
    node.querySelector('[type="submit"]').disabled = saving.has(key(node)) || imageUploads.has(key(node));
    const query = new URLSearchParams(location.search);
    const line = Number(query.get('line')), side = query.get('side'), commentID = query.get('comment');
    const locationKey = `${key(node)}:${side}:${line}:${commentID || ''}`;
    const commentTarget = commentID ? document.getElementById(`inline-diff-comment-${commentID}`) || document.getElementById(`inline-document-comment-${commentID}`) || document.getElementById(`document-comment-${commentID}`) || document.getElementById(`comment-${commentID}`) : null;
    if (commentTarget && locationKey !== focusedLocation) { focusedLocation = locationKey; commentTarget.querySelector('[data-comment-disclosure]')?.setAttribute('open', ''); commentTarget.closest('[data-comment-file-group]')?.setAttribute('open', ''); requestAnimationFrame(() => { commentTarget.scrollIntoView({ block: 'center', behavior: 'instant' }); commentTarget.focus({ preventScroll: true }); }); }
    if (line > 0 && ['current', 'proposed', 'document'].includes(side) && locationKey !== focusedLocation) {
      const target = document.querySelector(`[data-review-line="${line}"][data-review-side="${side}"]`) || (side === 'document' ? [...document.querySelectorAll('[data-document-block]')].find(block => Number(block.dataset.sourceStart) <= line && Number(block.dataset.sourceEnd) >= line)?.querySelector('[data-review-line]') : null);
      if (target) { focusedLocation = locationKey; requestAnimationFrame(() => { target.scrollIntoView({ block: 'center', behavior: 'instant' }); target.focus({ preventScroll: true }); }); }
    }
  }
  function placeDocumentComposer(start) {
    const node = form(), home = document.querySelector('[data-document-composer-home]'); if (!node || !home) return;
    const composer = document.getElementById('review-comment-composer');
    const block = start ? [...document.querySelectorAll('[data-document-block]')].find(block => Number(block.dataset.sourceStart) <= Number(start) && Number(block.dataset.sourceEnd) >= Number(start)) : null;
    const target = block?.querySelector('.document-inline-thread') || home;
    if (composer.parentElement !== target) target.append(composer);
    const general = document.querySelector('[data-general-document-comment]'); if (general) general.hidden = target === home;
    for (const button of document.querySelectorAll('.markdown-comment-gutter')) button.setAttribute('aria-expanded', String(Boolean(block && button.closest('[data-document-block]') === block)));
  }
  function placeDiffComposer(location) {
    const node = form(), home = document.querySelector('[data-diff-composer-home]'); if (!node || !home) return;
    const composer = document.getElementById('review-comment-composer');
    const thread = location ? [...document.querySelectorAll('[data-diff-thread]')].find(thread => thread.dataset.diffSide === location.side && Number(thread.dataset.diffLine) === Number(location.line)) : null;
    const target = thread || home;
    if (composer.parentElement !== target) target.append(composer);
    for (const button of document.querySelectorAll('.diff-comment-gutter')) button.setAttribute('aria-expanded', String(Boolean(thread && button.dataset.reviewSide === location.side && Number(button.dataset.reviewLine) === Number(location.line))));
  }
  function openComposer() {
    const toggle = document.getElementById('toggle-review-details');
    const node = form();
    if (!document.getElementById('document-discussion') && !node?.closest('.diff-inline-thread') && toggle?.getAttribute('aria-expanded') === 'false') toggle.click();
    if (node) { setComposer(node, true); node.scrollIntoView({ block: 'nearest', behavior: 'instant' }); field(node, 'body').focus({ preventScroll: true }); }
  }
  document.addEventListener('click', event => {
    const filter = event.target.closest('[data-comment-filter]');
    if (filter) { const section = document.getElementById('review-comments'); commentViews.set(section.dataset.preview, filter.dataset.commentFilter); updateCommentView(true); return; }
    const node = form(); if (!node) return;
    if (event.target.closest('[data-close-composer]')) { remember(); inlineTargets.delete(key(node)); diffTargets.delete(key(node)); placeDocumentComposer(); placeDiffComposer(); setComposer(node, false); showSelection(node); document.querySelector('#review-comment-composer>summary')?.focus(); return; }
    const line = event.target.closest('[data-review-line]');
    if (line) {
      const side = line.dataset.reviewSide, number = Number(line.dataset.reviewLine), last = Number(line.dataset.reviewEnd) || number;
      const first = event.shiftKey && anchor?.key === key(node) && anchor.side === side ? anchor.line : number;
      const end = event.shiftKey && anchor?.key === key(node) && anchor.side === side ? Math.max(anchor.end || first, last) : last;
      field(node, 'side').value = side; field(node, 'start').value = String(Math.min(first, number)); field(node, 'end').value = String(end);
      if (!event.shiftKey || first === number) anchor = { key: key(node), side, line: number, end: last };
      if (side === 'document') {
        node.dataset.sourceHash = document.querySelector('[data-document-content]').dataset.sourceHash;
        const block = line.closest('[data-document-block]');
        if (block) { inlineTargets.set(key(node), end); placeDocumentComposer(end); }
      } else {
        const location = { side, line: end }; diffTargets.set(key(node), location); placeDiffComposer(location);
      }
      showSelection(node); remember(); openComposer();
    } else if (event.target.closest('[data-comment-file]')) {
      inlineTargets.delete(key(node)); diffTargets.delete(key(node)); placeDocumentComposer(); placeDiffComposer();
      if (node.dataset.sourceHash) node.dataset.sourceHash = document.querySelector('[data-document-content]').dataset.sourceHash;
      field(node, 'side').value = 'file'; field(node, 'start').value = ''; field(node, 'end').value = ''; anchor = null;
      showSelection(node); remember(); openComposer();
    }
  });
  document.addEventListener('input', event => { if (event.target.closest('#review-comment-form')) { showSelection(form()); remember(); } });
  document.addEventListener('change', event => { if (event.target.closest('#review-comment-form')) { showSelection(form()); remember(); } });
  document.addEventListener('htmx:beforeRequest', remember);
  document.addEventListener('htmx:afterSwap', initialize);
  document.addEventListener('toggle', event => { if (event.target.id === 'review-comment-composer' && form()) composerStates.set(key(form()), event.target.hasAttribute('open')); }, true);
  function feedback(message, error = false, downloadUrl = '') {
    const target = document.getElementById('review-feedback'); if (!target) return;
    const paragraph = document.createElement('p');
    paragraph.className = error ? 'error-message' : 'success-message'; paragraph.textContent = message;
    if (downloadUrl) {
      const link = document.createElement('a'); link.href = downloadUrl; link.download = 'openspec-review-feedback.md'; link.textContent = 'Download Markdown';
      paragraph.append(' ', link);
    }
    target.replaceChildren(paragraph);
    const local = form()?.querySelector('[data-composer-feedback]');
    if (local) local.replaceChildren(paragraph.cloneNode(true));
  }
  function restoreExportState() {
    const section = document.getElementById('review-comments'); if (!section) return;
    const node = section.querySelector('[data-feedback-export]'); if (!node) return;
    const busy = exporting.has(section.dataset.preview);
    if (busy) node.setAttribute('aria-busy', 'true'); else node.removeAttribute('aria-busy');
    node.querySelector('[type="submit"]').disabled = busy || !section.querySelector('.review-comment');
    node.querySelector('[data-export-label]').textContent = busy ? 'Exporting…' : 'Export .md';
    const state = exportMessages.get(section.dataset.preview);
    if (state) feedback(state.message, state.error, state.downloadUrl);
  }
  function restoreUpdateState() {
    const node = document.querySelector('[data-spec-update]'); if (!node) return;
    const busy = updating.has(node.dataset.change);
    if (busy) node.setAttribute('aria-busy', 'true'); else node.removeAttribute('aria-busy');
    node.querySelector('button').disabled = busy || node.dataset.blocked === 'true';
    node.querySelector('[data-update-label]').textContent = busy ? 'Queuing…' : node.dataset.pendingStatus === 'awaiting-input' ? 'Reply in Build' : node.dataset.pendingStatus === 'running' ? 'Updating…' : node.dataset.pendingStatus === 'queued' ? 'Queued' : 'Update spec';
    const state = updateMessages.get(node.dataset.change);
    if (state) feedback(state.message, state.error, state.downloadUrl);
  }
  document.addEventListener('submit', async event => {
    const node = event.target.closest('[data-spec-update]'); if (!node) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const { preview, change } = node.dataset;
    if (updating.has(change) || node.dataset.blocked === 'true') return;
    remember(); updating.add(change);
    updateMessages.delete(change);
    document.getElementById('review-feedback')?.replaceChildren();
    form()?.querySelector('[data-composer-feedback]')?.replaceChildren();
    restoreUpdateState();
    try {
      const response = await fetch(node.getAttribute('action'), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content }, body: '' });
      const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
      if (!response.ok) throw new Error(result.error || (response.status === 403 ? 'Local session expired. Reload the viewer and retry the update.' : 'Could not queue the planning update. Retry Update spec.'));
      const { update, exported } = result;
      if (!update || update.change !== change || update.reviewPreview !== preview || update.feedbackId !== exported?.id || exported.preview !== preview || update.status !== 'queued' || exported.downloadUrl !== `/api/reviews/${preview}/feedback/${exported.id}`) throw new Error('Could not confirm the planning update. Reload to check its status before retrying.');
      // Preserve the accepted request if a subsequent workspace refresh fails.
      node.dataset.blocked = 'true';
      node.dataset.pendingStatus = 'queued';
      updateMessages.delete(change); exportMessages.delete(preview);
      await refreshComments(preview, '', { change, outcome: 'Planning update queued' });
      document.dispatchEvent(new window.CustomEvent('spequi-toast', { detail: { message: 'Spec update queued for your agent.' } }));
    } catch (error) {
      updateMessages.set(change, { message: error instanceof TypeError ? 'Could not reach the viewer. Check that the server is running and retry Update spec.' : error.message, error: true });
    } finally {
      updating.delete(change);
      const active = document.querySelector('[data-spec-update]');
      if (active?.dataset.change === change) {
        restoreUpdateState();
      }
    }
  }, true);
  // Export owns its POST and download. An HTMX swap/live refresh must not
  // consume the response or discard the only link before it can be used.
  document.addEventListener('submit', async event => {
    const node = event.target.closest('[data-feedback-export]'); if (!node) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const preview = node.dataset.preview; if (exporting.has(preview)) return;
    exporting.add(preview);
    exportMessages.set(preview, { message: 'Preparing feedback document…' }); restoreExportState();
    try {
      const response = await fetch(node.getAttribute('action'), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content }, body: '' });
      const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
      if (!response.ok) throw new Error(result.error || (response.status === 403 ? 'Local session expired. Reload the viewer and retry the export.' : 'Could not export feedback. Check the server connection and retry.'));
      const exported = result.exported;
      if (!exported || exported.preview !== preview || typeof exported.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(exported.id) || exported.downloadUrl !== `/api/reviews/${preview}/feedback/${exported.id}`) throw new Error('Could not confirm the exported document. Retry the export.');
      exportMessages.set(preview, { message: 'Feedback exported. If the download did not start, use this link.', downloadUrl: exported.downloadUrl });
      const download = document.createElement('a'); download.href = exported.downloadUrl; download.download = 'openspec-review-feedback.md'; download.hidden = true;
      document.body.append(download); download.click(); download.remove();
    } catch (error) {
      exportMessages.set(preview, { message: error instanceof TypeError ? 'Could not reach the viewer. Check that the server is running and retry the export.' : error.message, error: true });
    } finally { exporting.delete(preview); restoreExportState(); }
  }, true);
  async function refreshComments(preview, savedFile, { change = '', outcome = 'Comment saved', revealComment = '' } = {}) {
    const current = form(), workspace = document.getElementById('workspace');
    if (!workspace?.dataset.refreshUrl || (change ? workspace.dataset.change !== change : !current || current.dataset.preview !== preview)) return;
    const generation = ++refreshGeneration;
    const url = workspace.dataset.refreshUrl;
    const response = await fetch(url, { headers: { 'HX-Request': 'true' } });
    if (!response.ok) throw new Error(`${outcome}. Reload this view to refresh the comment list.`);
    const html = new DOMParser().parseFromString(await response.text(), 'text/html');
    if (generation !== refreshGeneration || document.getElementById('workspace') !== workspace || workspace.dataset.refreshUrl !== url) return;
    const updated = html.getElementById('review-comments');
    if (!updated) throw new Error(`${outcome}. Reload this view to refresh the comment list.`);
    const inspector = document.getElementById('review-details') || document.querySelector('.studio-review'), top = inspector?.scrollTop || 0;
    const reader = document.getElementById('studio-canvas-body') || document.querySelector('.reader'), readerTop = reader.scrollTop, readerLeft = reader.scrollLeft;
    const code = document.querySelector('.diff-code-scroll'), codeTop = code?.scrollTop, codeLeft = code?.scrollLeft;
    const active = current?.contains(document.activeElement) ? { name: document.activeElement.name, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd } : null;
    const disclosures = [...document.querySelectorAll('#workspace details[id]')].filter(node => node.id !== 'review-comment-composer').map(node => ({ id: node.id, open: node.hasAttribute('open') }));
    const imported = document.importNode(updated, true);
    document.getElementById('review-comments').replaceWith(imported);
    for (const selector of ['[data-document-content]', '#document-discussion', '.file-diff']) {
      const next = html.querySelector(selector), current = document.querySelector(selector);
      if (next && current) current.replaceWith(document.importNode(next, true));
    }
    for (const state of disclosures) document.getElementById(state.id)?.toggleAttribute('open', state.open);
    if (revealComment) {
      for (const thread of document.querySelectorAll('[data-comment-disclosure]')) if (thread.dataset.commentId === revealComment) thread.setAttribute('open', '');
      document.getElementById(`comment-${revealComment}`)?.closest('[data-comment-file-group]')?.setAttribute('open', '');
    }
    if (window.htmx) window.htmx.process(imported);
    if (window.htmx && document.getElementById('document-discussion')) window.htmx.process(document.getElementById('document-discussion'));
    if (window.htmx && document.querySelector('[data-document-content]')) window.htmx.process(document.querySelector('[data-document-content]'));
    if (window.htmx && document.querySelector('.file-diff')) window.htmx.process(document.querySelector('.file-diff'));
    document.dispatchEvent(new CustomEvent('htmx:afterSwap', { detail: { target: imported } }));
    if (active) { const input = form()?.querySelector(`[name="${active.name}"]`); input?.focus({ preventScroll: true }); if (typeof input?.setSelectionRange === 'function' && Number.isInteger(active.start)) input.setSelectionRange(active.start, active.end); }
    if (inspector) inspector.scrollTop = top;
    reader.scrollTop = readerTop; reader.scrollLeft = readerLeft;
    const updatedCode = document.querySelector('.diff-code-scroll');
    if (updatedCode && code) { updatedCode.scrollTop = codeTop; updatedCode.scrollLeft = codeLeft; }
  }
  function deleteForms(scope, id) {
    return [...document.querySelectorAll('[data-delete-comment]')].filter(node => node.dataset.reviewScope === scope && node.dataset.commentId === id);
  }
  function restoreDeleteMessages() {
    for (const node of document.querySelectorAll('[data-delete-comment]')) {
      const message = deleteMessages.get(`${node.dataset.reviewScope}:${node.dataset.commentId}`);
      const target = node.querySelector('[data-delete-feedback]');
      if (target) { target.textContent = message || ''; target.hidden = !message; }
    }
  }
  function setDeleteBusy(scope, id, busy) {
    for (const node of deleteForms(scope, id)) {
      node.querySelector('[type="submit"]').disabled = busy;
      if (busy) node.setAttribute('aria-busy', 'true'); else node.removeAttribute('aria-busy');
    }
  }
  document.addEventListener('submit', async event => {
    const node = event.target.closest('[data-delete-comment]'); if (!node) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const scope = node.dataset.reviewScope, id = node.dataset.commentId, requestKey = `${scope}:${id}`;
    const viewChange = document.getElementById('workspace')?.dataset.change;
    if (deleting.has(requestKey)) return;
    deleting.add(requestKey); deleteMessages.delete(requestKey); remember(); setDeleteBusy(scope, id, true); restoreDeleteMessages();
    const errorTarget = node.querySelector('[data-delete-feedback]'); errorTarget.hidden = true; errorTarget.textContent = '';
    try {
      const response = await fetch(node.getAttribute('action'), { method: 'POST', headers: { Accept: 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content, 'Content-Type': 'application/x-www-form-urlencoded' }, body: '' });
      const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
      if (!response.ok) throw new Error(result.error || (response.status === 403 ? 'Local session expired. Reload the viewer and retry deleting this comment.' : 'Could not delete the comment. Check the server connection and retry.'));
      const removed = result.deleted;
      if (!removed || removed.preview !== scope || removed.id !== id || removed.change !== node.dataset.commentChange || removed.file !== node.dataset.commentFile) throw new Error('Could not confirm this comment was deleted. Reload the view before retrying.');
      deleteMessages.delete(requestKey);
      const refreshURL = document.getElementById('workspace')?.dataset.refreshUrl;
      const viewport = ['.reader', '.diff-code-scroll'].map(selector => { const target = document.querySelector(selector); return target ? { selector, top: target.scrollTop, left: target.scrollLeft } : null; }).filter(Boolean);
      remember();
      exportMessages.delete(scope); exportMessages.delete(document.getElementById('review-comments')?.dataset.preview);
      for (const prefix of ['comment-', 'inline-diff-comment-', 'inline-document-comment-', 'document-comment-']) document.getElementById(prefix + id)?.remove();
      await refreshComments(scope, removed.file, { change: viewChange, outcome: 'Comment removed' });
      if (document.getElementById('workspace')?.dataset.refreshUrl === refreshURL) {
        for (const state of viewport) { const target = document.querySelector(state.selector); if (target) { target.scrollTop = state.top; target.scrollLeft = state.left; } }
        feedback('Comment removed.');
      }
    } catch (error) {
      const local = document.contains(node) ? node : deleteForms(scope, id)[0];
      const message = error instanceof TypeError ? 'Could not reach the viewer. Check that the server is running and retry.' : error.message;
      deleteMessages.set(requestKey, message); restoreDeleteMessages();
      const target = local?.querySelector('[data-delete-feedback]');
      if (target) { target.textContent = message; target.hidden = false; } else if (document.getElementById('workspace')?.dataset.change === viewChange) feedback(message, true);
    } finally { deleting.delete(requestKey); setDeleteBusy(scope, id, false); }
  }, true);
  // Capture before HTMX or the browser's native form-navigation fallback.
  document.addEventListener('submit', async event => {
    const node = event.target.closest('#review-comment-form'); if (!node) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const submittedKey = key(node); if (saving.has(submittedKey) || imageUploads.has(submittedKey)) return;
    const payload = new URLSearchParams({ file: node.dataset.file, body: field(node, 'body').value, side: field(node, 'side').value });
    payload.set('attachments', JSON.stringify((imageDrafts.get(submittedKey) || []).map(image => image.id)));
    if (node.dataset.sourceHash) payload.set('sourceHash', node.dataset.sourceHash);
    if (payload.get('side') !== 'file') for (const name of ['start', 'end']) payload.set(name, field(node, name).value);
    remember(); setComposer(node, true); saving.add(submittedKey); node.setAttribute('aria-busy', 'true'); node.querySelector('[type="submit"]').disabled = true;
    try {
      const response = await fetch(node.getAttribute('action'), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content }, body: payload.toString() });
      const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
      if (!response.ok) throw new Error(result.error || (response.status === 403 ? 'Local session expired. Reload this view before retrying; your comment has not been saved.' : 'Could not save the comment. Your draft is still available.'));
      if (!result.comment) throw new Error('Could not confirm the comment was saved. Your draft is still available.');
      const refreshURL = document.getElementById('workspace')?.dataset.refreshUrl;
      const viewport = ['.reader', '.diff-code-scroll'].map(selector => { const target = document.querySelector(selector); return target ? { selector, top: target.scrollTop, left: target.scrollLeft } : null; }).filter(Boolean);
      document.dispatchEvent(new CustomEvent('review-saved', { detail: { preview: node.dataset.preview, file: node.dataset.file, body: payload.get('body') } }));
      const active = form();
      if (active?.dataset.file === result.comment.file && active.dataset.preview === result.comment.preview && result.comment.side !== 'file') for (const button of document.querySelectorAll('[data-review-line]')) if (button.dataset.reviewSide === result.comment.side && Number(button.dataset.reviewLine) >= result.comment.start && Number(button.dataset.reviewLine) <= result.comment.end) button.classList.add('has-comments');
      await refreshComments(node.dataset.preview, result.comment.file, { revealComment: result.comment.id });
      if (document.getElementById('workspace')?.dataset.refreshUrl === refreshURL) for (const state of viewport) { const target = document.querySelector(state.selector); if (target) { target.scrollTop = state.top; target.scrollLeft = state.left; } }
      if (form()?.dataset.preview === node.dataset.preview) feedback('Comment saved.');
    } catch (error) { if (form() && key(form()) === submittedKey) feedback(error.message, true); }
    finally { saving.delete(submittedKey); const active = form(); if (active && key(active) === submittedKey) { active.removeAttribute('aria-busy'); active.querySelector('[type="submit"]').disabled = false; } }
  }, true);
  document.addEventListener('review-saved', event => {
    const savedKey = `${event.detail.preview}:${event.detail.file}`;
    if (event.detail.body !== undefined && drafts.get(savedKey)?.body !== event.detail.body) return;
    drafts.delete(savedKey); imageDrafts.delete(savedKey);
    const node = form(); if (!node || key(node) !== savedKey) return;
    anchor = null;
    inlineTargets.delete(savedKey); diffTargets.delete(savedKey); placeDocumentComposer(); placeDiffComposer();
    renderImageDraft(node);
    field(node, 'body').value = ''; field(node, 'side').value = 'file'; field(node, 'start').value = ''; field(node, 'end').value = '';
    showSelection(node);
    setComposer(node, Boolean(document.getElementById('document-discussion')));
    if (document.activeElement === field(node, 'body')) field(node, 'body').blur();
  });
  initialize();
})();
