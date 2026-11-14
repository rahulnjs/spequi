import {randomUUID} from 'node:crypto';
import {readJSON,writeJSON,runtime,withLock} from './files.mjs';

const statuses=new Set(['connected','disconnected','unavailable','unknown']);
function label(value,limit){return typeof value==='string' && value.trim() && value.length<=limit && !/[\x00-\x1f\x7f]/.test(value);}
export async function reportSession(root,{agent='Spequi Agent',sessionId,mcps}={}){
  if(!label(agent,100))throw new Error('Agent name must be a display name under 100 characters');
  if(sessionId!==undefined&&!/^[a-zA-Z0-9_-]{1,120}$/.test(sessionId))throw new Error('Invalid agent session ID');
  if(!mcps||typeof mcps.supported!=='boolean'||!Array.isArray(mcps.connections)||mcps.connections.length>50)throw new Error('Report MCP support and at most 50 connections');
  const connections=mcps.connections.map(item=>{
    if(!item||!label(item.name,100)||!statuses.has(item.status))throw new Error('Each MCP needs a bounded display name and known status');
    if(Object.keys(item).some(key=>!['name','status'].includes(key)))throw new Error('MCP reports accept display names and status only; omit credentials and configuration');
    return {name:item.name.trim(),status:item.status};
  });
  if(new Set(connections.map(item=>item.name.toLowerCase())).size!==connections.length)throw new Error('MCP display names must be unique');
  if(!mcps.supported&&connections.length)throw new Error('Unsupported discovery cannot report connections');
  if(Object.keys(mcps).some(key=>!['supported','connections'].includes(key)))throw new Error('MCP reports accept support and connection display metadata only');
  return withLock(runtime(root,'agent-session.lock'),async()=>{
    const id=sessionId||randomUUID();
    const report={agent,sessionId:id,reportedAt:Date.now(),mcps:{supported:mcps.supported,connections}};
    await writeJSON(runtime(root,'agent-session.json'),report);
    const previous=await readJSON(runtime(root,'agent.json'));
    await writeJSON(runtime(root,'agent.json'),{...(previous?.agent===agent&&previous.sessionId===id?previous:{}),agent,sessionId:id,at:Date.now()});
    return {sessionId:id,reportedAt:report.reportedAt,connections:connections.length};
  });
}
export async function sessionEvidence(root,state,now=Date.now()){
  const report=await readJSON(runtime(root,'agent-session.json'));
  const matching=Boolean(report&&report.agent===state?.agent&&report.sessionId===state?.sessionId);
  const stale=!matching||!state?.connected||now-report.reportedAt>300000;
  return {supported:matching?report.mcps.supported:null,reportedAt:matching?report.reportedAt:null,stale,
    connections:matching?report.mcps.connections:[],connectedCount:!stale&&report.mcps.supported?report.mcps.connections.filter(item=>item.status==='connected').length:null};
}
