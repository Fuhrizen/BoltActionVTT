import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

let actors, messages, rolls, combat, scene;
function apply(target, updates) {
  for (const [key, value] of Object.entries(updates)) {
    const parts = key.split('.');
    const last = parts.pop();
    let destination = target;
    for (const part of parts) destination = destination[part] ??= {};
    destination[last] = structuredClone(value);
  }
}
function actor(id, type = 'unit', extra = {}) {
  const value = {
    id, uuid: `Actor.${id}`, name: id, type, documentName: 'Actor', isOwner: true, items: [], flags: {},
    system: {kind: 'infantry', side: 'allies', pins: 0, quality: 'regular', ncoAlive: true,
      moraleBonus: 0, activated: false, destroyed: false, modelUuids: [], unitUuids: [],
      unitUuid: '', armyUuid: '', transportUuid: '', passengerUuids: [], order: '',
      firedWeaponUuids: [], hitTargetUuids: [], shotTargetUuid: '', assaultResolved: false, moveRun: 12, ...extra},
    async update(updates) { if (this.failUpdate) { this.failUpdate = false; throw new Error('Injected update failure'); } apply(this, updates); return this; },
    async setFlag(namespace, key, value) { this.flags[namespace] ??= {}; this.flags[namespace][key] = structuredClone(value); },
    getFlag(namespace, key) { return this.flags[namespace]?.[key]; },
    get unit() { return this.type === 'unit' ? this : actors.find(a => a.uuid === this.system.unitUuid); },
    get army() { return this.type === 'army' ? this : actors.find(a => a.uuid === this.unit?.system.armyUuid); },
    get members() { return (this.system[this.type === 'army' ? 'unitUuids' : 'modelUuids'] ?? []).map(uuid => actors.find(a => a.uuid === uuid)).filter(Boolean); },
    get livingMembers() { return this.members.filter(a => !a.system.dead); },
    get effectiveSide() { return this.system.side; },
    get isDestroyed() { return this.system.destroyed; },
    weapons: []
  };
  actors.push(value);
  return value;
}
function setup() {
  actors = []; messages = []; rolls = [];
  scene = {id: 'scene', uuid: 'Scene.scene', tokens: [], flags: {},
    async setFlag(namespace, key, value) { this.flags[namespace] ??= {}; this.flags[namespace][key] = structuredClone(value); },
    getFlag(namespace, key) { return this.flags[namespace]?.[key]; },
    async updateEmbeddedDocuments(_type, updates) { for (const row of updates) { const token = this.tokens.find(token => token.id === row._id); if (token) apply(token, row); } }};
  combat = {
    scene, round: 0, flags: {}, combatants: [],
    getFlag(namespace, key) { return this.flags[namespace]?.[key]; },
    async update(updates) { apply(this, updates); },
    async createEmbeddedDocuments(_type, values) { this.combatants.push(...values.map((v, i) => ({id: `combatant${i}`, ...v}))); },
    async deleteEmbeddedDocuments(_type, ids) { this.combatants = this.combatants.filter(c => !ids.includes(c.id)); }
  };
  globalThis.game = {user: {id: 'gm', isGM: true, can: () => true}, actors,
    combat, settings: {get: () => false}};
  globalThis.canvas = {scene, tokens: {placeables: [], releaseAll() {}}};
  globalThis.fromUuid = async uuid => actors.find(a => a.uuid === uuid) ?? null;
  globalThis.foundry = {utils: {deepClone: structuredClone},
    applications: {api: {DialogV2: {confirm: async () => true}}},
    documents: {ChatMessage: {getSpeaker: () => ({}), create: async value => messages.push(value)}}};
  globalThis.CONFIG = {Actor: {documentClass: {}}, Combat: {documentClass: {}}};
  globalThis.ui = {notifications: {info() {}, warn() {}, error() {}}};
  globalThis.Roll = class {
    constructor(formula) { this.formula = formula; }
    async evaluate() {
      const count = Number(this.formula.split('d')[0]);
      const values = Array.from({length: count}, () => rolls.shift() ?? 3);
      this.total = values.reduce((a, b) => a + b, 0);
      this.dice = [{results: values.map(result => ({result, active: true}))}];
      return this;
    }
  };
  return {deploy(...units) { scene.tokens.push(...units.map(u => ({id: `token-${u.id}`, actorId: u.id}))); }};
}
const api = await import('../scripts/services/api.mjs');

