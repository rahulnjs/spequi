(() => {
  let current = null, opener = null, checking = false;
  const panels = () => document.querySelectorAll('#agent-connections, #mcp-connections');
  function close() { for(const panel of panels()) panel.hidden = true; for(const button of document.querySelectorAll('[data-session-toggle]')) button.setAttribute('aria-expanded','false'); }
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
    if (current && (current.status !== agent.status || current.connected !== agent.connected || current.agent !== agent.agent)) {
      const result = document.querySelector('[data-session-check-result]'); if (result) result.textContent = '';
    }
    current = agent;
    const labels = { live:'Agent ready', connected:'Agent connected', blocked:'Queue blocked', working:'Agent working', waiting:'Awaiting your answer', unresponsive:'Reconnect agent', unattached:'No agent attached', unavailable:'Status unavailable' };
    const label = labels[agent.status] || 'Status unavailable';
    const indicator = document.getElementById('agent-indicator');
    const nameLabel = typeof agent.agent === 'string' ? agent.agent.trim() : '';
    const stateLabel = { live:'Ready', connected:'Connected', blocked:'Queue blocked', working:'Working', waiting:'Answer needed' }[agent.status];
    for(const node of document.querySelectorAll('[data-session-label]')) node.textContent = indicator?.contains(node) && agent.connected && nameLabel && stateLabel ? `${nameLabel} · ${stateLabel}` : label;
    indicator?.classList.toggle('session-online',Boolean(agent.connected));
    if (indicator) indicator.dataset.sessionState = agent.status;
    const heartbeatStopped = agent.status === 'unresponsive';
    const hint = heartbeatStopped ? 'Heartbeat stopped. Resume Spequi in the same coding session.' : agent.at ? `${agent.agent || 'Agent'} · Last heartbeat ${new Date(agent.at).toLocaleTimeString()}` : 'Attach the spequi skill in your coding agent';
    indicator?.setAttribute('title', hint);
    indicator?.setAttribute('aria-description', heartbeatStopped ? hint : 'Open agent status and recovery details.');
    const status = agent.status || 'unavailable';
    const badge = text('session-state', { live:'Ready', connected:'Connected', blocked:'Blocked', working:'Working', waiting:'Answer needed', unresponsive:'Offline', unattached:'Not attached', unavailable:'Unknown' }[status] || 'Unknown');
    if (badge) badge.dataset.state = status;
    text('session-agent-name', nameLabel || 'Your coding agent');
    text('session-agent-caption', { live:'Listening for your next request', connected:'Not listening for new requests', blocked:'A request needs attention', working:'Processing your request', waiting:'Waiting for your answer', unresponsive:'Session stopped responding', unattached:'No coding session connected', unavailable:'Connection status unavailable' }[status] || 'Connection status unavailable');
    const timestamp = Number(agent.at), validTime = Number.isFinite(timestamp) && timestamp > 0 && !Number.isNaN(new Date(timestamp).getTime());
    const seen = text('session-last-seen', validTime ? lastSeen(timestamp) : 'Not yet');
    if (seen) { seen.title = validTime ? new Date(timestamp).toLocaleString() : 'No activity reported'; if (validTime) seen.setAttribute('datetime', new Date(timestamp).toISOString()); else seen.removeAttribute('datetime'); }
    const info = agent.mcps || {supported:null,stale:true,connections:[],connectedCount:null};
    const count = document.getElementById('mcp-count'); if(count) count.textContent = info.connectedCount === null ? 'MCPs' : `${info.connectedCount} MCP${info.connectedCount === 1 ? '' : 's'}`;
    const mcpButton = document.querySelector('.session-mcp-button');
    mcpButton?.setAttribute('aria-label',info.connectedCount === null ? 'MCP connections: status not reported' : `${info.connectedCount} connected MCP${info.connectedCount === 1 ? '' : 's'}`);
    const summary = document.getElementById('mcp-report-summary');
    if(summary) summary.textContent = info.supported === null ? 'This agent has not reported its MCP connections.' : !info.supported ? 'This agent host cannot report MCP connection status.' : info.stale ? 'This report is out of date. Current connections are unknown.' : info.connections.length ? 'Connections reported by the attached agent session.' : 'The agent reported no MCP connections.';
    const list = document.getElementById('session-mcps');
    if(list) {
      list.replaceChildren();
      for(const connection of info.connections || []) {
        const item = document.createElement('li'), title = document.createElement('span'), status = document.createElement('small');
        title.textContent = connection.name;
        status.textContent = `${info.stale ? 'Last reported: ' : ''}${connection.status}`;
        status.className = !info.stale && connection.status === 'connected' ? 'mcp-connected' : '';
        item.append(title,status); list.append(item);
      }
    }
    const queue = agent.queue, active = status !== 'unavailable' ? queue?.active : null;
    const stalled = active?.status === 'running' && !active.ownerConnected && !active.origin;
    text('session-queue-state', status === 'unavailable' || !queue ? 'Unknown' : queue.queued ? `${queue.queued} waiting` : 'Empty');
    const request = document.querySelector('[data-session-current]'); if (request) request.hidden = !active;
    text('session-current-change', active?.change || 'Project question');
    text('session-current-state', active?.status === 'awaiting-input' ? 'Answer needed' : stalled ? 'Waiting for agent' : active?.preparing ? 'Preparing' : 'Working');
    text('session-current-hint', active?.status === 'awaiting-input' ? 'Open Requests to answer the question.' : stalled ? 'The request is saved and waiting for its session.' : active?.origin ? 'A local preview is running. Follow progress in Requests.' : 'Follow progress in Requests.');
    const needsHelp = !agent.connected || status === 'blocked' || status === 'connected' && !active && !agent.ready;
    const recovery = document.getElementById('session-recovery'); if (recovery) recovery.hidden = !needsHelp;
    text('session-recovery-message', status === 'unavailable' ? 'Could not read the connection status. Check the local server, then refresh.'
      : stalled ? 'Resume Spequi in the original coding session to continue.'
      : status === 'blocked' ? 'Open Requests to review the queue, then resume Spequi.'
      : status === 'unattached' ? 'Start the spequi skill in your coding session to attach an agent.'
      : status === 'connected' ? 'Resume the spequi skill in your coding session to receive requests.'
      : 'Resume the spequi skill in your coding session to reconnect.');
    const detail = text('session-recovery-detail', 'If the old session cannot resume, stop it before ending the stalled request in Requests.'); if (detail) detail.hidden = !stalled;
    const date = document.getElementById('mcp-report-date'); if(date) date.textContent = info.reportedAt ? `Reported: ${new Date(info.reportedAt).toLocaleString()}` : 'Your agent can report connections when it attaches. Workflows remain available.';
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
      const name = agent?.agent || 'Agent';
      const message = !agent ? 'Could not refresh status. Check that the local server is running and try again.'
        : !agent.connected ? agent.status === 'unattached' ? 'No agent attached. Start the Spequi skill in your coding session.' : 'Still disconnected. Checked just now.'
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
  document.addEventListener('click',event => {
    const toggle = event.target.closest('[data-session-toggle]');
    const target = toggle && document.getElementById(toggle.getAttribute('aria-controls'));
    if(target) {
      const opening = target.hidden; close();
      if(opening) { opener=toggle; target.hidden=false; toggle.setAttribute('aria-expanded','true'); target.querySelector('[data-session-close]')?.focus({preventScroll:true}); refresh(); }
      return;
    }
    const check = event.target.closest('[data-session-refresh]');
    if(check) { void checkConnection(check); return; }
    if(event.target.closest('[data-session-open-requests]')) { close(); document.querySelector('.topbar [data-requests-toggle]')?.click(); return; }
    if(event.target.closest('[data-session-close]')) { close(); opener?.focus(); return; }
    if(!event.target.closest('#agent-connections, #mcp-connections')) close();
  });
  document.addEventListener('keydown',event => { if(event.key === 'Escape' && [...panels()].some(panel => !panel.hidden)) { close(); opener?.focus(); } });
  refresh(); setInterval(refresh,30000);
})();
