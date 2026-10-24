import test from 'node:test';
import assert from 'node:assert/strict';
import * as r from '../scripts/rules/index.mjs';

test('morale clamps and NCO/pin modifiers combine', () => {
  assert.equal(r.moraleValue({quality:'veteran',pins:1,ncoAlive:false}),8);
  assert.equal(r.moraleValue({pins:20}),2);
  assert.equal(r.moraleValue({moraleBonus:10}),10);
  assert.equal(r.moraleTest({dice:[5,6],moraleBonus:20}).passed,false);
});
test('Down bypasses test without removing pins; ordinary success removes one', () => {
  assert.equal(r.orderTest({order:'down',pins:4}).remainingPins,4);
  assert.equal(r.orderTest({pins:2,dice:[3,4]}).remainingPins,1);
  assert.equal(r.orderTest({pins:2,dice:[4,4]}).order,'down');
});
test('Rally ignores pins but retains leader penalties and removes D6+1 once', () => {
  const result = r.orderTest({order:'rally',pins:7,ncoAlive:false,dice:[4,4],bonusDie:3});
  assert.equal(result.target,8); assert.equal(result.passed,true); assert.equal(result.pinsRemoved,4);
  assert.equal(r.orderTest({order:'rally',pins:7,ncoAlive:false,dice:[4,5],bonusDie:3}).passed,false);
});
test('courage uses D6+1, never D6+2, and cannot create negative pins', () => {
  assert.equal(r.orderTest({pins:8,dice:[1,1],bonusDie:2}).pinsRemoved,3);
  assert.equal(r.orderTest({pins:1,dice:[1,1],bonusDie:6}).remainingPins,0);
  assert.equal(r.orderTest({pins:8,dice:[1,1]}).needsBonusDie,true);
});
test('full strength requires ten or more, maximum purchase, no losses, infantry', () => {
  const base = {fullStrength:true,startingSize:10,maxSize:10,livingSize:10,pins:1,dice:[6,6],rerollDice:[2,2]};
  assert.equal(r.orderTest(base).rerolled,true); assert.equal(r.orderTest(base).fubar,false);
  for (const change of [{livingSize:9},{maxSize:12},{kind:'vehicle'},{startingSize:5,maxSize:5,livingSize:5}]) assert.equal(r.orderTest({...base,...change}).rerolled,false);
});
test('FUBAR selection includes no-target and vehicle panic exceptions', () => {
  assert.equal(r.orderTest({pins:1,dice:[6,6]}).fubar,true);
  assert.equal(r.fubarResult({roll:2,friendlyTargetAvailable:false}).order,'down');
  assert.equal(r.fubarResult({roll:3}).order,'run');
  assert.equal(r.fubarResult({roll:6,kind:'vehicle'}).order,'down');
});
test('shooting boundaries and cumulative modifiers use six-six beyond six', () => {
  assert.equal(r.shootingTarget({range:6}).target,2);
  assert.equal(r.shootingTarget({range:12,weaponRange:24}).modifiers.longRange,0);
  const options = {range:18,weaponRange:24,pins:2,cover:'hard',targetDown:true,moved:true};
  assert.equal(r.shootingTarget(options).sixSix,true);
  assert.equal(r.resolveHits({...options,dice:[6,5,6],followupDice:[6,5]}).hits,1);
  assert.equal(r.resolveHits({range:25,weaponRange:24,dice:[6]}).hits,0);
  assert.equal(r.shootingTarget({range:8,moved:true,assault:true}).modifiers.moved,0);
});
test('infantry damage always fails natural one and uses quality', () => {
  assert.equal(r.infantryDamage({quality:'veteran',dice:[4,5,6]}).casualties,2);
  assert.equal(r.infantryDamage({dice:[1,2],penetration:10}).casualties,1);
  assert.deepEqual(r.infantryDamage({dice:[6,6],exceptionalDice:[6,2]}).exceptional,[0]);
});
test('pin rout uses original morale; casualty morale uses current pre-attack size', () => {
  assert.equal(r.pinRout({quality:'regular',pins:8,ncoAlive:false}),false);
  assert.equal(r.pinRout({quality:'regular',pins:9}),true);
  assert.equal(r.casualtyMoraleRequired({sizeBefore:5,casualties:2}),false);
  assert.equal(r.casualtyMoraleRequired({sizeBefore:5,casualties:3}),true);
});
test('armour exact penetration superficial, +3 massive, small arms ineffective', () => {
  assert.equal(r.armourPenetration({roll:5,penetration:4,damageValue:9}).superficial,true);
  assert.equal(r.armourPenetration({roll:6,penetration:6,damageValue:9}).damageRolls,2);
  assert.equal(r.armourPenetration({roll:1,penetration:20}).damaged,false);
  assert.equal(r.armourPenetration({roll:6,penetration:0,damageValue:7,facing:'rear'}).damaged,false);
  assert.equal(r.armourPenetration({roll:5,penetration:4,damageValue:9,facing:'rear',longRange:true}).total,10);
  assert.equal(r.armourPenetration({roll:6,damageValue:6,facing:'rear',longRange:true}).superficial,false);
});
test('vehicle damage table applies superficial and repeated immobilisation', () => {
  assert.equal(r.vehicleDamage({roll:4,superficial:true}).effect,'stunned');
  assert.equal(r.vehicleDamage({roll:6,superficial:true}).moraleRequired,true);
  assert.equal(r.vehicleDamage({roll:2,alreadyImmobilised:true}).destroyed,true);
  assert.equal(r.vehicleDamage({roll:3,openToppedIndirect:true}).destroyed,true);
  assert.equal(r.vehicleDamage({roll:2,activated:false}).order,null);
  assert.equal(r.vehicleDamage({roll:2,activated:true}).order,'down');
  assert.equal(r.vehicleDamage({roll:3,turrets:1}).turretJamRequired,false);
  assert.equal(r.vehicleDamage({roll:3,turrets:1,fireMoralePassed:true}).turretJamRequired,true);
  assert.equal(r.vehicleDamage({roll:3,fireMoralePassed:false}).destroyed,true);
  assert.equal(r.turretJam({roll:3}).jammed,false);
  assert.equal(r.turretJam({roll:4}).jammed,true);
});
test('vehicle pins respect enclosure, crew quality and theoretical penetration', () => {
  const harmless = {penetration:1,damageValue:10};
  assert.equal(r.vehiclePin({...harmless,quality:'veteran'}).pinned,false);
  assert.equal(r.vehiclePin({...harmless,quality:'inexperienced'}).pinned,true);
  assert.equal(r.vehiclePin(harmless).needsDie,true);
  assert.equal(r.vehiclePin({...harmless,roll:3}).pinned,true);
  assert.equal(r.vehiclePin({...harmless,roll:4}).pinned,false);
  assert.equal(r.vehiclePin({penetration:0,openTopped:true}).pinned,true);
  assert.equal(r.vehiclePin({penetration:0}).pinned,false);
  assert.equal(r.vehiclePin({quality:'veteran',penetration:4,damageValue:10}).pinned,true);
});
test('retained Down removes D3 pins and retained Ambush removes none', () => {
  assert.equal(r.retainOrder({order:'down',pins:5,roll:5}).remainingPins,2);
  assert.equal(r.retainOrder({order:'ambush',pins:5}).remainingPins,5);
  assert.equal(r.retainOrder({order:'fire'}).retained,false);
});
test('assault defenders lose attacks first except defensive positions or later rounds', () => {
  const base = {attackers:2,defenders:2,attackerDice:[4,2],defenderDice:[4]};
  assert.equal(r.assaultRound(base).draw,true);
  assert.equal(r.assaultRound({...base,defensivePosition:true}).needsDefenderDice,2);
  const defended = r.assaultRound({...base,defensivePosition:true,defenderDice:[4,4]});
  assert.equal(defended.winner,'defender'); assert.equal(defended.attackersRemaining,0);
  const survivorWins = r.assaultRound({attackers:2,defenders:3,attackerDice:[4,4],defenderDice:[4,4,4],defensivePosition:true});
  assert.equal(survivorWins.attackerLosses,2); assert.equal(survivorWins.defenderLosses,2);
  assert.equal(survivorWins.winner,'defender');
  const simultaneousWipe = r.assaultRound({attackers:2,defenders:2,attackerDice:[4,4],defenderDice:[4,4],defensivePosition:true});
  assert.equal(simultaneousWipe.bothDestroyed,true); assert.equal(simultaneousWipe.winner,null); assert.equal(simultaneousWipe.draw,false);
});
test('movement profiles respect rough terrain, roads and reverse', () => {
  assert.equal(r.movementBudget({kind:'tracked',order:'run'}).pivots,0);
  assert.equal(r.movementBudget({kind:'wheeled',order:'run',terrain:'road'}).distance,48);
  assert.equal(r.movementBudget({kind:'infantry',order:'run',terrain:'rough'}).allowed,false);
  assert.equal(r.movementBudget({kind:'tracked',reverse:true}).distance,4.5);
  assert.equal(r.movementBudget({kind:'tracked',reverse:true,recce:true}).distance,9);
  assert.equal(r.movementBudget({kind:'artillery',order:'advance'}).distance,0);
  assert.equal(r.movementBudget({kind:'artillery',order:'run',gunClass:'heavy'}).allowed,false);
  assert.equal(r.movementBudget({kind:'artillery',order:'run',crew:1}).allowed,false);
});
test('formation uses connected group, strict gaps and base edges', () => {
  assert.equal(r.checkFormation([{x:0,y:0},{x:.9,y:0},{x:1.8,y:0}]).valid,true);
  assert.equal(r.checkFormation([{x:0,y:0},{x:1,y:0}]).valid,false);
  assert.equal(r.checkFormation([{x:0,y:0,radius:.5},{x:1.9,y:0,radius:.5}]).valid,true);
});
test('bag excludes ineligible units, is immutable and removes destroyed dice', () => {
  const bag = r.createBag([{id:'a',side:'allies'},{id:'b',side:'axis'},{id:'c',destroyed:true},{id:'d',activated:true},{id:'e',retained:true}]);
  const drawn = r.drawOrderDie(bag,() => .99);
  assert.equal(drawn.die.id,'b'); assert.equal(bag.remaining.length,2);
  assert.equal(r.removeOrderDie(drawn.state,'a').remaining.length,0);
  assert.equal(r.drawOrderDie({remaining:[],drawn:[]}).die,null);
});
