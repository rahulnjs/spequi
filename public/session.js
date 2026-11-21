(() => {
  let current = null, opener = null, checking = false;
  const panels = () => document.querySelectorAll('#agent-connections, #mcp-connections');
  function close() { for(const panel of panels()) panel.hidden = true; for(const button of document.querySelectorAll('[data-session-toggle]')) button.setAttribute('aria-expanded','false'); }
  function positionMCP() {
    for (const panel of panels()) if (!panel.hidden) window.spequiPositionDropdown?.(panel, document.querySelector(`[data-session-toggle][aria-controls="${panel.id}"]`));
  }
  function text(id, value) { const node = document.getElementById(id); if (node) node.textContent = value; return node; }
  function lastSeen(at) {
    const age = Math.max(0, Date.now() - at);
    if (age < 15000) return 'Just now';
    if (age < 60000) return `${Math.floor(age / 1000)} seconds ago`;
    if (age < 3600000) { const minutes = Math.floor(age / 60000); return `${minutes} minute${minutes === 1 ? '' : 's'} ago`; }
    if (age < 86400000) { const hours = Math.floor(age / 3600000); return `${hours} hour${hours === 1 ? '' : 's'} ago`; }
    return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function render(agent) {
    if (current?.observedAt && agent.observedAt && agent.observedAt < current.observedAt) return;
    if (current && (current.status !== agent.status || current.connected !== agent.connected || current.agent !== agent.agent)) {
      const result = document.querySelector('[data-session-check-result]'); if (result) result.textContent = '';
    }
    current = agent;
    const labels = { live:'Agent ready', connected:'Agent connected', blocked:'Queue blocked', working:'Agent working', waiting:'Awaiting your answer', unresponsive:'No recent update', unattached:'No agent connected', unavailable:'Status unavailable' };
    const running = agent.queue?.active?.status === 'running';
    const waiting = agent.queue?.active?.status === 'awaiting-input';
    const label = waiting ? 'Answer needed' : (running && agent.status === 'unresponsive' ? 'Request in progress' : labels[agent.status]) || 'Status unavailable';
    const indicator = document.getElementById('agent-indicator');
    const nameLabel = typeof agent.agent === 'string' ? agent.agent.trim() : '';
    const stateLabel = waiting ? 'Answer needed' : { live:'Ready', connected:'Connected', blocked:'Queue blocked', working:'Working', waiting:'Answer needed' }[agent.status];
    for(const node of document.querySelectorAll('[data-session-label]')) node.textContent = indicator?.contains(node) && agent.connected && nameLabel && stateLabel ? `${nameLabel} · ${stateLabel}` : label;
    indicator?.classList.toggle('session-online',Boolean(agent.connected));
    if (indicator) indicator.dataset.sessionState = waiting ? 'waiting' : agent.status;
    const heartbeatStopped = agent.status === 'unresponsive';
    const hint = heartbeatStopped ? 'Longer requests can take a few minutes. The result will appear here when ready. Check your CLI for permissions or other actions waiting for you.' : agent.at ? `${agent.agent || 'Agent'} · Last heartbeat ${new Date(agent.at).toLocaleTimeString()}` : 'Attach the spequi skill in your coding agent';
    indicator?.setAttribute('title', hint);
    indicator?.setAttribute('aria-description', heartbeatStopped ? hint : 'Open agent status and recovery details.');
    const status = agent.status || 'unavailable';
    const displayStatus = waiting ? 'waiting' : status;
    const badge = text('session-state', { live:'Ready', connected:'Connected', blocked:'Blocked', working:'Working', waiting:'Answer needed', unresponsive:running ? 'In progress' : 'No recent update', unattached:'Not attached', unavailable:'Unknown' }[displayStatus] || 'Unknown');
    if (badge) badge.dataset.state = displayStatus;
    text('session-agent-name', nameLabel || 'Spequi Agent');
    text('session-agent-caption', { live:'Listening for your next request', connected:'Not listening for new requests', blocked:'A request needs attention', working:'Processing your request', waiting:'Waiting for your answer', unresponsive:running ? 'Request in progress; check your CLI if it pauses' : 'No recent agent heartbeat', unattached:'No coding session connected', unavailable:'Connection status unavailable' }[status] || 'Connection status unavailable');
    const timestamp = Number(agent.at), validTime = Number.isFinite(timestamp) && timestamp > 0 && !Number.isNaN(new Date(timestamp).getTime());
    const seen = text('session-last-seen', validTime ? lastSeen(timestamp) : 'Not yet');
    if (seen) { seen.title = validTime ? new Date(timestamp).toLocaleString() : 'No activity reported'; if (validTime) seen.setAttribute('datetime', new Date(timestamp).toISOString()); else seen.removeAttribute('datetime'); }
    const info = agent.mcps || {supported:null,stale:true,connections:[],connectedCount:null};
    const count = document.getElementById('mcp-count'); if(count) count.textContent = info.connectedCount === null ? 'MCPs' : `${info.connectedCount} MCP${info.connectedCount === 1 ? '' : 's'}`;
    const mcpButton = document.querySelector('.session-mcp-button');
    mcpButton?.setAttribute('aria-label',info.connectedCount === null ? 'MCP connections: status not reported' : `${info.connectedCount} connected MCP${info.connectedCount === 1 ? '' : 's'}`);
    const summary = document.getElementById('mcp-report-summary');
    const connections = info.connections || [], hasConnections = connections.length > 0;
    const mcpState = text('mcp-panel-state', hasConnections ? info.stale ? 'Last report' : `${info.connectedCount ?? 0} connected` : info.supported === true && !info.stale ? 'None reported' : 'Unavailable');
    if (mcpState) mcpState.dataset.state = !info.stale && info.connectedCount > 0 ? 'connected' : 'unknown';
    if(summary) { summary.hidden = !hasConnections; summary.textContent = info.stale ? 'Last reported connections. Live status is unknown.' : `Shared by ${nameLabel || 'Spequi Agent'}.`; }
    const mcpEmpty = document.querySelector('[data-mcp-empty]'); if (mcpEmpty) mcpEmpty.hidden = hasConnections;
    text('mcp-empty-title', agent.status === 'unavailable' ? 'Couldn’t refresh connections' : info.supported === false ? 'Connection details unavailable' : info.supported === true && !info.stale ? 'No MCP connections reported' : 'Waiting for connection details');
    text('mcp-empty-description', agent.status === 'unavailable' ? 'Check the local server and try again.' : info.supported === false ? 'This session can’t report its MCP connection status.' : info.supported === true && !info.stale ? 'Your agent reported no MCP connections.' : 'Your agent hasn’t shared current connection details yet.');
    const list = document.getElementById('session-mcps');
    if(list) {
      list.replaceChildren();
      for(const connection of connections) {
        const item = document.createElement('li'), icon = document.createElement('span'), title = document.createElement('span'), status = document.createElement('small');
        icon.className = 'mcp-service-icon'; icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="15" width="6" height="6" rx="1.5"/><path d="M6 9v6a3 3 0 0 0 3 3h6M9 6h6a3 3 0 0 1 3 3v6"/></svg>';
        title.className = 'mcp-service-name';
        title.textContent = connection.name;
        const statusLabel = { connected: 'Connected', disconnected: 'Disconnected', unavailable: 'Unavailable', unknown: 'Unknown' }[connection.status] || 'Unknown';
        status.textContent = `${info.stale ? 'Last: ' : ''}${statusLabel}`;
        status.className = 'mcp-service-state'; status.dataset.state = info.stale ? 'unknown' : connection.status;
        item.append(icon,title,status); list.append(item);
      }
    }
    const queue = agent.queue, active = status !== 'unavailable' ? queue?.active : null;
    const stalled = active?.status === 'running' && !active.ownerConnected && !active.origin;
    text('session-queue-state', status === 'unavailable' || !queue ? 'Unknown' : queue.queued ? `${queue.queued} waiting` : 'Empty');
    const request = document.querySelector('[data-session-current]'); if (request) request.hidden = !active;
    text('session-current-change', active?.change || 'Project question');
    text('session-current-state', active?.status === 'awaiting-input' ? 'Answer needed' : stalled ? 'In progress · check CLI' : active?.preparing ? 'Preparing' : 'Working');
    text('session-current-hint', active?.status === 'awaiting-input' ? active.question ? 'Answer below to continue this request.' : 'The saved question is unavailable. Open the request, or cancel it to free the queue.' : stalled ? 'This can take a few minutes. Results appear here when ready. Check your CLI for permissions or other actions waiting for you.' : active?.origin ? 'A local preview is running. Follow progress in Requests.' : 'Follow progress in Requests.');
    const questionHost = document.getElementById('session-question');
    const question = active?.question;
    if (questionHost) {
      questionHost.hidden = !question || !waiting;
      const key = question ? `${active.id}:${question.id}` : '';
      if (key !== questionHost.dataset.questionKey) {
        questionHost.dataset.questionKey = key;
        questionHost.replaceChildren();
        if (question && waiting) questionHost.append(window.spequiQuestionForm(active, question, 'agent'));
      }
    }
    const cancel = document.getElementById('session-cancel-request');
    if (cancel) {
      cancel.hidden = !waiting;
      if (waiting) cancel.setAttribute('action', `/api/jobs/${encodeURIComponent(active.id)}/cancel`);
    }
    const needsHelp = !agent.connected || status === 'blocked' || status === 'connected' && !active && !agent.ready;
    const recovery = document.getElementById('session-recovery'); if (recovery) recovery.hidden = !needsHelp;
    text('session-recovery-message', waiting && !active?.ownerConnected ? 'Your reply will be saved. Resume the same coding session to continue, or cancel this request to free the queue.' : status === 'unavailable' ? 'Could not read the connection status. Check the local server, then refresh.'
      : stalled ? 'This can take a few minutes. Results appear here when ready. Check your CLI for permissions or other actions waiting for you.'
      : status === 'blocked' ? 'Open Requests to review the queue, then resume Spequi.'
      : status === 'unattached' ? 'Start the spequi skill in your coding session to attach an agent.'
      : status === 'connected' ? 'Resume the spequi skill in your coding session to receive requests.'
      : 'Resume the spequi skill in your coding session to reconnect.');
    const detail = text('session-recovery-detail', 'If the old session cannot resume, stop it before ending the request in Requests.'); if (detail) detail.hidden = !stalled;
    const date = document.getElementById('mcp-report-date'), reported = Number(info.reportedAt);
    if(date) {
      const valid = Number.isFinite(reported) && reported > 0 && !Number.isNaN(new Date(reported).getTime());
      date.textContent = valid ? `Updated ${lastSeen(reported).toLowerCase()}` : 'Not reported yet';
      date.title = valid ? new Date(reported).toLocaleString() : 'No connection report received';
      if (valid) date.setAttribute('datetime', new Date(reported).toISOString()); else date.removeAttribute('datetime');
    }
  }
  async function refresh() {
    try {
      let agent;
      if (window.spequiRefreshAgent) agent = await window.spequiRefreshAgent();
      else {
        const response = await fetch('/api/agent-status', { signal: globalThis.AbortSignal?.timeout?.(10000) });
        if(!response.ok) throw new Error('Unavailable');
        agent = await response.json();
      }
      if (!agent) throw new Error('Unavailable');
      render(agent); return agent;
    } catch { render({...current,connected:false,status:'unavailable',mcps:{...current?.mcps,stale:true,connectedCount:null}}); return null; }
  }
  async function checkConnection(button) {
    if (checking) return;
    const restoreFocus = document.activeElement === button;
    checking = true; button.disabled = true; button.textContent = 'Checking…'; button.setAttribute('aria-busy', 'true');
    const result = document.querySelector('[data-session-check-result]');
    if (result) { result.textContent = 'Checking agent status…'; result.dataset.state = 'checking'; }
    try {
      const agent = await refresh();
      const name = agent?.agent || 'Spequi Agent';
      const message = !agent ? 'Could not refresh status. Check that the local server is running and try again.'
        : !agent.connected ? agent.status === 'unattached' ? 'No agent attached. Start the Spequi skill in your coding session.' : 'Check your coding session for permissions or other actions waiting for you.'
        : agent.ready ? `${name} is connected and ready.`
        : agent.status === 'working' ? `${name} is connected and working.`
        : agent.status === 'waiting' ? `${name} is connected and waiting for your answer.`
        : agent.status === 'blocked' ? `${name} is connected. The queue needs attention.`
        : `${name} is connected. Resume Spequi to receive requests.`;
      if (result) { result.textContent = message; result.dataset.state = !agent ? 'error' : agent.connected ? 'connected' : 'disconnected'; }
    } finally {
      checking = false; button.disabled = false; button.textContent = 'Refresh status'; button.removeAttribute('aria-busy');
      if (restoreFocus && button.isConnected && !button.closest('.session-panel')?.hidden && (document.activeElement === document.body || document.activeElement === button)) button.focus({preventScroll:true});
    }
  }
  document.addEventListener('agent-status',event => render(event.detail));
  document.addEventListener('requests-updated', () => { void refresh(); });
  document.addEventListener('click',event => {
    const toggle = event.target.closest('[data-session-toggle]');
    const target = toggle && document.getElementById(toggle.getAttribute('aria-controls'));
    if(target) {
      const opening = target.hidden; close();
      if(opening) { opener=toggle; target.hidden=false; toggle.setAttribute('aria-expanded','true'); positionMCP(); target.querySelector('[data-session-close]')?.focus({preventScroll:true}); refresh(); }
      return;
    }
    const check = event.target.closest('[data-session-refresh]');
    if(check) { void checkConnection(check); return; }
    const mcpRefresh = event.target.closest('[data-mcp-refresh]');
    if(mcpRefresh) {
      if (mcpRefresh.disabled) return;
      mcpRefresh.disabled = true; mcpRefresh.textContent = 'Refreshing…'; mcpRefresh.setAttribute('aria-busy', 'true');
      void refresh().finally(() => { mcpRefresh.disabled = false; mcpRefresh.textContent = 'Refresh status'; mcpRefresh.removeAttribute('aria-busy'); });
      return;
    }
    if(event.target.closest('[data-session-open-requests]')) { close(); document.querySelector('.topbar [data-requests-toggle]')?.click(); return; }
    if(event.target.closest('[data-session-close]')) { close(); opener?.focus(); return; }
    if(!event.target.closest('#agent-connections, #mcp-connections')) close();
  });
  document.addEventListener('keydown',event => { if(event.key === 'Escape' && [...panels()].some(panel => !panel.hidden)) { close(); opener?.focus(); } });
  window.addEventListener('resize', positionMCP);
  window.addEventListener('scroll', positionMCP, { passive: true });
  refresh(); setInterval(refresh,30000);
})();
