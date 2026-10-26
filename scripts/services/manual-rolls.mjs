import {escapeCard as esc,diceAudit} from './chat-cards.mjs';

/** A deliberately rules-neutral dice pool. Modifiers affect each die independently. */
export function manualRollInput(input={}) {
 const count=Number(input.count??1),modifier=Number(input.modifier??0);
 const target=input.target===undefined||input.target===null||String(input.target).trim()===''?null:Number(input.target);
 if(!Number.isInteger(count)||count<1||count>200)throw new Error('Choose between 1 and 200 dice.');
 if(!Number.isInteger(modifier)||Math.abs(modifier)>100)throw new Error('Use a whole-number modifier between −100 and +100.');
 if(target!==null&&(!Number.isInteger(target)||Math.abs(target)>200))throw new Error('Use a whole-number success threshold between −200 and +200, or leave it blank.');
 return {count,modifier,target,label:String(input.label??'Dice roll').trim().slice(0,120)||'Dice roll'};
}
export function resolveManualPool(dice,input={}) {
 const confirmed=manualRollInput(input);
 if(dice.length!==confirmed.count||dice.some(d=>!Number.isInteger(d)||d<1||d>6))throw new Error('Supply one D6 result per die.');
 const modified=dice.map(d=>d+confirmed.modifier),results=confirmed.target===null?null:modified.map(d=>d>=confirmed.target);
 return {...confirmed,dice:[...dice],modified,total:dice.reduce((a,b)=>a+b,0),modifiedTotal:modified.reduce((a,b)=>a+b,0),results,successes:results?.filter(Boolean).length??null};
}
export function manualRollCard(actor,result) {
 const modifier=result.modifier>0?`+${result.modifier}`:String(result.modifier);
 return `<section class="ba-manual-roll">${actor?.name?`<header><strong>${esc(actor.name)}</strong></header>`:''}<div class="ba-manual-result"><b>${result.successes===null?`${result.modifier?result.modifiedTotal:result.total}${result.modifier?' modified':''} total`:`${result.successes} / ${result.count} successes`}</b><span>${result.count}D6${result.target===null?(result.modifier?` · ${modifier} each`:''):` · each die ${modifier} ≥ ${result.target}`}</span></div><details><summary>Inspect dice</summary>${diceAudit('D6 results',result.dice,result.results)}<p>Raw total: ${result.total}${result.modifier?` · Modifier per die: ${modifier} · Modified total: ${result.modifiedTotal}`:''}.</p><small>Manual roll: no range, cover, traits, automatic successes or other rules applied.</small></details></section>`;
}
export async function genericRoll(actor,input={}) {
 if(actor&&(actor.pack||actor.isOwner===false))throw new Error('Choose an owned actor or roll without an actor.');
 const confirmed=manualRollInput(input),roll=await new Roll(`${confirmed.count}d6`).evaluate();
 const dice=roll.dice.flatMap(d=>d.results.filter(r=>r.active!==false).map(r=>r.result));
 const result=resolveManualPool(dice,confirmed);
 await ChatMessage.create({speaker:ChatMessage.getSpeaker(actor?{actor}:{}),rolls:[roll],content:manualRollCard(actor,result),flags:{boltaction:{kind:'manual',apiVersion:1,actorUuid:actor?.uuid??null,confirmed,result}}});
 return result;
}
const values=value=>value?.contents??Array.from(value??[]);
/** Profile defaults only. Players choose firing models, shots and all rule adjustments. */
export function squadShotOptions(actor){
 if(actor?.type!=='unit')return [];
 const groups=new Map();
 for(const model of values(actor.members)){
  if(model.visible===false||model.isOwner===false||model.system?.dead||model.system?.isLoader||model.system?.role==='loader')continue;
  if(actor.uuid&&model.system?.unitUuid!==actor.uuid)continue;
  for(const weapon of values(model.items).filter(i=>i.type==='weapon')){
   const shots=Number(weapon.system?.shots),quantity=Number(weapon.system?.quantity??1);
   if(!Number.isInteger(quantity)||quantity<1)continue;
   const variable=!Number.isInteger(shots)||shots<1||Boolean(weapon.system?.shotsFormula);
   const baseShots=variable?1:shots,key=JSON.stringify([weapon.system?.slug||weapon.name,weapon.name,baseShots,variable]);
   const row=groups.get(key)??{name:weapon.name||'Weapon',count:0,shots:baseShots,variable};
   row.count+=quantity;groups.set(key,row);
  }
 }
 return [...groups.values()].map((row,index)=>({...row,id:index}));
}
export function selectedShotCount(rows){
 let total=0;
 for(const row of rows){if(!row.enabled)continue;const count=Number(row.count),shots=Number(row.shots);
  if(!Number.isInteger(count)||count<0||count>200||!Number.isInteger(shots)||shots<1||shots>200)throw new Error('Use whole numbers for firing weapons (0–200) and shots (1–200).');
  total+=count*shots;
 }
 return total;
}
function readShotRows(root,options){return options.map(row=>({...row,enabled:root.querySelector(`[name="weapon${row.id}"]`).checked,count:Number(root.querySelector(`[name="weapons${row.id}"]`).value),shots:Number(root.querySelector(`[name="shots${row.id}"]`).value)}));}
export function bindManualShotControls(root,options){
 const assistant=root.querySelector('[name="assist"]'),count=root.querySelector('[name="count"]');
 const update=()=>{
  if(!assistant)return;count.readOnly=assistant.checked;
  for(const input of root.querySelectorAll('[data-shot-control]'))input.disabled=!assistant.checked;
  if(assistant.checked){try{count.value=selectedShotCount(readShotRows(root,options));}catch{/* Preserve edited partial number until confirmation. */}}
 };
 root.querySelector('.ba-manual-dialog')?.addEventListener('input',update);update();
}
export async function confirmManualRoll(actor) {
 const options=squadShotOptions(actor),defaultCount=options.length?selectedShotCount(options.map(r=>({...r,enabled:true}))):1;
 const content=`<div class="ba-manual-dialog">${options.length?`<section class="ba-shot-assistant"><label class="ba-shot-toggle"><input name="assist" type="checkbox" checked> Use squad weapons to count dice</label><div class="ba-shot-list"><div class="ba-shot-heading"><span>Fire weapon</span><span>Weapons</span><span>Shots each</span></div>${options.map(row=>`<div class="ba-shot-row"><label class="ba-shot-toggle"><input name="weapon${row.id}" type="checkbox" data-shot-control checked><span>${esc(row.name)}${row.variable?'<small>Variable shots: confirm count</small>':''}</span></label><input name="weapons${row.id}" aria-label="${esc(row.name)} firing weapons" type="number" min="0" max="200" step="1" value="${row.count}" data-shot-control><input name="shots${row.id}" aria-label="${esc(row.name)} shots each" type="number" min="1" max="200" step="1" value="${row.shots}" data-shot-control></div>`).join('')}</div><small>Exclude weapons or reduce quantities for positioning, loaders or other restrictions. Profile shots are suggestions; apply special rules yourself.</small></section>`:''}<label>Number of D6<input name="count" type="number" min="1" max="200" step="1" value="${defaultCount}" ${options.length?'readonly':''}></label><label>Success threshold ≥<input name="target" type="number" step="1" placeholder="Optional"></label><label>Modifier to each die<input name="modifier" type="number" min="-100" max="100" step="1" value="0"></label><small>Leave the threshold blank for dice and total. No LOS, actions or damage applied.</small></div>`;
 const input=await foundry.applications.api.DialogV2.wait({window:{title:'Roll dice'},position:{width:500},content,render:(_event,dialog)=>bindManualShotControls(dialog.element,options),buttons:[{action:'roll',label:'Roll',default:true,callback:(_event,_button,dialog)=>{
  const root=dialog.element,data=Object.fromEntries(['count','target','modifier'].map(name=>[name,root.querySelector(`[name="${name}"]`).value]));
  if(root.querySelector('[name="assist"]')?.checked)data.count=selectedShotCount(readShotRows(root,options));
  return manualRollInput(data);
 }},{action:'cancel',label:'Cancel',callback:()=>null}],rejectClose:false});
 return input?genericRoll(actor,input):null;
}