test('profiles inherit faction traits and custom selector validation checks configured roster limits', async () => {
  setup();
  const inherited = {uuid: 'Compendium.traits.inherited', type: 'trait', name: 'Faction trait'};
  const hidden = {uuid: 'Compendium.traits.hidden', type: 'trait', visible: false};
  const faction = {uuid: 'Compendium.factions.one', type: 'faction', system: {traitUuids: [inherited.uuid, hidden.uuid]}};
  const selector = {uuid: 'Item.selector', type: 'selector', system: {slots: [{kind: 'infantry', min: 1, max: 1}]}};
  actors.push(inherited, hidden, faction, selector);
  const army = actor('army', 'army', {factionUuid: faction.uuid, selectorUuid: selector.uuid, pointsLimit: 200});
  const unit = actor('infantry', 'unit', {armyUuid: army.uuid, points: 120, maxSize: 1, battlefieldRole: 'infantry', traitUuids: [inherited.uuid]});
  const model = actor('soldier', 'model', {unitUuid: unit.uuid});
  const personal = {uuid: 'Actor.soldier.Item.personal', type: 'trait', name: 'Personal trait'};
  model.items.push(personal);
  unit.system.modelUuids = [model.uuid];
  army.system.unitUuids = [unit.uuid];
  const profile = await api.profiles(model);
  assert.equal(profile.faction, faction);
  assert.deepEqual(profile.traits, [inherited, personal]);
  assert.deepEqual(await api.validateArmy(army), {points: 120, valid: true, issues: []});
  const other = actor('other', 'unit', {armyUuid: army.uuid, points: 120, factionUuid: 'Item.other-faction', maxSize: 10, battlefieldRole: 'infantry'});
  army.system.unitUuids.push(other.uuid);
  unit.system.modelUuids.push(actor('extra-soldier', 'model', {unitUuid: unit.uuid}).uuid);
  const invalid = await api.validateArmy(army);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.points, 240);
  assert.equal(invalid.issues.length, 4);
  for (const message of ['Points', 'maximum squad size', 'faction differs', 'selector requires']) assert.ok(invalid.issues.some(issue => issue.includes(message)), message);
});

test('membership maintains reciprocal UUIDs, rejects unowned actors, and rolls back failed parent update', async () => {
  setup();
  const squad = actor('squad'), model = actor('soldier', 'model');
  await api.linkMember(squad, model);
  assert.deepEqual(squad.system.modelUuids, [model.uuid]);
  assert.equal(model.system.unitUuid, squad.uuid);
  await api.linkMember(squad, model);
  assert.equal(squad.system.modelUuids.length, 1);
  await api.unlinkMember(squad, model.uuid);
  assert.deepEqual(squad.system.modelUuids, []);
  assert.equal(model.system.unitUuid, '');
  model.isOwner = false;
  await assert.rejects(api.linkMember(squad, model), /own this actor/);
  model.isOwner = true;
  squad.failUpdate = true;
  await assert.rejects(api.linkMember(squad, model), /Injected/);
  assert.equal(model.system.unitUuid, '');
  assert.deepEqual(squad.system.modelUuids, []);
  await api.linkMember(squad, model);
  squad.failUpdate = true;
  await assert.rejects(api.unlinkMember(squad, model.uuid), /Injected/);
  assert.equal(model.system.unitUuid, squad.uuid);
  assert.deepEqual(squad.system.modelUuids, [model.uuid]);
});

test('a weapon group fires once and an assault exchange resolves once per order', async () => {
  setup();
  const unit = actor('shooter', 'unit', {order: 'fire', activated: true});
  const target = actor('target'); target.damageValue = 4;
  unit.weapons = [{id: 'rifle', uuid: 'Actor.shooter.Item.rifle', name: 'Rifle',
    system: {slug: 'rifle', range: 24, minRange: 0, shots: 1, quantity: 1, penetration: 0, traits: []}}];
  const options = {targetUuid: target.uuid, weaponId: 'rifle', range: 10};
  await api.shoot(unit, options);
  assert.deepEqual(unit.system.firedWeaponUuids, ['Actor.shooter.Item.rifle']);
  await assert.rejects(api.shoot(unit, options), /already fired/);
  unit.system.order = 'run';
  await api.assault(unit, {targetUuid: target.uuid, attackerDice: 1, defenderDice: 1, range: 1, reactionsResolved: true});
  assert.equal(unit.system.assaultResolved, true);
  await assert.rejects(api.assault(unit, {targetUuid: target.uuid}), /already resolved/);
});

