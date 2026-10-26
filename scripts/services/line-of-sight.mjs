const TYPES = new Set(['model','modelStatic','modelVehicle']);
const values = collection => collection?.contents ?? Array.from(collection ?? []);
const uuid = actor => actor?.uuid ?? `Actor.${actor?.id}`;
function center(token, canvas) {
  const doc = token.document ?? token;
  const size = Number(canvas.scene.grid?.size ?? canvas.grid?.size ?? 100);
  const point = token.center ?? {x:Number(doc.x)+Number(doc.width ?? 1)*size/2,y:Number(doc.y)+Number(doc.height ?? 1)*size/2};
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('A scene token has no valid position.');
  return {x:point.x,y:point.y,elevation:Number(doc.elevation ?? 0)};
}
/** V14 polygons require a Level document, never the token's persisted level ID. */
function tokenLevel(token,canvas) {
  const value=token.document?.level;
  if(!value)return null;
  const level=typeof value==='string'?canvas.scene.levels?.get?.(value):value;
  if(!level||level.parent!==canvas.scene)throw new Error('The firing token scene level is unavailable. Reopen the scene before attacking.');
  return level;
}
/** A center-to-center sight-wall test; range, cover and weapon rules are resolved separately. */
export function squadLineOfSight(squad, targetToken, {canvas = globalThis.canvas} = {}) {
  if (!squad || squad.type !== 'unit' || squad.pack || !squad.isOwner) throw new Error('You must own the firing squad.');
  if (!canvas?.ready || !canvas.scene) throw new Error('Open the firing scene before choosing a target.');
  const tokens = values(canvas.tokens?.placeables);
  const target = targetToken?.object ?? targetToken;
  if (!target || !tokens.includes(target) || target.destroyed || target.visible === false || target.document?.hidden && !game.user.isGM) throw new Error('Choose a visible target token on the active scene.');
  const backend = globalThis.CONFIG?.Canvas?.polygonBackends?.sight;
  if (typeof backend?.testCollision !== 'function') throw new Error('The scene sight-wall collision backend is unavailable.');
  const destination = center(target,canvas);
  const references = new Set(squad.system?.modelUuids ?? []);
  const models = values(game.actors).filter(model => references.has(uuid(model)) && TYPES.has(model.type)
    && model.system?.unitUuid === uuid(squad) && !model.system.dead && model.visible !== false && model.isOwner);
  if (!models.length) throw new Error('This squad has no living available models.');
  if (references.has(uuid(target.actor)) && target.actor?.system?.unitUuid === uuid(squad)) throw new Error('Choose a target outside the firing squad.');
  return models.map(model => {
    const token = tokens.find(token => !token.destroyed && token.visible !== false && !(token.document?.hidden && !game.user.isGM) && uuid(token.actor) === uuid(model));
    const row = {model,modelUuid:uuid(model),token:token ?? null,tokenUuid:token?.document?.uuid ?? null,visible:false,eligible:false,blocked:false,reason:''};
    if (!token) return {...row,reason:'No visible model token on this scene.'};
    if (model.system.isLoader || String(model.system.role ?? '').trim().toLowerCase()==='loader') return {...row,reason:'Assigned as a loader.'};
    if (token === target) return {...row,reason:'A model cannot fire at itself.'};
    if (token.document?.level && target.document?.level && token.document.level !== target.document.level) return {...row,reason:'Target is on a different scene level.'};
    const level=tokenLevel(token,canvas);
    const blocked = Boolean(backend.testCollision(center(token,canvas),destination,{type:'sight',mode:'any',...(token.vision?{source:token.vision}:{}),...(level?{level}:{})}));
    return {...row,blocked,visible:!blocked,eligible:!blocked,reason:blocked?'Sight is blocked by scene walls.':'Clear line of sight.'};
  });
}
