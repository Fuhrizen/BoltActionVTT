import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {armyBuilderCatalogue,addArmySquad,optionPrice,validateArmy,armyOrbat,createArmyPlatoon,assignSquadPlatoon} from '../fvtt/scripts/services/army-builder.mjs';
globalThis.fetch=async path=>({ok:true,json:async()=>JSON.parse(await readFile(new URL('../fvtt/'+path.replace('systems/boltaction/',''),import.meta.url),'utf8'))});
test('Army catalogue filters source profiles by selected faction without compendium browsing',async()=>{globalThis.fromUuid=async()=>({system:{slug:'great-britain'}});const army={type:'army',isOwner:true,system:{factionUuid:'Item.faction'}};const entries=await armyBuilderCatalogue(army);assert.ok(entries.length>10);assert.ok(entries.every(row=>row.slug.startsWith('great-britain-')&&row.sourcePage));assert.ok(entries.some(row=>row.options.length));army.system.factionUuid='';assert.deepEqual(await armyBuilderCatalogue(army),[]);});
test('Army builder rejects out-of-faction and unauthorized source construction',async()=>{globalThis.fromUuid=async()=>({system:{slug:'great-britain'}});const army={type:'army',isOwner:true,system:{factionUuid:'Item.faction'}};await assert.rejects(addArmySquad(army,'germany-regular-infantry'),/selected Army faction/);army.isOwner=false;await assert.rejects(armyBuilderCatalogue(army),/owned/);});

test('option price metadata distinguishes per-model spending and unresolved prices',()=>{assert.deepEqual(optionPrice({costPerModel:2}),{cost:2,costBasis:'per model',costLabel:'+2 pts per model'});assert.equal(optionPrice({variant:'unknown'}).cost,null);});
test('empty Army fails source-backed generic platoon requirements',async()=>{globalThis.fromUuid=async()=>({system:{slug:'great-britain'}});globalThis.game={actors:[]};const report=await validateArmy({uuid:'Actor.army',type:'army',isOwner:true,system:{factionUuid:'Item.faction',unitUuids:[],pointsLimit:1000}});assert.equal(report.valid,false);assert.ok(report.errors.some(s=>s.includes('squad')));assert.equal(report.selectorSource.page,153);assert.ok(report.errors.some(s=>s.includes('lieutenant')));});

test('generic rulebook platoon validates lieutenant plus two complete infantry squads',async()=>{
 const units=JSON.parse(await readFile(new URL('../fvtt/compendiums/units.json',import.meta.url),'utf8'));
 const army={uuid:'Actor.army',type:'army',isOwner:true,system:{factionUuid:'Item.faction',unitUuids:[],pointsLimit:1000}};
 const actors=[army];
 for(const [index,slug]of ['great-britain-second-lieutenant','great-britain-regular-infantry','great-britain-regular-infantry'].entries()){
  const row=units.find(row=>row.slug===slug),squad={uuid:'Actor.s'+index,name:row.name,type:'unit',system:{armyUuid:army.uuid,quality:'regular',modelUuids:[]},flags:{boltaction:{sourceName:row.name}},items:[]};army.system.unitUuids.push(squad.uuid);actors.push(squad);
  for(let i=0;i<(row.profile.baseModels??row.count);i++){const model={uuid:squad.uuid+'.m'+i,name:'Soldier',type:'model',system:{unitUuid:squad.uuid,quality:'regular',isNco:Boolean(row.profile.ncoCount&&i===0)},flags:{boltaction:{sourceName:row.name}},items:[]};squad.system.modelUuids.push(model.uuid);actors.push(model);}
 }
 globalThis.game={actors};globalThis.fromUuid=async()=>({system:{slug:'great-britain'}});
 const report=await validateArmy(army);assert.deepEqual(report.errors,[]);assert.deepEqual(report.warnings,[]);assert.equal(report.valid,true);assert.equal(report.selectorSource.page,153);
 actors.splice(actors.findIndex(a=>a.uuid==='Actor.s2'),1);const incomplete=await validateArmy(army);assert.equal(incomplete.valid,false);assert.ok(incomplete.errors.some(s=>s.includes('2–5')));
});


test('explicit platoons independently require their commander and infantry, with legacy default assignment',async()=>{
 globalThis.fromUuid=async()=>({system:{slug:'great-britain'}});
 const army={uuid:'Actor.army',type:'army',isOwner:true,system:{factionUuid:'Item.faction',unitUuids:['Actor.a','Actor.b'],platoons:[{id:'one',name:'First'},{id:'two',name:'Second'}]}};
 const make=(uuid,slug,platoonId)=>({uuid,type:'unit',name:slug,system:{armyUuid:army.uuid,platoonId},flags:{boltaction:{catalogueSlug:slug}}});
 globalThis.game={actors:[make('Actor.a','great-britain-second-lieutenant','one'),make('Actor.b','great-britain-regular-infantry','two')]};
 let {platoons}=await armyOrbat(army);assert.equal(platoons[0].commanderUuid,'Actor.a');assert.ok(platoons[0].errors.some(e=>e.includes('2–5')));assert.ok(platoons[1].errors.some(e=>e.includes('lieutenant')));
 game.actors[1].system.platoonId='';({platoons}=await armyOrbat(army));assert.equal(platoons[0].squads.length,2);assert.equal(platoons[1].squads.length,0);
});
test('platoon assignment is ownership guarded but incomplete platoons remain editable',async()=>{
 globalThis.fromUuid=async()=>({system:{slug:'germany'}});const army={uuid:'Actor.army',type:'army',isOwner:true,system:{unitUuids:['Actor.s']},update:async function(data){this.system.platoons=data['system.platoons'];}};
 const squad={uuid:'Actor.s',type:'unit',isOwner:true,system:{armyUuid:army.uuid},update:async function(data){this.system.platoonId=data['system.platoonId'];}};globalThis.game={actors:[squad]};
 const p=await createArmyPlatoon(army,'Second');await assignSquadPlatoon(army,squad,p.id);assert.equal(squad.system.platoonId,p.id);assert.equal((await armyOrbat(army)).platoons[1].valid,false);
 squad.isOwner=false;await assert.rejects(assignSquadPlatoon(army,squad,p.id),/owned/);assert.equal(squad.system.platoonId,p.id);
});
