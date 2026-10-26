import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {calculateCost} from '../fvtt/scripts/services/costs.mjs';
import {loadCatalogue,modelTemplate,squadTemplate} from '../fvtt/scripts/services/catalogue.mjs';
globalThis.fetch=async url=>({ok:true,json:async()=>JSON.parse(await readFile(new URL('../fvtt/'+url.replace('systems/boltaction/',''),import.meta.url),'utf8'))});
let id=0;
function actor(source){const doc={...structuredClone(source),id:String(++id),uuid:'Actor.'+id,visible:true};doc.items??=[];return doc;}
async function template(slug){const data=await loadCatalogue();return modelTemplate(data.units.find(row=>row.slug===slug));}
function choice(slug,id){return {name:slug,type:'weapon',system:{slug,quantity:1},flags:{boltaction:{catalogueSlug:slug,modelChoiceId:id}}};}
test('British model selections price included equipment once and report unknown custom gear',async()=>{
 const model=actor(await template('great-britain-regular-infantry'));let cost=await calculateCost(model);assert.equal(cost.total,10);assert.deepEqual(cost.unknown,[]);
 model.items=[choice('lmg','primary:primary:lmg')];cost=await calculateCost(model);assert.equal(cost.base,10);assert.equal(cost.options,20);assert.equal(cost.total,30);
 model.items.push({name:'Unlisted gun',type:'weapon',system:{}});cost=await calculateCost(model);assert.equal(cost.total,30);assert.match(cost.unknown[0],/Unlisted gun/);
});
test('squad and army aggregate reciprocal visible purchased models including casualties at squad quality',async()=>{
 const model=actor(await template('great-britain-regular-infantry')),dead=actor(await template('great-britain-regular-infantry')),hidden=actor(await template('great-britain-regular-infantry'));
 const squad=actor({type:'unit',name:'Section',system:{quality:'veteran',modelUuids:[model.uuid,dead.uuid,hidden.uuid]}});const army=actor({type:'army',system:{unitUuids:[squad.uuid]}});
 for(const doc of [model,dead,hidden])doc.system.unitUuid=squad.uuid;squad.system.armyUuid=army.uuid;dead.system.dead=true;hidden.visible=false;globalThis.game={actors:[army,squad,model,dead,hidden]};
 assert.equal((await calculateCost(squad)).total,26);assert.equal((await calculateCost(army)).total,26);
 dead.system.unitUuid='Actor.other';assert.equal((await calculateCost(army)).total,13);
});
test('static crew share base cost while vehicle mounts are included and optional gun is charged once',async()=>{
 const data=await loadCatalogue(),row=data.units.find(row=>row.slug==='united-states-medium-mortar'),source=await squadTemplate(row),members=source.flags.boltaction.memberTemplates.map(actor);
 const packed=actor({...source,pack:'world.squads'});assert.equal((await calculateCost(packed)).total,50);
 const squad=actor({type:'unit',system:{quality:'regular',modelUuids:members.map(m=>m.uuid)}});for(const member of members)member.system.unitUuid=squad.uuid;globalThis.game={actors:[squad,...members]};assert.equal((await calculateCost(squad)).total,50);
 const tank=actor(await template('great-britain-sherman-75'));let cost=await calculateCost(tank);assert.equal(cost.total,195);assert.deepEqual(cost.unknown,[]);
 tank.items.push(choice('hmg','additional:pintle:hmg'));cost=await calculateCost(tank);assert.equal(cost.total,220);
});
test('unpriced custom actors and undocumented experience yield an explicit known subtotal',async()=>{
 const custom=actor({type:'model',name:'Custom',system:{quality:'regular'},items:[]});const cost=await calculateCost(custom);assert.equal(cost.total,0);assert.ok(cost.unknown.length);
 const militia=actor(await template('imperial-japan-militia'));militia.system.quality='veteran';assert.ok((await calculateCost(militia)).unknown.length);
});
async function allowanceSquad(slug,{count,quality,allowance=true}={}){
 const data=await loadCatalogue(),row=data.units.find(row=>row.slug===slug),source=await squadTemplate(row);
 const templates=source.flags.boltaction.memberTemplates;
 const members=Array.from({length:count??templates.length},(_,index)=>{
  const model=actor(templates[Math.min(index,templates.length-1)]);
  if(index>=templates.length&&['observer','officer','medic'].includes(model.system.role))model.system.role='attendant';
  return model;
 });
 const squad=actor({...source,system:{...source.system,quality:quality??source.system.quality,nationalAllowance:allowance,modelUuids:members.map(member=>member.uuid)}});
 for(const member of members)member.system.unitUuid=squad.uuid;
 return {squad,members};
}
function placeArmy(faction,...groups){
 const army=actor({type:'army',flags:{boltaction:{factionSlug:faction}},system:{unitUuids:groups.map(group=>group.squad.uuid)}});
 for(const group of groups)group.squad.system.armyUuid=army.uuid;
 globalThis.game={actors:[army,...groups.flatMap(group=>[group.squad,...group.members])]};return army;
}
test('British allowance waives one regular artillery observer base, retaining attendants',async()=>{
 const group=await allowanceSquad('great-britain-artillery-observer',{count:3});const army=placeArmy('great-britain',group);
 const before=structuredClone(group.squad);const cost=await calculateCost(group.squad);assert.equal(cost.total,20);assert.deepEqual(cost.unknown,[]);assert.equal((await calculateCost(army)).total,20);assert.deepEqual(group.squad,before);
 group.squad.system.nationalAllowance=false;assert.equal((await calculateCost(group.squad)).total,120);
});
test('Soviet allowance waives the twelve-model inexperienced squad and its source options',async()=>{
 const group=await allowanceSquad('soviet-union-inexperienced-infantry',{count:12});
 group.members[0].items=[choice('lmg','primary:primary:lmg')];
 for(const member of group.members)member.items.push({name:'Anti-tank grenades',type:'trait',system:{slug:'anti-tank-grenades'},flags:{boltaction:{catalogueSlug:'anti-tank-grenades',modelChoiceId:'trait:anti-tank-grenades'}}});
 const army=placeArmy('soviet-union',group);let cost=await calculateCost(army);assert.equal(cost.total,0);assert.deepEqual(cost.unknown,[]);
 group.squad.system.nationalAllowance=false;assert.equal((await calculateCost(army)).total,128);
});
test('invalid national allowance flags keep the full cost and report why',async()=>{
 const group=await allowanceSquad('soviet-union-inexperienced-infantry',{count:11});placeArmy('soviet-union',group);let cost=await calculateCost(group.squad);assert.equal(cost.total,77);assert.match(cost.unknown.join(' '),/12-model/);
 const air=await allowanceSquad('great-britain-air-observer');placeArmy('great-britain',air);cost=await calculateCost(air.squad);assert.equal(cost.total,75);assert.ok(cost.unknown.length);
 const veteran=await allowanceSquad('great-britain-artillery-observer',{quality:'veteran'});placeArmy('great-britain',veteran);cost=await calculateCost(veteran.squad);assert.equal(cost.total,115);assert.ok(cost.unknown.length);
 const wrongNation=await allowanceSquad('great-britain-artillery-observer');placeArmy('soviet-union',wrongNation);cost=await calculateCost(wrongNation.squad);assert.equal(cost.total,100);assert.match(cost.unknown.join(' '),/Army faction/);
});
test('duplicate allowance is priced normally in both Army and directly opened squad',async()=>{
 const first=await allowanceSquad('great-britain-artillery-observer'),second=await allowanceSquad('great-britain-artillery-observer');const army=placeArmy('great-britain',first,second);
 const cost=await calculateCost(army);assert.equal(cost.total,100);assert.match(cost.unknown.join(' '),/Only one/);
 assert.equal((await calculateCost(first.squad)).total,0);assert.equal((await calculateCost(second.squad)).total,100);
});
test('ambiguous source names use their faction and do not silently pick the first nation',async()=>{
 const officer=actor(await template('great-britain-second-lieutenant'));delete officer.flags.boltaction.catalogueSlug;officer.system.role='officer';officer.system.quality='regular';let cost=await calculateCost(officer);assert.equal(cost.total,50);assert.deepEqual(cost.unknown,[]);
 delete officer.flags.boltaction.factionSlug;delete officer.flags.boltaction.profile;cost=await calculateCost(officer);assert.ok(cost.unknown.length);
});
