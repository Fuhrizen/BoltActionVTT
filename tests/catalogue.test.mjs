import test from 'node:test';
import assert from 'node:assert/strict';
import {readCatalogue} from '../tools/catalogue.mjs';
import {validateCatalogue,importStarter} from '../scripts/services/catalogue.mjs';
test('catalogue preserves the complete weapon chart and reference integrity',async () => {
  const data = await readCatalogue();
  assert.equal(data.weapons.length,27);
  assert.equal(data.factions.length,5);
  assert.equal(data.weapons.find(row => row.slug==='vehicle-flamethrower').system.shotsFormula,'1d6+1');
  assert.equal(data.weapons.find(row=>row.slug==='heavy-howitzer').system.indirectRange,84);
  assert.equal(data.weapons.find(row=>row.slug==='heavy-howitzer').system.indirectMinRange,36);
  for(const faction of data.factions) {
    const rows=data.units.filter(row=>row.factionSlug===faction.slug);assert.ok(rows.some(row=>row.system.kind==='infantry'));assert.ok(rows.some(row=>row.system.kind==='vehicle'));
    for(const row of rows)assert.match(row.profile.sourcePage,/^\d+$/);
  }
  const unknownFaction=structuredClone(data);unknownFaction.units[0].factionSlug='missing';assert.throws(()=>validateCatalogue(unknownFaction),/Unknown unit faction/);
  const invalid=structuredClone(data); invalid.factions[0].traitSlugs.push('missing');
  assert.throws(()=>validateCatalogue(invalid),/Unknown faction trait/);
});
test('GM importer creates real packs, reciprocal squads and remains idempotent',async()=>{
  const data=await readCatalogue(); let sequence=0;
  globalThis.fetch=async url=>({ok:true,json:async()=>structuredClone(data[url.split('/').at(-1).replace('.json','')])});
  const actors=[]; const packs=[];
  globalThis.game={user:{isGM:true},actors,packs};
  const create=async(source,options={})=>{
    const pack=options.pack && packs.find(p=>p.collection===options.pack);
    const doc={...structuredClone(source),uuid:`${pack?'Compendium.'+pack.collection:'Actor'}.${++sequence}`,getFlag(ns,key){return this.flags?.[ns]?.[key]},async update(changes){for(const [key,value] of Object.entries(changes))this.system[key.replace('system.','')]=value;return this}};
    (pack?pack.documents:actors).push(doc);return doc;
  };
  globalThis.CONFIG={Item:{documentClass:{create}},Actor:{documentClass:{create}}};
  globalThis.foundry={documents:{collections:{CompendiumCollection:{async createCompendium(metadata){const pack={metadata:{...metadata,packageType:'world'},collection:`world.${metadata.name}`,locked:false,documents:[],async getDocuments(){return [...this.documents]}};packs.push(pack);return pack}}}}};
  const pending=importStarter();assert.equal(importStarter(),pending);const result=await pending;
  assert.equal(packs.length,4);assert.equal(actors.length,14);
  for(const army of result.armies)for(const uuid of army.system.unitUuids){const unit=actors.find(a=>a.uuid===uuid);assert.equal(unit.system.armyUuid,army.uuid);assert.equal(unit.system.modelUuids.length,5);for(const modelUuid of unit.system.modelUuids)assert.equal(actors.find(a=>a.uuid===modelUuid).system.unitUuid,unit.uuid)}
  assert.ok(result.units.every(unit=>unit.system.points===50 && unit.system.factionUuid));
  const templates=packs.find(p=>p.metadata.name==='boltaction-units').documents;
  const named=templates.find(d=>d.flags.boltaction.catalogueSlug==='imperial-japan-regular-infantry');assert.equal(named.system.points,70);assert.equal(named.system.maxSize,15);assert.ok(named.system.factionUuid);
  const chiha=templates.find(d=>d.flags.boltaction.catalogueSlug==='imperial-japan-chi-ha');assert.equal(chiha.items.length,3);assert.equal(chiha.system.damageValue,8);
  const rifles=templates.find(d=>d.flags.boltaction.catalogueSlug==='regular-rifle-squad');
  assert.equal(rifles.items.length,0);assert.equal(rifles.flags.boltaction.composition.reduce((sum,row)=>sum+row.count,0),5);
  const crew=templates.find(d=>d.flags.boltaction.catalogueSlug==='mmg-team');assert.equal(crew.items.length,1);assert.equal(crew.flags.boltaction.composition[0].weaponSlug,'');
  assert.equal(templates.find(d=>d.type==='unit'&&d.system.kind==='vehicle').flags.boltaction.composition,undefined);
  const counts=packs.map(p=>p.documents.length); result.units[0].name='My renamed squad';
  await importStarter();assert.equal(actors.length,14);assert.deepEqual(packs.map(p=>p.documents.length),counts);assert.equal(result.units[0].name,'My renamed squad');
  for(const faction of packs.find(p=>p.metadata.name==='boltaction-factions').documents)assert.ok(faction.system.traitUuids.every(uuid=>packs[0].documents.some(d=>d.uuid===uuid)));
  packs[0].locked=true;await assert.rejects(importStarter(),/Unlock/);packs[0].locked=false;
  game.user.isGM=false;await assert.rejects(importStarter(),/Only the GM/);
});