test('non-GM transport request cannot partially mutate reciprocal records', async () => {
  setup();
  const unit = actor('passenger'), transport = actor('transport', 'unit', {kind: 'vehicle', capacity: 10});
  game.user.isGM = false;
  await assert.rejects(api.setTransport(unit, transport.uuid), /GM controls/);
  assert.equal(unit.system.transportUuid, '');
  assert.deepEqual(transport.system.passengerUuids, []);
});

test('mixed weapon profiles score one standard hit pin per firing unit and reject self targeting', async () => {
  setup();
  game.settings.get = () => true;
  const unit = actor('firing', 'unit', {order: 'fire', activated: true});
  const target = actor('target'); target.damageValue = 4;
  unit.weapons = ['rifle', 'lmg'].map(slug => ({id: slug, uuid: `Actor.firing.Item.${slug}`, name: slug,
    system: {slug, range: 24, minRange: 0, shots: 1, quantity: 1, penetration: 0, traits: []}}));
  rolls.push(4, 4, 4, 4);
  await api.shoot(unit, {targetUuid: target.uuid, weaponId: 'rifle', range: 10, apply: true});
  await api.shoot(unit, {targetUuid: target.uuid, weaponId: 'lmg', range: 10, apply: true});
  assert.equal(target.system.pins, 1);
  await assert.rejects(api.shoot(unit, {targetUuid: unit.uuid, weaponId: 'rifle'}), /itself|self|own unit/i);
});

test('transport reciprocal links roll back when passenger update fails', async () => {
  setup();
  const unit = actor('passenger'), transport = actor('transport', 'unit', {kind: 'vehicle', capacity: 10});
  unit.failUpdate = true;
  await assert.rejects(api.setTransport(unit, transport.uuid), /Injected/);
  assert.equal(unit.system.transportUuid, '');
  assert.deepEqual(transport.system.passengerUuids, []);
  unit.system.transportUuid = transport.uuid;
  transport.system.passengerUuids = [unit.uuid];
  unit.failUpdate = true;
  await assert.rejects(api.unloadTransport(unit), /Injected/);
  assert.equal(unit.system.transportUuid, transport.uuid);
  assert.deepEqual(transport.system.passengerUuids, [unit.uuid]);
});

test('vehicle Advance permits direct anti-tank fire despite optional HE profile, while explicit HE stays manual', async () => {
  setup();
  const tank = actor('tank', 'unit', {kind: 'vehicle', order: 'advance', activated: true});
  const target = actor('armour', 'unit', {kind: 'vehicle', immobilised: false, openTopped: false});
  target.damageValue = 8;
  tank.weapons = [{id: 'at-gun', uuid: 'Actor.tank.Item.at-gun', name: 'Medium anti-tank gun',
    system: {slug: 'medium-at-gun', range: 60, minRange: 0, shots: 1, quantity: 1,
      penetration: 5, heDiameter: 1, shotsFormula: '', traits: ['team', 'fixed', 'he'], notes: ''}}];
  const options = {targetUuid: target.uuid, weaponId: 'at-gun', range: 12};
  const beforeTank = structuredClone(tank.system), beforeTarget = structuredClone(target.system);
  assert.deepEqual(await api.shoot(tank, {...options, mode: 'he'}), {manual: true});
  assert.deepEqual(tank.system, beforeTank);
  assert.deepEqual(target.system, beforeTarget);
  rolls.push(6, 4, 4);
  const result = await api.shoot(tank, options);
  assert.equal(result.manual, undefined);
  assert.equal(result.hits.hits, 1);
  assert.equal(result.damage.penetrations.filter(hit => hit.damaged).length, 1);
  assert.equal(result.damage.damageResults.length, 1);
  assert.deepEqual(tank.system.firedWeaponUuids, ['Actor.tank.Item.at-gun']);
});

