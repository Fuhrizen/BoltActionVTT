import {renderInfantry} from '../token-art/infantry.mjs';
import {renderVehicle} from '../token-art/vehicles.mjs';
import {palettes,isDefaultModelArt,isGeneratedTokenArt,GENERATED_ART_PREFIX} from './faction-appearance.mjs';
const models=new Set(['model','modelStatic','modelVehicle']);
const values=value=>value?.contents??Array.from(value??[]);
const flag=(actor,key)=>actor?.getFlag?.('boltaction',key)??actor?.flags?.boltaction?.[key];
/** Pure layered output: every loadout is generated, without requiring an asset per combination. */
export function modelTokenArt(actor,factionSlug=flag(actor,'factionSlug')){
 if(!models.has(actor?.type))return null;
 const palette=palettes[factionSlug]??{color:'#758353',uniform:'#758353',helmet:'#4e5b3a',highlight:'#9fae82'};
 const weapons=values(actor.items).filter(i=>i.type==='weapon');
 const slugs=weapons.map(i=>i.system?.slug||flag(i,'catalogueSlug')||'rifle');
 const roles=['nco','loader','medic','observer'].filter(role=>actor.system?.['is'+role[0].toUpperCase()+role.slice(1)]||actor.system?.role===role);
 const options=values(actor.items).filter(i=>flag(i,'modelChoiceId')).map(i=>i.name||flag(i,'modelChoiceId'));
 let svg;
 if(actor.type==='modelVehicle'){
  const profile=flag(actor,'profile')??{};
  const row={slug:flag(actor,'catalogueSlug')||actor.system?.profileName||actor.name,name:actor.system?.profileName||flag(actor,'sourceName')||actor.name,profile,system:actor.system??{},weaponLoadout:weapons.map(i=>({weaponSlug:i.system?.slug,mount:flag(i,'mount'),quantity:i.system?.quantity??1}))};
  svg=renderVehicle({row,palette,options});
 }else svg=renderInfantry({palette,weaponSlug:slugs[0]||(actor.type==='modelStatic'?'unarmed':'rifle'),roles:[...roles,...(actor.type==='modelStatic'?['crew']:[])],extras:[...slugs.slice(1),...values(actor.items).filter(i=>i.type==='trait').map(i=>i.system?.slug||flag(i,'catalogueSlug')).filter(Boolean)]});
 return GENERATED_ART_PREFIX+encodeURIComponent(svg);
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
