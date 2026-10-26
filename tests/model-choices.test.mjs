import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getModelChoices,applyModelChoice} from '../fvtt/scripts/services/model-choices.mjs';
import {loadCatalogue,modelTemplate} from '../fvtt/scripts/services/catalogue.mjs';

globalThis.fetch = async path => ({ok:true,json:async()=>JSON.parse(await readFile(new URL(`../fvtt/${path.replace('systems/boltaction/','')}`,import.meta.url),'utf8'))});
let counter = 0;
function item(source) {
  const data = structuredClone(source); data._id ??= `item${++counter}`;
  return {...data,id:data._id,toObject(){const {id,toObject,...source}=this;return structuredClone(source);}};
}
async function model(slug = 'great-britain-regular-infantry') {
  const row = (await loadCatalogue()).units.find(row=>row.slug===slug);
  const source = await modelTemplate(row);
  return {...source,uuid:'Actor.model',isOwner:true,items:source.items.map(item),
    async update(data){if(data['system.quality'])this.system.quality=data['system.quality'];return this;},
    async createEmbeddedDocuments(type,rows){const created=rows.map(item);this.items.push(...created);return created;},
    async deleteEmbeddedDocuments(type,ids){if(this.failDelete){this.failDelete=false;throw new Error('Injected delete failure');}this.items=this.items.filter(item=>!ids.includes(item.id));}
  };
}
async function choose(model,slug,enabled=true) {
  const choice=(await getModelChoices(model)).equipment.find(choice=>(choice.weaponSlug??choice.traitSlug)===slug);
  assert.ok(choice,`Expected choice ${slug}`);
  await applyModelChoice(model,{choiceId:choice.id,enabled});
}

test('actual British infantry has experience and equipment choices with source option prices',async()=>{
  const actor=await model();const choices=await getModelChoices(actor);
  assert.deepEqual(choices.experiences.map(row=>row.value),['inexperienced','regular','veteran']);
  for(const slug of ['rifle','smg','lmg','anti-tank-grenades'])assert.ok(choices.equipment.some(row=>(row.weaponSlug??row.traitSlug)===slug));
  assert.equal(choices.equipment.find(row=>row.weaponSlug==='lmg').cost,20);assert.equal(choices.equipment.find(row=>row.weaponSlug==='lmg').loaderEach,1);
  await applyModelChoice(actor,{experience:'inexperienced'});assert.equal(actor.system.quality,'inexperienced');
  assert.ok((await getModelChoices(actor)).equipment.some(row=>row.weaponSlug==='lmg'));
});
test('primary switches preserve custom gear and repeated switches do not duplicate weapons',async()=>{
  const actor=await model();actor.items.push(item({name:'Custom sidearm',type:'weapon',system:{quantity:1}}));
  const custom=actor.items.at(-1).id;
  await choose(actor,'smg');await choose(actor,'smg');assert.equal(actor.items.length,2);
  await choose(actor,'lmg');assert.equal(actor.items.length,2);
  await choose(actor,'rifle');assert.equal(actor.items.length,2);assert.ok(actor.items.some(item=>item.id===custom));
  assert.equal(actor.items.find(item=>item.flags?.boltaction?.modelChoiceSlot==='primary').flags.boltaction.catalogueSlug,'rifle');
  assert.equal(actor.items.find(item=>item.flags?.boltaction?.modelChoiceSlot==='primary').system.cost,undefined);
});
test('optional trait toggles are idempotent and leave actor data unchanged',async()=>{
  const actor=await model();const before=structuredClone(actor.system);
  await choose(actor,'anti-tank-grenades');await choose(actor,'anti-tank-grenades');
  assert.equal(actor.items.filter(item=>item.type==='trait').length,1);
  const trait=actor.items.find(item=>item.type==='trait');assert.equal(trait.system.slug,'anti-tank-grenades');assert.equal(trait.system.category,undefined);assert.ok(trait.system.effect);
  await choose(actor,'anti-tank-grenades',false);await choose(actor,'anti-tank-grenades',false);
  assert.equal(actor.items.filter(item=>item.type==='trait').length,0);assert.deepEqual(actor.system,before);
});
test('a single-quality source profile stays restricted and displays an existing custom quality',async()=>{
  const actor=await model('imperial-japan-militia');
  assert.deepEqual((await getModelChoices(actor)).experiences.map(row=>row.value),['inexperienced']);
  await assert.rejects(applyModelChoice(actor,{experience:'veteran'}),/Unknown experience/);
  actor.system.quality='regular';
  const choices=(await getModelChoices(actor)).experiences;
  assert.deepEqual(choices.map(row=>row.value),['inexperienced','regular']);assert.equal(choices.find(row=>row.value==='regular').selected,true);
});
test('existing optional traits are recognized without creating duplicate items',async()=>{
  const actor=await model();actor.items.push(item({name:'Anti-tank grenades',type:'trait',system:{slug:'anti-tank-grenades',effect:'Existing effect',notes:''}}));
  assert.equal((await getModelChoices(actor)).equipment.find(row=>row.traitSlug==='anti-tank-grenades').selected,true);
  await choose(actor,'anti-tank-grenades');assert.equal(actor.items.filter(item=>item.type==='trait').length,1);
  await choose(actor,'anti-tank-grenades',false);assert.equal(actor.items.filter(item=>item.type==='trait').length,0);
});
test('failed weapon switch rolls back original identity and experience',async()=>{
  const actor=await model();const before=actor.items.map(item=>item.toObject());
  const choice=(await getModelChoices(actor)).equipment.find(choice=>choice.weaponSlug==='smg');
  actor.failDelete=true;
  await assert.rejects(applyModelChoice(actor,{choiceId:choice.id,experience:'veteran'}),/Injected delete/);
  assert.equal(actor.system.quality,'regular');assert.deepEqual(actor.items.map(item=>item.toObject()),before);
});
test('unowned, compendium, and unknown selections reject before mutation',async()=>{
  const actor=await model();const original=actor.items.map(item=>item.toObject());
  actor.isOwner=false;await assert.rejects(applyModelChoice(actor,{experience:'veteran'}),/own/);
  actor.isOwner=true;actor.pack='world.models';await assert.rejects(applyModelChoice(actor,{experience:'veteran'}),/world/);
  delete actor.pack;await assert.rejects(applyModelChoice(actor,{choiceId:'arbitrary-code'}),/Unknown/);
  assert.equal(actor.system.quality,'regular');assert.deepEqual(actor.items.map(item=>item.toObject()),original);
});
test('Sherman gun conversion keeps other mounted weapons and restores its original gun',async()=>{
  const actor=await model('great-britain-sherman-75');
  const others=actor.items.filter(item=>item.name!=='Medium anti-tank gun').map(item=>item.id);
  await choose(actor,'medium-howitzer');assert.equal(actor.items.length,3);
  const gun=actor.items.find(item=>item.flags?.boltaction?.catalogueSlug==='medium-howitzer');assert.equal(gun.flags.boltaction.mount,'turret');
  await choose(actor,'medium-at-gun');assert.equal(actor.items.length,3);
  for(const id of others)assert.ok(actor.items.some(item=>item.id===id));
});

