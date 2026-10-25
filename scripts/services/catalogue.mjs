import {factionAppearance,isDefaultModelArt} from './faction-appearance.mjs';

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
const defaultModelName = type => type === 'modelVehicle' ? 'Unnamed Vehicle' : type === 'modelStatic' ? 'Unnamed Crew' : 'Unnamed Soldier';
const modelFamily = row => `${row.factionSlug ?? ''}:${row.slug.replace(/(?:^|-)(inexperienced|regular|veteran)(?=-|$)/g,'')}`;
const relatedProfiles = (row, rows) => rows.filter(source=>modelFamily(source)===modelFamily(row));
export function squadProfileName(row, rows = [row]) {
  const genericFamily = relatedProfiles(row,rows).length > 1 && /\b(?:rifle|infantry)\s+(?:squad|section)\b/i.test(row.name);
  return (genericFamily ? row.name.replace(/\b(inexperienced|regular|veteran)\b\s*/gi,'') : row.name).replace(/\s+/g,' ').trim().replace(/^./,letter=>letter.toUpperCase());
}
export const modelProfileName = (row,rows) => squadProfileName(row,rows).replace(/\b(squad|section)\b/gi,'model');
const sourceProfiles = (row,rows) => relatedProfiles(row,rows).map(source=>({slug:source.slug,name:source.name,quality:source.system.quality,sourcePage:source.profile?.sourcePage ?? '',aliases:structuredClone(source.profile?.aliases ?? [])}));
function sourceNotes(row,rows,extra = '') {
  const aliases = relatedProfiles(row,rows).filter(source=>source.profile?.aliases?.length).map(source=>`Source-listed names for ${source.name}: ${source.profile.aliases.join(', ')}.`);
  return [row.system.notes,extra,...aliases].filter(Boolean).join('\n\n');
}
export function preferredModelRows(rows) {
  const families = new Map(), rank = {regular:0,veteran:1,inexperienced:2};
  for (const row of rows) {
    const key = modelFamily(row), previous = families.get(key);
    if (!previous || (rank[row.system.quality] ?? 3) < (rank[previous.system.quality] ?? 3)) families.set(key,row);
  }
  return [...families.values()];
}
/** Convert a source roster profile to one reusable individual model. */
export async function modelTemplate(row, packed = new Map()) {
  const catalogue = await loadCatalogue();
  const personal = row.composition?.find(entry => ['officer', 'observer', 'medic'].includes(entry.role));
  const individualComposition = row.composition?.some(entry => entry.role !== 'crew');
  const staticModel = row.system.kind === 'artillery' || row.system.kind !== 'vehicle' && !personal && !individualComposition && (Boolean(row.weaponLoadout?.length) || Boolean(row.weaponSlug && row.weaponSlug !== 'rifle'));
  const type = row.system.kind === 'vehicle' ? 'modelVehicle' : staticModel ? 'modelStatic' : 'model';
  const profile = structuredClone(row.profile ?? {});
  profile.sourceName = row.name;
  const quality = row.system.quality ?? 'regular';
  const wholeCost = profile.pointsByQuality?.[quality] ?? profile.basePoints ?? row.system.points ?? 0;
  const basePoints = type === 'model' && !personal
    ? profile.extraModelPoints ?? (profile.baseModels ? wholeCost / profile.baseModels : row.count ? wholeCost / row.count : wholeCost)
    : wholeCost;
  const entries = type === 'model'
    ? [{weaponSlug: personal?.weaponSlug ?? row.weaponSlug ?? 'rifle', quantity: 1}]
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
  flags.boltaction.sourceProfiles = sourceProfiles(row,catalogue.units);
  const name = modelProfileName(row,catalogue.units);
  const system = {
    profileName:name, unitUuid: '', quality, role: personal?.role ?? (type === 'model' ? 'rifleman' : type === 'modelStatic' ? 'weapon' : 'vehicle'),
    dead: false, basePoints, pointsAdjustment: 0, sourceFactionUuid,
    traitUuids: (row.traitSlugs ?? []).map(slug => packed.get(slug)?.uuid).filter(Boolean),
    notes: sourceNotes(row,catalogue.units,type === 'modelStatic' ? `Includes the source profile's ${row.count ?? profile.baseModels ?? 1} crew and base equipment. Edit the crew as needed.` : ''),
    crew: type === 'modelStatic' ? row.count ?? profile.baseModels ?? 1 : 0,
    damageValue: row.system.damageValue ?? (quality === 'veteran' ? 5 : quality === 'inexperienced' ? 3 : 4),
    capacity: row.system.capacity ?? 0, moveAdvance: row.system.moveAdvance ?? 6, moveRun: row.system.moveRun ?? 12,
    immobilised: false, openTopped: Boolean(row.system.openTopped || row.traitSlugs?.includes('open-topped')), vehicleDamage: ''
  };
  const appearance = factionAppearance(row.factionSlug,type);
  return {name,type,img:appearance.img,prototypeToken:{actorLink:true,texture:{src:appearance.tokenSrc}},system,items,flags};
}

