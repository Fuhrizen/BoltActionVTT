export const CATALOGUE_FILES = ['weapons','traits','factions','units'];
let cached;
export async function loadCatalogue() {
  if (!cached) cached = Promise.all(CATALOGUE_FILES.map(async key => {
    const response = await fetch(`systems/boltaction/compendiums/${key}.json`);
    if (!response.ok) throw new Error(`Cannot load ${key} catalogue (${response.status}).`);
    return [key, await response.json()];
  })).then(entries => validateCatalogue(Object.fromEntries(entries))).catch(error => { cached = undefined; throw error; });
  return cached;
}
export function validateCatalogue(data) {
  for (const key of CATALOGUE_FILES) {
    if (!Array.isArray(data[key])) throw new Error(`Missing catalogue: ${key}`);
    const slugs = new Set();
    for (const row of data[key]) {
      if (!row.slug || slugs.has(row.slug)) throw new Error(`Duplicate or missing ${key} slug: ${row.slug}`);
      slugs.add(row.slug);
    }
  }
  const traits = new Set(data.traits.map(row => row.slug));
  const factions = new Set(data.factions.map(row => row.slug));
  const weapons = new Set(data.weapons.map(row => row.slug));
  for (const row of data.weapons) {
    for (const field of ['range','shots','penetration']) if (!Number.isFinite(row.system[field])) throw new Error(`Invalid ${field}: ${row.slug}`);
    for (const slug of row.system.traits) if (!traits.has(slug)) throw new Error(`Unknown trait: ${slug}`);
  }
  for (const row of data.factions) for (const slug of row.traitSlugs) if (!traits.has(slug)) throw new Error(`Unknown faction trait: ${slug}`);
  for (const row of data.units) {
    if (!weapons.has(row.weaponSlug)) throw new Error(`Unknown unit weapon: ${row.weaponSlug}`);
    if (row.factionSlug && !factions.has(row.factionSlug)) throw new Error(`Unknown unit faction: ${row.factionSlug}`);
    for (const weapon of row.weaponLoadout ?? []) if (!weapons.has(weapon.weaponSlug)) throw new Error(`Unknown loadout weapon: ${weapon.weaponSlug}`);
    for (const option of row.profile?.options ?? []) if (option.weaponSlug && !weapons.has(option.weaponSlug)) throw new Error(`Unknown option weapon: ${option.weaponSlug}`);
  }
  return data;
}
export async function resolveWeapon(slug) {
  const row = (await loadCatalogue()).weapons.find(row => row.slug === slug);
  if (!row) throw new Error(`Unknown weapon: ${slug}`);
  return structuredClone({name: row.name,type:'weapon',system:row.system});
}
const identity = slug => ({boltaction:{catalogueSlug:slug}});
const findSlug = (collection, slug) => collection.find(document => document.getFlag?.('boltaction','catalogueSlug') === slug || document.flags?.boltaction?.catalogueSlug === slug);
const itemData = row => ({name:row.name,type:row.type,system:structuredClone(row.system),flags:identity(row.slug)});
let importing;
export function importStarter() {
  if (!globalThis.game?.user?.isGM) return Promise.reject(new Error('Only the GM can import the catalogue.'));
  if (!importing) importing = performImport().finally(() => { importing = undefined; });
  return importing;
}
async function performImport() {
  const data = await loadCatalogue();
  const Item = CONFIG.Item.documentClass;
  const Actor = CONFIG.Actor.documentClass;
  const packs = {};
  const packed = new Map();
  for (const key of ['traits','weapons','factions']) {
    const name = `boltaction-${key}`;
    let pack = game.packs.find(pack => pack.metadata?.name === name && pack.metadata?.packageType === 'world');
    if (!pack) pack = await foundry.documents.collections.CompendiumCollection.createCompendium({name,label:`Bolt Action: ${key}`,type:'Item',package:'world'});
    if (pack.locked) throw new Error(`Unlock the ${pack.metadata.label} compendium to continue importing.`);
    packs[key] = pack;
    const existing = await pack.getDocuments();
    for (const row of data[key]) {
      let document = findSlug(existing,row.slug);
      if (!document) {
        const source = itemData(row);
        if (row.type === 'faction') source.system.traitUuids = row.traitSlugs.map(slug => packed.get(slug).uuid);
        document = await Item.create(source,{pack:pack.collection});
        existing.push(document);
      }
      packed.set(row.slug,document);
    }
  }
  let unitPack = game.packs.find(pack => pack.metadata?.name === 'boltaction-units' && pack.metadata?.packageType === 'world');
  if (!unitPack) unitPack = await foundry.documents.collections.CompendiumCollection.createCompendium({name:'boltaction-units',label:'Bolt Action: unit templates',type:'Actor',package:'world'});
  if (unitPack.locked) throw new Error('Unlock the unit templates compendium to continue importing.');
  const unitTemplates = await unitPack.getDocuments();
  for (const row of data.units) if (!findSlug(unitTemplates,row.slug)) {
    const rifles = row.weaponSlug === 'rifle';
    const items = [];
    if (!rifles) for (const entry of row.weaponLoadout ?? [{weaponSlug:row.weaponSlug,quantity:row.weaponQuantity ?? 1}]) {
      const weapon = await resolveWeapon(entry.weaponSlug);
      weapon.system.quantity = entry.quantity ?? 1;
      if (entry.heDiameter) weapon.system.heDiameter = entry.heDiameter;
      if (entry.mount) { weapon.flags = {boltaction:{mount:entry.mount}}; weapon.system.notes += ` Mount: ${entry.mount}; arc and co-axial restrictions require manual resolution.`; }
      items.push(weapon);
    }
    const flags = identity(row.slug);
    if (row.profile) flags.boltaction.profile = structuredClone(row.profile);
    if (row.factionSlug) flags.boltaction.factionSlug = row.factionSlug;
    if (row.system.kind !== 'vehicle') flags.boltaction.composition = rifles
      ? [{count:1,role:'nco',weaponSlug:'rifle'},{count:row.count-1,role:'rifleman',weaponSlug:'rifle'}]
      : [{count:row.count,role:'crew',weaponSlug:''}];
    await Actor.create({name:row.name,type:'unit',system:{...row.system,side:row.system.side ?? (['germany','imperial-japan'].includes(row.factionSlug) ? 'axis' : 'allies'),factionUuid:row.factionSlug ? packed.get(row.factionSlug).uuid : '',modelUuids:[],armyUuid:''},items,flags},{pack:unitPack.collection});
  }
  packs.units = unitPack;
  const ensureActor = async (slug,source) => findSlug(game.actors,slug) ?? Actor.create({...source,flags:{...source.flags,boltaction:{...source.flags?.boltaction,...identity(slug).boltaction}}});
  const armies = [], units = [];
  for (const [side,faction] of [['allies','united-states'],['axis','germany']]) {
    const army = await ensureActor(`starter-${side}`,{name:`${side === 'allies' ? 'Allied' : 'Axis'} practice force`,type:'army',system:{side,factionUuid:packed.get(faction).uuid,unitUuids:[],pointsLimit:1000}});
    armies.push(army);
    const template = data.units.find(row => row.factionSlug === faction && row.system.kind === 'infantry' && row.system.quality === 'regular');
    const unit = await ensureActor(`starter-${side}-rifles`,{name:template.name,type:'unit',flags:{boltaction:{profile:structuredClone(template.profile),factionSlug:faction}},system:{...template.system,side,factionUuid:packed.get(faction).uuid,armyUuid:army.uuid,modelUuids:[]}});
    units.push(unit);
    const modelUuids = [];
    for (let index = 0; index < template.count; index++) {
      const model = await ensureActor(`starter-${side}-rifleman-${index+1}`,{name:`${unit.name} ${index+1}`,type:'model',system:{unitUuid:unit.uuid,quality:'regular',role:index ? 'rifleman':'nco'},items:[await resolveWeapon('rifle')]});
      if (model.system.unitUuid !== unit.uuid) throw new Error(`Starter model ${model.name} was moved to another unit; resolve its membership before importing again.`);
      modelUuids.push(model.uuid);
    }
    await unit.update({'system.modelUuids':[...new Set([...unit.system.modelUuids,...modelUuids])]});
    if (unit.system.armyUuid !== army.uuid) throw new Error('Starter unit has been moved to another army; resolve membership before importing again.');
    await army.update({'system.unitUuids':[...new Set([...army.system.unitUuids,unit.uuid])]});
  }
  return {packs,armies,units,catalogue:data};
}
