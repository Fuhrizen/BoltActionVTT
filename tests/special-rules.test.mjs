import test from 'node:test';
import assert from 'node:assert/strict';
import * as r from '../fvtt/scripts/rules/index.mjs';

test('HE profiles, one pin batch, Down rounding and building collapse',()=>{
  assert.deepEqual([1,2,3,4].map(n=>r.heProfile(n).pinSides),[2,3,3,6]);
  assert.equal(r.heEffect({diameter:1,modelsHit:5,down:true,pinDie:4}).hits,3);
  assert.equal(r.heEffect({diameter:1,modelsHit:5,pinDie:4}).pins,2);
  assert.equal(r.heEffect({diameter:4,modelsHit:3,vehicle:true,pinDie:3}).hits,1);
  const building=r.heEffect({diameter:3,building:true,dice:[5,5],down:true,pinDie:2});
  assert.equal(building.hits,5); assert.equal(building.rawHits,10); assert.equal(building.buildingCollapsed,true);
  assert.equal(r.heEffect({diameter:1,building:true,dice:[5],pinDie:1}).hits,3);
});
test('HE templates deduplicate intersecting bases, disallow friend clips and invalid layouts',()=>{
  const models=[{id:'a',unitUuid:'u',x:0,y:0,radius:.5},{id:'b',unitUuid:'u',x:1,y:0,radius:.5},{id:'c',unitUuid:'v',x:2,y:0,radius:.5,friendly:true}];
  const hit=r.heTemplate({diameter:1,centres:[{x:0,y:0},{x:1,y:0}],models});
  assert.equal(hit.hitsByUnit.u,2); assert.equal(hit.friendlyClipped,true); assert.equal(hit.legal,false);
  assert.equal(r.heTemplate({diameter:1,centres:[{x:0,y:0},{x:.5,y:0}]}).validArrangement,false);
  assert.equal(r.heTemplate({diameter:1,centres:[{x:0,y:0},{x:2,y:0}]}).validArrangement,false);
});
test('indirect ranging resets by movement, skipped round, target or direct fire; hit locks 2+',()=>{
  const shot={targetUuid:'u',round:1,range:30,minRange:12,maxRange:60,roll:3};
  const first=r.indirectShot(shot); assert.equal(first.target,6); assert.equal(first.hit,false);
  const second=r.indirectShot({...shot,round:2,state:first.state,roll:5}); assert.equal(second.target,5); assert.equal(second.hit,true);
  assert.equal(r.indirectShot({...shot,round:3,state:second.state,visible:false,roll:2}).hit,true);
  assert.equal(r.indirectShot({...shot,round:3,state:second.state,shooterMoved:true}).target,6);
  assert.equal(r.indirectShot({...shot,round:4,state:second.state}).target,2);
  assert.equal(r.indirectShot({...shot,round:4,state:first.state}).target,6);
  assert.equal(r.indirectShot({...shot,round:3,state:second.state,targetUuid:'other'}).target,6);
  assert.equal(r.indirectShot({...shot,mode:'direct',state:second.state}).state,null);
  assert.equal(r.indirectShot({...shot,range:12,roll:6}).legal,false);
  assert.equal(r.indirectShot({...shot,order:'ambush'}).legal,false);
});
test('flamethrower hit multiplication, D3+1 pins, miss fuel and team loss',()=>{
  const result=r.flamethrower({hit:true,vehicleMounted:true,hitDie:6,pinDie:5,fuelDie:1});
  assert.equal(result.hits,7); assert.equal(result.pins,4); assert.equal(result.exhausted,true); assert.equal(result.removeTeam,false);
  const missed=r.flamethrower({fuelDie:1}); assert.equal(missed.hits,0); assert.equal(missed.removeTeam,true); assert.equal(missed.moraleRequired,false);
  assert.equal(r.weaponAmmo({oneShot:true,used:true}).canFire,false);
  assert.equal(r.weaponAmmo({oneShot:true,fired:true}).used,true);
});
test('gun shields and building protection bypassed by HE, fire and assault',()=>{
  assert.equal(r.gunShieldDamage({quality:'veteran'}),6);
  assert.equal(r.gunShieldDamage({front:false}),4);
  for(const exception of ['he','flamethrower','assault']) assert.equal(r.gunShieldDamage({[exception]:true}),4);
  assert.equal(r.buildingProtection({}),5);
  assert.equal(r.buildingFire({roll:4,targetKind:'artillery'}).destroyed,true);
  assert.equal(r.indirectBuildingFloor({floors:3,dice:[1,4]}).floor,1);
  assert.equal(r.indirectBuildingFloor({floors:3,dice:[1,1]}).floor,0);
});
test('vehicle fire adds a pin before morale and turret jam is conditional on survival',()=>{
  const fire=r.vehicleFire({pins:1,quality:'regular',moraleDice:[3,4],turrets:1});
  assert.equal(fire.morale.target,7); assert.equal(fire.destroyed,false); assert.equal(fire.turretJamRequired,true);
  assert.equal(r.vehicleFire({pins:1,moraleDice:[4,4]}).destroyed,true);
  assert.equal(r.vehicleDamage({roll:3,carriesFlamethrower:true}).destroyed,true);
});
test('infantry vehicle assault uses 4+ stationary, 6 advance, fear, rear ignored and AT limits',()=>{
  assert.equal(r.infantryVehicleAssault({order:'run'}).legal,false);
  const normal=r.infantryVehicleAssault({dice:[4,5,6],damageDie:4,damageValue:7});
  assert.equal(normal.hits,3); assert.equal(normal.superficial,true); assert.equal(normal.tankFear,true);
  const hunter=r.infantryVehicleAssault({dice:[4,5,6],damageDie:6,damageValue:7,tankHunters:true});
  assert.equal(hunter.superficial,false); assert.equal(hunter.tankFear,false);
  assert.equal(r.infantryVehicleAssault({dice:[4,5,6],damageDie:6,order:'advance'}).hits,1);
  assert.equal(r.infantryVehicleAssault({dice:[4,5,6],damageDie:6,openTopped:true}).destroyed,true);
});
test('vehicle ram compares armour, loser and winner damage, ties damage both',()=>{
  assert.equal(r.vehicleRam({attackerArmour:7}).legal,false);
  const ram=r.vehicleRam({attackerArmour:10,defenderArmour:8,attackerDie:1,defenderDie:6});
  assert.equal(ram.attacker.superficial,true); assert.equal(ram.defender.superficial,true);
  const soft=r.vehicleRam({attackerArmour:8,defenderArmour:6,attackerDie:1,defenderDie:6});
  assert.equal(soft.defender.destroyed,true); assert.equal(soft.attacker.damage,false);
  assert.equal(r.tankOverrun({targetKind:'artillery',moralePassed:true}).destroyed,true);
});
test('observer missions enforce Fire and one use; barrage delays, scatter and radius',()=>{
  assert.equal(r.observerCall({used:true}).legal,false);
  assert.equal(r.observerCall({order:'ambush'}).legal,false);
  assert.equal(r.observerArrival({roll:2}).retargetDistance,12);
  const scatter=r.observerArrival({roll:1,scatterDice:[1,2,3],radiusDie:6});
  assert.equal(scatter.scatterDistance,6); assert.equal(scatter.radius,12);
  assert.equal(r.observerArrival({kind:'smoke',roll:4}).radius,6);
  assert.equal(r.barrageUnit({roll:5,pinDie:5}).pins,3);
  const direct=r.barrageUnit({roll:6,pinDie:4,modelsHit:5,down:true});
  assert.equal(direct.hits,3); assert.equal(direct.penetration,4); assert.equal(direct.pins,4);
});
test('air arrival, additional pins, strafing, flak and smoke drift use their own tables',()=>{
  assert.equal(r.observerArrival({kind:'air',roll:1}).retargetEnemy,true);
  assert.equal(r.observerArrival({kind:'air',roll:4,targetDestroyed:true}).wasted,true);
  assert.equal(r.airPreliminaryPins({roll:1}),0); assert.equal(r.airPreliminaryPins({roll:6}),2);
  assert.equal(r.airStrike({roll:1,dice:[4,5],down:true}).hits,5);
  assert.equal(r.airStrike({roll:1,dice:[4,5],vehicle:true,damageValue:6}).hits,9);
  assert.equal(r.airStrike({roll:1,dice:[4,5],vehicle:true,damageValue:7}).hits,1);
  assert.equal(r.airStrike({roll:3,modelsHit:4,pinDie:6}).pins,2);
  assert.equal(r.airStrike({roll:6,modelsHit:4,pinDie:6}).pins,3);
  assert.equal(r.flakHoldFire({quality:'inexperienced',roll:3}).held,false);
  assert.equal(r.flakAttack({dice:[5,6,6]}).aborted,true);
  assert.equal(r.flakAttack({dice:[5,6,6],pins:1}).hits,2);
  assert.equal(r.flakAttack({dice:[6,6],pins:2}).needsFollowupDice,2);
  assert.equal(r.flakAttack({dice:[6,6],pins:2,followupDice:[5,6]}).hits,1);
  assert.equal(r.flakAttack({dice:[6],heDiameter:1,heDice:[5]}).aborted,true);
  assert.equal(r.smokeDrift({roll:2,distanceDie:5}).drift,5);
});
test('reserve dice stay in bag while waiting and forced entry tests take -1 morale',()=>{
  assert.equal(r.reserveEntry({round:1}).legal,false);
  assert.equal(r.reserveEntry({round:1,order:'down'}).inBag,true);
  const arrival=r.reserveEntry({round:2,quality:'veteran',dice:[4,5]});
  assert.equal(arrival.test.target,9); assert.equal(arrival.entered,true); assert.equal(arrival.mayAssault,false);
  assert.equal(r.reserveEntry({round:2,pins:2,dice:[3,4]}).test.target,6);
  assert.equal(r.reserveEntry({round:1,topSecret:true,dice:[2,2]}).entered,true);
  assert.equal(r.reserveEntry({round:2,outflank:true}).legal,false);
  assert.equal(r.reserveEntry({round:3,outflank:true,dice:[2,2]}).maxEntryDistance,24);
  assert.equal(r.reserveEntry({round:5,outflank:true,tableDepth:40,dice:[2,2]}).maxEntryDistance,40);
});
