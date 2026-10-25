import {loadCatalogue,modelTemplate} from './catalogue.mjs';
import {factionAppearance,isDefaultModelArt} from './faction-appearance.mjs';
const MODELS = new Set(['model', 'modelStatic', 'modelVehicle']);
const SQUAD_KINDS = new Set(['infantry', 'vehicleStatic']);
const modelKind = actor => actor.type === 'model' ? 'infantry' : 'vehicleStatic';
const clone = value => structuredClone(value);
const actorClass = () => CONFIG.Actor.documentClass;
const ownerLevel = () => globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
const busy = new Map();
function serial(key, callback) {
  const job = (busy.get(key) ?? Promise.resolve()).catch(() => {}).then(callback);
  busy.set(key, job);
  return job.finally(() => {if (busy.get(key) === job) busy.delete(key);});
}
function owned(actor) {
  if (!actor || actor.documentName !== 'Actor' || !actor.isOwner || actor.pack) throw new Error('You must own this world actor.');
  return actor;
}
function gm() {if (!game.user.isGM) throw new Error('The GM assigns armies and their owners.');}
function canCreate() {if (!game.user.isGM && !game.user.can?.('ACTOR_CREATE')) throw new Error('You need permission to create actors.');}
function team(actor) {owned(actor); if (actor.type !== 'army') throw new Error('Choose a Army.'); return actor;}
function squad(actor) {owned(actor); if (actor.type !== 'unit') throw new Error('Choose a Squad.'); return actor;}
function relationship(parent, child) {
  if (parent.type === 'army' && child.type === 'unit') return {list: 'unitUuids', parent: 'armyUuid'};
  if (parent.type === 'unit' && MODELS.has(child.type)) return {list: 'modelUuids', parent: 'unitUuid'};
  throw new Error('Armies contain Squads; Squads contain individual Models.');
}
function collectionValues(collection) {return collection?.contents ?? Array.from(collection ?? []);}
function worldActor(uuid) {return collectionValues(game.actors).find(actor => actor.uuid === uuid);}
function childActors(parent) {
  const field = parent.type === 'army' ? 'unitUuids' : parent.type === 'unit' ? 'modelUuids' : null;
  if (!field) return [];
  const childField = parent.type === 'army' ? 'armyUuid' : 'unitUuid';
  return [...new Set(parent.system[field] ?? [])].map(worldActor).filter(actor => actor && actor.system[childField] === parent.uuid && (parent.type === 'army' ? actor.type === 'unit' : MODELS.has(actor.type)));
}
function descendants(parent) {return childActors(parent).flatMap(child => [child, ...descendants(child)]);}
function validateSquadKind(kind) {
  if (!SQUAD_KINDS.has(kind)) throw new Error('Choose an infantry or vehicle/static squad.');
  return kind;
}
export function getSquadKind(parent) {
  if (SQUAD_KINDS.has(parent.system.squadKind)) return parent.system.squadKind;
  const kinds = new Set(childActors(parent).map(modelKind));
  return kinds.size === 1 ? [...kinds][0] : 'infantry';
}
function validateSquadMembers(parent, child) {
  const kind = getSquadKind(parent);
  const members = childActors(parent);
  if (members.some(member => modelKind(member) !== kind)) throw new Error('This squad has incompatible models. Unlink them and sort the squad before adding models.');
  if (child && modelKind(child) !== kind) throw new Error('Infantry squads contain infantry models; vehicle/static squads contain vehicle or static models.');
}
export async function setSquadKind(parent, kind) {
  squad(parent); validateSquadKind(kind);
  return serial('group-membership', async () => {
    if (childActors(parent).some(member => modelKind(member) !== kind)) throw new Error('Unlink incompatible models before changing the squad type.');
    await parent.update({'system.squadKind': kind});
    return parent;
  });
}
function ownershipUpdate(actor, ownership) {
  return {...Object.fromEntries(Object.keys(actor.ownership ?? {}).map(id => [id, 0])), ...clone(ownership)};
}
async function restore(snapshots) {
  const errors = [];
  for (const {actor, data} of snapshots.reverse()) {
    try {await actor.update(data.ownership ? {...data, ownership: ownershipUpdate(actor, data.ownership)} : data, {boltactionOwnership: true, recursive: false});} catch (error) {errors.push(error.message);}
  }
  if (errors.length) console.error('Bolt Action: group rollback requires GM review', errors);
}
async function setOwnership(actors, ownership, snapshots) {
  for (const actor of actors) {
    owned(actor);
    snapshots.push({actor, data: {ownership: clone(actor.ownership ?? {})}});
    await actor.update({ownership: ownershipUpdate(actor, ownership)}, {boltactionOwnership: true, recursive: false});
  }
}
export async function syncGroupOwnership(parent) {
  owned(parent);
  if (!['army', 'unit'].includes(parent.type)) throw new Error('Choose a Army or Squad.');
  return serial('group-membership', async () => {
    const children = descendants(parent), snapshots = [];
    try {await setOwnership(children, parent.ownership ?? {}, snapshots);} catch (error) {await restore(snapshots); throw error;}
    return children;
  });
}
export async function linkGroupMember(parent, child) {
  owned(parent); owned(child);
  const fields = relationship(parent, child);
  return serial('group-membership', async () => {
    if (parent.type === 'unit') validateSquadMembers(parent, child);
    const previousParent = child.system[fields.parent] ?? '';
    if (previousParent && previousParent !== parent.uuid) throw new Error('This actor already belongs to another group. Unlink it there first.');
    const snapshots = [], previousList = [...(parent.system[fields.list] ?? [])];
    try {
      snapshots.push({actor: child, data: {folder:child.folder?.id??child.folder??null,[`system.${fields.parent}`]: previousParent,...(parent.type==='unit'?{'system.quality':child.system.quality}:{})}});
      await child.update({folder:parent.folder?.id??parent.folder??null,[`system.${fields.parent}`]: parent.uuid,...(parent.type==='unit'?{'system.quality':parent.system.quality||'regular'}:{})});
      snapshots.push({actor: parent, data: {[`system.${fields.list}`]: previousList}});
      await parent.update({[`system.${fields.list}`]: [...new Set([...previousList, child.uuid])]});
      await setOwnership([child, ...descendants(child)], parent.ownership ?? {}, snapshots);
      const army=parent.type==='army'?parent:worldActor(parent.system.armyUuid);
      if(army?.system.factionUuid){const faction=await fromUuid(army.system.factionUuid);for(const member of [child,...descendants(child)]){const art=factionAppearance(faction?.system?.slug||faction?.getFlag?.('boltaction','catalogueSlug'),member.type),changes={};if(isDefaultModelArt(member.img))changes.img=art.img;if(isDefaultModelArt(member.prototypeToken?.texture?.src))changes['prototypeToken.texture.src']=art.tokenSrc;if(Object.keys(changes).length)await member.update(changes);}}
      return child;
    } catch (error) {await restore(snapshots); throw error;}
  });
}
export async function unlinkGroupMember(parent, uuid) {
  owned(parent);
  return serial('group-membership', async () => {
    const listField = parent.type === 'army' ? 'unitUuids' : parent.type === 'unit' ? 'modelUuids' : null;
    if (!listField || !(parent.system[listField] ?? []).includes(uuid)) throw new Error('This actor is not in the group.');
    const child = worldActor(uuid), previousList = [...parent.system[listField]], snapshots = [];
    if (child) owned(child);
    try {
      if (child) {
        const fields = relationship(parent, child);
        if (child.system[fields.parent] === parent.uuid) {
          snapshots.push({actor: child, data: {[`system.${fields.parent}`]: parent.uuid}});
          await child.update({[`system.${fields.parent}`]: ''});
        }
      }
      snapshots.push({actor: parent, data: {[`system.${listField}`]: previousList}});
      await parent.update({[`system.${listField}`]: previousList.filter(id => id !== uuid)});
      return child;
    } catch (error) {await restore(snapshots); throw error;}
  });
}
export async function setTeamFaction(actor, factionUuid = '') {
  const parent = team(actor);
  if (factionUuid) {
    const faction = await fromUuid(factionUuid);
    if (!faction || faction.documentName !== 'Item' || faction.type !== 'faction' || faction.visible === false) throw new Error('Choose an available faction profile.');
  }
  await parent.update({'system.factionUuid': factionUuid});
  const faction=factionUuid?await fromUuid(factionUuid):null;
  for(const model of [parent,...descendants(parent)]) {
    const art=factionAppearance(faction?.system?.slug || faction?.getFlag?.('boltaction','catalogueSlug'),model.type),changes={};
    if(isDefaultModelArt(model.img))changes.img=art.img;
    if(isDefaultModelArt(model.prototypeToken?.texture?.src))changes['prototypeToken.texture.src']=art.tokenSrc;
    if(Object.keys(changes).length)await model.update(changes);
  }
  return parent;
}
export async function assignTeam(actor, userIds = []) {
  gm(); const parent = team(actor);
  if (!Array.isArray(userIds)) throw new Error('Choose the users assigned to this Army.');
  const ids = [...new Set(userIds)], users = collectionValues(game.users);
  if (ids.some(id => !users.some(user => user.id === id))) throw new Error('An assigned user could not be found.');
  return serial('group-membership', async () => {
    const ownership = {default: 0, ...Object.fromEntries(ids.map(id => [id, ownerLevel()]))};
    const actors = [parent, ...descendants(parent)], snapshots = [], userSnapshots = [];
    try {
      await setOwnership(actors, ownership, snapshots);
      for (const user of users) {
        const current = typeof user.character === 'string' ? user.character : user.character?.id;
        const assigned = ids.includes(user.id);
        if (assigned || current === parent.id) {
          userSnapshots.push({user, character: current ?? null});
          await user.update({character: assigned ? parent.id : null});
        }
      }
      return parent;
    } catch (error) {
      for (const entry of userSnapshots.reverse()) {try {await entry.user.update({character: entry.character});} catch (failure) {console.error('Bolt Action: player assignment rollback', failure);}}
      await restore(snapshots); throw error;
    }
  });
}
export async function createTeam({name = 'Army', userIds = [], factionUuid = ''} = {}) {
  gm(); canCreate();
  const actor = await actorClass().create({name: String(name).trim().slice(0, 150) || 'Army', type: 'army',
    img: 'systems/boltaction/assets/army.svg', system: {unitUuids: [], factionUuid: ''}, ownership: {default: 0}});
  try {await setTeamFaction(actor, factionUuid); await assignTeam(actor, userIds); return actor;}
  catch (error) {await actor.delete(); throw error;}
}
export async function createGroup(parent, {name = 'Unnamed Squad', squadKind = 'infantry'} = {}) {
  team(parent); canCreate(); validateSquadKind(squadKind);
  const actor = await actorClass().create({name: String(name).trim().slice(0, 150) || 'Squad', type: 'unit',
    img: 'systems/boltaction/assets/unit.svg', ownership: clone(parent.ownership ?? {}),
    system: {armyUuid: '', modelUuids: [], squadKind,identity:name,profileName:''}});
  try {await linkGroupMember(parent, actor); return actor;} catch (error) {await actor.delete(); throw error;}
}
export async function importModel(parent, documentOrUuid) {
  squad(parent); canCreate();
  const source = typeof documentOrUuid === 'string' ? await fromUuid(documentOrUuid) : documentOrUuid;
  if (!source || source.documentName !== 'Actor' || !MODELS.has(source.type) || source.visible === false) throw new Error('Import an individual infantry, static or vehicle Model from the compendium.');
  validateSquadMembers(parent, source);
  const data = clone(source.toObject());
  delete data._id; delete data.folder; delete data._stats;
  data.name=source.type==='model'?'Unnamed Soldier':source.type==='modelStatic'?'Unnamed Crew':'Unnamed Vehicle';
  data.system ??= {}; data.system.unitUuid = '';
  delete data.system.armyUuid; delete data.system.modelUuids; delete data.system.unitUuids;
  data.ownership = clone(parent.ownership ?? {});
  const army=worldActor(parent.system.armyUuid),faction=army?.system.factionUuid?await fromUuid(army.system.factionUuid):null;
  const art=factionAppearance(faction?.system?.slug || faction?.getFlag?.('boltaction','catalogueSlug') || source.flags?.boltaction?.factionSlug,source.type);
  if(isDefaultModelArt(data.img))data.img=art.img;
  data.prototypeToken = {...data.prototypeToken, actorLink: true,name:data.name};
  if(isDefaultModelArt(data.prototypeToken.texture?.src))data.prototypeToken.texture={...data.prototypeToken.texture,src:art.tokenSrc};
  for (const item of data.items ?? []) {delete item._id; delete item._stats;}
  const actor = await actorClass().create(data);
  try {await linkGroupMember(parent, actor); return actor;} catch (error) {await actor.delete(); throw error;}
}
export function groupSummary(parent) {
  const members = childActors(parent).filter(actor => actor.visible !== false);
  const squads = parent.type === 'army' ? members : [];
  const models = parent.type === 'unit' ? members : squads.flatMap(childActors).filter(actor => actor.visible !== false);
  return {members, modelCount: models.length, squadCount: squads.length, models: models.length, squads: squads.length};
}