test('source equipment maxima reject over-purchasing before item mutation',async()=>{const actor=await model();actor.system.unitUuid='Actor.squad';const choice=(await getModelChoices(actor)).equipment.find(c=>c.weaponSlug==='lmg');globalThis.game={actors:[actor,{uuid:'Actor.peer',system:{unitUuid:'Actor.squad'},items:[{type:'weapon',flags:{boltaction:{modelChoiceId:choice.id,catalogueSlug:'lmg'}}}]}]};const before=actor.items.length;await assert.rejects(applyModelChoice(actor,{choiceId:choice.id}),/limited/);assert.equal(actor.items.length,before);});
test('per-model-priced squad upgrades toggle every purchased model together',async()=>{const one=await model(),two=await model();one.uuid='Actor.one';two.uuid='Actor.two';const squad={uuid:'Actor.squad',type:'unit',isOwner:true,system:{modelUuids:[one.uuid,two.uuid]}};for(const member of [one,two]){member.unit=squad;member.system.unitUuid=squad.uuid;}globalThis.game={actors:[squad,one,two]};await choose(one,'anti-tank-grenades');assert.ok(one.items.some(i=>i.type==='trait'));assert.ok(two.items.some(i=>i.type==='trait'));await choose(two,'anti-tank-grenades',false);assert.ok([one,two].every(m=>!m.items.some(i=>i.type==='trait')));});

test('vehicle variant choices apply priced loadouts reversibly without overwriting custom equipment',async()=>{
 const actor=await model('germany-sdkfz234');const custom=item({name:'Custom gear',type:'weapon',system:{slug:'custom'}});actor.items.push(custom);
 const before=actor.items.map(i=>i.id);const choice=(await getModelChoices(actor)).equipment.find(c=>c.label.toLowerCase()==='puma');assert.ok(choice);assert.equal(choice.cost,50);
 await applyModelChoice(actor,{choiceId:choice.id});assert.ok(actor.items.some(i=>i.system.slug==='medium-at-gun'));assert.ok(actor.items.some(i=>i.id===custom.id));assert.ok((await getModelChoices(actor)).equipment.find(c=>c.id===choice.id).selected);
 const {calculateCost}=await import('../fvtt/scripts/services/costs.mjs');const cost=await calculateCost(actor);assert.equal(cost.options,50);
 await applyModelChoice(actor,{choiceId:choice.id,enabled:false});assert.deepEqual(new Set(actor.items.map(i=>i.id)),new Set(before));
});
test('vehicle capacity conversions and dependent HMG upgrades are selectable rather than manual',async()=>{
 const actor=await model('united-states-jeep');let config=await getModelChoices(actor);assert.equal(config.manualOptions.length,0);
 const mmg=config.equipment.find(c=>c.weaponSlug==='mmg');await applyModelChoice(actor,{choiceId:mmg.id});
 const hmg=(await getModelChoices(actor)).equipment.find(c=>c.weaponSlug==='hmg');await applyModelChoice(actor,{choiceId:hmg.id});assert.ok(actor.items.some(i=>i.system.slug==='hmg'));const {calculateCost}=await import('../fvtt/scripts/services/costs.mjs');assert.equal((await calculateCost(actor)).options,25);await assert.rejects(applyModelChoice(actor,{choiceId:mmg.id,enabled:false}),/dependent upgrade/);await applyModelChoice(actor,{choiceId:hmg.id,enabled:false});
 await applyModelChoice(actor,{choiceId:mmg.id,enabled:false});assert.equal(actor.items.some(i=>i.system.slug==='mmg'),false);
});
