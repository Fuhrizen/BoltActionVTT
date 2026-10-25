import {resolveWeapon} from './catalogue.mjs';
const SID = 'boltaction', busy = new Set();
const copy = value => structuredClone(value);
const flag = (unit, key) => unit.getFlag?.(SID, key) ?? unit.flags?.[SID]?.[key];
const selections = unit => copy(flag(unit, 'upgrades') ?? []);
function owned(actor) {
  if (!actor?.isOwner || actor.pack) throw new Error('Own this world actor before changing its roster.');
}
function profileOf(unit) {
  owned(unit);
  if (unit.type !== 'unit') throw new Error('Choose a squad, team or vehicle.');
  const profile = flag(unit, 'profile');
  if (!profile) throw new Error('This unit has no priced catalogue profile.');
  return profile;
}
function purchasedSize(unit) {return Math.max(unit.system.startingSize ?? 0, unit.members?.length ?? 0);}
export function calculateRosterCost(unit) {
  const profile = profileOf(unit), size = purchasedSize(unit);
  const base = profile.pointsByQuality?.[unit.system.quality] ?? profile.basePoints;
  if (!Number.isFinite(base)) throw new Error('No verified base price exists for this quality.');
  const extra = Math.max(0, size - (profile.baseModels ?? 1));
  if (extra && !Number.isFinite(profile.extraModelPoints)) throw new Error('Additional models require a verified per-model price.');
  const extraModels = extra * (profile.extraModelPoints ?? 0);
  const upgrades = selections(unit).reduce((total, entry) => {
    const option = profile.options?.[entry.optionIndex];
    if (!option) throw new Error('A saved upgrade no longer exists in this profile.');
    return total + price(option, entry.count, size);
  }, 0);
  return {base, extraModels, upgrades, total: base + extraModels + upgrades};
}
function price(option, count, size) {
  if (option.unresolvedCost || option.cost === null) throw new Error('This option has an unresolved printed cost; adjudicate it manually.');
  if (Number.isFinite(option.costPerModel)) return option.costPerModel * size;
  if (Number.isFinite(option.costEach)) return option.costEach * count;
  if (Number.isFinite(option.cost)) return option.cost * count;
  throw new Error('This option has no verified price.');
}
export async function previewUpgrade(unit, {optionIndex, modelUuids = [], loaderUuids = [], count} = {}) {
  const profile = profileOf(unit), option = profile.options?.[optionIndex];
  if (!Number.isInteger(optionIndex) || !option) throw new Error('Choose an option from this unit profile.');
  if (unit.system.activated || unit.system.order) throw new Error('Configure upgrades before issuing battlefield orders.');
  if (option.condition || option.subtype || option.excludedSubtype || option.removeTrait || option.variant || option.replaceAllWeapons || option.requiresOption || option.option === 'additional-model' || option.option === 'rifles') throw new Error('This conversion or conditional option requires manual roster configuration.');
  modelUuids = [...new Set(modelUuids)]; loaderUuids = [...new Set(loaderUuids)];
  const vehicle = unit.system.kind === 'vehicle';
  const chosen = selections(unit);
  if (!option.weaponSlug && chosen.some(s => s.optionIndex === optionIndex)) throw new Error('This squad option is already selected.');
  const quantity = option.weaponSlug && !vehicle ? modelUuids.length : Number(count ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Select at least one model or a positive whole quantity.');
  const previousCount = chosen.filter(s => s.optionIndex === optionIndex).reduce((n, s) => n + s.count, 0);
  if (previousCount + quantity > (option.max ?? (vehicle ? 1 : Infinity))) throw new Error('This option exceeds its profile limit.');
  const members = unit.members ?? [];
  for (const uuid of [...modelUuids, ...loaderUuids]) {
    const member = members.find(m => m.uuid === uuid);
    if (!member || member.system.dead) throw new Error('Choose surviving models belonging to this unit.');
    owned(member);
  }
  if (modelUuids.some(uuid => loaderUuids.includes(uuid))) throw new Error('A gunner cannot also be its loader.');
  const priorPrimary = chosen.filter(s => profile.options[s.optionIndex]?.weaponSlug && !profile.options[s.optionIndex]?.additional).flatMap(s => s.modelUuids);
  if (option.weaponSlug && !option.additional && modelUuids.some(uuid => priorPrimary.includes(uuid))) throw new Error('A selected model already has a primary weapon upgrade.');
  const previousLoaders = chosen.flatMap(s => s.loaderUuids);
  if ([...modelUuids, ...loaderUuids].some(uuid => previousLoaders.includes(uuid))) throw new Error('A selected model is already assigned as a loader.');
  for (const uuid of modelUuids) {
    const model = members.find(m => m.uuid === uuid), nco = ['nco', 'officer'].includes(model.system.role);
    if (option.ncoOnly && !nco || nco && !option.additional && !option.ncoOnly && !option.ncoAllowed) throw new Error('This option does not permit that model role.');
    if (!option.additional && model.items.filter(i => i.type === 'weapon' && !i.getFlag?.(SID, 'additional')).length !== 1) throw new Error('A replacement requires exactly one primary weapon on each selected model.');
  }
  if (option.loaderEach && loaderUuids.length !== quantity * option.loaderEach) throw new Error('Select the required number of distinct loaders.');
  if (loaderUuids.some(uuid => priorPrimary.includes(uuid))) throw new Error('An upgraded primary weapon model cannot be assigned as a loader.');
  const key = option.weaponSlug ?? option.option;
  for (const selection of chosen) {
    const other = profile.options[selection.optionIndex];
    if (other.excludes === key || option.excludes === (other.weaponSlug ?? other.option)) throw new Error('This option excludes an existing selection.');
    if (selection.optionIndex === optionIndex && modelUuids.some(uuid => selection.modelUuids.includes(uuid))) throw new Error('This model already has that upgrade.');
  }
  if (vehicle && option.replaceWeapon && unit.items.filter(i => i.type === 'weapon' && i.system.slug === option.replaceWeapon && (!option.replaceMount || i.getFlag?.(SID, 'mount') === option.replaceMount)).length !== 1) throw new Error('Choose a conversion with exactly one matching mounted weapon.');
  const weapon = option.weaponSlug ? await resolveWeapon(option.weaponSlug) : null;
  const before = calculateRosterCost(unit), cost = price(option, quantity, purchasedSize(unit));
  if (before.total + cost < 0) throw new Error('A roster price cannot be negative.');
  return {optionIndex, label:key, count:quantity, cost, pointsBefore:before.total, pointsAfter:before.total + cost, modelUuids, loaderUuids, option:copy(option), weapon};
}
export async function applyUpgrade(unit, options = {}) {
  if (busy.has(unit.uuid)) throw new Error('This roster is already being updated.');
  busy.add(unit.uuid);
  const snapshots = [];
  try {
    const preview = await previewUpgrade(unit, options), option = preview.option;
    const affected = [unit, ...(unit.members ?? []).filter(m => [...preview.modelUuids, ...preview.loaderUuids].includes(m.uuid))];
    for (const actor of affected) snapshots.push({actor, items:actor.items.map(i => i.toObject()), role:actor.system.role, points:actor.system.points, capacity:actor.system.capacity, upgrades:selections(actor)});
    if (option.weaponSlug) {
      const recipients = unit.system.kind === 'vehicle' ? [unit] : unit.members.filter(m => preview.modelUuids.includes(m.uuid));
      for (let index = 0; index < recipients.length; index++) {
        const actor = recipients[index];
        if (!option.additional && actor !== unit) await actor.deleteEmbeddedDocuments('Item', actor.items.filter(i => i.type === 'weapon' && !i.getFlag?.(SID, 'additional')).map(i => i.id));
        if (actor === unit && option.replaceWeapon) await actor.deleteEmbeddedDocuments('Item', actor.items.filter(i => i.type === 'weapon' && i.system.slug === option.replaceWeapon && (!option.replaceMount || i.getFlag?.(SID, 'mount') === option.replaceMount)).map(i => i.id));
        const count = actor === unit ? preview.count : 1;
        for (let n = 0; n < count; n++) {
          const source = copy(preview.weapon);
          source.system.quantity = option.quantity ?? 1;
          source.flags = {[SID]:{additional:Boolean(option.additional),upgradeOption:preview.optionIndex,mount:option.mounts?.[n] ?? option.mount ?? ''}};
          await actor.createEmbeddedDocuments('Item', [source]);
        }
      }
    } else await unit.createEmbeddedDocuments('Item', [{name:preview.label.replaceAll('-', ' '),type:'trait',system:{slug:preview.label,effect:'Roster option',notes:'Apply this selected roster option when its rule is relevant.'},flags:{[SID]:{upgradeOption:preview.optionIndex}}}]);
    for (const actor of unit.members ?? []) if (preview.loaderUuids.includes(actor.uuid)) await actor.update({'system.role':'loader'});
    const next = [...selections(unit), {optionIndex:preview.optionIndex,count:preview.count,modelUuids:preview.modelUuids,loaderUuids:preview.loaderUuids}];
    const update = {'system.points':preview.pointsAfter,[`flags.${SID}.upgrades`]:next};
    if (option.transportCapacity !== undefined) update['system.capacity'] = option.transportCapacity;
    await unit.update(update);
    return preview;
  } catch (error) {
    const rollbackErrors = [];
    for (const snap of snapshots.reverse()) {
      try {
        await snap.actor.deleteEmbeddedDocuments('Item', snap.actor.items.map(i => i.id));
        if (snap.items.length) await snap.actor.createEmbeddedDocuments('Item', snap.items, {keepId:true});
        const update = {[`flags.${SID}.upgrades`]:snap.upgrades};
        if (snap.role !== undefined) update['system.role'] = snap.role;
        if (snap.points !== undefined) update['system.points'] = snap.points;
        if (snap.capacity !== undefined) update['system.capacity'] = snap.capacity;
        await snap.actor.update(update);
      } catch (failure) {rollbackErrors.push(failure.message);}
    }
    if (rollbackErrors.length) throw new Error(`${error.message}; rollback requires referee review: ${rollbackErrors.join('; ')}`);
    throw error;
  } finally {busy.delete(unit.uuid);}
}
