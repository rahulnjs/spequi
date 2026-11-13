(() => {
  let current = null, opener = null;
  const panel = () => document.getElementById('agent-connections');
  function close() { if(panel()) panel().hidden = true; for(const button of document.querySelectorAll('[data-session-toggle]')) button.setAttribute('aria-expanded','false'); }
  function render(agent) {
    current = agent;
    const labels = { live:'Agent live', working:'Agent working', waiting:'Awaiting your answer', unresponsive:'Reconnect agent', unattached:'No agent attached', unavailable:'Status unavailable' };
    const label = labels[agent.status] || 'Status unavailable';
    for(const node of document.querySelectorAll('[data-session-label]')) node.textContent = label;
    const indicator = document.getElementById('agent-indicator');
    indicator?.classList.toggle('session-online',Boolean(agent.connected));
    if (indicator) indicator.dataset.sessionState = agent.status;
    indicator?.setAttribute('title',agent.at ? `${agent.agent || 'Agent'} · Last heartbeat ${new Date(agent.at).toLocaleTimeString()}` : 'Attach the spequi skill in your coding agent');
    const name = document.getElementById('session-agent-name'); if(name) name.textContent = agent.agent || 'No session reported';
    const seen = document.getElementById('session-last-seen'); if(seen) seen.textContent = agent.at ? `Last heartbeat: ${new Date(agent.at).toLocaleString()}` : 'No heartbeat received. Run the spequi skill in your coding agent to attach.';
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
    const recovery = document.getElementById('session-recovery'); if (recovery) recovery.hidden = Boolean(agent.connected);
    const date = document.getElementById('mcp-report-date'); if(date) date.textContent = info.reportedAt ? `Reported: ${new Date(info.reportedAt).toLocaleString()}` : 'Your agent can report connections when it attaches. Workflows remain available.';
  }
  async function refresh() {
    try { const response = await fetch('/api/agent-status'); if(!response.ok) throw new Error('Unavailable'); render(await response.json()); }
    catch { render({...current,connected:false,status:'unavailable',mcps:{...current?.mcps,stale:true,connectedCount:null}}); }
  }
  document.addEventListener('agent-status',event => render(event.detail));
  document.addEventListener('click',event => {
    const toggle = event.target.closest('[data-session-toggle]');
    if(toggle && panel()) { const visible = panel().hidden; close(); panel().hidden = !visible; if(visible){opener=toggle; for(const button of document.querySelectorAll('[data-session-toggle]')) button.setAttribute('aria-expanded','true'); refresh();} return; }
    if(event.target.closest('[data-session-refresh]')) { refresh(); return; }
    if(event.target.closest('[data-session-close]')) { close(); opener?.focus(); return; }
    if(!event.target.closest('#agent-connections')) close();
  });
  document.addEventListener('keydown',event => { if(event.key === 'Escape' && panel() && !panel().hidden) { close(); opener?.focus(); } });
  refresh(); setInterval(refresh,10000);
})();
