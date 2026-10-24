import * as rules from '../rules/index.mjs';
import {importStarter as importCatalogue, resolveWeapon} from './catalogue.mjs';

const SID = 'boltaction';
const actorClass = () => CONFIG.Actor.documentClass;
const messageClass = () => foundry.documents.ChatMessage;
const clone = value => foundry.utils.deepClone(value);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const setting = key => game.settings.get(SID, key);
export function requireGM() {
  if (!game.user.isGM) throw new Error('The GM controls the shared order bag and battlefield setup.');
}
export function requireOwner(actor) {
  if (!actor || actor.documentName !== 'Actor' || !actor.isOwner) throw new Error('You must own this actor.');
  if (actor.pack) throw new Error('Import this actor to the world before using it.');
  return actor;
}
function asUnit(actor) {
  requireOwner(actor);
  const unit = actor.unit;
  if (!unit || unit.type !== 'unit') throw new Error('Choose a squad, team or vehicle.');
  return requireOwner(unit);
}
function number(value, fallback, min = -100, max = 100, integer = false) {
  const result = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isFinite(result) || result < min || result > max || (integer && !Number.isInteger(result))) throw new Error(`Enter ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}.`);
  return result;
}
async function resolve(uuid, type) {
  const doc = await fromUuid(uuid);
  if (!doc || (type && doc.type !== type)) throw new Error('The referenced document is missing or has the wrong type.');
  return doc;
}
const locks = new Map();
function serial(key, fn) {
  const job = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
  locks.set(key, job);
  return job.finally(() => { if (locks.get(key) === job) locks.delete(key); });
}
async function dice(count) {
  if (!count) return {values: [], roll: null};
  const roll = await new Roll(`${number(count, 1, 1, 500, true)}d6`).evaluate();
  return {values: roll.dice.flatMap(d => d.results.filter(r => r.active !== false).map(r => r.result)), roll};
}
async function report(actor, title, lines, rolls = []) {
  return messageClass().create({
    speaker: messageClass().getSpeaker({actor}),
    content: `<section class="boltaction chat-card"><h3>${esc(title)}</h3>${lines.map(line => `<p>${esc(line)}</p>`).join('')}</section>`,
    rolls: rolls.filter(Boolean)
  });
}
function activeCheck(unit) {
  if (unit.isDestroyed) throw new Error('This unit is destroyed or routed.');
  if (unit.system.transportUuid) throw new Error('Disembark before giving a battlefield order.');
  const bag = game.combat?.getFlag(SID, 'bag');
  if (bag && bag.activeUnitUuid !== unit.uuid) throw new Error('The GM must activate this unit from the drawn side first.');
}
function moraleContext(unit) {
  const team = unit.items?.some(i => i.type === 'weapon' && i.system.traits.includes('team'));
  return {...unit.system, ncoAlive: unit.system.ncoAlive && !(team && unit.livingMembers.length === 1)};
}
async function confirm(title, content) {
  return foundry.applications.api.DialogV2.confirm({window: {title}, content: `<p>${esc(content)}</p>`, rejectClose: false});
}

