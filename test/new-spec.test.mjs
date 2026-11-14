import { readyDocument } from './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import vm from 'node:vm';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {initProject} from '../src/project.mjs';
import {requestLifecycle} from '../src/lifecycle.mjs';
import {claimNext,updateJob,getJob} from '../src/jobs.mjs';
import {startServer} from '../src/server.mjs';
import {parseHTML} from 'linkedom';
import {askJob,answerJob} from '../src/job-dialogue.mjs';
async function put(root,file,text){await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});await fs.writeFile(path.join(root,file),text);}
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'openspec-create-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await initProject(root);await put(root,'openspec/config.yaml','schema: spec-driven\n');return root;}

test('idea-to-plan preserves scope and ownership, refuses collisions and waits for actual artifacts',async t=>{
 const root=await fixture(t), options={runCLI:async()=>({root:{path:root}})};
 for(const planMode of ['next','full']){
  const change='new-'+planMode;
  const {job,url}=await requestLifecycle(root,{action:'start-plan',change,message:'Build the requested feature',planMode},options);
  assert.match(url,new RegExp(job.id));
  await assert.rejects(requestLifecycle(root,{action:'start-plan',change,message:'duplicate'},options),/already pending/);
  const owned=await claimNext(root,'This session');assert.equal(owned.planMode,planMode);assert.equal(owned.workflow.mode,'same-session');
  assert.equal(owned.workflow.skill,planMode==='full'?'openspec-propose':null);
  assert.match(owned.instructions,planMode==='full'?/all required planning/:/first ready artifact only/);
  const question=await askJob(root,owned.id,owned.claimToken,{message:'Which policy?',options:['A','B']});
  await assert.rejects(updateJob(root,owned.id,owned.claimToken,'finish','Not yet'),/not running/);
  await answerJob(root,owned.id,{questionId:question.question.id,answer:'A'});
  await assert.rejects(updateJob(root,owned.id,owned.claimToken,'finish','No files'),/planning artifact/);
  await put(root,`openspec/changes/${change}/.openspec.yaml`,'schema: spec-driven\n');
  await put(root,`openspec/changes/${change}/proposal.md`,'# The actual plan\n');
  if(planMode==='full'){
    await assert.rejects(updateJob(root,owned.id,owned.claimToken,'finish','Partial plan'),/all required/);
    await put(root,`openspec/changes/${change}/design.md`,'# Design\n');
    await put(root,`openspec/changes/${change}/tasks.md`,'- [ ] Build the feature\n');
    await put(root,`openspec/changes/${change}/specs/feature/spec.md`,'## ADDED Requirements\n\n### Requirement: Feature\nThe system SHALL implement the feature.\n\n#### Scenario: Use feature\n- **WHEN** requested\n- **THEN** the feature works\n');
  }
  const finished=await updateJob(root,owned.id,owned.claimToken,'finish','Plan ready');assert.ok(finished.planAfter);
  assert.equal((await getJob(root,owned.id)).questions[0].answer,'A');
  await assert.rejects(requestLifecycle(root,{action:'start-plan',change,message:'overwrite'},options),/already exists/);
 }
 await assert.rejects(requestLifecycle(root,{action:'start-plan',change:'bad',message:'Build',planMode:'anything'},options),/scope/);
 await assert.rejects(requestLifecycle(root,{action:'start-plan',change:'../escape',message:'Build'},options),/kebab/);
 const {job}=await requestLifecycle(root,{action:'start-plan',change:'racing-name',message:'Build'},options);
 await put(root,'openspec/changes/racing-name/proposal.md','# Created elsewhere\n');
 await assert.rejects(claimNext(root,'This session'),/already exists/);assert.equal((await getJob(root,job.id)).status,'failed');
});


