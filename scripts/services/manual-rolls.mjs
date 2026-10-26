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
 return `<section class="ba-manual-roll"><header><strong>${esc(result.label)}</strong>${actor?.name?`<small>${esc(actor.name)}</small>`:''}</header><div class="ba-manual-result"><b>${result.successes===null?`${result.modifier?result.modifiedTotal:result.total}${result.modifier?' modified':''} total`:`${result.successes} / ${result.count} successes`}</b><span>${result.count}D6${result.target===null?(result.modifier?` · ${modifier} each`:''):` · each die ${modifier} ≥ ${result.target}`}</span></div><details><summary>Inspect dice</summary>${diceAudit('D6 results',result.dice,result.results)}<p>Raw total: ${result.total}${result.modifier?` · Modifier per die: ${modifier} · Modified total: ${result.modifiedTotal}`:''}.</p><small>Manual roll: no range, cover, traits, automatic successes or other rules applied.</small></details></section>`;
}
export async function genericRoll(actor,input={}) {
 if(actor&&(actor.pack||actor.isOwner===false))throw new Error('Choose an owned actor or roll without an actor.');
 const confirmed=manualRollInput(input),roll=await new Roll(`${confirmed.count}d6`).evaluate();
 const dice=roll.dice.flatMap(d=>d.results.filter(r=>r.active!==false).map(r=>r.result));
 const result=resolveManualPool(dice,confirmed);
 await ChatMessage.create({speaker:ChatMessage.getSpeaker(actor?{actor}:{}),rolls:[roll],content:manualRollCard(actor,result),flags:{boltaction:{kind:'manual',apiVersion:1,actorUuid:actor?.uuid??null,confirmed,result}}});
 return result;
}
export async function confirmManualRoll(actor) {
 const content=`<div class="ba-manual-dialog"><label>Roll label<input name="label" value="Dice roll" maxlength="120"></label><label>Number of D6<input name="count" type="number" min="1" max="200" step="1" value="1"></label><label>Success threshold ≥<input name="target" type="number" step="1" placeholder="Optional"></label><label>Modifier to each die<input name="modifier" type="number" min="-100" max="100" step="1" value="0"></label><small>Choose the dice and modifiers yourself. Leave the threshold blank to show dice and their total. This roll does not spend an action or apply damage.</small></div>`;
 const input=await foundry.applications.api.DialogV2.wait({window:{title:'Roll dice'},position:{width:420},content,buttons:[{action:'roll',label:'Roll',default:true,callback:(_event,_button,dialog)=>Object.fromEntries(['label','count','target','modifier'].map(name=>[name,dialog.element.querySelector(`[name="${name}"]`).value]))},{action:'cancel',label:'Cancel',callback:()=>null}],rejectClose:false});
 return input?genericRoll(actor,input):null;
}