export async function setSquadExperience(parent, quality) {
  squad(parent);
  if (!['inexperienced','regular','veteran'].includes(quality)) throw new Error('Choose a valid squad experience.');
  return serial('group-membership',async()=>{
    const actors=[parent,...childActors(parent)],snapshots=[];
    try {for(const actor of actors){owned(actor);snapshots.push({actor,data:{'system.quality':actor.system.quality}});await actor.update({'system.quality':quality});}}
    catch(error){await restore(snapshots);throw error;}
    return parent;
  });
}
export async function importSquad(parent, sourceOrUuid) {
  team(parent);canCreate();
  const source=typeof sourceOrUuid==='string'?await fromUuid(sourceOrUuid):sourceOrUuid;
  if(source?.type!=='unit'||!source.pack||source.visible===false)throw new Error('Choose a squad compendium template.');
  const templates=source.getFlag?.('boltaction','memberTemplates') ?? source.flags?.boltaction?.memberTemplates;
  if(!Array.isArray(templates)||!templates.length)throw new Error('This squad template contains no model definitions.');
  let group;const created=[];
  try{
    group=await createGroup(parent,{name:'Unnamed Squad',squadKind:source.system.squadKind||'infantry'});
    const sourceSystem=clone(source.toObject?.().system ?? source.system);sourceSystem.profileName=source.system.profileName||source.flags?.boltaction?.sourceName||source.name;delete sourceSystem.identity;delete sourceSystem.armyUuid;delete sourceSystem.modelUuids;delete sourceSystem.transportUuid;delete sourceSystem.passengerUuids;
    await group.update({...Object.fromEntries(Object.entries(sourceSystem).map(([key,value])=>['system.'+key,value])),flags:{boltaction:{profile:clone(source.flags?.boltaction?.profile??{}),sourceName:source.flags?.boltaction?.sourceName??source.name,factionSlug:source.flags?.boltaction?.factionSlug??''}}});
    await setSquadExperience(group,source.system.quality||'regular');
    for(const template of templates){const data=clone(template);delete data._id;data.system={...data.system,unitUuid:''};data.ownership=clone(parent.ownership??{});const model=await actorClass().create(data);created.push(model);await linkGroupMember(group,model);}
    return group;
  }catch(error){for(const model of created.reverse())await model.delete();if(group){await unlinkGroupMember(parent,group.uuid);await group.delete();}throw error;}
}