test('real creation screens retain their request and open generated documents after completion',async t=>{
 const root=await fixture(t),viewer=await startServer({root,port:0,quiet:true});t.after(()=>viewer.close());
 const get=async url=>readyDocument(viewer.origin+url);
 let document=await get('/?view=studio&new=1');
 assert.ok(document.querySelector('[data-create-spec]'));
 assert.equal(document.querySelector('[name=planMode][value=next]').hasAttribute('checked'),true);
 assert.equal(document.querySelector('[form=studio-create]').textContent.includes('Continue'),true);
 assert.equal(document.querySelector('.change-header'),null,'No unrelated change header before the idea form');
 const csrf=document.querySelector('meta[name=csrf-token]').content;
 const payload={action:'start-plan',change:'fresh-idea',message:'A genuinely new feature',planMode:'next'};
 const post=(url,data,token=csrf)=>fetch(viewer.origin+url,{method:'POST',headers:{Origin:viewer.origin,'X-CSRF-Token':token,Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(data)});
 assert.equal((await post('/api/lifecycle/actions',payload,'bad')).status,403);
 const response=await post('/api/lifecycle/actions',payload);assert.equal(response.status,201);const created=await response.json();
 document=await get(created.url);assert.equal(document.querySelector('#workspace').dataset.change,'');assert.match(document.querySelector('.studio-creation-caption').textContent,/first ready artifact/);
 const owned=await claimNext(root,'This session');
 const question=await askJob(root,owned.id,owned.claimToken,{message:'Which policy should the new feature follow?',options:['First','Second']});
 document=await get(created.url);assert.ok(document.querySelector('[data-studio-question]'));assert.equal(document.querySelector('#studio-composer'),null);assert.match(document.querySelector('.studio-thread').textContent,/Which policy/);
 await post(`/api/lifecycle/jobs/${owned.id}/reply`,{questionId:question.question.id,answer:'First'});
 await put(root,'openspec/changes/fresh-idea/.openspec.yaml','schema: spec-driven\n');
 await put(root,'openspec/changes/fresh-idea/proposal.md','# Fresh generated proposal\n\nThe requested feature.\n');
 await updateJob(root,owned.id,owned.claimToken,'finish','Proposal generated');
 document=await get(created.url);
 assert.equal(document.querySelector('#workspace').dataset.change,'fresh-idea');assert.equal(document.querySelector('#workspace').dataset.creationComplete,'true');
 assert.match(document.querySelector('.studio-document').textContent,/Fresh generated proposal/);
 assert.match(document.querySelector('[data-refresh-url]').dataset.refreshUrl,/created=1/);
 assert.equal(document.querySelector('[name=action][value=plan-next]').parentElement.querySelector('button').disabled,false);
 assert.ok(document.querySelector('.studio-artifact-tab[aria-current=page]'));
 assert.equal(document.querySelector('#studio-document-picker'),null);assert.equal(document.querySelector('.studio-version'),null);assert.equal(document.querySelector('.studio-compare'),null);
 assert.equal((await post('/api/lifecycle/command',{command:'/status',change:'fresh-idea'},'bad')).status,403);
 const status=await post('/api/lifecycle/command',{command:'/status',change:'fresh-idea'});assert.equal(status.status,200);assert.match((await status.json()).summary,/OpenSpec status/);
 assert.equal((await post('/api/lifecycle/command',{command:'/arbitrary-shell',change:'fresh-idea'})).status,400);
 assert.equal((await fetch(viewer.origin+'/assets/session.js')).status,200);
 assert.match(document.querySelector('.studio-thread').textContent,/A genuinely new feature/);
});

test('picker and slash commands share guarded lifecycle operations without a shell',async t=>{
 const {requestCommand,parseCommand,renderCommandPicker}=await import('../src/commands.mjs');
 const root=await fixture(t);await put(root,'openspec/changes/flow/proposal.md','# Proposal\n');
 const getReadiness=async()=>({schema:'custom',artifacts:[{id:'brief',status:'ready'}],artifactPaths:{},planningComplete:false,nextArtifact:'brief',tasks:{done:0,total:2},applyState:'blocked'});
 const options={getReadiness};
 for(const text of ['/status; rm -rf .','/unknown','/opsx:','/new unsafe','/validate arbitrary','/update'])assert.throws(()=>parseCommand(text));
 assert.equal(parseCommand('/opsx:continue').action,'plan-next');assert.equal(parseCommand('/opsx-apply').action,'preview');
 assert.equal(parseCommand('/explore $(do not execute)').message,'$(do not execute)');
 const local=await requestCommand(root,{command:'/status',change:'flow'},options);assert.match(local.summary,/brief: ready/);assert.match(local.summary,/Tasks: 0\/2/);
 await assert.rejects(requestCommand(root,{command:'/apply',change:'flow'},options),/planning/);
 await assert.rejects(requestCommand(root,{command:'/archive',change:'flow'},options),/planning/);
 const queued=await requestCommand(root,{command:'/opsx:continue',change:'flow'},options);assert.equal(queued.job.action,'plan-next');
 await assert.rejects(requestCommand(root,{command:'/explore question',change:'flow'},options),/current workflow/);
 assert.match((await requestCommand(root,{command:'/status',change:'flow'},options)).summary,/OpenSpec status/);
 const {lifecycleState}=await import('../src/lifecycle.mjs');const state=await lifecycleState(root,'flow',options);const html=renderCommandPicker(state);assert.match(html,/Waiting for agent/);assert.match(html,/View request/);assert.doesNotMatch(html,/data-lifecycle-form|data-studio-insert-command/);
 await updateJob(root,queued.job.id,null,'cancel','End test');
});

test('agent reports distinguish unavailable discovery, current connections, expired heartbeats and old sessions',async t=>{
 const {reportSession,sessionEvidence}=await import('../src/agent-session.mjs');const {agentStatus,heartbeat}=await import('../src/jobs.mjs');
 const root=await fixture(t);let status=await agentStatus(root);assert.equal(status.status,'unattached');assert.equal(status.mcps.connectedCount,null);
 await reportSession(root,{agent:'Session',sessionId:'first',mcps:{supported:false,connections:[]}});
 status=await agentStatus(root);assert.equal(status.status,'connected');assert.equal(status.ready,false);assert.equal(status.mcps.supported,false);assert.equal(status.mcps.connectedCount,null);
 await reportSession(root,{agent:'Session',sessionId:'first',mcps:{supported:true,connections:[{name:'<script>GitHub</script>',status:'connected'},{name:'Browser',status:'unavailable'}]}});
 status=await agentStatus(root);assert.equal(status.mcps.connectedCount,1);assert.equal(status.mcps.connections.length,2);
 await heartbeat(root,'Session');assert.equal((await agentStatus(root)).sessionId,'first');
 const old=await sessionEvidence(root,status,Date.now()+300001);assert.equal(old.stale,true);assert.equal(old.connectedCount,null);
 await assert.rejects(reportSession(root,{agent:'Session',mcps:{supported:true,connections:[{name:'MCP',status:'connected',token:'secret'}]}}),/credentials/);
 await assert.rejects(reportSession(root,{mcps:{supported:true,connections:[{name:'Same',status:'connected'},{name:'same',status:'unknown'}]}}),/unique/);
 await put(root,'.spequi/agent.json',JSON.stringify({agent:'Session',sessionId:'first',at:Date.now()-46000}));
 status=await agentStatus(root);assert.equal(status.status,'unresponsive');assert.equal(status.mcps.connectedCount,null);
 await reportSession(root,{agent:'Session',sessionId:'second',mcps:{supported:true,connections:[]}});assert.equal((await agentStatus(root)).mcps.connectedCount,0);
 await put(root,'openspec/changes/flow/proposal.md','# Proposal\n');
 const {enqueue}=await import('../src/jobs.mjs');await enqueue(root,{action:'explore',change:'flow',message:'Check'});const owned=await claimNext(root,'Session');assert.equal(owned.agentSessionId,'second');
 await askJob(root,owned.id,owned.claimToken,{message:'What next?'});assert.equal((await agentStatus(root)).status,'waiting');
 await reportSession(root,{agent:'Session',sessionId:'third',mcps:{supported:false,connections:[]}});assert.equal((await agentStatus(root)).status,'blocked','An old session blocks claiming without masquerading as this session');
 await heartbeat(root,'Session','second');assert.equal((await agentStatus(root)).mcps.connectedCount,null,'An older attachment heartbeat cannot make the new report appear current');
});


test('session reporting CLI and header preserve honest status and escape MCP names',async t=>{
 const root=await fixture(t),exec=promisify(execFile);
 const file=path.join(root,'.spequi/report.json');
 await fs.writeFile(file,JSON.stringify({sessionId:'cli-report',mcps:{supported:true,connections:[{name:'Local files',status:'connected'}]}}));
 const result=await exec(process.execPath,[path.resolve('bin/spequi.mjs'),'agent','report','--file',file,'--name','CLI session','--root',root]);assert.equal(JSON.parse(result.stdout).sessionId,'cli-report');
 const {document,window}=parseHTML('<button id="agent-indicator" data-session-toggle aria-controls="agent-connections" aria-expanded="false"><i></i><span data-session-label></span></button><button id="mcps" class="session-mcp-button" data-session-toggle aria-controls="mcp-connections" aria-expanded="false"><span id="mcp-count"></span></button><aside id="agent-connections" hidden><span data-session-label></span><strong id="session-agent-name"></strong><p id="session-last-seen"></p><section id="session-recovery" hidden><button data-session-refresh>Check connection</button></section><button data-session-close>Close agent</button></aside><aside id="mcp-connections" hidden><p id="mcp-report-summary"></p><ul id="session-mcps"></ul><p id="mcp-report-date"></p><button data-session-close>Close MCPs</button></aside>');
 let active;document.querySelector('#agent-indicator').focus=()=>{active='agent'};
 vm.runInNewContext(await fs.readFile('public/session.js','utf8'),{document,window,fetch:async()=>({ok:true,json:async()=>({status:'live',connected:true,agent:'CLI session',at:Date.now(),mcps:{supported:true,stale:false,reportedAt:Date.now(),connectedCount:1,connections:[{name:'<script>unsafe</script>',status:'connected'}]}})}),setInterval(){}});
 await new Promise(r=>setTimeout(r,0));
 assert.equal(document.querySelector('#agent-indicator').textContent,'CLI session · Ready');assert.equal(document.querySelector('#mcp-count').textContent,'1 MCP');assert.equal(document.querySelector('#session-mcps script'),null);assert.match(document.querySelector('#session-mcps').textContent,/<script>unsafe/);
 document.querySelector('#agent-indicator').click();assert.equal(document.querySelector('#agent-connections').hidden,false);assert.equal(document.querySelector('#mcp-connections').hidden,true);assert.equal(document.querySelector('#mcps').getAttribute('aria-expanded'),'false');
 document.querySelector('#mcps').click();assert.equal(document.querySelector('#agent-connections').hidden,true);assert.equal(document.querySelector('#mcp-connections').hidden,false);assert.equal(document.querySelector('#agent-indicator').getAttribute('aria-expanded'),'false');assert.equal(document.querySelector('#mcps').getAttribute('aria-expanded'),'true');
 const escape=new window.Event('keydown');escape.key='Escape';document.dispatchEvent(escape);assert.equal(document.querySelector('#mcp-connections').hidden,true);
 document.querySelector('#agent-indicator').click();
 document.querySelector('[data-session-close]').click();assert.equal(document.querySelector('#agent-connections').hidden,true);assert.equal(active,'agent');
 const event=new window.Event('agent-status');event.detail={status:'unresponsive',connected:false,at:Date.now()-50000,mcps:{supported:true,stale:true,connectedCount:null,connections:[{name:'Local files',status:'connected'}]}};document.dispatchEvent(event);
 assert.equal(document.querySelector('#mcp-count').textContent,'MCPs');assert.match(document.querySelector('#session-mcps').textContent,/Last: Connected/);assert.equal(document.querySelector('.mcp-service-state').dataset.state,'unknown');
 assert.match(document.querySelector('#agent-indicator').textContent,/Agent offline/);assert.match(document.querySelector('#agent-indicator').getAttribute('title'),/Heartbeat stopped/);assert.match(document.querySelector('#agent-indicator').getAttribute('aria-description'),/same coding session/);assert.equal(document.querySelector('#session-recovery').hidden,false);
 document.querySelector('[data-session-refresh]').click();await new Promise(r=>setTimeout(r,0));assert.equal(document.querySelector('#session-recovery').hidden,true);
 const zero=new window.Event('agent-status');zero.detail={status:'live',connected:true,mcps:{supported:true,stale:false,connectedCount:0,connections:[]}};document.dispatchEvent(zero);assert.equal(document.querySelector('#mcp-count').textContent,'0 MCPs');
 const working=new window.Event('agent-status');working.detail={status:'working',connected:true,agent:'GigaCode CLI',mcps:{supported:false,stale:false,connections:[],connectedCount:null}};document.dispatchEvent(working);assert.equal(document.querySelector('#agent-indicator').textContent,'GigaCode CLI · Working');
 working.detail={...working.detail,status:'unresponsive',connected:false};document.dispatchEvent(working);assert.equal(document.querySelector('#agent-indicator').textContent,'Agent offline');
});

test('slash input routes to the command endpoint while failed drafts remain intact',async()=>{
 const {document,window}=parseHTML('<meta name="csrf-token" content="csrf"><div id="workspace" data-change="flow"><section data-studio><form id="studio-composer" data-lifecycle-form data-studio-composer action="/api/lifecycle/actions"><input name="action" type="hidden" value="revise-plan"><input name="change" type="hidden" value="flow"><input name="intent" type="radio" value="revise-plan" checked><textarea name="message"></textarea><button type="submit">Send</button><div data-lifecycle-feedback></div></form></section></div>');
 let called;
 vm.runInNewContext(await fs.readFile('public/workflow.js','utf8'),{document,window,location:{assign(){}},fetch:async(url,init)=>{called={url,payload:JSON.parse(init.body)};return{ok:false,status:400,json:async()=>({error:'Current planning dependency is missing'})};}});
 const form=document.querySelector('form');form.querySelector('textarea').value='/opsx:apply';form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,0));
 assert.equal(called.url,'/api/lifecycle/command');assert.equal(called.payload.command,'/opsx:apply');assert.equal(called.payload.action,undefined);assert.equal(form.querySelector('textarea').value,'/opsx:apply');assert.match(form.textContent,/planning dependency/);
});

