import {BoltToken} from '../documents/token.mjs';
import {isDefaultModelArt} from './faction-appearance.mjs';
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
/** Managed default artwork always fills its token bounds; custom artwork is untouched. */
export function centeredDefaultTokenTexture(texture = {}, preserveTransform = false) {
  if (!isDefaultModelArt(texture.src) || preserveTransform) return {...texture};
  return {...texture,...(texture.src?{src:texture.src.split('?')[0]+'?v=12'}:{}),anchorX:.5,anchorY:.5,scaleX:1,scaleY:1,fit:'contain'};
}

function hasManagedTokenArt(source) {
  const subject = source.ring?.subject?.texture;
  return isDefaultModelArt(source.texture?.src) && (!subject || isDefaultModelArt(subject));
}
/** Managed SVGs already contain a base; a second dynamic ring must not rescale their subject. */
export function centeredDefaultTokenData(source, type) {
  const update = {lockRotation:type === 'model'};
  if (!hasManagedTokenArt(source) || source.flags?.boltaction?.preserveTokenTransform === true) return update;
  update.texture = centeredDefaultTokenTexture(source.texture);
  update.ring = {...source.ring,enabled:false,subject:{...source.ring?.subject,scale:1}};
  return update;
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
    Object.assign(source,centeredDefaultTokenData(source,models[index].type));
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
  for (const graphic of overlays.values()) {graphic.parent?.removeChild(graphic);if (!graphic.destroyed) graphic.destroy();}
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
const ncoBadges = new Map();
function removeNcoBadge(token) {
  const graphic = ncoBadges.get(token);
  if (!graphic) return;
  graphic.parent?.removeChild(graphic);if (!graphic.destroyed) graphic.destroy();ncoBadges.delete(token);
}
export function clearNcoBadges() {for (const token of [...ncoBadges.keys()]) removeNcoBadge(token);}
/** A separate scene overlay marks the NCO without replacing any portrait, texture or core filters. */
export function refreshNcoBadge(token) {
  removeNcoBadge(token);
  if (!token || token.destroyed || token.visible === false || !MODEL_TYPES.has(token.actor?.type)
    || !(token.actor.system?.isNco || String(token.actor.system?.role ?? '').trim().toLowerCase() === 'nco')) return;
  const group = squadUuid(token.actor,globalThis.game?.actors);
  if (!hovered || hovered.visible === false || (hovered !== token && (!group || group !== squadUuid(hovered.actor,globalThis.game?.actors)))) return;
  const width = Number(token.w ?? token.width), height = Number(token.h ?? token.height);
  if (!(width > 0 && height > 0)) return;
  const radius = Math.max(5,Math.min(width,height)*.12);
  const cx = width-radius-3, cy = radius+3;
  const points = Array.from({length:10},(_,i)=>{
    const angle = -Math.PI/2+i*Math.PI/5, r = i%2 ? radius*.45 : radius;
    return [cx+Math.cos(angle)*r,cy+Math.sin(angle)*r];
  }).flat();
  const graphic = new PIXI.Graphics();graphic.eventMode='none';graphic.interactive=false;
  if (graphic.poly && graphic.fill) graphic.poly(points).fill({color:0xf5d76e,alpha:.95}).stroke({color:0x222222,width:1.5,alpha:.9});
  else graphic.lineStyle(1.5,0x222222,.9).beginFill(0xf5d76e,.95).drawPolygon(points).endFill();
  token.addChild(graphic);ncoBadges.set(token,graphic);
}
function refreshNcoBadges() {for (const token of globalThis.canvas?.tokens?.placeables ?? []) refreshNcoBadge(token);}
/** Repair earlier managed token defaults in the active scene, without touching custom artwork. */
export async function normalizeSceneTokenDefaults(scene = globalThis.canvas?.scene) {
  if (!scene) return [];
  const updates = values(scene.tokens).filter(token => MODEL_TYPES.has(token.actor?.type)).flatMap(token => {
    const source = token.toObject?.() ?? {texture:token.texture?.toObject?.() ?? token.texture,ring:token.ring,flags:token.flags,lockRotation:token.lockRotation};
    const fixed = centeredDefaultTokenData(source,token.actor.type);
    const changed = fixed.lockRotation !== source.lockRotation || fixed.texture &&
      ['src','anchorX','anchorY','scaleX','scaleY','fit'].some(key=>source.texture?.[key]!==fixed.texture[key]) ||
      fixed.ring && (source.ring?.enabled !== false || source.ring?.subject?.scale !== 1);
    return changed ? [{_id:token.id,...fixed}] : [];
  });
  if (updates.length) await scene.updateEmbeddedDocuments('Token',updates);
  return updates;
}

function normalizeActiveScene() {
  if (!game.user?.isGM || game.users?.activeGM && game.users.activeGM.id !== game.user.id) return;
  void normalizeSceneTokenDefaults().catch(error=>console.error('Bolt Action: default token layout',error));
}
export function setSquadHover(token,active) {
  if (active) hovered=token;else if (hovered===token) hovered=null;
  redrawHighlight();refreshNcoBadges();
}
/** Foundry V14 public dropCanvasData and hoverToken hooks; no core token/filter mutation. */
export function registerSceneGroups() {
  if (registered) return;registered = true;
  CONFIG.Token.objectClass = BoltToken;
  Hooks.on('preCreateToken', (token, source) => {
    const actor = token.actor ?? game.actors?.get?.(source.actorId) ?? values(game.actors).find(actor=>actor.id===source.actorId);
    if (!MODEL_TYPES.has(actor?.type)) return;
    token.updateSource(centeredDefaultTokenData({...source,texture:source.texture ?? token.texture ?? {}},actor.type));
  });
  Hooks.on('dropCanvasData', (canvas, data) => {
    if (data.type !== 'Actor' || typeof data.uuid !== 'string' || !data.uuid.startsWith('Actor.')) return;
    const parent = resolveWorld(data.uuid, game.actors);
    if (!groupTypes.has(parent?.type)) return;
    void deployGroup(parent,{canvas,x:data.x,y:data.y}).catch(error => {console.error('Bolt Action: group deployment',error);ui.notifications.warn(error.message);});
    return false;
  });
  Hooks.on('hoverToken', (token, active) => {
    setSquadHover(token,active);
  });
  Hooks.on('canvasTearDown', () => {hovered=null;clearSquadHighlight();clearNcoBadges();});
  Hooks.on('canvasReady', () => {hovered=null;clearSquadHighlight();clearNcoBadges();refreshNcoBadges();normalizeActiveScene();});
  Hooks.on('ready',normalizeActiveScene);
  Hooks.on('deleteToken', document => {hovered=null;clearSquadHighlight();clearNcoBadges();});
  for (const hook of ['drawToken','refreshToken']) Hooks.on(hook,refreshNcoBadge);
  for (const hook of ['visibilityRefresh','updateActor']) Hooks.on(hook,refreshNcoBadges);
  for (const hook of ['refreshToken','visibilityRefresh','updateActor']) Hooks.on(hook,redrawHighlight);
}
