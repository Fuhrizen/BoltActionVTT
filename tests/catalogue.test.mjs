import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readCatalogue} from '../tools/catalogue.mjs';
import {validateCatalogue,prepareCatalogue,importStarter} from '../scripts/services/catalogue.mjs';
import {factionAppearance,isDefaultModelArt} from '../scripts/services/faction-appearance.mjs';
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
test('GM preparation organizes profiles and refreshes defaults while preserving world identities and custom art',async()=>{
  const data=await readCatalogue(); let sequence=0;
  globalThis.fetch=async url=>({ok:true,json:async()=>structuredClone(data[url.split('/').at(-1).replace('.json','')])});
  const actors=[]; const packs=[];
  globalThis.game={user:{isGM:true},actors,packs};
  const create=async(source,options={})=>{
    const pack=options.pack && packs.find(p=>p.collection===options.pack);
    const doc={...structuredClone(source),uuid:`${pack?'Compendium.'+pack.collection:'Actor'}.${++sequence}`,getFlag(ns,key){return this.flags?.[ns]?.[key]},async update(data){assert.equal(pack.locked,false);for(const[key,value]of Object.entries(data)){const path=key.split('.'),last=path.pop();let target=this;for(const part of path)target=target[part]??={};target[last]=structuredClone(value);}return this;}};
    (pack?pack.documents:actors).push(doc);return doc;
  };
  const createFolder=async(source,options)=>{
    const pack=packs.find(pack=>pack.collection===options.pack);assert.ok(pack,'folders must be created inside the Models pack');assert.equal(pack.locked,false);assert.equal(source.type,'Actor');
    const folder={...structuredClone(source),id:`folder${++sequence}`,async update(data){assert.equal(pack.locked,false);Object.assign(this,structuredClone(data));return this;}};
    pack.folders.push(folder);return folder;
  };
  globalThis.CONFIG={Item:{documentClass:{create}},Actor:{documentClass:{create}},Folder:{documentClass:{create:createFolder}}};
  globalThis.foundry={documents:{collections:{CompendiumCollection:{async createCompendium(metadata){const pack={metadata:{...metadata,packageType:'world'},collection:`world.${metadata.name}`,locked:false,documents:[],folders:[],async getDocuments(){return [...this.documents]}};packs.push(pack);return pack}}}}};
  const pending=prepareCatalogue();assert.equal(importStarter(),pending);const result=await pending;
  assert.equal(packs.length,4);assert.equal(actors.length,0);assert.equal(result.armies,undefined);assert.equal(result.units,undefined);
  const templates=result.packs.models.documents;
  assert.equal(templates.length,142);
  assert.ok(templates.every(t=>['model','modelStatic','modelVehicle'].includes(t.type)));
  assert.ok(templates.every(t=>t.system.unitUuid==='' && !t.system.armyUuid && !t.system.modelUuids));
  for(const template of templates){
    const row=data.units.find(row=>row.slug===template.flags.boltaction.catalogueSlug);
    assert.equal(template.system.profileName,row.name);
    assert.equal(template.name,{model:'Unnamed Soldier',modelStatic:'Unnamed Crew',modelVehicle:'Unnamed Vehicle'}[template.type]);
    const art=factionAppearance(row.factionSlug,template.type);assert.equal(template.img,art.img);assert.equal(template.prototypeToken.texture.src,art.tokenSrc);
  }
  const infantry=templates.find(d=>d.flags.boltaction.catalogueSlug==='germany-wehrmacht');
  assert.equal(infantry.type,'model');assert.equal(infantry.system.basePoints,10);assert.equal(infantry.items.length,1);assert.equal(infantry.items[0].system.slug,'rifle');
  const officer=templates.find(d=>d.flags.boltaction.catalogueSlug==='germany-second-lieutenant');
  assert.equal(officer.type,'model');assert.equal(officer.system.role,'officer');assert.equal(officer.system.basePoints,50);assert.equal(officer.items[0].system.slug,'pistol');
  const crew=templates.find(d=>d.flags.boltaction.catalogueSlug==='germany-mmg');
  assert.equal(crew.type,'modelStatic');assert.equal(crew.system.crew,3);assert.equal(crew.system.basePoints,50);assert.equal(crew.items.length,1);
  const chiha=templates.find(d=>d.flags.boltaction.catalogueSlug==='imperial-japan-chi-ha');
  assert.equal(chiha.type,'modelVehicle');assert.equal(chiha.items.length,3);assert.equal(chiha.system.damageValue,8);
  assert.ok(templates.every(t=>t.items.every(i=>i.system.cost===0)),'included equipment must not double-count profile prices');
  for(const template of templates.filter(t=>t.flags.boltaction.factionSlug)){
    const faction=packs.find(p=>p.metadata.name==='boltaction-factions').documents.find(f=>f.flags.boltaction.catalogueSlug===template.flags.boltaction.factionSlug);
    assert.equal(template.system.sourceFactionUuid,faction.uuid,template.name);assert.equal(template.system.factionUuid,undefined,'team supplies effective faction');
    for(const uuid of template.system.traitUuids)assert.ok(packs[0].documents.some(d=>d.uuid===uuid),template.name);
  }
  const modelPack=result.packs.models;
  for(const template of templates){
    const roleFolder=modelPack.folders.find(folder=>folder.id===template.folder);assert.ok(roleFolder,template.name);assert.match(roleFolder.flags.boltaction.catalogueFolder,/^role:/);
    const typeFolder=modelPack.folders.find(folder=>folder.id===roleFolder.folder);assert.ok(typeFolder);
    assert.equal(typeFolder.name,{model:'Infantry',modelStatic:'Static',modelVehicle:'Vehicle'}[template.type]);
    const factionFolder=modelPack.folders.find(folder=>folder.id===typeFolder.folder);assert.ok(factionFolder);
    assert.equal(factionFolder.folder,null);
    assert.equal(factionFolder.name,data.factions.find(f=>f.slug===template.flags.boltaction.factionSlug)?.name??'Unaffiliated');
    const color=factionAppearance(template.flags.boltaction.factionSlug).color;
    for(const folder of [factionFolder,typeFolder,roleFolder])assert.equal(folder.color,color);
  }
  assert.equal(modelPack.folders.filter(folder=>folder.folder===null).length,6);
  assert.equal(modelPack.folders.filter(folder=>folder.flags.boltaction.catalogueFolder.startsWith('type:')).length,18);
  assert.equal(modelPack.folders.find(folder=>folder.id===officer.folder).name,'Officers');
  assert.equal(modelPack.folders.find(folder=>folder.id===crew.folder).name,'Machine-gun teams');
  const originalFolder=infantry.folder;infantry.folder=null;infantry.name='Old roster name';
  const originalSystem=structuredClone(infantry.system),originalItems=structuredClone(infantry.items);
  delete infantry.system.profileName;infantry.img='systems/boltaction/assets/soldier.svg';infantry.prototypeToken.texture.src='systems/boltaction/assets/model-token.svg';
  officer.img='custom/officer.webp';officer.prototypeToken.texture.src='custom/officer-token.webp';
  const worldActor={name:'Friedrich',type:'model',flags:structuredClone(infantry.flags),system:{quality:'veteran'}};actors.push(worldActor);
  const custom=await create({name:'My custom model',type:'model',system:{}},{pack:modelPack.collection});
  const foldersBefore=modelPack.folders.length;
  await prepareCatalogue();assert.equal(infantry.folder,originalFolder);assert.equal(custom.folder,undefined);
  assert.equal(modelPack.folders.length,foldersBefore);assert.equal(infantry.name,'Unnamed Soldier');assert.deepEqual(infantry.system,originalSystem);assert.deepEqual(infantry.items,originalItems);
  assert.equal(infantry.img,factionAppearance('germany').img);assert.equal(infantry.prototypeToken.texture.src,factionAppearance('germany').tokenSrc);
  assert.equal(officer.img,'custom/officer.webp');assert.equal(officer.prototypeToken.texture.src,'custom/officer-token.webp');
  assert.equal(worldActor.name,'Friedrich');assert.equal(worldActor.system.profileName,undefined);assert.equal(custom.name,'My custom model');
  const counts=packs.map(p=>p.documents.length);
  packs.forEach(pack=>pack.locked=true);
  await prepareCatalogue();assert.equal(actors.length,1);assert.deepEqual(packs.map(p=>p.documents.length),counts);assert.equal(infantry.name,'Unnamed Soldier');
  infantry.folder=null;await assert.rejects(prepareCatalogue(),/Unlock the Models/);assert.equal(infantry.folder,null);
  infantry.folder=originalFolder;
  const legacy={metadata:{name:'boltaction-units',packageType:'world'},documents:[{name:'My old squad'}]};packs.push(legacy);
  await prepareCatalogue();assert.equal(legacy.documents[0].name,'My old squad');assert.equal(legacy.documents.length,1);
  templates.splice(templates.indexOf(chiha),1);await assert.rejects(prepareCatalogue(),/Unlock the Models/);
  game.user.isGM=false;await assert.rejects(prepareCatalogue(),/Only the GM/);
});
test('faction appearance resolves existing SVG assets and excludes custom artwork',async()=>{
  const data=await readCatalogue();const colors=new Set();
  for(const faction of data.factions){
    for(const type of ['model','modelStatic','modelVehicle']){
      const art=factionAppearance(faction.slug,type);colors.add(art.color);assert.equal(art.slug,faction.slug);
      for(const path of [art.img,art.tokenSrc]){assert.equal(isDefaultModelArt(path),true);assert.match(await readFile(new URL(`../${path.replace('systems/boltaction/','')}`,import.meta.url),'utf8'),/^<svg/);}
    }
  }
  assert.equal(colors.size,5);assert.equal(factionAppearance('unknown').img,'systems/boltaction/assets/soldier.svg');
  assert.equal(isDefaultModelArt('custom/portrait.webp'),false);assert.equal(isDefaultModelArt('https://example.org/soldier.svg'),false);
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
