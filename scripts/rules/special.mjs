import {QUALITY, moraleTest, orderTest, vehicleDamage} from './index.mjs';
const d6 = n => { if (!Number.isInteger(n) || n < 1 || n > 6) throw new RangeError('Supply a D6 result'); return n; };
export function heProfile(diameter) {
  if (![1,2,3,4].includes(diameter)) throw new RangeError('HE diameter must be 1–4 inches');
  return {diameter,penetration:diameter,pinSides:[2,3,3,6][diameter-1],buildingDice:[1,1,2,3][diameter-1],buildingSides:diameter === 1 ? 3 : 6};
}
/** Model and template coordinates, radii and diameters are tabletop inches. */
export function heTemplate({diameter,centres = [],models = []} = {}) {
  heProfile(diameter); const radius = diameter/2;
  const hitModels = models.filter(m => centres.some(c => Math.hypot(c.x-m.x,c.y-m.y) <= radius+(m.radius ?? 25/25.4/2)));
  const friendlyClipped = hitModels.some(m => m.friendly), hitsByUnit = {};
  for (const model of hitModels) hitsByUnit[model.unitUuid] = (hitsByUnit[model.unitUuid] ?? 0)+1;
  let validArrangement = true;
  if (centres.length > 1) {
    const seen = new Set([0]), pending = [0];
    while (pending.length) { const i = pending.pop(); centres.forEach((c,j) => {const distance = Math.hypot(c.x-centres[i].x,c.y-centres[i].y); if (i !== j && distance < diameter-1e-6) validArrangement=false; if (!seen.has(j) && Math.abs(distance-diameter)<1e-6) {seen.add(j);pending.push(j);} }); }
    if (seen.size !== centres.length) validArrangement=false;
  }
  return {hitsByUnit,hitModels:hitModels.map(m => m.id),friendlyClipped,validArrangement,legal:!friendlyClipped && validArrangement,manualPlacementCheck:true};
}
export function heEffect({diameter,modelsHit = 0,down = false,vehicle = false,building = false,dice = [],pinDie} = {}) {
  const profile=heProfile(diameter); let hits=modelsHit;
  if (building) {
    if (dice.length !== profile.buildingDice) throw new RangeError('Supply building hit dice');
    hits=dice.reduce((sum,n)=>sum+(profile.buildingSides===3 ? Math.ceil(d6(n)/2) : d6(n)),0);
  }
  if (vehicle) hits=modelsHit>0 ? 1 : 0;
  else if (down) hits=Math.ceil(hits/2);
  const pins=hits>0 ? Math.ceil(d6(pinDie)/(6/profile.pinSides)) : 0;
  const rawHits=building ? dice.reduce((sum,n)=>sum+(profile.buildingSides===3 ? Math.ceil(n/2) : n),0) : modelsHit;
  return {...profile,hits,rawHits,pins,rangeExempt:true,buildingCollapsed:building && diameter>=3 && rawHits>=10};
}
export function indirectShot({state = null,targetUuid,round,shooterMoved = false,targetMoved = false,mode = 'indirect',roll,range,minRange = 0,maxRange = Infinity,visible = true,order = 'fire'} = {}) {
  if (mode !== 'indirect') return {hit:false,target:null,state:null,reset:true};
  if (order === 'ambush') return {hit:false,target:6,state,legal:false,reason:'indirect-ambush'};
  const continuing=state?.targetUuid===targetUuid && (state.zeroed || state.round===round-1) && !shooterMoved && !targetMoved;
  const target=continuing ? (state.zeroed ? 2 : Math.max(2,state.target-1)) : 6;
  const zeroed=continuing && state.zeroed;
  const legal=range>minRange && range<=maxRange && (visible || zeroed);
  const hit=legal && d6(roll)>=target;
  return {hit,target,legal,state:{targetUuid,round,target,zeroed:hit || zeroed},facing:'top',rangeExempt:true};
}
export function flamethrower({hit = false,vehicleMounted = false,hitDie,pinDie,fuelDie} = {}) {
  const exhausted=d6(fuelDie)===1;
  return {hits:hit ? d6(hitDie)+(vehicleMounted ? 1 : 0) : 0,pins:hit ? Math.ceil(d6(pinDie)/2)+1 : 0,exhausted,removeTeam:exhausted && !vehicleMounted,moraleRequired:hit,penetration:3,facing:'top',rangeExempt:true,ignoreCover:true,ignoreDown:true,ignoreGunShield:true};
}
export function weaponAmmo({oneShot = false,used = false,fired = false} = {}) {
  return {canFire:!oneShot || !used,used:used || (oneShot && fired)};
}
export function gunShieldDamage({quality = 'regular',front = true,shield = true,he = false,flamethrower = false,assault = false} = {}) {
  if (!QUALITY[quality]) throw new RangeError('Unknown troop quality');
  return QUALITY[quality].damage+(shield && front && !he && !flamethrower && !assault ? 1 : 0);
}
export function buildingProtection({quality = 'regular',he = false,flamethrower = false,assault = false} = {}) {
  return gunShieldDamage({quality,front:true,shield:true,he,flamethrower,assault});
}
export function buildingFire({roll,targetKind = 'infantry'} = {}) {
  const burning=d6(roll)>=4;
  return {burning,impassable:burning,evacuate:burning && targetKind!=='artillery',destroyed:burning && targetKind==='artillery'};
}
/** Floors are numbered 0 (ground) upwards. Rolls stop on 4+ or ground. */
export function indirectBuildingFloor({floors = 1,dice = []} = {}) {
  if (!Number.isInteger(floors) || floors<1) throw new RangeError('Building needs at least one floor');
  let floor=floors-1,used=0;
  while (floor>0) { if (dice[used]===undefined) return {floor:null,needsDie:true,diceUsed:used}; if (d6(dice[used++])>=4) return {floor,needsDie:false,diceUsed:used}; floor--; }
  return {floor:0,needsDie:false,diceUsed:used};
}
export function vehicleFire({moraleDice,quality = 'regular',pins = 0,ncoAlive = true,moraleBonus = 0,modifier = 0,turrets = 0} = {}) {
  const morale=moraleTest({dice:moraleDice,quality,pins:pins+1,ncoAlive,moraleBonus,modifier});
  return {morale,...vehicleDamage({roll:3,turrets,fireMoralePassed:morale.passed}),remainingPins:pins+1};
}
export function infantryVehicleAssault({dice = [],damageDie,damageValue = 7,order = '',immobilised = false,openTopped = false,tankHunters = false,hasAntiTank = tankHunters} = {}) {
  if (order==='run' && !immobilised) return {legal:false,reason:'vehicle-too-fast'};
  const target=order==='advance' && !immobilised ? 6 : 4;
  const hits=dice.filter(n=>d6(n)>=target).length;
  const total=d6(damageDie)+hits,damaged=damageDie!==1 && total>=damageValue;
  const destroyed=damaged && (damageValue<=6 || openTopped);
  return {legal:true,target,hits,total,damaged,destroyed,superficial:damaged && !destroyed && (total===damageValue || !hasAntiTank),massive:damaged && !destroyed && hasAntiTank && total>=damageValue+3,damageRolls:damaged && !destroyed ? (hasAntiTank && total>=damageValue+3 ? 2 : 1) : 0,tankFear:damageValue>=7 && !openTopped && !tankHunters,tankFearModifier:-3,regroup:true};
}
export function vehicleRam({attackerDie,defenderDie,attackerArmour,defenderArmour} = {}) {
  if (attackerArmour<8) return {legal:false,reason:'attacker-not-tank'};
  const a=d6(attackerDie)+(attackerArmour>=7 ? attackerArmour : 0),b=d6(defenderDie)+(defenderArmour>=7 ? defenderArmour : 0);
  const result=(armour,other,loser)=>({destroyed:loser && armour<=6,damage:armour>=7 && (loser || armour<=other),superficial:armour>=7 && (loser ? armour>other : armour<=other),survivorOrder:'down',survivorPins:1});
  return {legal:true,attackerTotal:a,defenderTotal:b,attacker:result(attackerArmour,defenderArmour,a<=b),defender:result(defenderArmour,attackerArmour,b<=a),tankFear:defenderArmour>=8,tankFearModifier:-3};
}
export function tankOverrun({damageValue = 8,targetKind = 'infantry',moralePassed,order = 'run',straight = true} = {}) {
  return {legal:damageValue>=8 && order==='run' && straight,destroyed:targetKind==='artillery' || moralePassed===false,moraleRequired:moralePassed===undefined,continueMove:true};
}
export function observerCall({kind = 'artillery',used = false,order = 'fire',visible = true} = {}) {
  if (!['artillery','smoke','air'].includes(kind)) throw new RangeError('Unknown observer mission');
  return {legal:!used && order==='fire' && visible,used:!used && order==='fire' && visible ? true : used,resolveNextRound:true};
}
export function observerArrival({kind = 'artillery',roll,scatterDice = [],radiusDie,targetDestroyed = false} = {}) {
  const value=d6(roll);
  if (kind==='air') return {arrived:value===1 || value>=4,delayed:value===2 || value===3,retargetEnemy:value===1,mayRetarget:value===2 || value===3,wasted:value>=4 && targetDestroyed,aircraftOffset:18};
  if (!['artillery','smoke'].includes(kind)) throw new RangeError('Unknown observer mission');
  const delayed=value===2 || value===3,scatter=value===1;
  if (scatter && scatterDice.length!==3) throw new RangeError('Supply three scatter dice');
  return {arrived:!delayed,delayed,retargetDistance:delayed ? 12 : 0,scatterDistance:scatter ? scatterDice.reduce((a,n)=>a+d6(n),0) : 0,randomDirection:scatter,radius:delayed ? 0 : kind==='smoke' ? 6 : d6(radiusDie)+6,softCover:kind==='smoke',dense:kind==='smoke'};
}
export function barrageUnit({roll,pinDie,modelsHit = 0,down = false,vehicle = false,building = false,buildingDice = []} = {}) {
  const direct=d6(roll)===6;
  if (!direct) return {direct:false,hits:0,pins:Math.ceil(d6(pinDie)/2)};
  return {direct:true,...heEffect({diameter:4,modelsHit,down,vehicle,building,dice:buildingDice,pinDie}),facing:'top'};
}
export function airStrike({roll,modelsHit = 0,down = false,vehicle = false,damageValue = 7,dice = [],pinDie} = {}) {
  const value=d6(roll),type=value<=2 ? 'strafe' : value<=4 ? 'fighter-bomber' : 'ground-attack';
  if(type==='strafe') {
    if(dice.length!==2) throw new RangeError('Supply two strafing dice');
    const rawHits=dice.reduce((a,n)=>a+d6(n),0),hits=vehicle ? (damageValue>=7 ? 1 : rawHits) : down ? Math.ceil(rawHits/2) : rawHits;
    return {type,hits,rawHits,penetration:2,pins:1,facing:'top',rangeExempt:true};
  }
  const diameter=type==='fighter-bomber' ? 3 : 4;
  return {type,hits:vehicle ? 1 : down ? Math.ceil(modelsHit/2) : modelsHit,rawHits:modelsHit,diameter,penetration:diameter,pins:type==='fighter-bomber' ? Math.ceil(d6(pinDie)/3) : Math.ceil(d6(pinDie)/2),facing:'top',rangeExempt:true};
}
export function airPreliminaryPins({roll} = {}) {return Math.ceil(d6(roll)/2)-1;}
export function flakHoldFire({quality = 'regular',roll} = {}) {
  const target={inexperienced:4,regular:3,veteran:2}[quality]; if(!target) throw new RangeError('Unknown troop quality');
  return {target,held:d6(roll)>=target};
}
export function flakAttack({dice = [],pins = 0,heDiameter = 0,heDice = [],followupDice = []} = {}) {
  const target=5+pins,sixSix=target>6;
  const initial=dice.filter(n=>d6(n)>=(sixSix ? 6 : target)).length;
  if(sixSix && followupDice.length<initial) return {target,sixSix,hits:null,needsFollowupDice:initial,needsHeDice:0,aborted:false};
  const candidates=sixSix ? followupDice.slice(0,initial).filter(n=>d6(n)===6).length : initial;
  let hits=candidates;
  if(heDiameter) {
    const profile=heProfile(heDiameter),needed=candidates*profile.buildingDice;
    if(heDice.length!==needed) return {target,sixSix,hits:null,needsHeDice:needed,needsFollowupDice:0,aborted:false};
    hits=heDice.reduce((a,n)=>a+(profile.buildingSides===3 ? Math.ceil(d6(n)/2) : d6(n)),0);
  }
  return {target,sixSix,hits,needsHeDice:0,needsFollowupDice:0,aborted:hits>=3};
}
export function smokeDrift({roll,distanceDie} = {}) {
  const value=d6(roll); return {removed:value===1,drift:value===2 ? d6(distanceDie) : 0,randomDirection:value===2};
}
export function reserveEntry({round = 1,outflank = false,topSecret = false,order = 'advance',tableDepth = Infinity,...testOptions} = {}) {
  if (!Number.isInteger(round) || round<1) throw new RangeError('Supply a positive game round');
  const earliest=outflank ? 3 : topSecret ? 1 : 2;
  const canEnter=round>=earliest;
  const eligibleOrder=['advance','run'].includes(order);
  if(order==='down') return {legal:true,entered:false,order:'down',waiting:true,inBag:true};
  if(!canEnter || !eligibleOrder) return {legal:false,entered:false,order:'down',waiting:true,inBag:true,earliest};
  const test=orderTest({...testOptions,order,forceTest:true,modifier:(testOptions.modifier ?? 0)-1});
  return {legal:true,entered:test.passed,test,order:test.order,waiting:!test.passed,inBag:true,mayAssault:false,mayExit:false,maxEntryDistance:outflank ? Math.min(tableDepth,24+(round-3)*12) : null,earliest};
}