/** Expand the recorded base composition; optional attendants, weapons and extra models remain optional. */
export async function squadTemplate(row, packed = new Map()) {
  const catalogue = await loadCatalogue();
  const base = await modelTemplate(row,packed);
  const count = row.profile?.baseModels ?? row.count ?? row.system.startingSize ?? 1;
  const composition = row.system.kind === 'vehicle' ? [{count:1,role:'vehicle'}]
    : row.composition?.length ? row.composition
    : [{count,role:base.type === 'model' ? 'rifleman' : 'crew'}];
  const memberTemplates = [];
  for (const entry of composition) for (let index=0;index<entry.count;index++) {
    const member = structuredClone(base);
    member.name = defaultModelName(base.type);
    member.system.role = entry.role;
    member.system.unitUuid = '';
    if (base.type === 'model') {
      if (!row.composition?.length && memberTemplates.length < (row.profile?.ncoCount ?? 0)) member.system.role = 'nco';
      if (entry.weaponSlug !== undefined) {
        member.items = [];
        if (entry.weaponSlug) {
          const weapon = await resolveWeapon(entry.weaponSlug);weapon.system.quantity=1;weapon.system.cost=0;
          member.items.push(weapon);
        }
      }
    } else if (base.type === 'modelStatic') {
      member.system.crew = 1;
      member.system.role = memberTemplates.length ? 'crew' : 'operator';
      member.system.notes = 'Individual crew member. The shared weapon is assigned to the operator.';
      if (memberTemplates.length) member.items = [];
    }
    memberTemplates.push(member);
  }
  const appearance = factionAppearance(row.factionSlug,'unit');
  return {
    name:squadProfileName(row,catalogue.units),type:'unit',img:appearance.img,
    prototypeToken:{actorLink:true,texture:{src:appearance.tokenSrc}},
    system:{...structuredClone(row.system),notes:sourceNotes(row,catalogue.units),armyUuid:'',modelUuids:[],squadKind:base.type === 'model' ? 'infantry' : 'vehicleStatic',startingSize:memberTemplates.length,traitUuids:(row.traitSlugs ?? []).map(slug=>packed.get(slug)?.uuid).filter(Boolean)},
    flags:{boltaction:{catalogueSlug:row.slug,sourceName:row.name,factionSlug:row.factionSlug ?? '',profile:{...structuredClone(row.profile ?? {}),sourceName:row.name},sourceProfiles:sourceProfiles(row,catalogue.units),composition:structuredClone(row.composition ?? []),squadTemplate:true,memberTemplates}}
  };
}

