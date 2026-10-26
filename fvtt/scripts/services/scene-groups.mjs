import {getLoaderPair} from './groups.mjs';
import {DEFAULT_TOKEN_FOOTPRINTS,tokenFootprint,preservesTokenSize} from './token-sizing.mjs';
import {BoltToken} from '../documents/token.mjs';
import {isDefaultModelArt,isGeneratedTokenArt} from './faction-appearance.mjs';
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
  return {...texture,...(texture.src?{src:isGeneratedTokenArt(texture.src)?texture.src:texture.src.split('?')[0]+'?v=13'}:{}),anchorX:.5,anchorY:.5,scaleX:1,scaleY:-1,fit:'contain'};
}

function hasManagedTokenArt(source) {
  const subject = source.ring?.subject?.texture;
  return isDefaultModelArt(source.texture?.src) && (!subject || isDefaultModelArt(subject));
}
/** Managed SVGs already contain a base; a second dynamic ring must not rescale their subject. */
export function centeredDefaultTokenData(source, actorOrType) {
  const actor=typeof actorOrType==='string'?{type:actorOrType,system:{}}:actorOrType;
  const update = {lockRotation:false};
  if(hasManagedTokenArt(source)&&!preservesTokenSize(source))Object.assign(update,tokenFootprint(actor));
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
    Object.assign(source,centeredDefaultTokenData(source,models[index]));
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
  overlays.clear();highlightSizes.clear();
}
const highlightSizes = new Map();
function redrawHighlight() {
  const fellows = hovered && !hovered.destroyed ? fellowSquadTokens(hovered, globalThis.canvas?.tokens?.placeables) : [];
  const desired = new Set(fellows);
  for (const [token,graphic] of overlays) if (!desired.has(token)) {
    graphic.parent?.removeChild(graphic);if (!graphic.destroyed)graphic.destroy();overlays.delete(token);highlightSizes.delete(token);
  }
  for (const token of fellows) {
    const width = token.w ?? token.width, height = token.h ?? token.height;
    const signature = `${width}:${height}`;
    if (overlays.has(token) && highlightSizes.get(token)===signature)continue;
    const old=overlays.get(token);if(old){old.parent?.removeChild(old);if(!old.destroyed)old.destroy();}
    const graphic = new PIXI.Graphics();graphic.eventMode='none';graphic.interactive=false;
    if (graphic.roundRect && graphic.stroke)graphic.roundRect(1,1,width-2,height-2,Math.min(width,height)*.2).stroke({color:0xdde7b9,width:3,alpha:.22});
    else graphic.lineStyle(3,0xdde7b9,.22).drawRoundedRect(1,1,width-2,height-2,Math.min(width,height)*.2);
    token.addChild(graphic);overlays.set(token,graphic);highlightSizes.set(token,signature);
  }
}

