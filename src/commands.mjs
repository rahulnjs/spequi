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
export async function requestCommand(root,{command,change='',requestKey},options={}){
  const item=parseCommand(command);
  if(item.action==='new')return {url:'/?view=studio&new=1'};
  const result=await requestLifecycle(root,{action:item.action,change,message:item.message,requestKey},options);
  if(item.name==='status'){
    if(result.error)throw new Error(result.error);
    const ready=result.readiness;
    return {...result,summary:`OpenSpec status · ${change}\nSchema: ${ready.schema}\n${ready.artifacts.map(artifact=>`${artifact.id}: ${artifact.status}`).join('\n')}\nTasks: ${ready.tasks.done}/${ready.tasks.total}\nNext: ${ready.nextArtifact||'Review the plan'}`};
  }
  return result;
}
export function renderCommandPicker(state){
  const change=state.selected.id;
  return `<details class="studio-commands" id="studio-command-picker"><summary>Commands <span aria-hidden="true">/</span></summary><div class="studio-command-menu"><p>OpenSpec lifecycle</p>${commands.map(item=>{
    const option=item.action==='new'||item.action==='refresh'?{enabled:true}:state.actions[item.action];
    const enabled=Boolean(option?.enabled),reason=option?.reason||'';
    const label=`<span><strong>${e(item.label)}</strong><small>${e(reason||item.description)}</small></span><span class="studio-command-shortcut">/${item.name}</span>`;
    if(item.action==='new')return `<a href="/?view=studio&amp;new=1" hx-get="/?view=studio&amp;new=1" hx-target="#workspace" hx-swap="outerHTML" hx-push-url="true">${label}</a>`;
    if(item.input)return `<button type="button" data-studio-insert-command="/${item.name} " ${enabled?'':'disabled'} ${reason?`title="${e(reason)}"`:''}>${label}</button>`;
    return `<form data-lifecycle-form id="studio-command-${item.name}" action="/api/lifecycle/command" method="post"><input type="hidden" name="change" value="${e(change)}"><input type="hidden" name="command" value="/${item.name}"><button type="submit" ${enabled?'':'disabled'}>${label}</button><div data-lifecycle-feedback role="status" aria-live="polite"></div></form>`;
  }).join('')}</div></details>`;
}