test('footer errors stay inline while queued requests emit one toast without replay', async () => {
 const {document,window}=parseHTML('<meta name="csrf-token" content="csrf"><div id="workspace" data-change="flow"><footer class="studio-footer"><form id="next" data-lifecycle-form action="/api/lifecycle/actions"><input name="action" value="plan-next"><button type="submit">Create design</button><div data-lifecycle-feedback></div></form><div id="studio-action-feedback"></div></footer></div>');
 let fail=true; const toasts=[];
 document.addEventListener('spequi-toast', event=>toasts.push(event.detail));
 vm.runInNewContext(await fs.readFile('public/workflow.js','utf8'),{document,window,location:{assign(){}},fetch:async()=>({ok:!fail,status:fail?400:201,json:async()=>fail?{error:'Refresh readiness and retry.'}:{job:{id:'queued',change:'flow'}}})});
 const submit=async()=>{document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await new Promise(resolve=>setTimeout(resolve,0));};
 await submit();assert.match(document.querySelector('#studio-action-feedback').textContent,/Refresh readiness/);assert.equal(document.querySelector('[data-lifecycle-feedback]').textContent,'');
 fail=false;await submit();assert.equal(document.querySelector('#studio-action-feedback').textContent,'');
 assert.equal(toasts.length,1);assert.match(toasts[0].message,/Queued/);assert.equal(toasts[0].persist,false);
 document.dispatchEvent(new window.Event('htmx:afterSwap'));assert.equal(document.querySelector('#studio-action-feedback').textContent,'');assert.equal(toasts.length,1);
});


