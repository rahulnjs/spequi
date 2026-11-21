import {requestLifecycle} from './lifecycle.mjs';

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
  if(!definition)throw new Error('Unknown command. Open Workflow to choose a supported OpenSpec action.');
  const message=(match[2]||'').trim();
  if(message.length>12000)throw new Error('Command instructions must be under 12,000 characters');
  if(definition.input&&!message)throw new Error(`Add a ${definition.name==='explore'?'question':'revision'} after /${definition.name}.`);
  if(['new','status','validate'].includes(definition.name)&&message)throw new Error(`/${definition.name} does not accept arguments. Use the new-spec form to describe a new idea.`);
  return {...definition,message};
}
export async function requestCommand(root,{command,change='',requestKey,confirmBranch,attachments},options={}){
  const item=parseCommand(command);
  if(item.action==='new')return {url:'/?view=studio&new=1'};
  const result=await requestLifecycle(root,{action:item.action,change,message:item.message,requestKey,confirmBranch,attachments},options);
  if(item.name==='status'){
    if(result.error)throw new Error(result.error);
    const ready=result.readiness;
    return {...result,summary:`OpenSpec status · ${change}\nSchema: ${ready.schema}\n${ready.artifacts.map(artifact=>`${artifact.id}: ${artifact.status}`).join('\n')}\nTasks: ${ready.tasks.done}/${ready.tasks.total}\nNext: ${ready.nextArtifact||'Review the plan'}`};
  }
  return result;
}
