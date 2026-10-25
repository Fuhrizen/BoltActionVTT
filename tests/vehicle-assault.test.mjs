import test from 'node:test';
import assert from 'node:assert/strict';
import {vehicleAssault} from '../scripts/services/vehicle-assault.mjs';
let queued, messages;
function doc(name,kind,damageValue,side){return {name,uuid:`Actor.${name}`,type:'unit',isOwner:true,effectiveSide:side,damageValue,livingMembers:Array(5).fill({}),system:{kind,order:'run',moveRun:12,quality:'regular',pins:0,ncoAlive:true,moraleBonus:0},flags:{},getFlag(namespace,key){return this.flags[namespace]?.[key];},async update(data){for(const [key,value]of Object.entries(data)){const fields=key.split('.');let at=this;for(const f of fields.slice(0,-1))at=at[f]??={};at[fields.at(-1)]=value;}}};}
function setup(attackerKind='infantry',targetKind='vehicle',attackerArmour=4,targetArmour=8){
 queued=[];messages=[];const attacker=doc('Attacker',attackerKind,attackerArmour,'allies'),target=doc('<Enemy>',targetKind,targetArmour,'axis');target.system.order='';
 globalThis.game={combat:{round:2,getFlag:()=>({activeUnitUuid:attacker.uuid})}};globalThis.fromUuid=async uuid=>uuid===target.uuid?target:null;
 globalThis.Roll=class{constructor(formula){this.count=Number(formula.split('d')[0]);}async evaluate(){const values=queued.shift();assert.equal(values.length,this.count);this.dice=[{results:values.map(result=>({result}))}];return this;}};
 globalThis.foundry={documents:{ChatMessage:{getSpeaker:()=>({}),create:async data=>messages.push(data)}}};
 return {attacker,target,options:{targetUuid:target.uuid,range:6,geometryConfirmed:true,reactionsResolved:true,orderTestConfirmed:true}};
}
test('infantry attacks front armour, consumes Run once and never removes the target',async()=>{
 const {attacker,target,options}=setup();queued=[[4,4,4,4,4],[3],[4]];
 const result=await vehicleAssault(attacker,options);assert.equal(result.mode,'infantry');assert.equal(result.hits,5);assert.equal(result.superficial,true);assert.equal(result.damageResults[0].effect,'stunned');assert.equal(attacker.system.assaultResolved,true);assert.equal(target.system.destroyed,undefined);assert.ok(messages[0].content.includes('&lt;Enemy&gt;'));await assert.rejects(vehicleAssault(attacker,options),/already resolved/);
});
test('fear, moving target, geometry, ownership and arrival restrictions reject before consuming dice',async()=>{
 const {attacker,target,options}=setup();
 await assert.rejects(vehicleAssault(attacker,{...options,orderTestConfirmed:false}),/Tank fear/);
 await assert.rejects(vehicleAssault(attacker,{...options,reactionsResolved:false}),/reaction fire/);
 target.system.order='run';await assert.rejects(vehicleAssault(attacker,options),/Run speed/);target.system.order='';
 attacker.system.arrivalRound=2;await assert.rejects(vehicleAssault(attacker,options),/arrival round/);attacker.system.arrivalRound=0;
 attacker.isOwner=false;await assert.rejects(vehicleAssault(attacker,options),/Own a world/);assert.equal(attacker.system.assaultResolved,undefined);assert.equal(messages.length,0);
});
test('open-topped target needs no fear confirmation and is destroyed on scored damage',async()=>{
 const {attacker,target,options}=setup();target.system.openTopped=true;queued=[[4,4,4,4,4],[3]];
 const result=await vehicleAssault(attacker,{...options,orderTestConfirmed:false});assert.equal(result.destroyed,true);assert.deepEqual(result.damageResults,[]);
});
test('ram resolves equal-armour damage for both vehicles and prevents another assault',async()=>{
 const {attacker,target,options}=setup('vehicle','vehicle',9,9);queued=[[6,1],[4],[4]];
 const result=await vehicleAssault(attacker,options);assert.equal(result.attacker.damage,true);assert.equal(result.attacker.superficial,true);assert.equal(result.defender.damage,true);assert.equal(result.damageResults.length,2);assert.equal(target.system.order,'');assert.equal(target.system.pins,0);
 await assert.rejects(vehicleAssault(attacker,{...options,continueOverrun:true}),/already resolved/);
});
test('tank overrun resolves morale, artillery loss and continued path without repeated targets',async()=>{
 const {attacker,target,options}=setup('vehicle','artillery',8,4);queued=[[1,1]];
 const result=await vehicleAssault(attacker,options);assert.equal(result.destroyed,true);assert.equal(result.morale.passed,true);assert.equal(result.mode,'overrun');
 await assert.rejects(vehicleAssault(attacker,{...options,continueOverrun:true}),/already resolved along/);
 const second=doc('Second','infantry',4,'axis');second.system.order='';globalThis.fromUuid=async uuid=>uuid===second.uuid?second:target;queued=[[6,6]];
 const next=await vehicleAssault(attacker,{...options,targetUuid:second.uuid,continueOverrun:true});assert.equal(next.destroyed,true);assert.equal(next.morale.passed,false);assert.equal(attacker.flags.boltaction.vehicleAssaultTargets.length,2);
});
test('a non-tank vehicle cannot ram and friendly assault cannot be selected',async()=>{
 const {attacker,target,options}=setup('vehicle','vehicle',7,8);await assert.rejects(vehicleAssault(attacker,options),/Only a mobile tank/);attacker.damageValue=8;target.effectiveSide='allies';await assert.rejects(vehicleAssault(attacker,options),/enemy unit/);
});