test('new-spec submission errors use a toast, retain the idea, and do not replay after refresh', async () => {
 const {document,window}=parseHTML('<meta name="csrf-token" content="csrf"><div id="workspace" data-change=""><section data-studio><form id="studio-create" data-create-spec data-lifecycle-form action="/api/lifecycle/actions"><input type="hidden" name="action" value="start-plan"><input name="change" value="a-new-idea"><textarea name="message">Keep my idea</textarea><button type="submit">Continue</button><div data-lifecycle-feedback></div></form></section></div>');
 const toasts=[];document.addEventListener('spequi-toast', event=>toasts.push(event.detail.message));
 window.spequiSaveDraft=async()=>{};
 vm.runInNewContext(await fs.readFile('public/workflow.js','utf8'),{document,window,location:{assign(){}},fetch:async()=>({ok:false,status:400,json:async()=>({error:'This idea was submitted. Continue from its planning workspace.'})})});
 const form=document.querySelector('form');form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(toasts.length,1);assert.match(toasts[0],/This idea was submitted/);
 assert.equal(form.querySelector('[data-lifecycle-feedback]').textContent,'');assert.equal(form.dataset.draftSubmitting,undefined);
 assert.equal(form.querySelector('textarea').value,'Keep my idea');
 document.dispatchEvent(new window.Event('htmx:afterSwap'));assert.equal(toasts.length,1);assert.equal(form.querySelector('[data-lifecycle-feedback]').textContent,'');
});