test('bag uses one die per eligible unit, permits side choice, and cannot draw or order twice', async () => {
  const {deploy} = setup();
  const first = actor('allied-one'), second = actor('allied-two');
  const enemy = actor('axis', 'unit', {side: 'axis'});
  actor('undeployed');
  const dead = actor('dead', 'unit', {destroyed: true});
  deploy(first, second, enemy, dead);
  const bag = await api.nextRound();
  assert.deepEqual(bag.remaining.map(d => d.side), ['allies', 'allies', 'axis']);
  assert.equal(combat.combatants.length, 3);
  rolls.push(2);
  assert.equal(await api.drawDie(), 'allies');
  await assert.rejects(api.drawDie(), /currently drawn side/);
  await assert.rejects(api.activateUnit(enemy), /drawn side/);
  await api.activateUnit(first);
  assert.equal(combat.getFlag('boltaction', 'bag').remaining.length, 2);
  await assert.rejects(api.drawDie(), /Give the active unit/);
  await api.order(first, 'fire');
  assert.equal(first.system.activated, true);
  await assert.rejects(api.order(first, 'fire'), /already has an order/);
  await assert.rejects(api.order(second, 'fire'), /activate this unit/);
  rolls.push(2);
  assert.equal(await api.drawDie(), 'axis');
  await api.activateUnit(enemy);
  assert.deepEqual(combat.getFlag('boltaction', 'bag').used, [first.uuid, enemy.uuid]);
});

test('GM-only bag operations and actor ownership fail before mutation', async () => {
  const {deploy} = setup();
  const unit = actor('unit'); deploy(unit);
  game.user.isGM = false;
  await assert.rejects(api.nextRound(), /GM controls/);
  await assert.rejects(api.drawDie(), /GM controls/);
  await assert.rejects(api.activateUnit(unit), /GM controls/);
  assert.deepEqual(combat.flags, {});
  unit.isOwner = false;
  await assert.rejects(api.addPin(unit), /own this actor/);
  assert.equal(unit.system.pins, 0);
});

test('bag recovers when a drawn side disappears and cannot activate an embarked unit', async () => {
  const {deploy} = setup();
  const ally = actor('ally'), enemy = actor('enemy', 'unit', {side: 'axis'});
  deploy(ally, enemy);
  await api.nextRound();
  rolls.push(1);
  assert.equal(await api.drawDie(), 'allies');
  ally.system.transportUuid = 'Actor.transport';
  await assert.rejects(api.activateUnit(ally), /not deployed or is embarked/);
  rolls.push(1);
  assert.equal(await api.drawDie(), 'axis');
  assert.deepEqual(combat.getFlag('boltaction', 'bag').remaining.map(entry => entry.unitUuid), [enemy.uuid]);
});

test('reserves are scene assigned and hidden, receive bag dice without tokens, and enter with a forced -1 test', async () => {
  const {deploy} = setup();
  const unit = actor('reserve'), model = actor('reserve-soldier', 'model', {unitUuid: unit.uuid});
  unit.system.modelUuids = [model.uuid];
  deploy(unit, model);
  await api.setReserve(unit);
  assert.equal(unit.getFlag('boltaction', 'battlefield'), scene.uuid);
  assert.equal(unit.system.reserve, true);
  assert.equal(unit.system.deployment, 'reserve');
  assert.ok(scene.tokens.every(token => token.hidden));
  scene.tokens = [];
  const roundOne = await api.nextRound();
  assert.deepEqual(roundOne.remaining.map(entry => entry.unitUuid), [unit.uuid]);
  rolls.push(1);
  await api.drawDie(); await api.activateUnit(unit);
  await assert.rejects(api.order(unit, 'fire'), /Reserve units/);
  await assert.rejects(api.order(unit, 'advance'), /before round 2/);
  await api.order(unit, 'down');
  assert.equal(unit.system.reserve, true);
  await api.nextRound();
  rolls.push(1);
  await api.drawDie(); await api.activateUnit(unit);
  rolls.push(4, 4);
  const result = await api.order(unit, 'run');
  assert.equal(result.automatic, false);
  assert.equal(result.target, 8);
  assert.equal(result.passed, true);
  assert.equal(unit.system.reserve, false);
  assert.equal(unit.system.deployment, 'field');
  assert.equal(unit.system.arrivalRound, 2);
  await assert.rejects(api.assault(unit, {}), /reserve arrival turn/);
});

