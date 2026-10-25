import {ArmyData, UnitData, ModelData, WeaponData, TraitData, FactionData, SelectorData} from './data/models.mjs';
import {BoltActor} from './documents/actor.mjs';
import {BoltCombat} from './documents/combat.mjs';
import {BoltActorSheet} from './applications/actor-sheet.mjs';
import {BoltItemSheet} from './applications/item-sheet.mjs';
import {BattleBoard} from './applications/board.mjs';
import * as api from './services/api.mjs';
import * as scenarios from './services/scenario-service.mjs';
import * as observers from './services/observer-service.mjs';
import {specialistAttack} from './services/special-combat.mjs';
import {registerCanvasAssistants, formationReport} from './services/canvas.mjs';

const SID = 'boltaction';
let board;
const openBoard = () => { board ??= new BattleBoard(); return board.render({force: true}); };

Hooks.once('init', () => {
  CONFIG.Actor.documentClass = BoltActor;
  CONFIG.Combat.documentClass = BoltCombat;
  Object.assign(CONFIG.Actor.dataModels, {army: ArmyData, unit: UnitData, model: ModelData});
  Object.assign(CONFIG.Item.dataModels, {weapon: WeaponData, trait: TraitData, faction: FactionData, selector: SelectorData});
  foundry.documents.collections.Actors.registerSheet(SID, BoltActorSheet, {types: ['army', 'unit', 'model'], makeDefault: true, label: 'Bolt Action roster'});
  foundry.documents.collections.Items.registerSheet(SID, BoltItemSheet, {types: ['weapon', 'trait', 'faction', 'selector'], makeDefault: true, label: 'Bolt Action profile'});
  for (const [key, name, hint, initial] of [
    ['applyPins', 'Assist: apply hit pins', 'Allows the attack dialog to apply one eligible hit pin when confirmed and you own the target.', false],
    ['applyMorale', 'Assist: failed morale', 'Offers a confirmation to mark a unit destroyed after a failed morale test.', false],
    ['groupMovement', 'Assist: move connected soldiers', 'Moving only the squad command token translates its soldier tokens. Select individual tokens for precise placement.', false],
    ['movementWarnings', 'Assist: movement warnings', 'Warns when a single move exceeds the current order allowance. Cumulative movement and terrain remain manual.', true],
    ['cohesionWarnings', 'Assist: formation warnings', 'Warns when surviving deployed soldiers are outside a connected one-inch formation.', true]
  ]) game.settings.register(SID, key, {name, hint, scope: 'world', config: true, type: Boolean, default: initial});
  game.settings.register(SID, 'openBoard', {name: 'Open Battle Board on launch', scope: 'client', config: true, type: Boolean, default: true});
  game.keybindings.register(SID, 'board', {name: 'Open Battle Board', editable: [{key: 'KeyB', modifiers: ['Shift']}], onDown: () => {openBoard(); return true;}});
  game.boltaction = {...api, ...scenarios, ...observers, specialistAttack, openBoard, formationReport};
  registerCanvasAssistants();
});

Hooks.once('ready', () => {
  if (game.settings.get(SID, 'openBoard')) openBoard();
});

Hooks.on('preCreateActor', (actor, source) => {
  const icon = {army: 'army', unit: 'unit', model: 'soldier'}[source.type];
  if (!icon) return;
  const image = source.img || `systems/boltaction/assets/${icon}.svg`;
  const tokenImage = source.type === 'model' ? 'model-token' : source.type === 'unit' && source.system?.kind === 'vehicle' ? 'vehicle-token' : icon;
  actor.updateSource({img: image, prototypeToken: {actorLink: true, texture: {src: source.prototypeToken?.texture?.src || `systems/boltaction/assets/${tokenImage}.svg`}, sight: {enabled: false}}});
});

function addBoardButton(app, html) {
  const root = html instanceof HTMLElement ? html : app.element;
  if (!root || root.querySelector('[data-boltaction-board]')) return;
  const button = document.createElement('button');
  button.type = 'button'; button.dataset.boltactionBoard = 'true';
  button.innerHTML = '<i class="fa-solid fa-dice" aria-hidden="true"></i> Battle Board';
  button.addEventListener('click', openBoard);
  (root.querySelector('.directory-footer') ?? root).append(button);
}
Hooks.on('renderActorDirectory', addBoardButton);
Hooks.on('renderCombatTracker', addBoardButton);
Hooks.on('preCreateCombatant', (doc, data) => {
  const actor = data.actorId && game.actors.get(data.actorId);
  if (actor && actor.type !== 'unit') {
    ui.notifications.warn('Only squad/team/vehicle command actors receive order dice. Add the unit to combat, rather than its soldiers.');
    return false;
  }
  if (data.actorId && doc.parent.combatants.some(c => c.actorId === data.actorId)) return false;
});
let renderTimer;
function refresh() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    if (board?.rendered) board.render({force: true});
    for (const actor of game.actors) if (actor.sheet?.rendered) actor.sheet.render({force: true});
  }, 80);
}
for (const hook of ['createActor', 'updateActor', 'deleteActor', 'updateCombat', 'createToken', 'deleteToken', 'createItem', 'updateItem', 'deleteItem', 'canvasReady']) Hooks.on(hook, refresh);
