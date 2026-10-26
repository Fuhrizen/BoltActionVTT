import {assertCanAttack,reserveAttack,releaseAttack,recordAttack,applyAttackResults,applyVehicleResults} from './actions.mjs';
import {ask} from '../applications/dialogs.mjs';
import {shootingTarget,resolveHits,infantryDamage,armourPenetration,vehicleDamage,vehiclePin,turretJam,moraleTest} from '../rules/index.mjs';
import {profiles} from './group-profiles.mjs';
import {resolveTraitModifiers} from '../rules/traits.mjs';
import {squadLineOfSight} from './line-of-sight.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const values=c=>c?.contents??Array.from(c??[]);
const isLoader=model=>model.system?.isLoader||model.system?.role==='loader'||model.system?.role==='crew'&&!values(model.items).some(item=>item.type==='weapon');
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
   const row=groups.get(key)??{key,weapon,quantity:0,defaultCount:0,models:[],team:model.type!=='modelVehicle'&&((p.traits??[]).includes('team')||['lmg','mmg','hmg'].includes(p.slug))};
   row.quantity+=quantity;row.defaultCount+=isLoader(model)?0:quantity;row.models.push({uuid:model.uuid,name:model.name,quantity});groups.set(key,row);
  }
 }
 return {actor,rows:[...groups.values()],loaders:models.filter(isLoader).length,quality:actor.system.quality||'regular',pins:actor.system.pins??0,lineOfSight:lineOfSight??null};
}
export function validateFiringSelection(plan,input){
 const rows=plan.rows.map((row,i)=>{const count=Number(input['count'+i]),shots=Number(input['shots'+i]);if(!Number.isInteger(count)||count<0||count>row.quantity||!Number.isInteger(shots)||shots<1||shots>200)throw new Error('Invalid firing quantities.');let loaded=input['loaders'+i]===undefined?(input['loader'+i]?count:0):Number(input['loaders'+i]);if(!Number.isInteger(loaded)||loaded<0||loaded>row.quantity)throw new Error('Invalid loader allocation.');loaded=Math.min(loaded,count);return {...row,count,shots,loadedCount:loaded,mode:input['mode'+i]??((row.weapon.system.traits??[]).some(t=>['howitzer','indirect','indirect-fire','flamethrower'].includes(t))?'special':'direct'),loaderAvailable:loaded===count};}).filter(row=>row.count);
 if(!rows.length)throw new Error('Select at least one firing weapon.');
 if(rows.reduce((n,r)=>n+r.count*r.shots,0)>1000)throw new Error('Limit a single roll to 1000 dice.');
 for(const key of ['range','pins','extraModifier'])if(!Number.isFinite(Number(input[key])))throw new Error('Invalid shooting modifier.');
 if(Number(input.range)<0||!Number.isInteger(Number(input.pins))||Number(input.pins)<0||Number(input.pins)>100||Math.abs(Number(input.extraModifier))>100)throw new Error('Shooting modifiers are outside supported bounds.');
 if(input.penetrationModifier!==undefined&&(!Number.isInteger(Number(input.penetrationModifier))||Math.abs(Number(input.penetrationModifier))>20))throw new Error('Invalid penetration modifier.');
 if(!['none','soft','hard'].includes(input.cover))throw new Error('Choose valid target cover.');
 return rows;
}
export function shootingTargets(squad,canvas=globalThis.canvas){
 if(!canvas?.ready||!canvas.scene)throw new Error('Open a scene before firing.');
 const targeted=new Set(values(globalThis.game?.user?.targets));
 return values(canvas.tokens?.placeables).filter(token=>targeted.has(token)&&token.visible!==false&&!token.destroyed&&token.actor?.visible!==false&&token.actor&&!token.actor.system?.dead&&token.document?.parent===canvas.scene
  &&token.actor.uuid!==squad.uuid&&token.actor.system?.unitUuid!==squad.uuid);
}
const modifierLabels={pointBlank:'Point blank',pins:'Pins',longRange:'Long range',inexperienced:'Inexperienced',moved:'Movement',down:'Target Down',smallTeam:'Small team',cover:'Cover',extra:'Other / loader'};
const signed=n=>n>0?'+'+n:String(n);
function chatCard(actor,target,plan,input,results){
 const hits=results.reduce((n,r)=>n+r.hits,0),dice=results.reduce((n,r)=>n+r.count*r.shots,0);
 return `<section class="boltaction-roll-card" style="border:1px solid var(--color-border-light-primary,#7776);border-radius:6px;overflow:hidden;"><header style="padding:10px;border-bottom:1px solid #7776;"><small>CONFIRMED SQUAD SHOOTING</small><h3 style="font-size:1.15rem;margin:4px 0;">${esc(actor.name)}</h3><div>Target: <strong>${esc(target.name||target.actor.name)}</strong></div></header><div style="padding:10px;"><div style="display:flex;justify-content:space-between;gap:8px;"><strong>${hits} hits</strong><span>${dice} attack dice</span></div><p>Range ${esc(input.range)}″ · ${esc(plan.quality)} · ${esc(input.pins)} pins · ${esc(input.cover)} cover</p>${results.map(r=>`<article style="padding:8px 0;border-top:1px solid #7775;"><strong>${esc(r.name)}</strong> <span>${r.count} weapons × ${r.shots} shots</span><div><b>${r.hits} hits</b> · ${esc(r.note||(r.sixSix?'6 then 6':r.target+'+ to hit'))}</div>${r.modifiers?`<ul style="margin:4px 0;padding-left:18px;">${Object.entries(r.modifiers).filter(([,v])=>v!==0).map(([key,value])=>`<li>${esc(modifierLabels[key]||key)}: ${signed(value)}</li>`).join('')||'<li>No hit modifiers</li>'}</ul>`:''}<small>Dice: ${r.dice?.join(', ')||'not rolled'}${r.followupDice?.length?'; follow-ups: '+r.followupDice.join(', '):''}</small>${r.damage?`<div>${r.damage.casualties} suggested casualties · ${r.damage.exceptional.length} exceptional</div><small>Damage dice: ${r.damageDice.join(', ')}${r.exceptionalDice.length?'; exceptional checks: '+r.exceptionalDice.join(', '):''}</small>`:''}${r.traits&&(r.traits.extraShots||r.traits.ignoreMovedPenalty||r.traits.effectivePins!==Number(input.pins))?`<small>Applied traits: ${[r.traits.extraShots?'MG training: +'+r.traits.extraShots+' shot in default profile':'',r.traits.ignoreMovedPenalty?'movement penalty ignored':'',r.traits.effectivePins!==Number(input.pins)?'effective pins '+r.traits.effectivePins:''].filter(Boolean).join('; ')}</small>`:''}${r.vehicle?`<div>Vehicle: ${r.vehicle.pinAwarded?'hit pin awarded':'no new hit pin'}; ${r.vehicle.additionalPins} damage pins</div><small>Penetration: ${r.vehicle.penetrations.map(p=>p.roll+' → '+(p.damaged?'damage':'no damage')).join(', ')}</small><ul>${r.vehicle.damageTests.map(t=>`<li>Damage ${t.roll}: ${esc(t.result.effect)}${t.turretDie?'; turret '+t.turretDie+(t.turretJammed?' jammed':' clear'):''}${t.fireMorale?'; fire morale '+(t.fireMorale.passed?'passed':'failed'):''}</li>`).join('')}</ul>`:''}${r.manual?'<div>Special weapon effects require manual resolution.</div>':''}${r.traits?.manual?.length?`<small>Manual traits: ${esc(r.traits.manual.join(', '))}</small>`:''}</article>`).join('')}<footer style="border-top:1px solid #7776;padding-top:8px;"><small>Wall LOS checked before rolling. Firing counts and modifiers confirmed by the player. Standard infantry damage is suggested where enabled. Pins and casualties require a separate target-owner allocation; special weapon effects remain manual; direct vehicle damage uses the armour and damage tables.</small></footer></div></section>`;
}
async function rollDice(count,rolls,faces=6){
 if(!count)return [];
 const roll=await new Roll(`${count}d${faces}`).evaluate();rolls.push(roll);
 return roll.dice.flatMap(d=>d.results.filter(r=>r.active!==false).map(r=>r.result));
}
/** Direct AP damage uses the 2e vehicle tables; rolls are retained for chat auditing. */
export async function directVehicleResult({hits,weapon,input,quality,targetPins=0,context,rolls=[]}){
 const result={penetrations:[],damageTests:[],pinCheck:null,pinAwarded:false,additionalPins:0};
 if(!hits||context.dead)return result;
 const penetration=Number(weapon.system.penetration||0)+Number(input.penetrationModifier||0),damageValue=Number(input.armour),longRange=Number(input.range)>Number(weapon.system.range)/2;
 const pinOptions={quality,damageValue,penetration,openTopped:Boolean(input.openTopped),facing:input.facing,longRange,hits};
 let pin=vehiclePin(pinOptions);
 if(pin.needsDie){const die=(await rollDice(1,rolls))[0];pin=vehiclePin({...pinOptions,roll:die});result.pinCheck={die,pinned:pin.pinned};}
 else result.pinCheck={pinned:pin.pinned};
 if(pin.pinned&&!context.pinAwarded){context.pinAwarded=true;result.pinAwarded=true;}
 const damageDice=await rollDice(hits,rolls);
 for(const die of damageDice){
  const hit={roll:die,...armourPenetration({roll:die,penetration,damageValue,facing:input.facing,longRange})};result.penetrations.push(hit);
  if(!hit.damaged||context.dead)continue;
  for(let i=0;i<hit.damageRolls&&!context.dead;i++){
   const die=(await rollDice(1,rolls))[0];
   const options={roll:die,superficial:hit.superficial,carriesFlamethrower:Boolean(input.carriesFlamethrower),alreadyImmobilised:context.immobilised,activated:Boolean(input.targetActivated),turrets:Number(input.turrets)};
   let damage=vehicleDamage(options);
   const test={roll:die,superficial:hit.superficial,massive:hit.massive};
   context.addedPins+=damage.pins;result.additionalPins+=damage.pins;
   if(damage.moraleRequired){
    test.fireDice=await rollDice(2,rolls);
    test.fireMorale=moraleTest({dice:test.fireDice,quality,pins:targetPins+Number(context.pinAwarded)+context.addedPins,ncoAlive:true,moraleBonus:Number(input.fireMoraleBonus||0)});
    damage=vehicleDamage({...options,fireMoralePassed:test.fireMorale.passed});
    if(test.fireMorale.passed){context.states.delete('onFire');context.states.add('stunned');}
    else context.states.add('onFire');
   }
   if(damage.immobilised){context.immobilised=true;context.states.add('immobilised');}
   if(damage.order==='down')context.states.add('stunned');
   if(damage.destroyed){context.dead=true;context.states.add('knockedOut');}
   if(damage.turretJamRequired&&!context.dead){
    if(Number(input.turrets)>1)test.turretNumber=(await rollDice(1,rolls,Number(input.turrets)))[0];
    else test.turretNumber=1;
    test.turretDie=(await rollDice(1,rolls))[0];test.turretJammed=turretJam({roll:test.turretDie}).jammed;
    if(test.turretJammed)context.states.add('turretJammed');
   }
   test.result=damage;result.damageTests.push(test);
  }
 }
 return result;
}
/** All macro and sheet calls confirm a scene target and situational inputs before rolling. */
export async function confirmShooting(actorOrUuid){
 const actor=typeof actorOrUuid==='string'?await fromUuid(actorOrUuid):actorOrUuid;
 shootingPlan(actor);
 await assertCanAttack(actor);
 const candidates=shootingTargets(actor);
 if(!candidates.length)throw new Error('Target another model token on the active scene before firing.');
 let target=candidates[0];
 if(candidates.length>1){const chosen=await ask('Choose targeted unit',[{name:'targetId',label:'Targeted scene token',selected:target.id,options:candidates.map(token=>({value:token.id,label:token.name||token.actor.name}))}]);if(!chosen)return null;target=shootingTargets(actor).find(token=>token.id===chosen.targetId);}
 if(!target)throw new Error('The selected target is no longer available.');
 const inherited=await profiles(actor);
 const factionSlug=inherited.faction?.system?.slug||actor.getFlag?.('boltaction','factionSlug')||'';
 const targetSquad=target.actor.unit??target.actor;
 const targetQuality=targetSquad.system?.quality||'regular';
 const armoured=target.actor.type==='modelVehicle'||targetSquad.system?.kind==='vehicle';
 const los=squadLineOfSight(actor,target),plan=shootingPlan(actor,{lineOfSight:los});
 if(!plan.rows.length)throw new Error('No deployed armed squad models have line of sight to that target.');
 const blocked=los.filter(row=>!(row.eligible??(row.visible&&!row.blocked))).length;
 const traitFor=(row,input={})=>resolveTraitModifiers({traits:inherited.traits,factionSlug,kind:actor.system.kind||'infantry',weaponSlug:row.weapon.system.slug,weaponTraits:row.weapon.system.traits,moved:Boolean(input.moved),pins:Number(input.pins??plan.pins),livingSize:values(actor.members).filter(m=>!m.system.dead).length});
 const existingStates=new Set(target.actor.system?.vehicleStates??[]);if(target.actor.system?.immobilised)existingStates.add('immobilised');
 const vehicleContext={states:existingStates,immobilised:existingStates.has('immobilised'),dead:Boolean(target.actor.system?.dead),pinAwarded:false,addedPins:0};
 const fields=[{name:'range',label:'Measured range (inches)',type:'number',value:12},{name:'pins',label:'Squad pins',type:'number',value:plan.pins},{name:'cover',label:'Target cover',options:['none','soft','hard']},{name:'moved',label:'Squad moved',type:'checkbox',checked:actor.system.order==='advance'},{name:'targetDown',label:'Target is Down',type:'checkbox',checked:targetSquad.system.order==='down'},{name:'smallTeam',label:'Target is a small team',type:'checkbox'},{name:'penetrationModifier',label:'Other penetration modifier (signed)',type:'number',value:0},{name:'resolveDamage',label:'Roll standard infantry damage and exceptional damage',type:'checkbox',checked:!armoured},{name:'extraModifier',label:'Other buffs (+) / debuffs (−), including traits',type:'number',value:0}];
 if(armoured)fields.push({name:'armour',label:'Target damage value (confirm profile)',type:'number',value:Number(target.actor.system.damageValue??targetSquad.system.damageValue??7)},{name:'facing',label:'Facing struck (confirm firing arc)',options:['front','side','rear']},{name:'openTopped',label:'Target is open-topped',type:'checkbox',checked:Boolean(target.actor.system.openTopped||targetSquad.system.openTopped)},{name:'turrets',label:'Number of target turrets',type:'number',value:new Set(values(target.actor.items).map(i=>i.getFlag?.('boltaction','mount')??i.flags?.boltaction?.mount).filter(m=>String(m??'').startsWith('turret'))).size},{name:'carriesFlamethrower',label:'Target carries a flamethrower (+1 damage result)',type:'checkbox',checked:values(target.actor.items).some(i=>(i.system.traits??[]).includes('flamethrower'))},{name:'targetActivated',label:'Target already activated this turn',type:'checkbox',checked:Boolean(targetSquad.system.activated)},{name:'fireMoraleBonus',label:'Target fire-morale bonus (signed)',type:'number',value:Number(targetSquad.system.moraleBonus)||0});
 plan.rows.forEach((row,i)=>{fields.push({name:'mode'+i,label:row.weapon.name+' firing mode',value:(row.weapon.system.traits??[]).some(t=>['howitzer','indirect','indirect-fire','flamethrower'].includes(t))?'special':'direct',options:[{value:'direct',label:'Direct / AP'},{value:'special',label:'HE / indirect / special (manual effects)'}]},{name:'count'+i,label:`${row.weapon.name} — firing weapons with LOS (0–${row.quantity})`,type:'number',value:row.defaultCount},{name:'shots'+i,label:`${row.weapon.name}: shots per weapon (confirm variable shots and special rules)`,type:'number',value:(Number(row.weapon.system.shots)||1)+traitFor(row).extraShots});if(row.team)fields.push({name:'loaders'+i,label:`${row.weapon.name}: weapons with an available loader (0–${row.quantity}; ${plan.loaders} marked loaders/crew)`,type:'number',value:Math.min(row.quantity,plan.loaders)});});
 const input=await ask('Confirm squad shooting',fields,`Target: ${target.name||target.actor.name}. ${blocked} models excluded by deployment or LOS. Confirm which eligible weapons can fire, measured range, loaders, cover and unhandled trait modifiers; standard faction movement and MG bonuses are included automatically. Missing team-weapon loaders apply −1 to hit. Special weapon effects and damage require manual resolution. Cancel makes no rolls.`);
 if(!input)return null;
 const rows=validateFiringSelection(plan,input);
 if(armoured&&(!Number.isInteger(Number(input.armour))||Number(input.armour)<3||Number(input.armour)>11||!['front','side','rear'].includes(input.facing)||!Number.isInteger(Number(input.turrets))||Number(input.turrets)<0||Number(input.turrets)>6||!Number.isFinite(Number(input.fireMoraleBonus))||Math.abs(Number(input.fireMoraleBonus))>20))throw new Error('Confirm valid target armour, facing, turret count and fire morale.');
 // Scene changes during a dialog cannot silently permit fire through a newly blocked line.
 const currentTarget=shootingTargets(actor).find(token=>token===target);
 if(!currentTarget)throw new Error('The target changed or is no longer available; confirm shooting again.');
 const current=shootingPlan(actor,{lineOfSight:squadLineOfSight(actor,target)});
 for(const row of rows){const live=current.rows.find(candidate=>candidate.key===row.key);if(!live||row.count>live.quantity)throw new Error('Eligible firing models changed; confirm shooting again.');}
 const firingBatches=rows.flatMap(row=>row.team&&row.loadedCount>0&&row.loadedCount<row.count?[{...row,count:row.loadedCount,loaderAvailable:true},{...row,count:row.count-row.loadedCount,loaderAvailable:false}]:[row]);
 const prepared=firingBatches.map(row=>{const traits=traitFor(row,input);const options={quality:plan.quality,range:Number(input.range),weaponRange:row.weapon.system.range,pins:traits.effectivePins,moved:input.moved&&!traits.ignoreMovedPenalty,targetDown:input.targetDown,smallTeam:input.smallTeam,cover:input.cover,extraModifier:Number(input.extraModifier)-(row.team&&!row.loaderAvailable?1:0),assault:(row.weapon.system.traits??[]).includes('assault')};const target=shootingTarget(options);if(Number(input.range)<Number(row.weapon.system.minRange||0))target.inRange=false;return {row,options,traits,target};});
 const reservation=await reserveAttack(actor);
 let recorded=false;
 try {
 const rolls=[],results=[];
 for(const {row,options,traits,target:hit} of prepared){if(!hit.inRange){results.push({name:row.weapon.name,hits:0,note:'Out of range',count:row.count,shots:row.shots,dice:[],followupDice:[]});continue;}
  const roll=await new Roll(`${row.count*row.shots}d6`).evaluate();rolls.push(roll);const dice=roll.dice.flatMap(d=>d.results.filter(r=>r.active!==false).map(r=>r.result));let followupDice=[];
  if(hit.sixSix&&dice.includes(6)){const followup=await new Roll(`${dice.filter(v=>v===6).length}d6`).evaluate();rolls.push(followup);followupDice=followup.dice.flatMap(d=>d.results.map(r=>r.result));}
  const hitResult=resolveHits({...options,dice,followupDice});
  const special=row.mode!=='direct'||(row.weapon.system.traits??[]).some(trait=>['flamethrower','shaped-charge','one-shot','sniper'].includes(trait));
  let damage=null,damageDice=[],exceptionalDice=[];
  if(input.resolveDamage&&!armoured&&!special&&hitResult.hits){const rolled=await new Roll(`${hitResult.hits}d6`).evaluate();rolls.push(rolled);damageDice=rolled.dice.flatMap(d=>d.results.map(r=>r.result));const penetration=Number(row.weapon.system.penetration||0)+Number(input.penetrationModifier||0);damage=infantryDamage({dice:damageDice,quality:targetQuality,penetration});if(damage.needsExceptionalDice){const exceptional=await new Roll(`${damage.needsExceptionalDice}d6`).evaluate();rolls.push(exceptional);exceptionalDice=exceptional.dice.flatMap(d=>d.results.map(r=>r.result));damage=infantryDamage({dice:damageDice,quality:targetQuality,penetration,exceptionalDice});}}
  const vehicle=armoured&&!special?await directVehicleResult({hits:hitResult.hits,weapon:row.weapon,input,quality:targetQuality,targetPins:Number(targetSquad.system.pins)||0,context:vehicleContext,rolls}):null;
  results.push({name:row.weapon.name,...hitResult,count:row.count,shots:row.shots,dice,followupDice,damage,damageDice,exceptionalDice,traits,special,vehicle,manual:special});
 }
 await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),rolls,content:chatCard(actor,target,plan,input,results),flags:{boltaction:{kind:'shooting',apiVersion:1,actorUuid:actor.uuid,targetTokenUuid:target.document.uuid,targetActorUuid:target.actor.uuid,confirmed:input,results}}});
 const summary={actorUuid:actor.uuid,targetTokenUuid:target.document.uuid,targetActorUuid:target.actor.uuid,results,suggestedCasualties:results.reduce((n,r)=>n+(r.damage?.casualties??0),0),pins:armoured?Number(vehicleContext.pinAwarded)+vehicleContext.addedPins:(results.some(r=>r.hits>0&&!r.manual)?1:0),vehicle:armoured?{pins:Number(vehicleContext.pinAwarded)+vehicleContext.addedPins,states:[...vehicleContext.states],dead:vehicleContext.dead}:null};
 await recordAttack(actor,targetSquad.uuid,summary,reservation);recorded=true;
 if(armoured&&target.actor.isOwner&&summary.vehicle&&(summary.vehicle.pins||summary.vehicle.dead||summary.vehicle.states.some(state=>!existingStates.has(state)))){
  const apply=await ask('Apply vehicle damage (optional)',[{name:'apply',label:'Apply the proposed pins, vehicle states and destroyed result',type:'checkbox'}],`Proposed: ${summary.vehicle.pins} pins; ${summary.vehicle.states.join(', ')||'no new state'}${summary.vehicle.dead?'; knocked out':''}. No model actor will be deleted.`);
  if(apply?.apply)summary.applied=await applyVehicleResults(actor,target.actor,summary.vehicle);
 }
 if(!armoured&&targetSquad.isOwner&&(summary.pins||summary.suggestedCasualties)){
  const living=values(targetSquad.members).filter(model=>model.isOwner&&!model.system.dead&&model.system.unitUuid===targetSquad.uuid);
  const fields=[...(summary.pins?[{name:'applyPin',label:'Apply one standard hit pin',type:'checkbox',checked:true}]:[]),...living.map((model,i)=>({name:'casualty'+i,label:`Casualty: ${model.name}`,type:'checkbox'}))];
  const allocation=await ask('Allocate target damage (optional)',fields,`${summary.suggestedCasualties} suggested casualties. The target owner chooses models; exceptional results permit selecting key team members. No models are deleted. Cancel leaves pins and casualties unchanged.`);
  if(allocation){const casualties=living.filter((model,i)=>allocation['casualty'+i]).map(model=>model.uuid);if(casualties.length>summary.suggestedCasualties)throw new Error('Choose no more than the suggested casualty count.');if(casualties.length||allocation.applyPin)summary.applied=await applyAttackResults(actor,targetSquad,{pins:allocation.applyPin?summary.pins:0,casualtyUuids:casualties});}
 }
 return summary;
 } finally {if(!recorded)await releaseAttack(actor,reservation);}
}