test('failed reserve entry retains reserve state and still consumes this round order', async () => {
  setup();
  const unit = actor('waiting', 'unit', {reserve: true, deployment: 'reserve'});
  await unit.setFlag('boltaction', 'battlefield', scene.uuid);
  combat.round = 2;
  combat.flags = {boltaction: {bag: {activeUnitUuid: unit.uuid}}};
  rolls.push(4, 5);
  const result = await api.order(unit, 'advance');
  assert.equal(result.target, 8);
  assert.equal(result.passed, false);
  assert.equal(unit.system.reserve, true);
  assert.equal(unit.system.activated, true);
  await assert.rejects(api.order(unit, 'run'), /already has an order/);
});

test('scenario configuration loads catalogue, persists chosen sides and reports the configured profile', async () => {
  setup();
  const rows = JSON.parse(await readFile(new URL('../compendiums/scenarios.json', import.meta.url), 'utf8'));
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(url, 'systems/boltaction/compendiums/scenarios.json');
    return {ok: true, json: async () => structuredClone(rows)};
  };
  try {
    const scenarios = await import('../scripts/services/scenario-service.mjs');
    assert.equal(await scenarios.scenarioStatus(), null);
    assert.equal((await scenarios.listScenarios()).length, 12);
    const chosen = await scenarios.configureScenario({scenarioId: 'top-secret', attackerSide: 'red', defenderSide: 'blue'});
    assert.equal(chosen.id, 5);
    assert.deepEqual(scene.getFlag('boltaction', 'scenario'), {scenarioId: 5, slug: 'top-secret', attackerSide: 'red', defenderSide: 'blue'});
    const status = await scenarios.scenarioStatus();
    assert.equal(status.name, 'Top Secret');
    assert.equal(status.scenario.duration.baseTurns, 6);
    assert.equal(status.attackerSide, 'red');
    await assert.rejects(scenarios.configureScenario({scenarioId: 5, attackerSide: 'red', defenderSide: 'red'}), /different sides/);
    game.user.isGM = false;
    await assert.rejects(scenarios.configureScenario({scenarioId: 1}), /GM configures/);
    assert.equal(scene.getFlag('boltaction', 'scenario').scenarioId, 5);
  } finally { globalThis.fetch = previousFetch; }
});

test('complete main module boots with V14 namespaces and registers schemas, sheets and API', async () => {
  setup();
  const hooks = new Map(), registered = [], sheets = [];
  globalThis.Hooks = {
    once(name, callback) { hooks.set(name, callback); },
    on(name, callback) { registered.push({name, callback}); }
  };
  class Field {
    constructor(...args) { this.args = args; }
  }
  class Application {
    render() { return this; }
  }
  foundry.data = {fields: Object.fromEntries(['StringField', 'NumberField', 'BooleanField', 'ArrayField', 'SchemaField', 'ObjectField'].map(name => [name, Field]))};
  foundry.abstract = {TypeDataModel: class {}};
  foundry.documents.Actor = class {};
  foundry.documents.Combat = class {};
  foundry.documents.collections = {
    Actors: {registerSheet: (...args) => sheets.push(args)},
    Items: {registerSheet: (...args) => sheets.push(args)}
  };
  Object.assign(foundry.applications.api, {ApplicationV2: Application, HandlebarsApplicationMixin: Base => class extends Base {}});
  foundry.applications.sheets = {ActorSheetV2: Application, ItemSheetV2: Application};
  CONFIG.Actor.dataModels = {};
  CONFIG.Item = {dataModels: {}};
  game.settings.register = (namespace, key, options) => registered.push({namespace, key, options});
  game.keybindings = {register: () => {}};
  await import('../scripts/main.mjs');
  assert.equal(typeof hooks.get('init'), 'function');
  await hooks.get('init')();
  assert.deepEqual(Object.keys(CONFIG.Actor.dataModels).sort(), ['army', 'model', 'modelStatic', 'modelVehicle', 'unit']);
  assert.deepEqual(Object.keys(CONFIG.Item.dataModels).sort(), ['faction', 'selector', 'trait', 'weapon']);
  for (const Model of [...Object.values(CONFIG.Actor.dataModels), ...Object.values(CONFIG.Item.dataModels)]) {
    const schema = Model.defineSchema();
    assert.ok(Object.keys(schema).length > 0);
    assert.ok(Object.values(schema).every(field => field instanceof Field));
  }
  assert.equal(CONFIG.Actor.dataModels.unit.defineSchema().order.args[0].blank,true);
  assert.equal(CONFIG.Actor.dataModels.unit.defineSchema().observerKind.args[0].blank,true);
  assert.equal(sheets.length, 2);
  for (const name of ['createTeam','createGroup','linkGroupMember','importModel','assignTeam','setTeamFaction','groupSummary','prepareCatalogue']) assert.equal(typeof game.boltaction[name], 'function', name);
  assert.ok(!registered.some(entry => entry.name === 'preUpdateToken'));
  assert.equal(game.boltaction.openBoard,undefined);
  assert.ok(!registered.some(entry => entry.key === 'applyPins'));
  game.packs=[{metadata:{name:'boltaction-models'}}];
  await hooks.get('ready')();
});

