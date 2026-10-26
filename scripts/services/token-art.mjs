import {infantryTokenAssets} from '../token-art/infantry-manifest.mjs';
import {vehicleTokenAssets,vehicleTokenVariants} from '../token-art/vehicle-manifest.mjs';
import {infantryAssetKey,vehicleVisualKey} from '../token-art/asset-keys.mjs';
import {palettes,isDefaultModelArt} from './faction-appearance.mjs';
const models=new Set(['model','modelStatic','modelVehicle']);
const values=value=>value?.contents??Array.from(value??[]);
const flag=(actor,key)=>actor?.getFlag?.('boltaction',key)??actor?.flags?.boltaction?.[key];
/** Only checked-in .svg paths enter Foundry FilePathFields; never SVG data URIs. */
export function modelTokenArt(actor,factionSlug=flag(actor,'factionSlug')){
 if(!models.has(actor?.type))return null;
 const faction=palettes[factionSlug]?factionSlug:'germany';
 const weapons=values(actor.items).filter(i=>i.type==='weapon'),slugs=weapons.map(i=>i.system?.slug||flag(i,'catalogueSlug')||'rifle');
 if(actor.type==='modelVehicle'){
  const source=flag(actor,'catalogueSlug');
  const slug=vehicleTokenAssets[source]?source:Object.keys(vehicleTokenAssets).find(key=>key.startsWith(faction+'-')&&key.endsWith(String(actor.system?.profileName||actor.name||'').toLowerCase().replaceAll(' ','-')));
  if(!slug)return `systems/boltaction/assets/factions/${faction}/vehicle-token.svg?v=22`;
  const options=values(actor.items).filter(i=>flag(i,'modelChoiceId')).map(i=>i.name||flag(i,'modelChoiceId'));
  const key=vehicleVisualKey(options);
  return 'systems/boltaction/'+(vehicleTokenVariants[slug+':'+key]||vehicleTokenVariants[slug+':'+(key?128:0)]||vehicleTokenAssets[slug])+'?v=22';
 }
 const roles=['nco','loader','medic','observer'].filter(role=>actor.system?.['is'+role[0].toUpperCase()+role.slice(1)]||actor.system?.role===role);
 if(actor.type==='modelStatic')roles.push('crew');
 const options={weaponSlug:slugs[0]||(actor.type==='modelStatic'?'unarmed':'rifle'),roles,extras:slugs.slice(1)};
 const key=infantryAssetKey(options),fallback=infantryAssetKey({...options,extras:[]});
 return 'systems/boltaction/'+(infantryTokenAssets[faction+':'+key]||infantryTokenAssets[faction+':'+fallback]||infantryTokenAssets[faction+':'+options.weaponSlug]||infantryTokenAssets[faction+':rifle'])+'?v=22';
}
function worldActor(uuid){return values(game.actors).find(a=>a.uuid===uuid);}
async function factionFor(actor){
 const squad=worldActor(actor.system?.unitUuid),army=worldActor(squad?.system?.armyUuid);
 const uuid=army?.system?.factionUuid||actor.system?.sourceFactionUuid;
 const faction=uuid&&globalThis.fromUuid?await fromUuid(uuid):null;
 return faction?.system?.slug||flag(faction,'catalogueSlug')||flag(actor,'factionSlug')||flag(squad,'factionSlug');
}
/** Only system-managed paths are changed; custom portraits and custom placed token art stay intact. */
export async function synchronizeModelArt(actor){
 if(!models.has(actor?.type)||actor.pack||!actor.isOwner)return;
 const src=modelTokenArt(actor,await factionFor(actor)),update={};
 if(isDefaultModelArt(actor.img)&&actor.img!==src)update.img=src;
 const texture=actor.prototypeToken?.texture;
 if(isDefaultModelArt(texture?.src)&&texture?.src!==src){update['prototypeToken.texture.src']=src;if(!actor.flags?.boltaction?.preserveTokenTransform)update['prototypeToken.texture.scaleY']=1;}
 if(Object.keys(update).length)await actor.update(update,{boltactionArt:true,render:false});
 for(const scene of values(game.scenes)){
  const changed=values(scene.tokens).filter(token=>token.actorId===actor.id&&token.actorLink!==false&&isDefaultModelArt(token.texture?.src)&&token.texture?.src!==src).map(token=>({_id:token.id,'texture.src':src,...(!token.flags?.boltaction?.preserveTokenTransform?{'texture.scaleY':1}: {})}));
  if(changed.length&&scene.updateEmbeddedDocuments)await scene.updateEmbeddedDocuments('Token',changed,{boltactionArt:true});
 }
}
let registered=false;const pending=new Map();
export function registerTokenArt(){
 if(registered)return;registered=true;
 function authored(userId){return userId?userId===game.user?.id:game.user?.isGM&&(!game.users?.activeGM||game.users.activeGM.id===game.user.id);}
 function queue(actor,options={},userId){
  if(!models.has(actor?.type)||actor.pack||options.boltactionArt||!authored(userId))return;
  clearTimeout(pending.get(actor.uuid));pending.set(actor.uuid,setTimeout(()=>{pending.delete(actor.uuid);void synchronizeModelArt(actor).catch(error=>console.error('Bolt Action: token artwork',error));},20));
 }
 Hooks.on('createActor',(actor,options,userId)=>queue(actor,options,userId));
 Hooks.on('updateActor',(actor,changes,options,userId)=>{
  if(Object.keys(changes).some(key=>key==='system'||key==='flags'||key==='img'||key.startsWith('system.')||key.startsWith('flags.boltaction.')))queue(actor,options,userId);
 });
 for(const name of ['createItem','updateItem','deleteItem'])Hooks.on(name,(item,changes,options,userId)=>{
  if(name!=='updateItem'){userId=options;options=changes;}
  if(['weapon','trait'].includes(item.type))queue(item.parent,options,userId);
 });
 Hooks.on('ready',async()=>{if(!authored())return;for(const actor of values(game.actors))await synchronizeModelArt(actor);});
}