export function squadDisplayName(identity='Unnamed Squad',quality='regular') {
  const level=['inexperienced','regular','veteran'].includes(quality)?quality:'regular';
  return `${level[0].toUpperCase()+level.slice(1)} ${String(identity||'Unnamed Squad').trim()||'Unnamed Squad'}`;
}
export async function deleteGroupActor(actor) {
  owned(actor);
  const members=actor.type==='unit'?childActors(actor):[];
  for(const member of members)owned(member);
  const documents=[...members,actor];
  if(actorClass().deleteDocuments)await actorClass().deleteDocuments(documents.map(a=>a.id));
  else for(const document of documents)await document.delete();
  const parent=worldActor(actor.system[actor.type==='unit'?'armyUuid':'unitUuid']);
  if(parent?.isOwner){const field=actor.type==='unit'?'unitUuids':'modelUuids';await parent.update({['system.'+field]:(parent.system[field]??[]).filter(uuid=>uuid!==actor.uuid)});}
  return documents;
}

export async function setPins(parent,value){
 squad(parent);if(!Number.isInteger(value)||value<0||value>100)throw new Error('Pins must be an integer from 0 to 100.');
 await parent.update({'system.pins':value});return parent;
}
export async function addSquadMember(parent){
 squad(parent);canCreate();
 if(childActors(parent).length>=100)throw new Error('A squad may contain at most 100 model actors.');
 const data=await loadCatalogue(),name=parent.getFlag?.('boltaction','sourceName')??parent.flags?.boltaction?.sourceName;
 const row=data.units.find(row=>row.name===name);
 let source=row?await modelTemplate(row):childActors(parent)[0]?.toObject();
 if(!source)throw new Error('Import a squad template, or drop a model reference into this squad first.');
 source=clone(source);delete source._id;delete source.folder;delete source._stats;
 source.name=source.type==='model'?'Unnamed Soldier':source.type==='modelStatic'?'Unnamed Crew':'Unnamed Vehicle';
 source.system={...source.system,unitUuid:'',dead:false,isNco:false,isLoader:false,isMedic:false,isObserver:false,role:source.type==='model'?'rifleman':source.type==='modelStatic'?'weapon':'vehicle',quality:parent.system.quality,vehicleStates:[]};
 source.ownership=clone(parent.ownership??{});source.prototypeToken={...source.prototypeToken,actorLink:true,name:source.name};
 for(const item of source.items??[])delete item._id;
 const model=await actorClass().create(source);try{await linkGroupMember(parent,model);return model;}catch(error){await model.delete();throw error;}
}
