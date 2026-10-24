import {pixelsPerInch, rules} from './api.mjs';

const SID = 'boltaction';
const enabled = key => game.settings.get(SID, key);
function sceneModels(unit, scene) {
  const ids = new Set(unit.livingMembers.map(m => m.id));
  return scene.tokens.filter(t => ids.has(t.actorId) && !t.hidden);
}
export function formationReport(unit, scene = canvas.scene) {
  if (!scene) return {valid: true, disconnected: []};
  const scale = pixelsPerInch(scene), tokens = sceneModels(unit, scene);
  return rules.checkFormation(tokens.map(t => ({id: t.name, x: (t.x + t.width * scene.grid.size / 2) / scale,
    y: (t.y + t.height * scene.grid.size / 2) / scale,
    radius: Math.min(t.width, t.height) * scene.grid.size / scale / 2})));
}
export function registerCanvasAssistants() {
  Hooks.on('preUpdateToken', (token, changes, options) => {
    if (options.boltactionGroupMove || (changes.x === undefined && changes.y === undefined)) return;
    options.boltactionPrevious = {x: token.x, y: token.y};
  });
  Hooks.on('updateToken', async (token, changes, options, userId) => {
    if (userId !== game.user.id || options.boltactionGroupMove || !options.boltactionPrevious) return;
    const unit = token.actor?.unit;
    if (!unit || token.parent.id !== canvas.scene?.id) return;
    const old = options.boltactionPrevious;
    const dx = token.x - old.x, dy = token.y - old.y;
    const command = token.getFlag(SID, 'command');
    const onlyCommandSelected = canvas.tokens.controlled.length === 1 && canvas.tokens.controlled[0].document.id === token.id;
    if (command && enabled('groupMovement') && onlyCommandSelected) {
      const targets = sceneModels(unit, token.parent).filter(t => t.isOwner);
      const updates = targets.map(t => ({_id: t.id, x: t.x + dx, y: t.y + dy}));
      const outOfBounds = updates.some(t => t.x < 0 || t.y < 0 || t.x > token.parent.width - token.parent.grid.size || t.y > token.parent.height - token.parent.grid.size);
      if (outOfBounds) ui.notifications.warn('Formation movement would cross the Scene boundary; move the individual soldiers manually.');
      else if (updates.length) await token.parent.updateEmbeddedDocuments('Token', updates, {boltactionGroupMove: true});
    }
    if (enabled('movementWarnings')) {
      const inches = Math.hypot(dx, dy) / pixelsPerInch(token.parent);
      const budget = unit.system.order === 'run' ? unit.system.moveRun : unit.system.order === 'advance' ? unit.system.moveAdvance : 0;
      if (inches > budget + 0.01) ui.notifications.warn(`${unit.name}: this movement segment is ${inches.toFixed(1)}″; current order allows ${budget}″. Check cumulative movement and terrain manually.`);
    }
    if (enabled('cohesionWarnings') && !formationReport(unit, token.parent).valid) ui.notifications.warn(`${unit.name}: the surviving models are outside a connected 1″ formation.`);
  });
}
