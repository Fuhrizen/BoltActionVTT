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
function gm() {if (!game.user.isGM) throw new Error('The GM assigns player teams and their owners.');}
function canCreate() {if (!game.user.isGM && !game.user.can?.('ACTOR_CREATE')) throw new Error('You need permission to create actors.');}
function team(actor) {owned(actor); if (actor.type !== 'army') throw new Error('Choose a Player Team.'); return actor;}
function squad(actor) {owned(actor); if (actor.type !== 'unit') throw new Error('Choose a Squad.'); return actor;}
function relationship(parent, child) {
  if (parent.type === 'army' && child.type === 'unit') return {list: 'unitUuids', parent: 'armyUuid'};
  if (parent.type === 'unit' && MODELS.has(child.type)) return {list: 'modelUuids', parent: 'unitUuid'};
  throw new Error('Player Teams contain Squads; Squads contain individual Models.');
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
  if (!['army', 'unit'].includes(parent.type)) throw new Error('Choose a Player Team or Squad.');
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
      snapshots.push({actor: child, data: {[`system.${fields.parent}`]: previousParent}});
      await child.update({[`system.${fields.parent}`]: parent.uuid});
      snapshots.push({actor: parent, data: {[`system.${fields.list}`]: previousList}});
      await parent.update({[`system.${fields.list}`]: [...new Set([...previousList, child.uuid])]});
      await setOwnership([child, ...descendants(child)], parent.ownership ?? {}, snapshots);
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
  return parent;
}
export async function assignTeam(actor, userIds = []) {
  gm(); const parent = team(actor);
  if (!Array.isArray(userIds)) throw new Error('Choose the users assigned to this Player Team.');
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
export async function createTeam({name = 'Player Team', userIds = [], factionUuid = ''} = {}) {
  gm(); canCreate();
  const actor = await actorClass().create({name: String(name).trim().slice(0, 150) || 'Player Team', type: 'army',
    img: 'systems/boltaction/assets/army.svg', system: {unitUuids: [], factionUuid: ''}, ownership: {default: 0}});
  try {await setTeamFaction(actor, factionUuid); await assignTeam(actor, userIds); return actor;}
  catch (error) {await actor.delete(); throw error;}
}
export async function createGroup(parent, {name = 'Squad', squadKind = 'infantry'} = {}) {
  team(parent); canCreate(); validateSquadKind(squadKind);
  const actor = await actorClass().create({name: String(name).trim().slice(0, 150) || 'Squad', type: 'unit',
    img: 'systems/boltaction/assets/unit.svg', ownership: clone(parent.ownership ?? {}),
    system: {armyUuid: '', modelUuids: [], squadKind}});
  try {await linkGroupMember(parent, actor); return actor;} catch (error) {await actor.delete(); throw error;}
}
export async function importModel(parent, documentOrUuid) {
  squad(parent); canCreate();
  const source = typeof documentOrUuid === 'string' ? await fromUuid(documentOrUuid) : documentOrUuid;
  if (!source || source.documentName !== 'Actor' || !MODELS.has(source.type) || source.visible === false) throw new Error('Import an individual infantry, static or vehicle Model from the compendium.');
  validateSquadMembers(parent, source);
  const data = clone(source.toObject());
  delete data._id; delete data.folder; delete data._stats;
  data.system ??= {}; data.system.unitUuid = '';
  delete data.system.armyUuid; delete data.system.modelUuids; delete data.system.unitUuids;
  data.ownership = clone(parent.ownership ?? {});
  data.prototypeToken = {...data.prototypeToken, actorLink: true};
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