let importing;
export function prepareCatalogue() {
  if (!globalThis.game?.user?.isGM) return Promise.reject(new Error('Only the GM can prepare the catalogue.'));
  if (!importing) importing = performImport().finally(() => { importing = undefined; });
  return importing;
}
// Older macros prepare reusable content without creating sample forces.
export const importStarter = prepareCatalogue;
const folderId = folder => typeof folder === 'string' ? folder : folder?.id ?? folder?._id ?? null;
const modelFolderLabels = {model:'Infantry',modelStatic:'Static',modelVehicle:'Vehicle'};
function battlefieldRole(row, type) {
  const personal = row.composition?.find(entry => ['officer','observer','medic'].includes(entry.role))?.role;
  if (type === 'model') return {officer:'Officers',observer:'Observers',medic:'Medics'}[personal] ?? 'Infantry sections';
  if (type === 'modelVehicle') {
    if (row.system.capacity > 0) return 'Transports';
    if (row.traitSlugs?.includes('flak') || /\bAA\b|anti-aircraft/i.test(row.name)) return 'Anti-aircraft';
    if (/howitzer|mortar/.test(row.weaponSlug ?? '')) return 'Fire support';
    return 'Armoured vehicles';
  }
  if (row.system.kind === 'artillery') return 'Artillery';
  if (row.traitSlugs?.includes('sniper')) return 'Snipers';
  if (/mortar/.test(row.weaponSlug ?? '')) return 'Mortar teams';
  if (/^(lmg|mmg|hmg)$/.test(row.weaponSlug ?? '')) return 'Machine-gun teams';
  if (/at-|anti-tank|bazooka|piat|panzerschreck/.test(row.weaponSlug ?? '')) return 'Anti-tank teams';
  return 'Weapon teams';
}
async function modelFolder(pack, folders, data, row, type) {
  const Folder = CONFIG.Folder?.documentClass ?? foundry.documents.Folder;
  const label = pack.metadata.name === 'boltaction-squads' ? 'Squads' : 'Models';
  const {color} = factionAppearance(row.factionSlug,type);
  const ensure = async (name, key, parent = null) => {
    let folder = folders.find(folder => folder.type === 'Actor' && (folder.getFlag?.('boltaction','catalogueFolder') === key || folder.flags?.boltaction?.catalogueFolder === key));
    folder ??= folders.find(folder => folder.type === 'Actor' && folder.name === name && folderId(folder.folder) === parent);
    if (!folder) {
      if (pack.locked) throw new Error(`Unlock the ${label} compendium to organize its catalogue folders.`);
      folder = await Folder.create({name,type:'Actor',folder:parent,color,sorting:'a',flags:{boltaction:{catalogueFolder:key}}},{pack:pack.collection});
      folders.push(folder);
    } else {
      const changes = {};
      if (folderId(folder.folder) !== parent) changes.folder = parent;
      if (folder.color !== color) changes.color = color;
      if (Object.keys(changes).length) {
        if (pack.locked) throw new Error(`Unlock the ${label} compendium to organize its catalogue folders.`);
        await folder.update(changes);
      }
    }
    return folderId(folder);
  };
  const faction = data.factions.find(faction => faction.slug === row.factionSlug);
  const factionKey = row.factionSlug || 'unaffiliated';
  const parent = await ensure(faction?.name ?? 'Unaffiliated',`faction:${factionKey}`);
  const typeFolder = await ensure(modelFolderLabels[type],`type:${factionKey}:${type}`,parent);
  const role = battlefieldRole(row,type);
  return ensure(role,`role:${factionKey}:${type}:${role}`,typeFolder);
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
  const folders = Array.from(modelPack.folders ?? []);
  const preferred = new Set(preferredModelRows(data.units).map(row=>row.slug));
  for (const row of data.units) {
    let document = findSlug(existing,row.slug);
    if (!document && !preferred.has(row.slug)) continue;
    if (!document && modelPack.locked) throw new Error('Unlock the Models compendium to add missing catalogue entries.');
    const source = document ? null : await modelTemplate(row, packed);
    const folder = await modelFolder(modelPack,folders,data,row,document?.type ?? source.type);
    if (!document) {
      document = await Actor.create({...source,folder}, {pack:modelPack.collection});
      existing.push(document);
    } else {
      const updates = {};
      if (folderId(document.folder) !== folder) updates.folder = folder;
      if (document.name !== modelProfileName(row,data.units)) updates.name = modelProfileName(row,data.units);
      if (document.system.profileName !== modelProfileName(row,data.units)) updates['system.profileName'] = modelProfileName(row,data.units);
      if (document.flags?.boltaction?.profile?.sourceName !== row.name) updates['flags.boltaction.profile.sourceName'] = row.name;
      const provenance = sourceProfiles(row,data.units);
      if (JSON.stringify(document.flags?.boltaction?.sourceProfiles) !== JSON.stringify(provenance)) updates['flags.boltaction.sourceProfiles'] = provenance;
      if (!document.system.notes && sourceNotes(row,data.units)) updates['system.notes'] = sourceNotes(row,data.units);
      const appearance = factionAppearance(row.factionSlug,document.type);
      if (isDefaultModelArt(document.img) && document.img !== appearance.img) updates.img = appearance.img;
      if (isDefaultModelArt(document.prototypeToken?.texture?.src) && document.prototypeToken?.texture?.src !== appearance.tokenSrc) updates['prototypeToken.texture.src'] = appearance.tokenSrc;
      if (Object.keys(updates).length) {
        if (modelPack.locked) throw new Error('Unlock the Models compendium to organize and refresh its catalogue entries.');
        await document.update(updates);
      }
    }
  }
  packs.models = modelPack;
  let squadPack = game.packs.find(pack=>pack.metadata?.name === 'boltaction-squads' && pack.metadata?.packageType === 'world');
  if (!squadPack) squadPack = await foundry.documents.collections.CompendiumCollection.createCompendium({name:'boltaction-squads',label:'Bolt Action: Squads',type:'Actor',package:'world'});
  const existingSquads = await squadPack.getDocuments(), squadFolders = Array.from(squadPack.folders ?? []);
  const squadRows = preferredModelRows(data.units.filter(row=>row.factionSlug && row.profile?.sourcePage));
  const preferredSquads = new Set(squadRows.map(row=>row.slug));
  for (const document of existingSquads) {
    const flags = document.flags?.boltaction;
    if (flags?.squadTemplate && data.units.some(row=>row.slug===flags.catalogueSlug) && !preferredSquads.has(flags.catalogueSlug)) {
      if (squadPack.locked) throw new Error('Unlock the Squads compendium to consolidate experience variants.');
      await document.delete();
    }
  }
  for (const row of squadRows) {
    const document = findSlug(existingSquads,row.slug);
    if (!document && squadPack.locked) throw new Error('Unlock the Squads compendium to add missing catalogue entries.');
    const source = await squadTemplate(row,packed);
    const folder = await modelFolder(squadPack,squadFolders,data,row,source.flags.boltaction.memberTemplates[0].type);
    if (!document) existingSquads.push(await Actor.create({...source,folder},{pack:squadPack.collection}));
    else {
      const updates = {};
      if (folderId(document.folder) !== folder) updates.folder = folder;
      if (document.name !== source.name) updates.name = source.name;
      for (const key of ['profile','memberTemplates','sourceProfiles']) if (JSON.stringify(document.flags?.boltaction?.[key]) !== JSON.stringify(source.flags.boltaction[key])) updates[`flags.boltaction.${key}`] = source.flags.boltaction[key];
      if (!document.system.notes || document.system.notes === row.system.notes) {
        if (document.system.notes !== source.system.notes) updates['system.notes'] = source.system.notes;
      }
      const appearance = factionAppearance(row.factionSlug,'unit');
      if (isDefaultModelArt(document.img) && document.img !== appearance.img) updates.img = appearance.img;
      if (isDefaultModelArt(document.prototypeToken?.texture?.src) && document.prototypeToken?.texture?.src !== appearance.tokenSrc) updates['prototypeToken.texture.src'] = appearance.tokenSrc;
      if (Object.keys(updates).length) {
        if (squadPack.locked) throw new Error('Unlock the Squads compendium to organize its catalogue entries.');
        await document.update(updates);
      }
    }
  }
  packs.squads = squadPack;
  return {packs,catalogue:data};
}
