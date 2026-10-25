import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {calculateCost} from '../scripts/services/costs.mjs';
import {loadCatalogue,modelTemplate,squadTemplate} from '../scripts/services/catalogue.mjs';
globalThis.fetch=async url=>({ok:true,json:async()=>JSON.parse(await readFile(new URL('../'+url.replace('systems/boltaction/',''),import.meta.url),'utf8'))});
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
