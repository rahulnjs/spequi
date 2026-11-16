import {requestLifecycle,lifecycleState} from './lifecycle.mjs';
import {escape as e} from './specs.mjs';

export const commands = [
  {name:'new',label:'New spec',description:'Describe an idea and create a planning change',action:'new'},
  {name:'explore',label:'Explore',description:'Investigate without editing',action:'explore',input:true},
  {name:'continue',label:'Create next artifact',description:'Generate only the next ready planning artifact',action:'plan-next'},
  {name:'propose',label:'Generate full plan',description:'Complete the required planning artifacts',action:'propose'},
  {name:'update',label:'Revise spec',description:'Request a change to the plan',action:'revise-plan',input:true},
  {name:'apply',label:'Preview implementation',description:'Generate code in an isolated copy; applying is separate',action:'preview'},
  {name:'status',label:'Check status',description:'Read current readiness with the local CLI',action:'refresh'},
  {name:'validate',label:'Validate spec',description:'Run strict local specification validation',action:'validate'},
  {name:'verify',label:'Verify implementation',description:'Check the implementation against the plan',action:'verify'},
  {name:'sync',label:'Sync specs',description:'Update main specs and keep this change active',action:'sync-specs'},
  {name:'archive',label:'Archive change',description:'Finish with the existing workflow checks',action:'archive'}
];
export function parseCommand(value){
  if(typeof value!=='string'||value.length>12500)throw new Error('Enter a supported slash command under 12,500 characters');
  const match=value.trim().match(/^\/(?:(?:opsx:|opsx-))?([a-z][a-z-]*)(?:[ \t]+([\s\S]*))?$/);
  const definition=match&&commands.find(item=>item.name===match[1]);
  if(!definition)throw new Error('Unknown command. Open Commands to choose a supported OpenSpec action.');
  const message=(match[2]||'').trim();
  if(message.length>12000)throw new Error('Command instructions must be under 12,000 characters');
  if(definition.input&&!message)throw new Error(`Add a ${definition.name==='explore'?'question':'revision'} after /${definition.name}.`);
  if(['new','status','validate'].includes(definition.name)&&message)throw new Error(`/${definition.name} does not accept arguments. Use the new-spec form to describe a new idea.`);
  return {...definition,message};
}
export async function requestCommand(root,{command,change='',requestKey,confirmBranch},options={}){
  const item=parseCommand(command);
  if(item.action==='new')return {url:'/?view=studio&new=1'};
  const result=await requestLifecycle(root,{action:item.action,change,message:item.message,requestKey,confirmBranch},options);
  if(item.name==='status'){
    if(result.error)throw new Error(result.error);
    const ready=result.readiness;
    return {...result,summary:`OpenSpec status · ${change}\nSchema: ${ready.schema}\n${ready.artifacts.map(artifact=>`${artifact.id}: ${artifact.status}`).join('\n')}\nTasks: ${ready.tasks.done}/${ready.tasks.total}\nNext: ${ready.nextArtifact||'Review the plan'}`};
  }
  return result;
}
export function renderCommandPicker(state,{icon=()=>'',planningOnly=false}={}){
  const change=state.selected.id;
  const jobs=state.jobs||[];
  const completed=jobs.filter(job=>job.status==='completed').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  const planAt=completed.find(job=>['start-plan','plan-next','propose','revise-plan','update-specs'].includes(job.action))?.updatedAt||'';
  const baseline=[planAt,state.result?.appliedAt||''].sort().at(-1);
  const finished=action=>completed.some(job=>job.action===action&&job.updatedAt>=baseline);
  let next=null,notice='';
  if(state.selected.archived)notice='This change is archived.';
  else if(state.pending)notice=state.pending.status==='awaiting-input'?'Answer the current question to continue.':'Waiting for the current request to finish.';
  else if(state.error||!state.readiness)next='status';
  else if(!state.readiness.planningComplete)next=state.readiness.nextArtifact?'continue':'propose';
  else if(planningOnly)notice='The plan is ready. Finish planning to open Review.';
  else if(state.actions.apply?.enabled)notice='Review and apply the file diff to continue.';
  else if((!state.result||state.previewStale||!state.result.changes.length||state.result.unsupported.length)&&state.actions.preview?.enabled)next='apply';
  else if(!state.validation||state.validation.stale)next='validate';
  else if(!state.validation.valid)next='update';
  else if(!finished('verify'))next='verify';
  else if(state.actions['sync-specs']?.enabled&&!finished('sync-specs'))next='sync';
  else next='archive';
  const item=commands.find(command=>command.name===next&&state.actions[command.action]?.enabled);
  const label=item?`${icon('arrow')}<span class="studio-command-copy"><strong>${e(item.label)}</strong><small>${e(item.description)}</small></span><span class="studio-command-shortcut">/${item.name}</span>`:'';
  const action=item?item.input?`<button type="button" data-studio-insert-command="/${item.name} " data-dropdown-choice>${label}</button>`:`<form data-lifecycle-form id="studio-command-${item.name}" action="/api/lifecycle/command" method="post"><input type="hidden" name="change" value="${e(change)}"><input type="hidden" name="command" value="/${item.name}"><button type="submit">${label}</button><div data-lifecycle-feedback role="status" aria-live="polite"></div></form>`:'';
  const history=new Map();
  for(const job of completed){
    const action=['start-plan','create-change'].includes(job.action)?'new':job.action==='update-specs'?'revise-plan':job.action;
    const command=commands.find(item=>item.action===action);
    if(command&&!history.has(command.name))history.set(command.name,command);
  }
  if(state.validation)history.set('validate',commands.find(item=>item.name==='validate'));
  const previous=[...history.values()].map(command=>`<div class="studio-command-history">${icon('check')}<strong>${e(command.label)}</strong><span class="studio-command-shortcut">/${command.name}</span></div>`).join('');
  const title=state.pending?({'awaiting-input':'Your reply is needed',queued:'Waiting for agent',running:'Request in progress'}[state.pending.status]||'Request in progress'):state.selected.archived?'Change archived':'No command available';
  const context=state.pending?`<button type="button" class="studio-command-context" data-studio-conversation-jump data-dropdown-choice>${state.pending.status==='awaiting-input'?'Reply to agent':'View request'}${icon('arrow')}</button>`:state.actions.apply?.enabled?`<a class="studio-command-context" href="/?change=${encodeURIComponent(change)}&amp;view=preview" hx-get="/?change=${encodeURIComponent(change)}&amp;view=preview" hx-target="#workspace" hx-swap="outerHTML" hx-push-url="true" data-dropdown-choice>Review file diff${icon('arrow')}</a>`:'';
  const waiting=`<div class="studio-command-status">${icon(state.pending?.status==='awaiting-input'?'comment':state.selected.archived?'check':'clock')}<div><strong>${e(title)}</strong><p>${e(notice||'Continue the workflow to see the next command.')}</p>${context}</div></div>`;
  return `<div class="studio-commands" id="studio-command-picker"><button type="button" popovertarget="studio-command-menu" aria-controls="studio-command-menu" aria-expanded="false">Commands<kbd>/</kbd>${icon('down')}</button><div class="studio-command-menu" id="studio-command-menu" popover="auto" data-dropdown-panel data-dropdown-width="320" aria-label="Commands">${action?`<header><strong>Next step</strong></header>${action}`:waiting}${previous?`<section class="studio-command-completed"><header><strong>Previously run</strong><span>${history.size}</span></header>${previous}</section>`:''}</div></div>`;
}
