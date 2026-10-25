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
  for(const template of templates.filter(t=>t.flags.boltaction.factionSlug)){
    const faction=packs.find(p=>p.metadata.name==='boltaction-factions').documents.find(f=>f.flags.boltaction.catalogueSlug===template.flags.boltaction.factionSlug);assert.equal(template.system.factionUuid,faction.uuid,template.name);
    for(const uuid of template.system.traitUuids)assert.ok(packs[0].documents.some(d=>d.uuid===uuid),template.name);
  }
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

// Audit index: printed army-list base entries, grouped by their printed page.
// Multiple names sharing one printed profile are retained as profile.aliases.
const requiredArmyEntries = {
  "155": [
    "germany-second-lieutenant",
    "germany-first-lieutenant",
    "germany-captain",
    "germany-major",
    "germany-artillery-observer",
    "germany-air-observer"
  ],
  "156": [
    "germany-wehrmacht",
    "germany-veteran-infantry"
  ],
  "157": [
    "germany-inexperienced-infantry"
  ],
  "158": [
    "germany-mmg",
    "germany-sniper",
    "germany-medium-mortar"
  ],
  "159": [
    "germany-light-artillery",
    "germany-pak40"
  ],
  "160": [
    "germany-panzer-iv",
    "germany-flak36"
  ],
  "161": [
    "germany-panther",
    "germany-tiger-i"
  ],
  "162": [
    "germany-stug"
  ],
  "163": [
    "germany-marder",
    "germany-stuh42",
    "germany-panzerwerfer"
  ],
  "164": [
    "germany-sdkfz7-flak",
    "germany-sdkfz234"
  ],
  "165": [
    "germany-hanomag",
    "germany-truck",
    "germany-kubelwagen"
  ],
  "167": [
    "united-states-second-lieutenant",
    "united-states-first-lieutenant",
    "united-states-captain",
    "united-states-major",
    "united-states-artillery-observer",
    "united-states-air-observer"
  ],
  "168": [
    "united-states-regular-infantry"
  ],
  "169": [
    "united-states-veteran-infantry",
    "united-states-inexperienced-infantry",
    "united-states-mmg"
  ],
  "170": [
    "united-states-bazooka",
    "united-states-sniper"
  ],
  "171": [
    "united-states-medium-mortar",
    "united-states-light-howitzer",
    "united-states-57mm-at"
  ],
  "172": [
    "united-states-m1a2-aa"
  ],
  "173": [
    "united-states-sherman-75",
    "united-states-sherman-76",
    "united-states-stuart",
    "great-britain-stuart",
    "great-britain-sherman-75"
  ],
  "174": [
    "united-states-m10",
    "united-states-priest"
  ],
  "175": [
    "united-states-m16",
    "united-states-greyhound"
  ],
  "176": [
    "united-states-truck",
    "united-states-jeep",
    "united-states-m3-halftrack"
  ],
  "177": [
    "united-states-lvt",
    "great-britain-lvt-buffalo"
  ],
  "179": [
    "great-britain-second-lieutenant",
    "great-britain-first-lieutenant",
    "great-britain-captain",
    "great-britain-major",
    "great-britain-artillery-observer",
    "great-britain-air-observer"
  ],
  "180": [
    "great-britain-regular-infantry",
    "great-britain-veteran-infantry"
  ],
  "181": [
    "great-britain-inexperienced-infantry",
    "great-britain-mmg"
  ],
  "182": [
    "great-britain-piat",
    "great-britain-sniper",
    "great-britain-medium-mortar"
  ],
  "183": [
    "great-britain-light-artillery"
  ],
  "184": [
    "great-britain-6pdr",
    "great-britain-bofors"
  ],
  "185": [
    "great-britain-cromwell",
    "great-britain-firefly"
  ],
  "186": [
    "great-britain-churchill",
    "great-britain-wolverine"
  ],
  "187": [
    "great-britain-priest",
    "great-britain-crusader-aa",
    "great-britain-humber-daimler"
  ],
  "188": [
    "great-britain-truck",
    "great-britain-jeep",
    "great-britain-bren-carrier"
  ],
  "190": [
    "soviet-union-second-lieutenant",
    "soviet-union-first-lieutenant",
    "soviet-union-captain",
    "soviet-union-major",
    "soviet-union-artillery-observer",
    "soviet-union-air-observer"
  ],
  "191": [
    "soviet-union-regular-infantry",
    "soviet-union-veteran-infantry"
  ],
  "192": [
    "soviet-union-inexperienced-infantry",
    "soviet-union-mmg",
    "soviet-union-at-rifle"
  ],
  "193": [
    "soviet-union-medium-mortar"
  ],
  "194": [
    "soviet-union-sniper",
    "soviet-union-zis3",
    "soviet-union-zis2"
  ],
  "195": [
    "soviet-union-t34-76",
    "soviet-union-61k-aa",
    "soviet-union-bt5-bt7"
  ],
  "196": [
    "soviet-union-t34-85",
    "soviet-union-is2"
  ],
  "197": [
    "soviet-union-su85"
  ],
  "198": [
    "soviet-union-su76"
  ],
  "199": [
    "soviet-union-katyusha",
    "soviet-union-tokarev4m"
  ],
  "200": [
    "soviet-union-ba64",
    "soviet-union-truck",
    "soviet-union-gaz-jeep"
  ],
  "202": [
    "imperial-japan-second-lieutenant",
    "imperial-japan-first-lieutenant",
    "imperial-japan-captain",
    "imperial-japan-major",
    "imperial-japan-artillery-observer",
    "imperial-japan-air-observer"
  ],
  "203": [
    "imperial-japan-regular-infantry",
    "imperial-japan-veteran-infantry"
  ],
  "204": [
    "imperial-japan-mmg",
    "imperial-japan-at-rifle",
    "imperial-japan-sniper",
    "imperial-japan-militia"
  ],
  "205": [
    "imperial-japan-light-mortar",
    "imperial-japan-medium-mortar"
  ],
  "206": [
    "imperial-japan-75mm-field",
    "imperial-japan-type1-at",
    "imperial-japan-type98-aa"
  ],
  "207": [
    "imperial-japan-hago"
  ],
  "208": [
    "imperial-japan-chi-ha",
    "imperial-japan-shinhoto-chi-ha",
    "imperial-japan-type98-truck"
  ],
  "209": [
    "imperial-japan-type94",
    "imperial-japan-truck",
    "imperial-japan-kurogane"
  ]
};
test('every audited five-faction army-list base entry has its verified source page',async()=>{
  const data=await readCatalogue();
  const units=new Map(data.units.map(row=>[row.slug,row]));
  for(const [page,slugs] of Object.entries(requiredArmyEntries))for(const slug of slugs){
    const row=units.get(slug);assert.ok(row,`Missing army-list entry ${slug}`);assert.equal(row.profile.sourcePage,page,slug);
    assert.ok(row.system.points>=0,slug);assert.ok(row.count>0,slug);
    if(row.profile.pointsByQuality)assert.equal(row.system.points,row.profile.pointsByQuality[row.system.quality],slug);
    if(row.composition)assert.equal(row.composition.reduce((sum,part)=>sum+part.count,0),row.count,slug);
  }
  assert.equal(Object.values(requiredArmyEntries).flat().length,134);
  const panther=units.get('germany-panther');assert.deepEqual(panther.profile.pointsByQuality,{regular:355,veteran:426});
  assert.equal(units.get('germany-sdkfz234').profile.printedPointsAnomaly,true);
  assert.equal(units.get('imperial-japan-militia').system.quality,'inexperienced');
  assert.equal(units.get('great-britain-churchill').system.moveAdvance,6);
  const carrierOption=units.get('great-britain-bren-carrier').profile.options.find(option=>option.weaponSlug==='mmg');assert.equal(carrierOption.cost,null);assert.equal(carrierOption.unresolvedCost,true);
  assert.equal(units.get('imperial-japan-truck').system.capacity,13);assert.equal(units.get('united-states-jeep').system.moveAdvance,12);assert.equal(units.get('germany-pak40').system.moveRun,0);
  assert.equal(data.traits.find(row=>row.slug==='he-4').profile.parameters.buildingHits,'3d6');
});
