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
    if (row.weaponSlug && !weapons.has(row.weaponSlug)) throw new Error(`Unknown unit weapon: ${row.weaponSlug}`);
    if (row.factionSlug && !factions.has(row.factionSlug)) throw new Error(`Unknown unit faction: ${row.factionSlug}`);
    for (const slug of row.traitSlugs ?? []) if (!traits.has(slug)) throw new Error(`Unknown unit trait: ${slug}`);
    for (const weapon of row.weaponLoadout ?? []) if (!weapons.has(weapon.weaponSlug)) throw new Error(`Unknown loadout weapon: ${weapon.weaponSlug}`);
    for (const option of row.profile?.options ?? []) if (option.weaponSlug && !weapons.has(option.weaponSlug)) throw new Error(`Unknown option weapon: ${option.weaponSlug}`);
  }
  return data;
}
export async function resolveWeapon(slug) {
  const row = (await loadCatalogue()).weapons.find(row => row.slug === slug);
  if (!row) throw new Error(`Unknown weapon: ${slug}`);
  return structuredClone({name: row.name,type:'weapon',system:{...row.system,cost:row.system.cost ?? 0}});
}
const identity = slug => ({boltaction:{catalogueSlug:slug}});
const findSlug = (collection, slug) => collection.find(document => document.getFlag?.('boltaction','catalogueSlug') === slug || document.flags?.boltaction?.catalogueSlug === slug);
const itemData = row => ({name:row.name,type:row.type,system:structuredClone(row.system),flags:{boltaction:{catalogueSlug:row.slug,...(row.profile ? {profile:structuredClone(row.profile)} : {})}}});
/** Convert a source roster profile to one reusable individual model. */
export async function modelTemplate(row, packed = new Map()) {
  const personal = row.composition?.find(entry => ['officer', 'observer', 'medic'].includes(entry.role));
  const staticModel = row.system.kind === 'artillery' || row.system.kind !== 'vehicle' && !personal && (Boolean(row.weaponLoadout?.length) || row.weaponSlug !== 'rifle');
  const type = row.system.kind === 'vehicle' ? 'modelVehicle' : staticModel ? 'modelStatic' : 'model';
  const profile = structuredClone(row.profile ?? {});
  const quality = row.system.quality ?? 'regular';
  const wholeCost = profile.pointsByQuality?.[quality] ?? profile.basePoints ?? row.system.points ?? 0;
  const basePoints = type === 'model' && !personal
    ? profile.extraModelPoints ?? (profile.baseModels ? wholeCost / profile.baseModels : row.count ? wholeCost / row.count : wholeCost)
    : wholeCost;
  const entries = type === 'model'
    ? [{weaponSlug: personal?.weaponSlug || row.weaponSlug || 'rifle', quantity: 1}]
    : row.weaponLoadout ?? (row.weaponSlug ? [{weaponSlug: row.weaponSlug, quantity: row.weaponQuantity ?? 1}] : []);
  const items = [];
  for (const entry of entries) {
    if (!entry.weaponSlug) continue;
    const weapon = await resolveWeapon(entry.weaponSlug);
    weapon.system.quantity = entry.quantity ?? 1;
    weapon.system.cost = 0;
    if (entry.heDiameter) weapon.system.heDiameter = entry.heDiameter;
    if (Number.isFinite(entry.penetration)) weapon.system.penetration = entry.penetration;
    if (entry.mount) weapon.flags = {boltaction: {mount: entry.mount}};
    items.push(weapon);
  }
  const sourceFactionUuid = row.factionSlug ? packed.get(row.factionSlug)?.uuid ?? '' : '';
  const flags = identity(row.slug);
  flags.boltaction.profile = profile;
  flags.boltaction.sourceName = row.name;
  flags.boltaction.factionSlug = row.factionSlug ?? '';
  flags.boltaction.includedEquipment = true;
  flags.boltaction.modelTemplate = true;
  const name = type === 'model' && !personal ? row.name.replace(/squad|section/gi, 'model') : row.name;
  const system = {
    unitUuid: '', quality, role: personal?.role ?? (type === 'model' ? 'rifleman' : type === 'modelStatic' ? 'weapon' : 'vehicle'),
    dead: false, basePoints, pointsAdjustment: 0, sourceFactionUuid,
    traitUuids: (row.traitSlugs ?? []).map(slug => packed.get(slug)?.uuid).filter(Boolean),
    notes: type === 'modelStatic' ? `Includes the source profile's ${row.count ?? profile.baseModels ?? 1} crew and base equipment. Edit the crew as needed.` : '',
    crew: type === 'modelStatic' ? row.count ?? profile.baseModels ?? 1 : 0,
    damageValue: row.system.damageValue ?? (quality === 'veteran' ? 5 : quality === 'inexperienced' ? 3 : 4),
    capacity: row.system.capacity ?? 0, moveAdvance: row.system.moveAdvance ?? 6, moveRun: row.system.moveRun ?? 12,
    immobilised: false, openTopped: Boolean(row.system.openTopped || row.traitSlugs?.includes('open-topped')), vehicleDamage: ''
  };
  return {name, type, system, items, flags};
}

let importing;
export function prepareCatalogue() {
  if (!globalThis.game?.user?.isGM) return Promise.reject(new Error('Only the GM can prepare the catalogue.'));
  if (!importing) importing = performImport().finally(() => { importing = undefined; });
  return importing;
}
// Older macros prepare reusable content without creating sample forces.
export const importStarter = prepareCatalogue;
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
    const existing = await pack.getDocuments();
    packs[key] = pack;
    for (const row of data[key]) {
      let document = findSlug(existing,row.slug);
      if (!document) {
        if (pack.locked) throw new Error(`Unlock the ${pack.metadata.label} compendium to add missing catalogue entries.`);
        const source = itemData(row);
        if (row.type === 'weapon') source.system.cost = 0;
        if (row.type === 'faction') source.system.traitUuids = row.traitSlugs.map(slug => packed.get(slug).uuid);
        document = await Item.create(source,{pack:pack.collection});
        existing.push(document);
      }
      packed.set(row.slug,document);
    }
  }
  let modelPack = game.packs.find(pack => pack.metadata?.name === 'boltaction-models' && pack.metadata?.packageType === 'world');
  if (!modelPack) modelPack = await foundry.documents.collections.CompendiumCollection.createCompendium({name:'boltaction-models',label:'Bolt Action: Models',type:'Actor',package:'world'});
  const existing = await modelPack.getDocuments();
  for (const row of data.units) if (!findSlug(existing,row.slug)) {
    if (modelPack.locked) throw new Error('Unlock the Models compendium to add missing catalogue entries.');
    const document = await Actor.create(await modelTemplate(row, packed), {pack:modelPack.collection});
    existing.push(document);
  }
  packs.models = modelPack;
  return {packs,catalogue:data};
}
