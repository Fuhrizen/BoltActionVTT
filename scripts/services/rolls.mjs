import {ask} from '../applications/dialogs.mjs';
import {shootingTarget,resolveHits} from '../rules/index.mjs';
import {squadLineOfSight} from './line-of-sight.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const values=c=>c?.contents??Array.from(c??[]);
const isLoader=model=>model.system?.isLoader||model.system?.role==='loader';
/** Read-only macro preview. Pass LOS results to constrain quantities to deployed visible models. */
export function shootingPlan(actor,{lineOfSight}={}){
 if(!actor?.isOwner||actor.pack||actor.type!=='unit')throw new Error('Choose an owned world squad; shooting is resolved at squad level.');
 const models=values(actor.members).filter(m=>m.visible!==false&&!m.system.dead&&m.isOwner&&m.system.unitUuid===actor.uuid);
 const eligible=lineOfSight?new Set(lineOfSight.filter(row=>row.eligible??(row.visible&&!row.blocked)).map(row=>row.modelUuid)):null;
 const groups=new Map();
 for(const model of models){if(eligible&&!eligible.has(model.uuid))continue;
  for(const weapon of values(model.items).filter(i=>i.type==='weapon')){
   const p=weapon.system??{},quantity=Number(p.quantity)||1;
   const key=JSON.stringify([p.slug||weapon.name,p.range,p.shots,p.shotsFormula,p.penetration,[...(p.traits??[])].sort()]);
   const row=groups.get(key)??{weapon,quantity:0,defaultCount:0,models:[],team:(p.traits??[]).includes('team')||['lmg','mmg','hmg'].includes(p.slug)};
   row.quantity+=quantity;row.defaultCount+=isLoader(model)?0:quantity;row.models.push({uuid:model.uuid,name:model.name,quantity});groups.set(key,row);
  }
 }
 return {actor,rows:[...groups.values()],loaders:models.filter(isLoader).length,quality:actor.system.quality||'regular',pins:actor.system.pins??0,lineOfSight:lineOfSight??null};
}
export function validateFiringSelection(plan,input){
 const rows=plan.rows.map((row,i)=>{const count=Number(input['count'+i]),shots=Number(input['shots'+i]);if(!Number.isInteger(count)||count<0||count>row.quantity||!Number.isInteger(shots)||shots<1||shots>200)throw new Error('Invalid firing quantities.');return {...row,count,shots,loaderAvailable:Boolean(input['loader'+i])};}).filter(row=>row.count);
 if(!rows.length)throw new Error('Select at least one firing weapon.');
 if(rows.reduce((n,r)=>n+r.count*r.shots,0)>1000)throw new Error('Limit a single roll to 1000 dice.');
 for(const key of ['range','pins','extraModifier'])if(!Number.isFinite(Number(input[key])))throw new Error('Invalid shooting modifier.');
 if(Number(input.range)<0||!Number.isInteger(Number(input.pins))||Number(input.pins)<0||Number(input.pins)>100||Math.abs(Number(input.extraModifier))>100)throw new Error('Shooting modifiers are outside supported bounds.');
 if(!['none','soft','hard'].includes(input.cover))throw new Error('Choose valid target cover.');
 return rows;
}
export function shootingTargets(squad,canvas=globalThis.canvas){
 if(!canvas?.ready||!canvas.scene)throw new Error('Open a scene before firing.');
 const armyUuid=squad.system.armyUuid;
 return values(canvas.tokens?.placeables).filter(token=>token.visible!==false&&!token.destroyed&&token.actor?.visible!==false&&token.actor&&!token.actor.system?.dead&&token.document?.parent===canvas.scene
  &&token.actor.uuid!==squad.uuid&&token.actor.system?.unitUuid!==squad.uuid
  &&(!armyUuid||!token.actor.unit?.system?.armyUuid||token.actor.unit.system.armyUuid!==armyUuid));
}
const modifierLabels={pointBlank:'Point blank',pins:'Pins',longRange:'Long range',inexperienced:'Inexperienced',moved:'Movement',down:'Target Down',smallTeam:'Small team',cover:'Cover',extra:'Other / loader'};
const signed=n=>n>0?'+'+n:String(n);
function chatCard(actor,target,plan,input,results){
 const hits=results.reduce((n,r)=>n+r.hits,0),dice=results.reduce((n,r)=>n+r.count*r.shots,0);
 return `<section class="boltaction-roll-card" style="border:1px solid var(--color-border-light-primary,#7776);border-radius:6px;overflow:hidden;"><header style="padding:10px;border-bottom:1px solid #7776;"><small>CONFIRMED SQUAD SHOOTING</small><h3 style="font-size:1.15rem;margin:4px 0;">${esc(actor.name)}</h3><div>Target: <strong>${esc(target.name||target.actor.name)}</strong></div></header><div style="padding:10px;"><div style="display:flex;justify-content:space-between;gap:8px;"><strong>${hits} hits</strong><span>${dice} attack dice</span></div><p>Range ${esc(input.range)}″ · ${esc(plan.quality)} · ${esc(input.pins)} pins · ${esc(input.cover)} cover</p>${results.map(r=>`<article style="padding:8px 0;border-top:1px solid #7775;"><strong>${esc(r.name)}</strong> <span>${r.count} weapons × ${r.shots} shots</span><div><b>${r.hits} hits</b> · ${esc(r.note||(r.sixSix?'6 then 6':r.target+'+ to hit'))}</div>${r.modifiers?`<ul style="margin:4px 0;padding-left:18px;">${Object.entries(r.modifiers).filter(([,v])=>v!==0).map(([key,value])=>`<li>${esc(modifierLabels[key]||key)}: ${signed(value)}</li>`).join('')||'<li>No hit modifiers</li>'}</ul>`:''}<small>Dice: ${r.dice?.join(', ')||'not rolled'}${r.followupDice?.length?'; follow-ups: '+r.followupDice.join(', '):''}</small></article>`).join('')}<footer style="border-top:1px solid #7776;padding-top:8px;"><small>Wall LOS checked before rolling. Firing counts and modifiers confirmed by the player. Special weapon effects, damage, pins and casualties are not applied.</small></footer></div></section>`;
}
/** All macro and sheet calls confirm a scene target and situational inputs before rolling. */
export async function confirmShooting(actorOrUuid){
 const actor=typeof actorOrUuid==='string'?await fromUuid(actorOrUuid):actorOrUuid;
 shootingPlan(actor);
 const candidates=shootingTargets(actor);
 if(!candidates.length)throw new Error('There are no visible enemy model tokens to target in this scene.');
 const targeted=new Set(values(game.user?.targets));
 const preferred=candidates.find(token=>targeted.has(token))??candidates[0];
 const chosen=await ask('Choose shooting target',[{name:'targetId',label:'Scene target',selected:preferred.id,options:candidates.map(token=>({value:token.id,label:token.name||token.actor.name}))}],'Firing requires a deployed squad model with an unobstructed sight line to the selected scene token.');
 if(!chosen)return null;
 const target=shootingTargets(actor).find(token=>token.id===chosen.targetId);
 if(!target)throw new Error('The selected target is no longer available.');
 const los=squadLineOfSight(actor,target),plan=shootingPlan(actor,{lineOfSight:los});
 if(!plan.rows.length)throw new Error('No deployed armed squad models have line of sight to that target.');
 const blocked=los.filter(row=>!(row.eligible??(row.visible&&!row.blocked))).length;
 const fields=[{name:'range',label:'Measured range (inches)',type:'number',value:12},{name:'pins',label:'Squad pins',type:'number',value:plan.pins},{name:'cover',label:'Target cover',options:['none','soft','hard']},{name:'moved',label:'Squad moved',type:'checkbox'},{name:'targetDown',label:'Target is Down',type:'checkbox'},{name:'smallTeam',label:'Target is a small team',type:'checkbox'},{name:'extraModifier',label:'Other buffs (+) / debuffs (−), including traits',type:'number',value:0}];
 plan.rows.forEach((row,i)=>{fields.push({name:'count'+i,label:`${row.weapon.name} — firing weapons with LOS (0–${row.quantity})`,type:'number',value:row.defaultCount},{name:'shots'+i,label:`${row.weapon.name}: shots per weapon (confirm variable shots and special rules)`,type:'number',value:Number(row.weapon.system.shots)||1});if(row.team)fields.push({name:'loader'+i,label:`${row.weapon.name}: loader available and in position (${plan.loaders} marked loaders)`,type:'checkbox',checked:plan.loaders>0});});
 const input=await ask('Confirm squad shooting',fields,`${blocked} models excluded by deployment or LOS. Confirm which eligible weapons can fire, measured range, loaders, cover and all trait modifiers. Missing team-weapon loaders apply −1 to hit. Special weapon effects and damage require manual resolution. Cancel makes no rolls.`);
 if(!input)return null;
 const rows=validateFiringSelection(plan,input);
 // Scene changes during a dialog cannot silently permit fire through a newly blocked line.
 const currentTarget=shootingTargets(actor).find(token=>token===target);
 if(!currentTarget)throw new Error('The target changed or is no longer available; confirm shooting again.');
 const current=shootingPlan(actor,{lineOfSight:squadLineOfSight(actor,target)});
 for(const row of rows){const live=current.rows.find(candidate=>candidate.weapon===row.weapon||candidate.weapon.uuid&&candidate.weapon.uuid===row.weapon.uuid);if(!live||row.count>live.quantity)throw new Error('Eligible firing models changed; confirm shooting again.');}
 const prepared=rows.map(row=>{const options={quality:plan.quality,range:Number(input.range),weaponRange:row.weapon.system.range,pins:Number(input.pins),moved:input.moved,targetDown:input.targetDown,smallTeam:input.smallTeam,cover:input.cover,extraModifier:Number(input.extraModifier)-(row.team&&!row.loaderAvailable?1:0),assault:(row.weapon.system.traits??[]).includes('assault')};return {row,options,target:shootingTarget(options)};});
 const rolls=[],results=[];
 for(const {row,options,target:hit} of prepared){if(!hit.inRange){results.push({name:row.weapon.name,hits:0,note:'Out of range',count:row.count,shots:row.shots,dice:[],followupDice:[]});continue;}
  const roll=await new Roll(`${row.count*row.shots}d6`).evaluate();rolls.push(roll);const dice=roll.dice.flatMap(d=>d.results.filter(r=>r.active!==false).map(r=>r.result));let followupDice=[];
  if(hit.sixSix&&dice.includes(6)){const followup=await new Roll(`${dice.filter(v=>v===6).length}d6`).evaluate();rolls.push(followup);followupDice=followup.dice.flatMap(d=>d.results.map(r=>r.result));}
  results.push({name:row.weapon.name,...resolveHits({...options,dice,followupDice}),count:row.count,shots:row.shots,dice,followupDice});
 }
 await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),rolls,content:chatCard(actor,target,plan,input,results),flags:{boltaction:{kind:'shooting',apiVersion:1,actorUuid:actor.uuid,targetTokenUuid:target.document.uuid,targetActorUuid:target.actor.uuid,confirmed:input,results}}});
 return {actorUuid:actor.uuid,targetTokenUuid:target.document.uuid,results};
}