const ncoBadges = new Map(), roleSignatures = new Map(), statusSignatures = new Map();
function removeNcoBadge(token) {
  const graphic = ncoBadges.get(token);
  if (!graphic) return;
  graphic.parent?.removeChild(graphic);if (!graphic.destroyed) graphic.destroy();ncoBadges.delete(token);
}
export function clearNcoBadges() {roleSignatures.clear();for (const token of [...ncoBadges.keys()]) removeNcoBadge(token);for (const token of [...specialRoleBadges.keys()]) removeNodes(specialRoleBadges,token);}
/** A separate scene overlay marks the NCO without replacing any portrait, texture or core filters. */
export function refreshNcoBadge(token) {
  const system=token?.actor?.system ?? {};
  const signature=JSON.stringify([usableToken(token),usableToken(token)&&hoveringSquad(token),token?.w,token?.h,system.role,system.isNco,system.isMedic,system.isObserver,system.isLoader,system.loaderForUuid,getLoaderPair(token?.actor)?.pairLabel,getLoaderPair(token?.actor)?.loaders.map(m=>m.uuid)]);
  if (roleSignatures.get(token)===signature)return;
  roleSignatures.set(token,signature);
  removeNcoBadge(token);
  refreshSpecialRoleBadges(token);
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
const specialRoleBadges = new Map(), statusBadges = new Map();
function removeNodes(map,token) {
  for (const node of map.get(token) ?? []) {node.parent?.removeChild(node);if (!node.destroyed)node.destroy();}
  map.delete(token);
}
function textLabel(token,text,{x,y,size=14,color=0xffffff}={}) {
  const style={fontFamily:'Arial',fontSize:size,fontWeight:'bold',fill:color,stroke:0x111111,strokeThickness:3};
  const node=Number.parseInt(PIXI.VERSION ?? '7',10)>=8?new PIXI.Text({text,style}):new PIXI.Text(text,style);
  node.eventMode='none';node.interactive=false;node.x=x;node.y=y;token.addChild(node);return node;
}
function usableToken(token) {return token && !token.destroyed && token.visible!==false && MODEL_TYPES.has(token.actor?.type);}
function hoveringSquad(token) {
  if (!usableToken(hovered)) return false;
  const group=squadUuid(token.actor,globalThis.game?.actors);
  return hovered===token || group && group===squadUuid(hovered.actor,globalThis.game?.actors);
}
function refreshSpecialRoleBadges(token) {
  removeNodes(specialRoleBadges,token);
  if (!usableToken(token) || !hoveringSquad(token) || !PIXI.Text) return;
  const system=token.actor.system,role=String(system.role ?? '').trim().toLowerCase();
  const roles=[];
  if (system.isMedic || role==='medic')roles.push({text:'+',color:0x9ee8a8});
  if (system.isObserver || role==='observer')roles.push({text:'O',color:0xaadcf5});
  const pair=getLoaderPair(token.actor);
  if (system.isLoader || role==='loader')roles.push({text:pair?'L'+pair.pairLabel+'↔':'L?',color:0xe5ddb7});
  else if(pair?.loaders.length)roles.push({text:'MG'+pair.pairLabel+'↔',color:0xe5ddb7});
  const size=Math.max(10,Math.min(token.w,token.h)*.18);
  specialRoleBadges.set(token,roles.map((item,index)=>textLabel(token,item.text,{x:4+index*(size+5),y:3,size,color:item.color})));
}
/** Pins and damage state are presentation-only badges; no generic status data is altered. */
export function tokenStateLabels(actor) {
  const squad=actor?.type==='unit'?actor:actor?.unit;
  const pins=Math.max(0,Math.trunc(Number(squad?.system?.pins ?? 0)));
  const labels=[];if(actor?.system?.dead)labels.push({text:'☠',color:0xffffff,kind:'dead'});if(pins)labels.push({text:`P:${pins}`,color:0xffcc78,kind:'pins'});
  const order=String(squad?.system?.order ?? '').toLowerCase();
  if(['fire','advance','run','ambush','rally','down'].includes(order))labels.push({text:order.toUpperCase(),color:0xb9dcff,kind:'order'});
  if(actor?.type!=='modelVehicle')return labels;
  const system=actor.system ?? {},states=new Set(system.vehicleStates ?? []);
  for(const key of ['immobilised','onFire','turretJammed','stunned','engineDamage','knockedOut'])if(system[key])states.add(key);
  const names={immobilised:'IMM',onFire:'FIRE',turretJammed:'JAM',stunned:'STUN',engineDamage:'ENG',knockedOut:'KO'};
  for(const [key,text]of Object.entries(names))if(states.has(key))labels.push({text,color:0xffb29e,kind:'vehicle'});
  if(system.vehicleDamage && !Object.hasOwn(names,system.vehicleDamage))labels.push({text:'DMG',color:0xffb29e,kind:'vehicle'});
  else if(system.vehicleDamage && !states.has(system.vehicleDamage))labels.push({text:names[system.vehicleDamage],color:0xffb29e,kind:'vehicle'});
  return labels;
}
export function refreshTokenStateBadges(token) {
  const labels=usableToken(token)?tokenStateLabels(token.actor):[];
  const signature=JSON.stringify([token?.w,token?.h,labels]);
  if(statusSignatures.get(token)===signature)return;
  statusSignatures.set(token,signature);removeNodes(statusBadges,token);
  if(!usableToken(token)||!PIXI.Text||!labels.length)return;
  const size=Math.min(Math.max(10,Math.min(token.w,token.h)*.14),token.h*.65/(labels.length+1),(token.w-8)/(Math.max(...labels.map(x=>x.text.length))*.65));
  statusBadges.set(token,labels.map((label,index)=>textLabel(token,label.text,{x:4,y:token.h-(labels.length-index)*(size+2)-3,size,color:label.color})));
}
export function clearTokenStateBadges(){statusSignatures.clear();for(const token of [...statusBadges.keys()])removeNodes(statusBadges,token);}
function refreshAllStateBadges(){for(const token of globalThis.canvas?.tokens?.placeables??[])refreshTokenStateBadges(token);}
function refreshNcoBadges() {for (const token of globalThis.canvas?.tokens?.placeables ?? []) refreshNcoBadge(token);}
/** Repair earlier managed token defaults in the active scene, without touching custom artwork. */
export async function normalizeSceneTokenDefaults(scene = globalThis.canvas?.scene) {
  if (!scene) return [];
  const updates = values(scene.tokens).filter(token => MODEL_TYPES.has(token.actor?.type)).flatMap(token => {
    const source = token.toObject?.() ?? {texture:token.texture?.toObject?.() ?? token.texture,ring:token.ring,flags:token.flags,lockRotation:token.lockRotation,width:token.width,height:token.height};
    const fixed = centeredDefaultTokenData(source,token.actor);
    const changed = fixed.width!==undefined && (fixed.width!==source.width || fixed.height!==source.height) || fixed.lockRotation !== source.lockRotation || fixed.texture &&
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
  for(const [kind,footprint]of Object.entries(DEFAULT_TOKEN_FOOTPRINTS))for(const dimension of ['width','height'])game.settings?.register('boltaction',`tokenSize_${kind}_${dimension}`,{name:`${kind.replace(/([A-Z])/g,' $1')} token ${dimension}`,hint:'Grid spaces; a configurable tabletop footprint, not a historical scale measurement.',scope:'world',config:true,type:Number,default:footprint[dimension],range:{min:.25,max:10,step:.25}});
  Hooks.on('preCreateToken', (token, source) => {
    const actor = token.actor ?? game.actors?.get?.(source.actorId) ?? values(game.actors).find(actor=>actor.id===source.actorId);
    if (!MODEL_TYPES.has(actor?.type)) return;
    token.updateSource(centeredDefaultTokenData({...source,texture:source.texture ?? token.texture ?? {}},actor));
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
  Hooks.on('canvasTearDown', () => {hovered=null;clearSquadHighlight();clearNcoBadges();clearTokenStateBadges();});
  Hooks.on('canvasReady', () => {hovered=null;clearSquadHighlight();clearNcoBadges();clearTokenStateBadges();refreshNcoBadges();refreshAllStateBadges();normalizeActiveScene();});
  Hooks.on('ready',normalizeActiveScene);
  Hooks.on('renderTokenHUD',(hud,html)=>{
    const token=hud.object,actor=token?.actor;if(!MODEL_TYPES.has(actor?.type))return;
    const root=html?.querySelector?html:html?.[0]??hud.element;
    if(!root?.querySelector)return;
    for(const control of root.querySelectorAll('[data-action="effects"],[data-action="statusEffects"],[data-action="toggleStatusEffects"],.status-effects'))control.remove();
    const column=root.querySelector('.col.right')??root;
    for(const [key,label] of [['pins','Pins'],...(actor.type==='modelVehicle'?[['vehicle','Vehicle states']]:[])]){
      if(root.querySelector('[data-ba-state="'+key+'"]'))continue;
      const button=root.ownerDocument.createElement('button');button.type='button';button.dataset.baState=key;button.textContent=key==='pins'?'P: '+(actor.unit?.system.pins??0):'Vehicle';button.title=label+' — edit on squad';button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();(actor.unit??actor).sheet.render({force:true});});column.append(button);
    }
  });

  Hooks.on('deleteToken', document => {hovered=null;clearSquadHighlight();clearNcoBadges();clearTokenStateBadges();});
  for (const hook of ['drawToken','refreshToken']) {Hooks.on(hook,refreshNcoBadge);Hooks.on(hook,refreshTokenStateBadges);}
  for (const hook of ['visibilityRefresh','updateActor']) {Hooks.on(hook,refreshNcoBadges);Hooks.on(hook,refreshAllStateBadges);}
  for (const hook of ['refreshToken','visibilityRefresh','updateActor']) Hooks.on(hook,redrawHighlight);
}
