import test from 'node:test';
import assert from 'node:assert/strict';
import {profiles} from '../fvtt/scripts/services/group-profiles.mjs';
test('all three models inherit their assigned team faction, overriding source references without copying',async()=>{
 const traitA={uuid:'Item.ruleA',type:'trait',system:{slug:'a'}},traitB={uuid:'Item.ruleB',type:'trait',system:{slug:'b'}},personal={uuid:'Item.personal',type:'trait',system:{slug:'personal'}};
 const a={uuid:'Item.factionA',type:'faction',system:{traitUuids:[traitA.uuid]}},b={uuid:'Item.factionB',type:'faction',system:{traitUuids:[traitB.uuid]}};
 const docs=[a,b,traitA,traitB,personal];globalThis.fromUuid=async uuid=>docs.find(d=>d.uuid===uuid);
 const team={type:'army',system:{factionUuid:a.uuid},items:[]};
 for(const type of ['model','modelStatic','modelVehicle']){
  const model={type,army:team,system:{sourceFactionUuid:b.uuid,traitUuids:[personal.uuid]},items:[]};
  let inherited=await profiles(model);assert.equal(inherited.faction,a);assert.deepEqual(inherited.traits,[personal,traitA]);
  team.system.factionUuid=b.uuid;inherited=await profiles(model);assert.equal(inherited.faction,b);assert.deepEqual(inherited.traits,[personal,traitB]);
  assert.equal(model.system.sourceFactionUuid,b.uuid);team.system.factionUuid=a.uuid;
 }
});
