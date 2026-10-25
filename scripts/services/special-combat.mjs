import * as rules from '../rules/index.mjs';
const locks = new Set();
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function num(v, fallback, min=0,max=1000) {const n=v===undefined||v===''?fallback:Number(v);if(!Number.isFinite(n)||n<min||n>max)throw new Error(`Enter a number between ${min} and ${max}.`);return n;}
async function dice(count,rolls){if(!count)return [];const roll=await new Roll(`${count}d6`).evaluate();rolls.push(roll);return roll.dice.flatMap(d=>d.results.filter(r=>r.active!==false).map(r=>r.result));}
async function report(unit,lines,rolls){await foundry.documents.ChatMessage.create({speaker:foundry.documents.ChatMessage.getSpeaker({actor:unit}),content:`<section class="boltaction chat-card"><h3>Special weapon attack</h3>${lines.map(l=>`<p>${esc(l)}</p>`).join('')}</section>`,rolls});}
/** Assisted specialist fire. Template placement and model allocation remain explicit player inputs. */
export async function specialistAttack(actor,options={}) {
  const unit=actor?.unit ?? actor;
  if(!unit||unit.type!=='unit'||!unit.isOwner||unit.pack)throw new Error('Own a world unit before firing.');
  if(locks.has(unit.uuid))throw new Error('This unit is already resolving an attack.');
  locks.add(unit.uuid);
  try{return await resolveAttack(unit,options);}finally{locks.delete(unit.uuid);}
}
async function resolveAttack(unit,o) {
  if(unit.isDestroyed||unit.system.transportUuid)throw new Error('This unit cannot fire.');
  if(!['fire','advance','ambush'].includes(unit.system.order))throw new Error('A Fire, Advance or Ambush order is required.');
  const bag=game.combat?.getFlag('boltaction','bag');
  if(unit.system.order!=='ambush'&&bag&&bag.activeUnitUuid!==unit.uuid)throw new Error('Activate this unit from the drawn side first.');
  const target=await fromUuid(o.targetUuid);
  if(!target||target.type!=='unit'||target.uuid===unit.uuid||target.isDestroyed||target.visible===false)throw new Error('Choose a valid target unit.');
  const weapon=unit.weapons.find(w=>w.uuid===o.weaponId||w.id===o.weaponId);
  if(!weapon||!weapon.isOwner)throw new Error('Choose an owned weapon on this unit.');
  const p=weapon.system,traits=p.traits??[],mode=o.mode??'he';
  if(!['he','indirect','flamethrower','building','direct'].includes(mode))throw new Error('Unsupported special attack mode.');
  const flame=mode==='flamethrower'||traits.includes('flamethrower');
  const indirect=mode==='indirect',building=mode==='building'||Boolean(o.building);
  if(traits.includes('indirect-fire')&&!indirect)throw new Error('This weapon requires the indirect-fire procedure.');
  const he=!flame&&(mode==='he'||indirect||building);
  if(he&&![1,2,3,4].includes(p.heDiameter))throw new Error('This profile has no supported HE diameter.');
  if(mode==='flamethrower'&&!traits.includes('flamethrower'))throw new Error('Choose a flamethrower profile.');
  if(indirect&&!(p.indirectRange||traits.includes('indirect-fire')&&p.range))throw new Error('This profile has no indirect range.');
  if(p.exhausted||!rules.weaponAmmo({oneShot:traits.includes('one-shot'),used:p.ammoUsed}).canFire)throw new Error('This weapon is exhausted or its single shot has been spent.');
  const signature=w=>JSON.stringify([w.system.slug,w.system.range,w.system.shots,w.system.penetration,[...(w.system.traits??[])].sort()]);
  const group=[weapon];
  if(group.some(w=>(unit.system.firedWeaponUuids??[]).includes(w.uuid)))throw new Error('This weapon group has already fired under this order.');
  if(unit.system.kind!=='vehicle'&&unit.system.shotTargetUuid&&unit.system.shotTargetUuid!==target.uuid)throw new Error('The unit must keep the same target under this order.');
  const range=num(o.range,12),diameter=p.heDiameter;let modelsHit=num(o.modelsHit,0,0,500);
  if(!Number.isInteger(modelsHit))throw new Error('Enter a whole number of models under the template.');
  if(he&&!building&&!o.templateConfirmed)throw new Error('Confirm legal template placement and the number of clipped models.');
  if(p.traits.includes('fixed')&&unit.system.kind!=='vehicle'&&!o.fixedArcConfirmed)throw new Error('Confirm the fixed weapon arc and any rotation without translation.');
  const round=game.combat?.round??1,rolls=[],lines=[`${unit.name} → ${target.name}; ${weapon.name}; ${mode} at ${range}″.`];
  const consume=async()=>{await weapon.update({'system.ammoUsed':Boolean(p.ammoUsed||traits.includes('one-shot'))});await unit.update({'system.firedWeaponUuids':[...new Set([...(unit.system.firedWeaponUuids??[]),...group.map(w=>w.uuid)])],'system.shotTargetUuid':target.uuid});};
  let hit=false,hitResult=null,indirectState=null;
  if(indirect){
    const input={state:p.indirectTargetUuid?{targetUuid:p.indirectTargetUuid,round:p.indirectRound,target:p.indirectThreshold,zeroed:p.indirectZeroed}:null,targetUuid:target.uuid,round,range,minRange:p.indirectMinRange||p.minRange||0,maxRange:p.indirectRange||p.range,order:unit.system.order,shooterMoved:Boolean(o.moved||unit.system.order==='advance'),targetMoved:Boolean(o.targetMoved),visible:o.visible!==false};
    const preview=rules.indirectShot({...input,roll:1});if(!preview.legal)throw new Error('Illegal indirect shot: check minimum/maximum range, visibility, movement and Ambush.');
    await consume();const [roll]=await dice(1,rolls);hitResult=rules.indirectShot({...input,roll});hit=hitResult.hit;indirectState=hitResult.state;lines.push(`Indirect hit target ${hitResult.target}+: ${hit?'hit':'miss'}. Ranging state saved on this weapon.`);
  }else{
    if(range<(p.minRange??0)||range>p.range)throw new Error('Target outside this weapon’s direct range.');
    const input={quality:unit.system.quality,pins:unit.system.pins,range,weaponRange:p.range,moved:Boolean(o.moved||unit.system.order==='advance'),assault:traits.includes('assault'),cover:flame?'none':o.cover??'none',targetDown:flame?false:Boolean(o.targetDown||target.system.order==='down'),smallTeam:Boolean(o.smallTeam),extraModifier:num(o.extraModifier,0,-30,30)};
    const count=flame?1:num(o.shots,p.shots,1,500);if(!Number.isInteger(count))throw new Error('Shots must be a whole number.');
    await consume();const values=await dice(count,rolls),threshold=rules.shootingTarget(input),followupDice=threshold.sixSix?await dice(values.filter(v=>v===6).length,rolls):[];
    hitResult=rules.resolveHits({...input,dice:values,followupDice});hit=hitResult.hits>0;lines.push(`${hitResult.hits} hits (${hitResult.sixSix?'6 then 6':hitResult.target+'+'}).`);
  }
  if(he&&!building&&hitResult.hits>1&&!o.modelsHitTotalConfirmed){
    const total=await foundry.applications.api.DialogV2.prompt({window:{title:`${hitResult.hits} HE templates hit`},content:`<p>Place ${hitResult.hits} touching, nonoverlapping templates legally. Count each model in the target unit only once. Confirm no friendly models are clipped. Enter the total target models hit; resolve other units clipped separately.</p><input type="number" name="models" min="0" max="500" value="${modelsHit}">`,ok:{callback:(_event,button)=>Number(button.form.elements.models.value)},rejectClose:false});
    if(total===null)throw new Error('HE placement cancelled after hit dice. Resolve and record this attack manually before firing again.');
    modelsHit=num(total,0,0,500);if(!Number.isInteger(modelsHit))throw new Error('Enter a whole number of models.');
  }
  let effect={hits:hit?hitResult.hits:0,pins:hit?1:0,penetration:p.penetration},exhausted=false;
  if(flame){const [hitDie,pinDie,fuelDie]=await dice(3,rolls);effect=rules.flamethrower({hit,vehicleMounted:unit.system.kind==='vehicle',hitDie,pinDie,fuelDie});exhausted=effect.exhausted;lines.push(`Flamethrower: ${effect.hits} damage hits; ${effect.pins} pins; fuel ${exhausted?'exhausted':'available'}.`);if(effect.removeTeam)lines.push('Fuel exhausted: remove the infantry flamethrower team manually.');if(effect.moraleRequired)lines.push('Target must take the flamethrower morale test after casualties, even if no casualties were caused.');}
  else if(he){const profile=rules.heProfile(diameter),[pinDie]=hit?await dice(1,rolls):[1],buildingDice=hit&&building?await dice(profile.buildingDice,rolls):[];effect=hit?rules.heEffect({diameter,modelsHit,down:Boolean(o.targetDown||target.system.order==='down'),vehicle:target.system.kind==='vehicle',building,dice:buildingDice,pinDie}):{hits:0,pins:0,penetration:profile.penetration};lines.push(`HE ${diameter}″: ${effect.hits} damage hits; ${effect.pins} pins. Template placement remains player confirmed.${effect.buildingCollapsed?' Building collapse threshold reached: resolve occupants and destruction manually.':''}`);}
  const damageDice=await dice(effect.hits,rolls);let damage=null;
  if(target.system.kind==='vehicle'){
    const penetration=effect.penetration+num(o.penetrationModifier,0,-20,20),facing=indirect||flame?'top':o.facing??'front';
    const penetrations=damageDice.map(roll=>rules.armourPenetration({roll,penetration,damageValue:target.damageValue,facing,longRange:range>p.range/2,rangeExempt:he||flame||traits.includes('shaped-charge')}));
    const results=[];for(const result of penetrations.filter(v=>v.damaged)){const values=await dice(result.damageRolls,rolls);results.push(...values.map(roll=>rules.vehicleDamage({roll,superficial:result.superficial,openToppedIndirect:indirect&&target.system.openTopped,alreadyImmobilised:target.system.immobilised,activated:target.system.activated})));}
    damage={penetrations,results};lines.push(`${penetrations.filter(v=>v.damaged).length} penetrating hits; vehicle results: ${results.map(v=>v.effect).join(', ')||'none'}. Apply armour damage, vehicle pin eligibility, fire tests and secondary effects manually.`);
  }else{damage=rules.infantryDamage({dice:damageDice,quality:target.system.quality,damageValue:building?rules.buildingProtection({quality:target.system.quality,he,flamethrower:flame}):target.damageValue,penetration:effect.penetration+num(o.penetrationModifier,0,-20,20)});if(!he&&!flame){const exceptionalDice=await dice(damage.needsExceptionalDice,rolls);damage=rules.infantryDamage({dice:damageDice,quality:target.system.quality,damageValue:target.damageValue,penetration:effect.penetration+num(o.penetrationModifier,0,-20,20),exceptionalDice});}lines.push(`${damage.casualties} casualties suggested.${he||flame?' HE and flames do not select exceptional casualties.':` ${damage.exceptional.length} exceptional damage results.`} Allocate models manually.`);}
  const prior=Object.hasOwn(unit.system.attackPinTotals??{},target.uuid)?unit.system.attackPinTotals[target.uuid]:(unit.system.hitTargetUuids??[]).includes(target.uuid)?1:0;
  const specialPins=he||flame,previousSpecial=(unit.system.specialPinTargets??[]).includes(target.uuid);
  const mixed=previousSpecial&&specialPins&&effect.pins>0;
  const owed=mixed?0:Math.max(0,effect.pins-prior);
  if(mixed)lines.push(`This unit already resolved a special pin batch against this target (${prior} pins suggested). New special batch ${effect.pins}: do not stack automatically. Resolve mixed special weapon pin interactions manually; multiple HE templates grant only one batch.`);
  if(owed&&o.apply&&game.settings.get('boltaction','applyPins')&&target.isOwner&&target.system.kind!=='vehicle'){await target.update({'system.pins':target.system.pins+owed});lines.push(`${owed} additional pins applied (${Math.max(prior,effect.pins)} total from this firing unit).`);}else if(owed)lines.push(`${owed} additional pins suggested (${Math.max(prior,effect.pins)} total); target owner confirms and applies them${target.system.kind==='vehicle'?' after checking vehicle eligibility':''}.`);
  await weapon.update({'system.ammoUsed':Boolean(p.ammoUsed||traits.includes('one-shot')),'system.exhausted':Boolean(p.exhausted||exhausted),'system.indirectTargetUuid':indirectState?.targetUuid??'','system.indirectRound':indirectState?.round??0,'system.indirectThreshold':indirectState?.target??6,'system.indirectZeroed':indirectState?.zeroed??false});
  await unit.update({'system.attackPinTotals':{...(unit.system.attackPinTotals??{}),[target.uuid]:mixed?prior:Math.max(prior,effect.pins)},'system.specialPinTargets':specialPins&&effect.pins?[...new Set([...(unit.system.specialPinTargets??[]),target.uuid])]:unit.system.specialPinTargets??[],'system.firedWeaponUuids':[...new Set([...(unit.system.firedWeaponUuids??[]),...group.map(w=>w.uuid)])],'system.shotTargetUuid':target.uuid,'system.hitTargetUuids':effect.hits?[...new Set([...(unit.system.hitTargetUuids??[]),target.uuid])]:unit.system.hitTargetUuids??[]});
  if(unit.system.order==='ambush')await unit.update({'system.order':'fire','system.retained':false});
  lines.push('Confirm special faction traits, teams, buildings, fires and casualty morale separately. No models were removed automatically.');
  await report(unit,lines,rolls);return {hit,hitResult,effect,damage,indirectState,exhausted};
}
