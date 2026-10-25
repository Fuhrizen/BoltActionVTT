import * as rules from '../rules/index.mjs';
const locks=new Set();
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function unit(actor){const u=actor?.unit??actor;if(!u||u.type!=='unit'||!u.isOwner||u.pack)throw new Error('Own a world observer unit.');return u;}
function gm(){if(!game.user.isGM)throw new Error('The GM resolves off-table support.');}
function round(){if(!game.combat?.round)throw new Error('Start the battle round first.');return game.combat.round;}
async function locked(u,fn){if(locks.has(u.uuid))throw new Error('This observer is already resolving.');locks.add(u.uuid);try{return await fn();}finally{locks.delete(u.uuid);}}
async function dice(n,rolls){if(!n)return [];const r=await new Roll(`${n}d6`).evaluate();rolls.push(r);return r.dice.flatMap(d=>d.results.filter(v=>v.active!==false).map(v=>v.result));}
async function chat(u,title,lines,rolls=[]){await foundry.documents.ChatMessage.create({speaker:foundry.documents.ChatMessage.getSpeaker({actor:u}),content:`<section class="boltaction chat-card"><h3>${esc(title)}</h3>${lines.map(l=>`<p>${esc(l)}</p>`).join('')}</section>`,rolls});}
async function target(uuid){const t=await fromUuid(uuid);if(!t||t.type!=='unit'||t.visible===false)throw new Error('Choose a visible target unit.');return t;}
function point(o){const x=Number(o.x),y=Number(o.y);if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0)throw new Error('Enter nonnegative scene coordinates for the aim point.');return {x,y};}
export async function callObserver(actor,o={}){const u=unit(actor);return locked(u,async()=>{
  const kind=o.kind??u.system.observerKind;
  if(!u.system.observerKind||kind==='air'&&u.system.observerKind!=='air'||kind!=='air'&&u.system.observerKind!=='artillery')throw new Error('Configure the appropriate observer type on this unit.');
  if(u.isDestroyed||u.system.transportUuid)throw new Error('This observer cannot call support.');
  const state=rules.observerCall({kind,used:u.system.observerUsed,order:u.system.order,visible:Boolean(o.visible)});
  if(!state.legal)throw new Error('An unused observer must have a Fire order and confirm visibility.');
  const bag=game.combat?.getFlag('boltaction','bag');if(bag&&bag.activeUnitUuid!==u.uuid)throw new Error('Activate this observer first.');
  if(!canvas.scene)throw new Error('Open the battle scene first.');const p=point(o),t=o.targetUuid?await target(o.targetUuid):null;if(kind==='air'&&!t)throw new Error('Air support requires a designated target unit.');
  await u.update({'system.observerUsed':true,'system.observerPending':true,'system.observerMission':kind,'system.observerTargetUuid':t?.uuid??'','system.observerRound':round(),'system.observerSceneUuid':canvas.scene.uuid,'system.observerX':p.x,'system.observerY':p.y,'system.observerResult':{},'system.observerResolvedUuids':[]});
  await chat(u,'Support requested',[`${kind} mission designated at scene point (${p.x}, ${p.y})${t?`; target ${t.name}`:''}. Resolve arrival at the start of the next round. Confirm observer restrictions, visibility and aim point on the table.`]);return state;
});}
export async function resolveObserver(actor){gm();const u=unit(actor);return locked(u,async()=>{
  if(!u.system.observerPending)throw new Error('No support mission is pending.');if(round()<=u.system.observerRound)throw new Error('Resolve support only in the round after the previous call or delay.');
  if(canvas.scene?.uuid!==u.system.observerSceneUuid)throw new Error('Open the scene where support was requested.');
  const rolls=[],kind=u.system.observerMission,[roll]=await dice(1,rolls),scatterDice=kind!=='air'&&roll===1?await dice(3,rolls):[],radiusDie=kind==='artillery'&&![2,3].includes(roll)?(await dice(1,rolls))[0]:undefined;
  const t=u.system.observerTargetUuid?await fromUuid(u.system.observerTargetUuid):null;
  const result=rules.observerArrival({kind,roll,scatterDice,radiusDie,targetDestroyed:!t||t.isDestroyed});
  await u.update({'system.observerPending':result.delayed,'system.observerRound':round(),'system.observerResult':result});
  const lines=[`${kind}: ${result.delayed?'delayed until next round':result.wasted?'mission wasted':'arrived'}.`];
  if(result.retargetDistance)lines.push(`Aim point may be shifted up to ${result.retargetDistance} inches after manual measurement.`);
  if(result.mayRetarget)lines.push('The designated air target may be changed before next round.');
  if(result.retargetEnemy)lines.push('Enemy chooses the attack target. The GM must record that target before applying the strike.');
  if(result.randomDirection)lines.push(`Scatter ${result.scatterDistance} inches in a random direction. The GM must record the adjusted aim point before resolving affected units.`);
  if(result.radius)lines.push(`Effect radius ${result.radius} inches. Measure every friendly and enemy unit within it and resolve each once.`);
  if(kind==='smoke'&&result.arrived)lines.push('Place the smoke area manually: it provides soft cover and blocks sight through its dense area. Roll drift in later rounds using the smoke assistant.');
  if(kind==='air'&&result.arrived&&!result.wasted)lines.push('Place the aircraft 18 inches from its target. Resolve nearby preliminary pins, eligible friendly/enemy flak and any target reassignment before applying the air strike.');
  await chat(u,'Support arrival',lines,rolls);return result;
});}
export async function retargetObserver(actor,o={}){gm();const u=unit(actor);return locked(u,async()=>{
  if(!u.system.observerUsed)throw new Error('No support mission has been called.');if(!o.confirmed)throw new Error('Confirm permitted movement, enemy target choice and scatter manually.');
  const p=point(o),t=o.targetUuid?await target(o.targetUuid):null,result=u.system.observerResult??{};
  if(!u.system.observerPending&&!result.randomDirection&&!result.retargetEnemy)throw new Error('This support mission cannot be retargeted now.');
  await u.update({'system.observerX':p.x,'system.observerY':p.y,'system.observerTargetUuid':t?.uuid??u.system.observerTargetUuid,'system.observerResult':{...result,positionConfirmed:true}});
  await chat(u,'Support aim point confirmed',[`Point (${p.x}, ${p.y}); target ${t?.name??'unchanged'}. GM confirmed scatter or permitted retargeting.`]);return p;
});}
export async function resolveObserverTarget(actor,o={}){gm();const u=unit(actor);return locked(u,async()=>{
  const state=u.system.observerResult??{},kind=u.system.observerMission;
  if(!state.arrived||state.wasted||kind==='smoke')throw new Error('No arrived damaging support mission is available.');if(canvas.scene?.uuid!==u.system.observerSceneUuid)throw new Error('Open the mission scene.');
  if((state.randomDirection||state.retargetEnemy)&&!state.positionConfirmed)throw new Error('Record scatter or enemy target choice first.');
  const t=await target(o.targetUuid);if((u.system.observerResolvedUuids??[]).includes(t.uuid))throw new Error('This unit already resolved this support mission.');
  if(!o.placementConfirmed)throw new Error('Confirm effect area, templates and affected models.');if(kind==='air'&&!o.flakResolved)throw new Error('Resolve preliminary pins and eligible flak before the air strike.');if(kind==='air'&&t.uuid!==u.system.observerTargetUuid)throw new Error('Resolve the designated air target only.');
  const modelsHit=Number(o.modelsHit??0);if(!Number.isInteger(modelsHit)||modelsHit<0||modelsHit>500)throw new Error('Enter a whole model count from 0 to 500.');
  await u.update({'system.observerResolvedUuids':[...(u.system.observerResolvedUuids??[]),t.uuid]});
  const rolls=[],[roll,pinDie]=await dice(2,rolls);let effect;
  const down=t.system.order==='down'||Boolean(o.down),vehicle=t.system.kind==='vehicle';
  if(kind==='artillery'){const buildingDice=o.building&&roll===6?await dice(3,rolls):[];effect=rules.barrageUnit({roll,pinDie,modelsHit,down,vehicle,building:Boolean(o.building),buildingDice});}
  else {const strikeDice=roll<=2?await dice(2,rolls):[];effect=rules.airStrike({roll,pinDie,modelsHit,down,vehicle,damageValue:t.damageValue,dice:strikeDice});}
  const values=await dice(effect.hits,rolls);let damage=null;const lines=[`${kind} → ${t.name}: ${effect.type??(effect.direct?'direct blast':'nearby barrage')}; ${effect.hits} damage hits; ${effect.pins} pins.`];
  if(vehicle){const penetrations=values.map(roll=>rules.armourPenetration({roll,penetration:effect.penetration??0,damageValue:t.damageValue,facing:'top',rangeExempt:true})),results=[];for(const p of penetrations.filter(v=>v.damaged)){for(const value of await dice(p.damageRolls,rolls))results.push(rules.vehicleDamage({roll:value,superficial:p.superficial,openToppedIndirect:kind==='artillery'&&t.system.openTopped,alreadyImmobilised:t.system.immobilised,activated:t.system.activated}));}damage={penetrations,results};lines.push(`Vehicle damage: ${results.map(v=>v.effect).join(', ')||'none'}. Confirm vehicle pin eligibility, fire and secondary effects manually.`);}
  else {damage=rules.infantryDamage({dice:values,quality:t.system.quality,damageValue:t.damageValue,penetration:effect.penetration??0});lines.push(`${damage.casualties} casualties suggested. Allocate models and resolve casualty morale manually.`);}
  if(effect.pins&&o.apply&&game.settings.get('boltaction','applyPins')&&t.isOwner&&!vehicle){await t.update({'system.pins':t.system.pins+effect.pins});lines.push('Suggested pins applied.');}else if(effect.pins)lines.push('Target owner confirms and applies the suggested pins.');
  lines.push('No model casualties, template geometry, flak fire or nearby-unit selection were applied automatically.');await chat(u,'Off-table support effect',lines,rolls);return {effect,damage};
});}
export async function resolveSmokeDrift(actor){gm();const u=unit(actor);if(u.system.observerMission!=='smoke'||!u.system.observerResult?.arrived)throw new Error('No smoke mission is in play.');const rolls=[],[roll,distanceDie]=await dice(2,rolls),result=rules.smokeDrift({roll,distanceDie});await chat(u,'Smoke drift',[result.removed?'Remove the smoke area.':result.randomDirection?`Move the smoke area ${result.drift} inches in a randomly chosen direction.`:'The smoke remains in place.'],rolls);if(result.removed)await u.update({'system.observerResult':{...u.system.observerResult,arrived:false,removed:true}});return result;}
