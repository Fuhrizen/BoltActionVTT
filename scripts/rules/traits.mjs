/** Source-checked trait decisions. Callers supply legal geometry, trait references and dice. */
const d6 = value => {if(!Number.isInteger(value)||value<1||value>6)throw new RangeError('Supply a D6 result');return value;};
const count = (value,name) => {if(!Number.isInteger(value)||value<0)throw new RangeError(`Invalid ${name}`);return value;};
// Supported means a primitive exists here; the caller must invoke event-specific helpers.
const known = new Set(['machine-gun-training','fire-and-manoeuvre','shirkers','stubborn','morale-reroll','banzai-charge','fanatics','death-before-dishonour','air-support','tough-fighters','green','sniper','initiative-training','assault','team','tank-hunters']);
const factionTraits = {
 germany:['initiative-training','machine-gun-training'],
 'united-states':['fire-and-manoeuvre','air-support'],
 'soviet-union':['morale-reroll'],
 'imperial-japan':['banzai-charge','death-before-dishonour','fanatics']
};
export function traitSlugs(traits=[]) {
 return [...new Set(Array.from(traits,trait=>typeof trait==='string'?trait:trait?.system?.slug??trait?.slug).filter(Boolean))];
}
export function resolveTraitModifiers({traits=[],factionSlug='',kind='infantry',weaponSlug='',weaponTraits=[],moved=false,pins=0,testType='shooting',wouldBeDestroyed=false,livingSize=0,order='',closestVisibleEnemyConfirmed=false}={}) {
 count(pins,'pins');count(livingSize,'living size');
 if(!['order','morale','shooting'].includes(testType))throw new RangeError('Unknown test type');
 const slugs=new Set([...traitSlugs(traits),...(factionTraits[factionSlug]??[])]), weapons=new Set(traitSlugs(weaponTraits));
 const has=slug=>slugs.has(slug), troop=kind==='infantry'||kind==='artillery';
 const automaticBanzai=testType==='order'&&kind==='infantry'&&has('banzai-charge')&&order==='run'&&closestVisibleEnemyConfirmed;
 const fanaticProtection=troop&&has('fanatics')&&livingSize>=2;
 const supported=[...slugs].filter(slug=>known.has(slug));
 const manual=[...slugs].filter(slug=>!known.has(slug));
 if(has('banzai-charge')&&order==='run'&&!closestVisibleEnemyConfirmed)manual.push('banzai-direction-confirmation');
 return {
  extraShots:has('machine-gun-training')&&['lmg','mmg'].includes(weaponSlug)?1:0,
  ignoreMovedPenalty:Boolean(moved&&(weapons.has('assault')||has('assault')||(has('fire-and-manoeuvre')&&kind==='infantry'&&['rifle','automatic-rifle'].includes(weaponSlug)))),
  effectivePins:has('shirkers')?pins*2:pins,
  forceOrderTest:testType==='order'&&has('shirkers'),
  ignoreMoralePins:testType==='morale'&&has('stubborn'),
  moraleRerollEligible:testType==='morale'&&has('morale-reroll')&&troop&&wouldBeDestroyed,
  automaticBanzai,couragePinRemoval:automaticBanzai,
  ignoreCasualtyMorale:fanaticProtection,ignorePinRout:fanaticProtection,
  continueLostAssault:fanaticProtection,
  automaticallyPassTankAssaultMorale:has('death-before-dishonour')&&troop,
  airObserverUses:has('air-support')?2:1,
  toughFighters:has('tough-fighters')||weapons.has('assault'),
  tankHunters:has('tank-hunters'),supported,manual
 };
}
export function greenResult({resolved=false,quality='inexperienced',roll,pinDie}={}) {
 if(resolved)return {resolved:true,quality,changed:false,pinsAdded:0,order:null};
 const value=d6(roll);
 return {resolved:true,quality:value>=5?'regular':quality,changed:value>=5,pinsAdded:value===1?d6(pinDie):0,order:value===1?'down':null};
}
export function initiativeTraining({roll,remainingOtherModels=0}={}) {
 count(remainingOtherModels,'remaining other models');
 const replaced=d6(roll)>=2&&remainingOtherModels>0;
 return {replaced,ncoAlive:replaced,chooseOtherCasualty:replaced,moralePenalty:replaced?0:-1};
}
export function toughFighterDamage({initialDice=[],bonusDice=[],damageValue=4}={}) {
 const casualties=initialDice.filter(value=>d6(value)!==1&&value>=damageValue).length;
 if(bonusDice.length>casualties)throw new RangeError('Only one bonus damage roll per initial casualty');
 const extraCasualties=bonusDice.filter(value=>d6(value)!==1&&value>=damageValue).length;
 return {initialCasualties:casualties,extraCasualties,casualties:casualties+extraCasualties,needsBonusDice:casualties-bonusDice.length};
}
export function sniperShot({order='fire',range,pins=0,loneOperator=false,hitDie,followupDie,damageDie,damageValue=4}={}) {
 count(pins,'pins');
 if(!Number.isFinite(range)||range<0)throw new RangeError('Invalid range');
 const legal=['fire','ambush'].includes(order),inRange=range>12&&range<=36,target=3+pins+Number(loneOperator),sixSix=target>6;
 const base={legal,inRange,target,sixSix,ignoreGunShield:true,ignoreBuildingProtection:true};
 if(!legal||!inRange)return {...base,hit:false,casualty:false,exceptional:false};
 if(hitDie===undefined)return {...base,needsHitDie:true,hit:null,casualty:false,exceptional:false};
 const initial=d6(hitDie),needsFollowup=sixSix&&initial===6&&followupDie===undefined;
 const hit=sixSix?initial===6&&followupDie!==undefined&&d6(followupDie)===6:initial>=target;
 const casualty=Boolean(hit&&damageDie!==undefined&&d6(damageDie)!==1&&damageDie>=damageValue);
 return {...base,hit,needsFollowup,needsDamageDie:hit&&damageDie===undefined,casualty,exceptional:casualty};
}