test('actual actor getters require reciprocal membership and exclude dead soldiers weapons', () => {
  const ActorClass = CONFIG.Actor.documentClass;
  const documents = new Map();
  globalThis.fromUuidSync = uuid => documents.get(uuid) ?? null;
  function document(id, type, system = {}, items = []) {
    const result = Object.assign(new ActorClass(), {id, uuid: `Actor.${id}`, documentName: 'Actor', type, items,
      system: {quality: 'regular', kind: 'infantry', pins: 0, ncoAlive: true, moraleBonus: 0,
        side: 'allies', modelUuids: [], unitUuids: [], ...system}});
    documents.set(result.uuid, result);
    return result;
  }
  const army = document('army', 'army', {side: 'axis'});
  const unit = document('unit', 'unit', {armyUuid: army.uuid});
  const model = document('model', 'model', {unitUuid: unit.uuid}, [{uuid: 'Item.rifle', type: 'weapon'}]);
  const dead = document('dead', 'model', {unitUuid: unit.uuid, dead: true}, [{uuid: 'Item.dead-rifle', type: 'weapon'}]);
  const stray = document('stray', 'model', {unitUuid: 'Actor.other'});
  const staleUnit = document('stale-unit', 'unit', {armyUuid: 'Actor.other'});
  army.system.unitUuids = [unit.uuid, staleUnit.uuid];
  unit.system.modelUuids = [model.uuid, dead.uuid, stray.uuid, model.uuid];
  assert.deepEqual(army.members, [unit]);
  assert.deepEqual(unit.members, [model, dead]);
  assert.deepEqual(unit.livingMembers, [model]);
  assert.equal(model.unit, unit);
  assert.equal(model.army, army);
  assert.equal(model.effectiveSide, 'axis');
  assert.deepEqual(unit.weapons.map(weapon => weapon.uuid), ['Item.rifle']);
  unit.system.modelUuids = [];
  assert.equal(model.unit, null);
  army.system.unitUuids = [];
  assert.equal(unit.army, null);
});

test('standard shooting applies German MG shots and US moving-fire trait modifiers',async()=>{
 setup();
 const u=actor('trait-shooter','unit',{order:'advance'}),t=actor('trait-target');t.damageValue=4;
 const w={uuid:'Actor.trait-shooter.Item.gun',id:'gun',name:'MMG',system:{slug:'mmg',range:36,minRange:0,shots:5,quantity:1,penetration:0,traits:[]}};u.weapons=[w];
 u.flags.boltaction={factionSlug:'germany'};
 let result=await api.shoot(u,{targetUuid:t.uuid,weaponId:w.uuid,range:12});assert.equal(result.hits.results.length,6);assert.equal(result.hits.target,4);
 u.system.firedWeaponUuids=[];w.system.slug='rifle';w.system.shots=1;w.system.range=24;u.flags.boltaction.factionSlug='united-states';
 result=await api.shoot(u,{targetUuid:t.uuid,weaponId:w.uuid,range:12});assert.equal(result.hits.target,3);
});
test('Shirkers test unpinned Down orders and stubborn morale ignores pins',async()=>{
 setup();const u=actor('shirker');u.items=[{type:'trait',system:{slug:'shirkers'}}];rolls.push(5,6);
 const result=await api.order(u,'down');assert.equal(result.automatic,false);assert.equal(result.passed,false);
 u.items=[{type:'trait',system:{slug:'stubborn'}}];u.system.pins=4;rolls.push(4,4);
 const morale=await api.morale(u);assert.equal(morale.target,9);assert.equal(morale.passed,true);
});
