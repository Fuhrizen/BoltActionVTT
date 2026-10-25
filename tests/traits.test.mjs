import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveTraitModifiers,greenResult,initiativeTraining,toughFighterDamage,sniperShot} from '../scripts/rules/traits.mjs';
test('German light and medium MG bonus includes vehicle mounts but excludes heavy MG',()=>{
 for(const kind of ['infantry','vehicle'])for(const weaponSlug of ['lmg','mmg'])assert.equal(resolveTraitModifiers({factionSlug:'germany',kind,weaponSlug}).extraShots,1);
 assert.equal(resolveTraitModifiers({factionSlug:'germany',weaponSlug:'hmg'}).extraShots,0);
});
test('US infantry rifle and BAR movement exemption does not cover other weapons or vehicles',()=>{
 for(const weaponSlug of ['rifle','automatic-rifle'])assert.equal(resolveTraitModifiers({factionSlug:'united-states',weaponSlug,moved:true}).ignoreMovedPenalty,true);
 assert.equal(resolveTraitModifiers({factionSlug:'united-states',weaponSlug:'mmg',moved:true}).ignoreMovedPenalty,false);
 assert.equal(resolveTraitModifiers({factionSlug:'united-states',weaponSlug:'rifle',kind:'vehicle',moved:true}).ignoreMovedPenalty,false);
 assert.equal(resolveTraitModifiers({weaponTraits:['assault'],moved:true}).ignoreMovedPenalty,true);
});
test('shirkers force orders and double pins; stubborn exempts only morale pins',()=>{
 assert.deepEqual(Object.fromEntries(Object.entries(resolveTraitModifiers({traits:['shirkers','stubborn'],pins:2,testType:'order'})).filter(([k])=>['effectivePins','forceOrderTest','ignoreMoralePins'].includes(k))),{effectivePins:4,forceOrderTest:true,ignoreMoralePins:false});
 assert.equal(resolveTraitModifiers({traits:['stubborn'],pins:2,testType:'morale'}).ignoreMoralePins,true);
});
test('Soviet destruction morale reroll excludes orders and vehicles',()=>{
 assert.equal(resolveTraitModifiers({factionSlug:'soviet-union',testType:'morale',wouldBeDestroyed:true}).moraleRerollEligible,true);
 assert.equal(resolveTraitModifiers({factionSlug:'soviet-union',testType:'order',wouldBeDestroyed:true}).moraleRerollEligible,false);
 assert.equal(resolveTraitModifiers({factionSlug:'soviet-union',kind:'vehicle',testType:'morale',wouldBeDestroyed:true}).moraleRerollEligible,false);
});
test('banzai needs explicit closest-enemy direction while fanatic protection ends at one model',()=>{
 const input={factionSlug:'imperial-japan',kind:'infantry',testType:'order',order:'run',livingSize:2};
 assert.equal(resolveTraitModifiers(input).automaticBanzai,false);
 const result=resolveTraitModifiers({...input,closestVisibleEnemyConfirmed:true});assert.equal(result.automaticBanzai,true);assert.equal(result.couragePinRemoval,true);assert.equal(result.ignorePinRout,true);
 assert.equal(resolveTraitModifiers({...input,livingSize:1}).ignoreCasualtyMorale,false);
 assert.equal(resolveTraitModifiers({...input,kind:'artillery',closestVisibleEnemyConfirmed:true}).automaticBanzai,false);
});
test('green and initiative decisions require supplied dice and preserve one-time state',()=>{
 assert.deepEqual(greenResult({roll:1,pinDie:4}),{resolved:true,quality:'inexperienced',changed:false,pinsAdded:4,order:'down'});
 assert.equal(greenResult({roll:5}).quality,'regular');assert.equal(greenResult({resolved:true,quality:'regular'}).changed,false);
 assert.equal(initiativeTraining({roll:2,remainingOtherModels:1}).ncoAlive,true);
 assert.equal(initiativeTraining({roll:6,remainingOtherModels:0}).ncoAlive,false);
});
test('tough fighters roll bonuses once per initial casualty without recursive attacks',()=>{
 const first=toughFighterDamage({initialDice:[1,4,6],damageValue:4});assert.equal(first.needsBonusDice,2);
 const result=toughFighterDamage({initialDice:[1,4,6],bonusDice:[6,6],damageValue:4});assert.equal(result.casualties,4);assert.equal(result.needsBonusDice,0);
 assert.throws(()=>toughFighterDamage({initialDice:[1],bonusDice:[6]}),/one bonus/);
});
test('scope uses exclusive twelve-inch minimum, stationary orders and automatic exceptional kills',()=>{
 assert.equal(sniperShot({range:12,hitDie:6,damageDie:6}).hit,false);
 assert.equal(sniperShot({range:13,order:'advance',hitDie:6,damageDie:6}).legal,false);
 const result=sniperShot({range:36,pins:1,loneOperator:true,hitDie:5,damageDie:4});assert.equal(result.target,5);assert.equal(result.exceptional,true);
 assert.equal(sniperShot({range:24,pins:4,hitDie:6}).needsFollowup,true);
 assert.equal(sniperShot({range:24,pins:4,hitDie:6,followupDie:6,damageDie:4}).casualty,true);
});
test('Item-like trait references dedupe and unsupported rules remain explicitly manual',()=>{
 const result=resolveTraitModifiers({traits:[{system:{slug:'stubborn'}},'stubborn','recce'],testType:'morale'});
 assert.deepEqual(result.supported,['stubborn']);assert.deepEqual(result.manual,['recce']);assert.equal(result.ignoreMoralePins,true);
});