export const importStarter = () => importCatalogue();
export async function profiles(actor) {
  const unit = actor.type === 'army' ? null : actor.unit;
  const army = actor.type === 'army' ? actor : actor.army;
  const factionUuid = unit?.system.factionUuid || army?.system.factionUuid;
  const faction = factionUuid ? await fromUuid(factionUuid) : null;
  const uuids = [...new Set([...(faction?.system.traitUuids ?? []), ...(unit?.system.traitUuids ?? [])])];
  const inherited = await Promise.all(uuids.map(uuid => fromUuid(uuid)));
  const embedded = [actor, ...(unit && unit !== actor ? [unit] : [])].flatMap(a => a.items.filter(i => i.type === 'trait'));
  return {faction: faction?.visible === false ? null : faction,
    traits: [...inherited, ...embedded].filter(item => item?.type === 'trait' && item.visible !== false)};
}
export async function validateArmy(army) {
  requireOwner(army);
  if (army.type !== 'army') throw new Error('Choose an army roster.');
  const issues = [], units = army.members;
  const points = units.reduce((total, unit) => total + unit.system.points, 0);
  if (points > army.system.pointsLimit) issues.push(`Points ${points} exceed limit ${army.system.pointsLimit}.`);
  for (const unit of units) {
    if (unit.system.factionUuid && army.system.factionUuid && unit.system.factionUuid !== army.system.factionUuid) issues.push(`${unit.name}: faction differs from the army.`);
    if (unit.system.kind !== 'vehicle' && unit.members.length > unit.system.maxSize) issues.push(`${unit.name}: exceeds its maximum squad size.`);
  }
  if (army.system.selectorUuid) {
    const selector = await resolve(army.system.selectorUuid, 'selector');
    for (const slot of selector.system.slots) {
      const count = units.filter(unit => unit.system.battlefieldRole === slot.kind).length;
      if (count < slot.min || count > slot.max) issues.push(`${slot.kind}: ${count} units; selector requires ${slot.min}–${slot.max}.`);
    }
  }
  await report(army, 'Roster check', [`${points} / ${army.system.pointsLimit} points.`, ...issues,
    'Check weapon upgrades, per-model costs, theatre and scenario eligibility manually. This checks configured limits and slots, rather than certifying a complete army list.']);
  return {points, valid: issues.length === 0, issues};
}
export async function shareRoster(army) {
  requireGM(); requireOwner(army);
  if (army.type !== 'army') throw new Error('Choose an army roster.');
  const actors = army.members.flatMap(unit => [unit, ...unit.members]);
  await actorClass().updateDocuments(actors.map(actor => ({_id: actor.id,
    ownership: {...Object.fromEntries(Object.keys(actor.ownership).map(id => [id, 0])), ...clone(army.ownership)}})));
  return actors;
}
export async function linkMember(parent, child) {
  requireOwner(parent); requireOwner(child);
  const army = parent.type === 'army' && child.type === 'unit';
  if (!army && !(parent.type === 'unit' && child.type === 'model' && parent.system.kind !== 'vehicle')) throw new Error('Armies contain units; infantry and artillery units contain individual soldiers.');
  if (parent.uuid === child.uuid) throw new Error('An actor cannot contain itself.');
  return serial('membership', async () => {
    const parentField = army ? 'unitUuids' : 'modelUuids', childField = army ? 'armyUuid' : 'unitUuid';
    const previous = child.system[childField];
    if (previous && previous !== parent.uuid) throw new Error('Unlink this actor from its current roster before moving it.');
    await child.update({[`system.${childField}`]: parent.uuid});
    try { await parent.update({[`system.${parentField}`]: [...new Set([...(parent.system[parentField] ?? []), child.uuid])]}); }
    catch (error) { await child.update({[`system.${childField}`]: previous ?? ''}); throw error; }
    return child;
  });
}
export async function unlinkMember(parent, uuid) {
  requireOwner(parent);
  return serial('membership', async () => {
    const parentField = parent.type === 'army' ? 'unitUuids' : 'modelUuids';
    if (!(parent.system[parentField] ?? []).includes(uuid)) throw new Error('This actor is not a roster member.');
    const child = await fromUuid(uuid);
    let childField, previous;
    if (child) {
      requireOwner(child);
      childField = parent.type === 'army' ? 'armyUuid' : 'unitUuid';
      previous = child.system[childField];
      if (previous === parent.uuid) await child.update({[`system.${childField}`]: ''});
    }
    try { await parent.update({[`system.${parentField}`]: parent.system[parentField].filter(id => id !== uuid)}); }
    catch (error) { if (child && previous === parent.uuid) await child.update({[`system.${childField}`]: previous}); throw error; }
    return child;
  });
}
export async function createSquad({name = 'Infantry squad', count = 5, quality = 'regular', side = 'allies', armyUuid = '', weaponSlug = 'rifle'} = {}) {
  if (!game.user.can('ACTOR_CREATE')) throw new Error('You need permission to create Actors.');
  count = number(count, 5, 1, 50, true);
  if (!rules.QUALITY[quality]) throw new Error('Unknown troop quality.');
  const army = armyUuid ? requireOwner(await resolve(armyUuid, 'army')) : null;
  const unit = await actorClass().create({name: String(name).slice(0, 150), type: 'unit', img: 'systems/boltaction/assets/unit.svg',
    ownership: {[game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER},
    system: {quality, side: String(side).slice(0, 50), startingSize: count, maxSize: Math.max(10, count), fullStrength: count >= 10},
    prototypeToken: {actorLink: true, texture: {src: 'systems/boltaction/assets/unit.svg'}}});
  try {
    await addModels(unit, {count, weaponSlug, addNco: true});
    if (army) await linkMember(army, unit);
  } catch (error) {
    await actorClass().deleteDocuments(unit.members.map(a => a.id));
    await unit.delete();
    throw error;
  }
  return unit;
}
export async function addModels(actor, {count = 1, weaponSlug = 'rifle', addNco = false, role = 'rifleman'} = {}) {
  const unit = asUnit(actor);
  if (unit.system.kind === 'vehicle') throw new Error('Vehicles use one unit actor rather than soldier members.');
  if (!game.user.can('ACTOR_CREATE')) throw new Error('You need permission to create Actors.');
  count = number(count, 1, 1, 50, true);
  if (unit.members.length + count > 100) throw new Error('A unit can contain at most 100 models.');
  const weapon = weaponSlug ? await resolveWeapon(weaponSlug) : null;
  if (weaponSlug && !weapon) throw new Error(`Unknown weapon slug: ${weaponSlug}`);
  const created = await actorClass().createDocuments(Array.from({length: count}, (_, i) => ({
    name: `${unit.name} · ${addNco && i === 0 ? 'NCO' : role} ${unit.members.length + i + 1}`, type: 'model',
    img: 'systems/boltaction/assets/soldier.svg', ownership: clone(unit.ownership),
    system: {unitUuid: unit.uuid, quality: unit.system.quality, role: addNco && i === 0 ? 'nco' : role},
    items: weapon ? [clone(weapon)] : [],
    prototypeToken: {actorLink: true, texture: {src: 'systems/boltaction/assets/model-token.svg'}}
  })));
  try { await unit.update({'system.modelUuids': [...unit.system.modelUuids, ...created.map(a => a.uuid)]}); }
  catch (error) { await actorClass().deleteDocuments(created.map(a => a.id)); throw error; }
  return created;
}
export async function casualty(model, dead = true) {
  requireOwner(model);
  if (model.type !== 'model') throw new Error('Mark casualties on individual soldier actors.');
  const unit = model.unit;
  if (unit) requireOwner(unit);
  await model.update({'system.dead': Boolean(dead)});
  if (unit) {
    const nco = unit.members.filter(a => a.system.role === 'nco');
    if (nco.length) await unit.update({'system.ncoAlive': nco.some(a => !a.system.dead)});
  }
  await model.toggleStatusEffect('dead', {active: Boolean(dead)});
  return model;
}
export async function addPin(actor, delta = 1) {
  const unit = asUnit(actor);
  return serial(unit.uuid, async () => {
    const pins = Math.max(0, unit.system.pins + number(delta, 1, -100, 100, true));
    await unit.update({'system.pins': pins});
    return pins;
  });
}
export async function order(actor, requestedOrder, {forceTest = false, modifier = 0} = {}) {
  const unit = asUnit(actor);
  return serial(unit.uuid, async () => {
    activeCheck(unit);
    if (unit.system.activated) throw new Error('This unit already has an order this round.');
    modifier = number(modifier, 0, -20, 20, true);
    const options = {...moraleContext(unit), order: requestedOrder, forceTest, modifier, livingSize: unit.livingMembers.length};
    const automatic = requestedOrder === 'down' || (!unit.system.pins && !forceTest);
    const first = automatic ? {values: [], roll: null} : await dice(2);
    options.dice = first.values;
    let result = rules.orderTest(options);
    const rolls = [first.roll];
    if (result.canReroll && await confirm('Full-strength re-roll', 'This infantry squad qualifies for one full-strength order-test re-roll. Re-roll the failed test?')) {
      const reroll = await dice(2); options.rerollDice = reroll.values; rolls.push(reroll.roll);
      result = rules.orderTest(options);
    }
    if (result.needsBonusDie) {
      const bonus = await dice(1); options.bonusDie = bonus.values[0]; rolls.push(bonus.roll);
      result = rules.orderTest(options);
    }
    const lines = [`${unit.name}: ${requestedOrder.toUpperCase()}. ${result.automatic ? 'Automatic' : `${result.total} vs morale ${result.target}`}: ${result.passed ? 'passed' : 'failed'}.`, `Pins removed: ${result.pinsRemoved}. Remaining: ${result.remainingPins}.`];
    let actualOrder = result.order;
    if (result.fubar) {
      const extra = await dice(1); rolls.push(extra.roll);
      const fubar = rules.fubarResult({roll: extra.values[0], kind: unit.system.kind});
      actualOrder = fubar.order;
      lines.push(`FUBAR: ${fubar.effect}. Resolve eligible friendly-fire targets, visible enemies and compulsory movement manually; use the order field to set Down if no legal target/move exists.`);
    }
    if (!result.passed && unit.system.kind === 'vehicle') lines.push('Failed vehicle order: resolve the compulsory reverse move manually; tracked/half-tracked/wheeled and terrain restrictions still apply.');
    await unit.update({'system.order': actualOrder, 'system.activated': true, 'system.retained': false, 'system.pins': result.remainingPins, 'system.firedWeaponUuids': [], 'system.shotTargetUuid': '', 'system.assaultResolved': false, 'system.hitTargetUuids': []});
    await report(unit, 'Order test', lines, rolls);
    return result;
  });
}
export async function morale(actor, {modifier = 0} = {}) {
  const unit = asUnit(actor), rolled = await dice(2);
  const result = rules.moraleTest({...moraleContext(unit), modifier: number(modifier, 0, -20, 20, true), dice: rolled.values});
  await report(unit, 'Morale test', [`${result.total} vs ${result.target}: ${result.passed ? 'passed' : 'failed — resolve the applicable destruction or vehicle-fire result.'}`], [rolled.roll]);
  if (!result.passed && setting('applyMorale') && await confirm('Apply failed morale', `Mark ${unit.name} destroyed? Confirm the test requires destruction and all special rules have been applied.`)) await unit.update({'system.destroyed': true});
  return result;
}
export async function retainOrder(actor, retain = true) {
  const unit = asUnit(actor);
  if (!['ambush', 'down'].includes(unit.system.order)) throw new Error('Only Ambush or Down can be retained.');
  await unit.update({'system.retained': Boolean(retain)});
}

function battlefieldUnits() {
  const scene = canvas.scene;
  return game.actors.filter(a => a.type === 'unit' && !a.isDestroyed && !a.system.transportUuid && scene?.tokens.some(t => t.actorId === a.id || a.members.some(m => t.actorId === m.id)));
}
async function ensureCombat() {
  if (!canvas.scene) throw new Error('Open a Scene first.');
  let combat = game.combat;
  if (combat && combat.scene?.id !== canvas.scene.id) throw new Error('Select the combat encounter for the viewed Scene.');
  if (!combat) combat = await CONFIG.Combat.documentClass.create({scene: canvas.scene.id, active: true});
  return combat;
}
export async function nextRound() {
  requireGM();
  return serial('bag', async () => {
    const combat = await ensureCombat();
    const prior = combat.getFlag(SID, 'bag');
    if (prior && (prior.remaining.length || (prior.activeUnitUuid && !game.actors.find(a => a.uuid === prior.activeUnitUuid)?.system.activated))) {
      if (!await confirm('End round early?', 'Some order dice have not been used. End this round and reset battlefield orders?')) return null;
    }
    const units = battlefieldUnits(), rolls = [];
    for (const unit of units) {
      let pins = unit.system.pins;
      const retained = unit.system.retained && ['ambush', 'down'].includes(unit.system.order);
      if (retained && unit.system.order === 'down') {
        const rolled = await dice(1); rolls.push(rolled.roll);
        pins = Math.max(0, pins - Math.ceil(rolled.values[0] / 2));
      }
      await unit.update({'system.activated': retained, 'system.order': retained ? unit.system.order : '', 'system.pins': pins, 'system.firedWeaponUuids': [], 'system.shotTargetUuid': '', 'system.assaultResolved': false, 'system.hitTargetUuids': []});
    }
    const active = units.filter(u => !u.isDestroyed);
    const existing = new Set(combat.combatants.map(c => c.actorId));
    await combat.createEmbeddedDocuments('Combatant', active.filter(u => !existing.has(u.id)).map(u => ({actorId: u.id, tokenId: canvas.scene.tokens.find(t => t.actorId === u.id)?.id, sceneId: canvas.scene.id, name: u.name})));
    const stale = combat.combatants.filter(c => !active.some(u => u.id === c.actorId));
    if (stale.length) await combat.deleteEmbeddedDocuments('Combatant', stale.map(c => c.id));
    const bag = {round: Math.max(1, combat.round + 1), remaining: active.filter(u => !u.system.activated).map(u => ({unitUuid: u.uuid, side: u.effectiveSide})), drawnSide: null, activeUnitUuid: null, used: []};
    await combat.update({round: bag.round, turn: null, [`flags.${SID}.bag`]: bag});
    await report(null, `Round ${bag.round}`, [`${bag.remaining.length} order dice returned to the bag. Retained Ambush/Down orders remain outside it.`], rolls);
    return bag;
  });
}
export async function drawDie() {
  requireGM();
  return serial('bag', async () => {
    const combat = await ensureCombat(), previous = combat.getFlag(SID, 'bag');
    if (!previous) throw new Error('Start a new round on the Battle Board first.');
    const bag = clone(previous);
    const living = battlefieldUnits();
    bag.remaining = bag.remaining.filter(entry => living.some(u => u.uuid === entry.unitUuid && !u.system.activated));
    if (bag.drawnSide && !bag.remaining.some(entry => entry.side === bag.drawnSide)) bag.drawnSide = null;
    if (bag.drawnSide) throw new Error('Select a unit for the currently drawn side first.');
    const active = bag.activeUnitUuid && await fromUuid(bag.activeUnitUuid);
    if (active && living.some(u => u.uuid === active.uuid) && !active.system.activated && !active.isDestroyed) throw new Error('Give the active unit an order before drawing again.');
    if (!bag.remaining.length) {
      bag.activeUnitUuid = null; bag.drawnSide = null;
      await combat.update({[`flags.${SID}.bag`]: bag});
      throw new Error('The bag is empty. Start the next round.');
    }
    const rolled = await new Roll(`1d${bag.remaining.length}`).evaluate();
    const entry = bag.remaining[rolled.total - 1];
    bag.drawnSide = entry.side; bag.activeUnitUuid = null;
    await combat.update({[`flags.${SID}.bag`]: bag});
    await report(null, 'Order die drawn', [`${entry.side} chooses one eligible unit. ${bag.remaining.length} dice remain until a unit is assigned.`], [rolled]);
    return entry.side;
  });
}
export async function activateUnit(actor) {
  requireGM(); const unit = asUnit(actor);
  return serial('bag', async () => {
    const combat = await ensureCombat(), bag = clone(combat.getFlag(SID, 'bag'));
    if (!battlefieldUnits().some(u => u.uuid === unit.uuid)) throw new Error('This unit is not deployed or is embarked.');
    if (!bag?.drawnSide || unit.effectiveSide !== bag.drawnSide || unit.isDestroyed || unit.system.activated) throw new Error('Choose an unactivated unit belonging to the drawn side.');
    const index = bag.remaining.findIndex(d => d.unitUuid === unit.uuid);
    if (index < 0) throw new Error('This unit has no available order die.');
    bag.remaining.splice(index, 1); bag.used.push(unit.uuid); bag.drawnSide = null; bag.activeUnitUuid = unit.uuid;
    await combat.update({[`flags.${SID}.bag`]: bag});
    await selectUnit(unit);
    return unit;
  });
}

export async function shoot(actor, options = {}) {
  const unit = asUnit(actor);
  return serial(`attack:${unit.uuid}`, () => resolveShooting(unit, options));
}
async function resolveShooting(unit, options) {
  if (unit.system.order !== 'ambush') activeCheck(unit);
  else if (unit.isDestroyed || unit.system.transportUuid) throw new Error('This unit cannot react from Ambush.');
  if (!['fire', 'advance', 'ambush'].includes(unit.system.order)) throw new Error('Give this unit a Fire, Advance or Ambush order before shooting.');
  const target = await resolve(options.targetUuid, 'unit');
  if (target.uuid === unit.uuid) throw new Error('A unit cannot target itself.');
  if (target.isDestroyed) throw new Error('The target is destroyed.');
  const weapon = unit.weapons.find(w => w.uuid === options.weaponId || w.id === options.weaponId);
  if (!weapon) throw new Error('Choose a weapon carried by this unit or a surviving soldier.');
  const profile = weapon.system;
  const signature = w => JSON.stringify([w.system.slug, w.system.range, w.system.shots, w.system.penetration, [...w.system.traits].sort()]);
  const group = unit.system.kind === 'vehicle' ? [weapon] : unit.weapons.filter(w => signature(w) === signature(weapon));
  if (group.some(w => unit.system.firedWeaponUuids.includes(w.uuid))) throw new Error('This weapon group already fired under the current order.');
  if (unit.system.kind !== 'vehicle' && unit.system.shotTargetUuid && unit.system.shotTargetUuid !== target.uuid) throw new Error('The unit must direct its remaining weapons at the same target.');
  const mode = options.mode || 'direct';
  if (!['direct', 'he', 'indirect'].includes(mode)) throw new Error('Unknown firing mode.');
  const manualTraits = ['indirect-fire', 'flamethrower', 'shaped-charge', 'one-shot', 'howitzer', 'indirect'];
  const manual = mode !== 'direct' || profile.shotsFormula || profile.traits.some(t => manualTraits.includes(t));
  if (manual) {
    await report(unit, 'Special weapon — manual resolution', [`${weapon.name}: ${profile.notes || 'Consult this weapon’s special rules.'}`, 'Use Foundry chat dice for special attacks. HE templates, ranging-in, variable hits, fuel, ammunition and exceptional weapon effects are not resolved by the standard direct-fire assistant. No pins or casualties were applied.']);
    return {manual: true};
  }
  if (profile.traits.includes('fixed') && unit.system.kind !== 'vehicle' && unit.system.order === 'advance') {
    if (!await confirm('Fixed weapon rotation', 'Confirm this fixed weapon rotated on the spot and did not translate during its Advance. Apply the normal movement hit penalty.')) return null;
  }
  const range = number(options.range, 12, 0, 1000);
  if (range < profile.minRange || range > profile.range) throw new Error('The target is outside this weapon’s firing range.');
  const count = number(options.shots, group.reduce((n, w) => n + w.system.shots * w.system.quantity, 0), 1, 500, true);
  const input = {quality: unit.system.quality, pins: unit.system.pins, range, weaponRange: profile.range,
    moved: options.moved || unit.system.order === 'advance', assault: profile.traits.includes('assault'),
    targetDown: Boolean(options.targetDown || (target.system.order === 'down' && target.system.kind !== 'vehicle')),
    smallTeam: Boolean(options.smallTeam || (target.system.kind === 'infantry' && target.livingMembers.length > 0 && target.livingMembers.length <= 2)),
    cover: options.cover || 'none', extraModifier: number(options.extraModifier, 0, -30, 30)};
  const hitsRoll = await dice(count), rolls = [hitsRoll.roll];
  const hitTarget = rules.shootingTarget(input);
  const followups = hitTarget.sixSix ? await dice(hitsRoll.values.filter(v => v === 6).length) : {values: []};
  rolls.push(followups.roll);
  const hits = rules.resolveHits({...input, dice: hitsRoll.values, followupDice: followups.values});
  const penetration = profile.penetration + number(options.penetrationModifier, 0, -20, 20, true);
  const lines = [`${unit.name} → ${target.name}; ${weapon.name} × ${group.length}.`, `${count} shots at ${range}″; ${hits.sixSix ? '6 then 6' : `${hits.target}+`} to hit: ${hits.hits} hits.`];
  if (profile.traits.includes('fixed') && unit.system.kind !== 'vehicle') lines.push('Confirm the target is inside the fixed weapon arc.');
  let damage = null, eligiblePin = hits.hits > 0;
  if (hits.hits) {
    const damageRoll = await dice(hits.hits); rolls.push(damageRoll.roll);
    if (target.system.kind === 'vehicle') {
      const facing = options.facing || 'front', longRange = range > profile.range / 2;
      const penetrations = damageRoll.values.map(roll => rules.armourPenetration({roll, penetration, damageValue: target.damageValue, facing, longRange}));
      const damageResults = [];
      for (const hit of penetrations.filter(h => h.damaged)) {
        const rolled = await dice(hit.damageRolls); rolls.push(rolled.roll);
        damageResults.push(...rolled.values.map(roll => rules.vehicleDamage({roll, superficial: hit.superficial, alreadyImmobilised: target.system.immobilised, activated: target.system.activated})));
      }
      const pinOptions = {quality: target.system.quality, damageValue: target.damageValue, penetration, openTopped: target.system.openTopped, facing, longRange, hits: hits.hits};
      let pin = rules.vehiclePin(pinOptions);
      if (pin.needsDie) { const rolled = await dice(1); rolls.push(rolled.roll); pin = rules.vehiclePin({...pinOptions, roll: rolled.values[0]}); }
      eligiblePin = pin.pinned;
      damage = {penetrations, damageResults};
      lines.push(`${penetrations.filter(p => p.damaged).length} penetrating hits. Damage results: ${damageResults.map(d => d.effect).join(', ') || 'none'}.`);
      lines.push('Apply vehicle damage, additional pins, turret jams and fire morale manually on the unit sheet. Armour facing and special armour rules must be confirmed by the players.');
    } else {
      damage = rules.infantryDamage({dice: damageRoll.values, quality: target.system.quality, penetration, damageValue: target.damageValue});
      const exceptional = await dice(damage.needsExceptionalDice); rolls.push(exceptional.roll);
      damage = rules.infantryDamage({dice: damageRoll.values, quality: target.system.quality, penetration, damageValue: target.damageValue, exceptionalDice: exceptional.values});
      lines.push(`${damage.casualties} casualties suggested; ${damage.exceptional.length} exceptional damage results. Allocate models on the roster after checking cover, weapon teams and special rules.`);
      if (rules.casualtyMoraleRequired({sizeBefore: target.livingMembers.length, casualties: damage.casualties})) lines.push('At least half the unit was lost in this attack: take a morale test after allocating casualties unless a special rule overrides it.');
    }
  }
  const alreadyHit = (unit.system.hitTargetUuids ?? []).includes(target.uuid);
  if (eligiblePin && alreadyHit) lines.push('This firing unit already scored a pin-eligible hit on this target under this order. Apply only one standard hit pin in total.');
  if (eligiblePin && !alreadyHit && options.apply && setting('applyPins')) {
    if (target.isOwner) { await addPin(target, 1); lines.push('One hit pin applied.'); }
    else lines.push('Target owner or GM must apply one hit pin; you do not have permission to edit the target.');
  } else if (eligiblePin && !alreadyHit) lines.push('One hit pin suggested; apply manually or enable the pin assistant and confirm Apply.');
  await unit.update({'system.firedWeaponUuids': [...new Set([...unit.system.firedWeaponUuids, ...group.map(w => w.uuid)])], 'system.shotTargetUuid': target.uuid, 'system.hitTargetUuids': eligiblePin ? [...new Set([...(unit.system.hitTargetUuids ?? []), target.uuid])] : (unit.system.hitTargetUuids ?? [])});
  await report(unit, 'Shooting', lines, rolls);
  return {hits, damage, eligiblePin};
}
export async function assault(actor, options = {}) {
  const unit = asUnit(actor);
  return serial(`attack:${unit.uuid}`, () => resolveAssault(unit, options));
}
async function resolveAssault(unit, options) {
  activeCheck(unit);
  if (unit.system.assaultResolved) throw new Error('An assault exchange was already resolved under this order. Resolve tied exchanges manually.');
  if (unit.system.order !== 'run') throw new Error('Assaults require a Run order.');
  const target = await resolve(options.targetUuid, 'unit');
  if (unit.uuid === target.uuid || target.isDestroyed) throw new Error('Choose a different, surviving target unit.');
  if (unit.system.kind === 'vehicle' || target.system.kind === 'vehicle') throw new Error('Vehicle assaults require manual resolution.');
  const attackers = number(options.attackerDice, unit.livingMembers.length, 1, 100, true);
  const defenders = number(options.defenderDice, target.livingMembers.length, 1, 100, true);
  const range = number(options.range, 12, 0, 1000);
  if (range > unit.system.moveRun) throw new Error('This assault is beyond the Run movement budget.');
  if (!options.reactionsResolved && !await confirm('Assault reactions', 'Confirm that charge range, terrain, defensive positions and all reaction fire have been resolved. Continue to combat dice?')) return null;
  const attack = await dice(attackers);
  const attackDamage = rules.infantryDamage({dice: attack.values, quality: target.system.quality});
  attackDamage.casualties = Math.min(defenders, attackDamage.casualties);
  const simultaneous = Boolean(options.defensivePosition);
  const survivors = simultaneous ? defenders : Math.max(0, defenders - attackDamage.casualties);
  const defend = await dice(survivors);
  const defenceDamage = rules.infantryDamage({dice: defend.values, quality: unit.system.quality});
  const result = {attackerCasualties: Math.min(attackers, defenceDamage.casualties), defenderCasualties: attackDamage.casualties, simultaneous};
  const attackingLeft = attackers - result.attackerCasualties, defendingLeft = defenders - result.defenderCasualties;
  const comparison = !attackingLeft && !defendingLeft ? 'Both units were wiped out.' : !attackingLeft ? `${unit.name} was wiped out.` : !defendingLeft ? `${target.name} was wiped out.` : result.attackerCasualties === result.defenderCasualties ? 'Draw: resolve another simultaneous exchange manually.' : `${result.attackerCasualties > result.defenderCasualties ? unit.name : target.name} loses: remove the remaining models unless a special rule overrides surrender.`;
  await unit.update({'system.assaultResolved': true});
  await report(unit, 'Close quarters — assisted exchange', [`${unit.name} vs ${target.name}.`, `${attackers} attacker dice; ${survivors} defender dice${simultaneous ? ' (simultaneous)' : ' (after attacker casualties)'}.`, `${result.defenderCasualties} defender casualties; ${result.attackerCasualties} attacker casualties.`, comparison, 'Allocate casualties, exceptional damage, tough fighters and other traits manually. This assistant covers one standard exchange; regroup and reactions remain manual.'], [attack.roll, defend.roll]);
  return result;
}

export async function configureScene() {
  requireGM();
  if (!canvas.scene) throw new Error('Open a Scene first.');
  const pixels = await foundry.applications.api.DialogV2.prompt({window: {title: 'Battlefield scale'}, content: '<div class="form-group"><label>Pixels per tabletop inch</label><input name="scale" type="number" min="10" max="500" value="100"></div>', ok: {callback: (_event, button) => Number(button.form.elements.scale.value)}, rejectClose: false});
  if (pixels === null || pixels === undefined) return null;
  await canvas.scene.update({'grid.type': 0, 'grid.size': number(pixels, 100, 10, 500), 'grid.distance': 1, 'grid.units': 'in', tokenVision: false, fog: {exploration: false}});
  return canvas.scene;
}
function requireInches() {
  if (!canvas.scene) throw new Error('Open a Scene first.');
  if (!['in', 'inch', 'inches', '″'].includes(canvas.scene.grid.units?.toLowerCase()) || !(canvas.scene.grid.distance > 0)) throw new Error('Use Setup scene to calibrate tabletop inches before deployment or measurement assistance.');
}
export function pixelsPerInch(scene = canvas.scene) { return scene.grid.size / scene.grid.distance; }
export async function spawnUnit(actor, {x, y} = {}) {
  requireOwner(actor); requireInches();
  if (!game.user.can('TOKEN_CREATE')) throw new Error('You need permission to create tokens.');
  if (actor.type === 'army') {
    const output = [];
    const scale = pixelsPerInch(), startX = x ?? canvas.stage.pivot.x, startY = y ?? canvas.stage.pivot.y;
    for (let i = 0; i < actor.members.length; i++) output.push(...await spawnUnit(actor.members[i], {x: startX + i % 3 * scale * 8, y: startY + Math.floor(i / 3) * scale * 6}));
    return output;
  }
  const unit = asUnit(actor);
  if (!unit.members.length && unit.system.kind !== 'vehicle') {
    const composition = unit.getFlag(SID, 'composition');
    if (!Array.isArray(composition) || !composition.length) throw new Error('Add the individual soldiers on the unit sheet before deployment.');
    for (const entry of composition) await addModels(unit, entry);
  }
  const existing = canvas.scene.tokens.filter(t => t.actorId === unit.id || unit.members.some(m => m.id === t.actorId));
  const scale = pixelsPerInch();
  const center = {x: x ?? canvas.stage.pivot.x, y: y ?? canvas.stage.pivot.y};
  const baseX = Math.max(0, Math.min(canvas.scene.width - 6 * scale, center.x));
  const baseY = Math.max(0, Math.min(canvas.scene.height - 6 * scale, center.y));
  const actors = unit.system.kind === 'vehicle' ? [unit] : [unit, ...unit.livingMembers];
  const tokens = [];
  for (let i = 0; i < actors.length; i++) {
    const member = actors[i], command = member === unit && unit.system.kind !== 'vehicle';
    if (existing.some(t => t.actorId === member.id)) continue;
    const index = Math.max(0, i - 1);
    const token = await member.getTokenDocument({actorLink: true,
      x: Math.max(0, baseX + (command ? -1.5 * scale : index % 5 * 1.4 * scale)),
      y: baseY + (command ? 0 : Math.floor(index / 5) * 1.4 * scale),
      width: (unit.system.kind === 'vehicle' ? 2 : 1) / canvas.scene.grid.distance,
      height: (unit.system.kind === 'vehicle' ? 3 : 1) / canvas.scene.grid.distance,
      texture: {src: `systems/boltaction/assets/${unit.system.kind === 'vehicle' ? 'vehicle-token' : command ? 'unit' : 'model-token'}.svg`},
      alpha: command ? 0.55 : 1,
      disposition: member.effectiveSide === 'axis' ? -1 : 1,
      flags: {[SID]: {command}}, displayName: CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER});
    tokens.push(token.toObject());
  }
  const created = tokens.length ? await canvas.scene.createEmbeddedDocuments('Token', tokens) : [];
  if (game.user.isGM && game.combat?.getFlag(SID, 'bag')) ui.notifications.info('Deployment changed. New units join the order bag at the next round.');
  await selectUnit(unit);
  return [...existing, ...created];
}
export async function selectUnit(actor) {
  const unit = actor.type === 'army' ? null : actor.unit;
  if (!unit) throw new Error('Choose a unit.');
  const actors = new Set([unit.id, ...unit.livingMembers.map(a => a.id)]);
  canvas.tokens?.releaseAll();
  const tokens = canvas.tokens?.placeables.filter(t => actors.has(t.document.actorId)) ?? [];
  for (const token of tokens) if (token.isOwner) token.control({releaseOthers: false});
  if (tokens.length) await canvas.animatePan({x: tokens[0].center.x, y: tokens[0].center.y});
  return tokens;
}
export async function setTransport(actor, transportUuid) {
  requireGM();
  const unit = asUnit(actor), transport = asUnit(await resolve(transportUuid, 'unit'));
  if (unit.system.kind === 'vehicle' || transport.system.kind !== 'vehicle' || transport.uuid === unit.uuid) throw new Error('Only infantry/artillery can embark a vehicle.');
  if (unit.system.transportUuid) throw new Error('This unit is already embarked.');
  if (unit.effectiveSide !== transport.effectiveSide) throw new Error('A unit must use a friendly transport.');
  const occupied = await Promise.all(transport.system.passengerUuids.map(id => fromUuid(id)));
  const seats = occupied.reduce((n, u) => n + (u?.livingMembers.length ?? 0), 0);
  if (seats + unit.livingMembers.length > transport.system.capacity) throw new Error('The transport has insufficient configured capacity.');
  if (!await confirm('Embark', 'Confirm transport range, capacity, timing and weapon restrictions. Soldier tokens will be hidden; disembark restores them for manual placement.')) return null;
  if (!canvas.scene) throw new Error('Open the battlefield Scene first.');
  const previousPassengers = [...transport.system.passengerUuids];
  const previousTransport = unit.system.transportUuid;
  const ids = new Set([unit.id, ...unit.members.map(m => m.id)]);
  const tokens = canvas.scene.tokens.filter(t => ids.has(t.actorId));
  const hidden = tokens.map(t => ({_id: t.id, hidden: t.hidden}));
  try {
    await transport.update({'system.passengerUuids': [...new Set([...previousPassengers, unit.uuid])]});
    await unit.update({'system.transportUuid': transport.uuid});
    await canvas.scene.updateEmbeddedDocuments('Token', tokens.map(t => ({_id: t.id, hidden: true})));
  } catch (error) {
    await transport.update({'system.passengerUuids': previousPassengers});
    await unit.update({'system.transportUuid': previousTransport});
    if (hidden.length) await canvas.scene.updateEmbeddedDocuments('Token', hidden);
    throw error;
  }
  return unit;
}
export async function unloadTransport(actor) {
  requireGM(); const unit = asUnit(actor);
  if (!canvas.scene) throw new Error('Open the battlefield Scene first.');
  const previousTransport = unit.system.transportUuid;
  const transport = previousTransport && await fromUuid(previousTransport);
  if (transport) requireOwner(transport);
  const previousPassengers = transport ? [...transport.system.passengerUuids] : [];
  const ids = new Set([unit.id, ...unit.members.map(m => m.id)]);
  const tokens = canvas.scene.tokens.filter(t => ids.has(t.actorId));
  const hidden = tokens.map(t => ({_id: t.id, hidden: t.hidden}));
  try {
    if (transport) await transport.update({'system.passengerUuids': previousPassengers.filter(id => id !== unit.uuid)});
    await unit.update({'system.transportUuid': ''});
    await canvas.scene.updateEmbeddedDocuments('Token', tokens.map(t => ({_id: t.id, hidden: false})));
  } catch (error) {
    if (transport) await transport.update({'system.passengerUuids': previousPassengers});
    await unit.update({'system.transportUuid': previousTransport});
    if (hidden.length) await canvas.scene.updateEmbeddedDocuments('Token', hidden);
    throw error;
  }
  ui.notifications.info('Place the disembarked models at legal positions beside the transport and resolve their permitted order.');
}
export {rules};
