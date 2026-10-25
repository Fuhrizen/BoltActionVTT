const MODEL_TYPES = new Set(['model', 'modelStatic', 'modelVehicle']);
const values = collection => collection?.contents ?? Array.from(collection ?? []);
const groupTypes = new Set(['army', 'unit']);
const uuid = actor => actor?.uuid ?? `Actor.${actor?.id}`;
function resolveWorld(reference, actors) {return values(actors).find(actor => uuid(actor) === reference);}
function available(actor) {return actor && !actor.pack && actor.visible !== false && actor.isOwner;}
function children(parent, actors) {
  const army = parent.type === 'army';
  const list = parent.system?.[army ? 'unitUuids' : 'modelUuids'] ?? [];
  return [...new Set(list)].map(reference => resolveWorld(reference, actors)).filter(child => available(child)
    && (army ? child.type === 'unit' : MODEL_TYPES.has(child.type))
    && child.system?.[army ? 'armyUuid' : 'unitUuid'] === uuid(parent));
}
/** Return deployable world models in reciprocal group membership order. */
export function collectGroupModels(parent, actors = globalThis.game?.actors) {
  if (!available(parent) || !groupTypes.has(parent.type)) throw new Error('You must own this world Army or Squad to deploy it.');
  const models = parent.type === 'unit' ? children(parent, actors) : children(parent, actors).flatMap(squad => children(squad, actors));
  return [...new Map(models.map(actor => [uuid(actor), actor])).values()];
}
/** Prepare all token data first, then create a single embedded-document batch. */
export async function deployGroup(parent, {canvas = globalThis.canvas, x, y} = {}) {
  const scene = canvas?.scene;
  if (!canvas?.ready || !scene) throw new Error('Open a scene before deploying a group.');
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('The drop location is invalid.');
  const TokenClass = globalThis.CONFIG?.Token?.documentClass;
  const permitted = TokenClass?.canUserCreate ? TokenClass.canUserCreate(game.user) : game.user.isGM || game.user.can?.('TOKEN_CREATE');
  if (!permitted) throw new Error('You need permission to create scene tokens.');
  const models = collectGroupModels(parent);
  if (!models.length) throw new Error('This group has no available models to deploy.');
  const documents = await Promise.all(models.map(actor => actor.getTokenDocument({actorLink:true})));
  if (globalThis.canvas && globalThis.canvas.scene !== scene) throw new Error('The active scene changed before deployment.');
  const grid = Number(scene.grid?.size ?? canvas.grid?.size ?? 100) || 100;
  const data = documents.map((doc, index) => {
    const source = doc.toObject();delete source._id;
    source.actorId = models[index].id;source.actorLink = true;
    return source;
  });
  const columns = Math.ceil(Math.sqrt(data.length));
  const cellWidth = Math.max(...data.map(row => Number(row.width) || 1)) * grid + grid * .15;
  const cellHeight = Math.max(...data.map(row => Number(row.height) || 1)) * grid + grid * .15;
  for (const [index, row] of data.entries()) {
    row.x = x + (index % columns) * cellWidth;
    row.y = y + Math.floor(index / columns) * cellHeight;
    row.name = models[index].displayName ?? models[index].system?.identity ?? models[index].name;
  }
  return scene.createEmbeddedDocuments('Token', data);
}
function squadUuid(actor, actors) {
  if (!MODEL_TYPES.has(actor?.type)) return null;
  const reference = actor.system?.unitUuid;
  const squad = resolveWorld(reference, actors);
  return squad?.visible !== false && squad?.type === 'unit' && squad.system?.modelUuids?.includes(uuid(actor)) ? reference : null;
}
/** Hidden or unrelated tokens are never highlighted, including a stale one-way link. */
export function fellowSquadTokens(token, tokens = [], actors = globalThis.game?.actors) {
  const group = squadUuid(token?.actor, actors);
  if (!group || token.visible === false) return [];
  return values(tokens).filter(other => other !== token && other.visible !== false && !other.destroyed
    && squadUuid(other.actor, actors) === group);
}
const overlays = new Map();
let hovered = null, registered = false;
export function clearSquadHighlight() {
  for (const graphic of overlays.values()) {graphic.parent?.removeChild(graphic);graphic.destroy();}
  overlays.clear();
}
function redrawHighlight() {
  clearSquadHighlight();
  if (!hovered || hovered.destroyed) return;
  for (const token of fellowSquadTokens(hovered, globalThis.canvas?.tokens?.placeables)) {
    const graphic = new PIXI.Graphics();
    graphic.eventMode = 'none';graphic.interactive = false;
    const width = token.w ?? token.width, height = token.h ?? token.height;
    if (graphic.roundRect && graphic.stroke) graphic.roundRect(1, 1, width - 2, height - 2, Math.min(width,height)*.2).stroke({color:0xdde7b9,width:3,alpha:.22});
    else graphic.lineStyle(3,0xdde7b9,.22).drawRoundedRect(1,1,width-2,height-2,Math.min(width,height)*.2);
    token.addChild(graphic);overlays.set(token,graphic);
  }
}
/** Foundry V14 public dropCanvasData and hoverToken hooks; no core token/filter mutation. */
export function registerSceneGroups() {
  if (registered) return;registered = true;
  Hooks.on('dropCanvasData', (canvas, data) => {
    if (data.type !== 'Actor' || typeof data.uuid !== 'string' || !data.uuid.startsWith('Actor.')) return;
    const parent = resolveWorld(data.uuid, game.actors);
    if (!groupTypes.has(parent?.type)) return;
    void deployGroup(parent,{canvas,x:data.x,y:data.y}).catch(error => {console.error('Bolt Action: group deployment',error);ui.notifications.warn(error.message);});
    return false;
  });
  Hooks.on('hoverToken', (token, active) => {
    if (active) hovered = token;else if (hovered === token) hovered = null;
    redrawHighlight();
  });
  for (const hook of ['canvasTearDown','canvasReady']) Hooks.on(hook, () => {hovered=null;clearSquadHighlight();});
  Hooks.on('deleteToken', () => {hovered=null;clearSquadHighlight();});
  for (const hook of ['refreshToken','visibilityRefresh','updateActor']) Hooks.on(hook,redrawHighlight);
}
