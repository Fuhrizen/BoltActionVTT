const TYPES=new Set(['model','modelStatic','modelVehicle']);
const values=value=>value?.contents??Array.from(value??[]);
const blankName=name=>!String(name??'').trim()||/^unnamed (soldier|crew|vehicle|model)$/i.test(String(name).trim());
const sourceFlag=(actor,key)=>actor.getFlag?.('boltaction',key)??actor.flags?.boltaction?.[key];
function role(actor,flag,name){return Boolean(actor.system?.[flag])||String(actor.system?.role??'').trim().toLowerCase()===name;}
/** Generate a role/weapon label without mutating either the actor or source profile. */
export function generatedModelName(actor){
 if(!TYPES.has(actor?.type))return actor?.name??'';
 if(actor.type==='modelVehicle')return actor.system?.profileName||sourceFlag(actor,'sourceName')||'Vehicle';
 if(role(actor,'isNco','nco'))return 'NCO';
 if(role(actor,'isMedic','medic'))return 'Medic';
 if(role(actor,'isObserver','observer'))return 'Observer';
 if(role(actor,'isLoader','loader'))return 'Loader';
 const weapons=values(actor.items).filter(item=>item.type==='weapon');
 const weapon=weapons[0];
 if(!weapon)return actor.type==='modelStatic'?'Crewman':'Unarmed infantry';
 const slug=weapon.system?.slug??sourceFlag(weapon,'catalogueSlug');
 const names={rifle:'Rifleman',smg:'SMG gunner',lmg:'LMG gunner',mmg:'MMG gunner',hmg:'HMG gunner',pistol:'Pistol-armed infantry','assault-rifle':'Assault rifleman',bar:'BAR gunner'};
 return actor.type==='modelStatic'?(actor.system?.profileName||weapon.name||'Weapon crew'):(names[slug]||`${weapon.name||'Weapon'} gunner`);
}
function candidate(actor,changes={}){
 const system={...actor.system,...changes.system};
 for(const [key,value]of Object.entries(changes))if(key.startsWith('system.'))system[key.slice(7)]=value;
 // Role checkboxes take precedence over a legacy role string when explicitly switched off.
 for(const [flag,name]of [['isNco','nco'],['isMedic','medic'],['isLoader','loader'],['isObserver','observer']])if((Object.hasOwn(changes,'system.'+flag)||Object.hasOwn(changes.system??{},flag))&&!system[flag]&&system.role===name)system.role='rifleman';
 return {type:actor.type,name:actor.name,system,items:actor.items,flags:actor.flags,getFlag:actor.getFlag?.bind(actor)};
}
function nameUpdate(actor,changes={},options={}){
 const next=candidate(actor,changes),explicit=changes['system.customName']??changes.system?.customName;
 let custom=explicit!==undefined?String(explicit??'').trim():String(actor.system?.customName??'').trim();
 if(typeof changes.name==='string'&&!options.boltactionAutoName)custom=blankName(changes.name)?'':changes.name.trim();
 const name=custom||generatedModelName(next);
 return {name,'system.customName':custom,'prototypeToken.name':name};
}
let registered=false;
const pending=new Map();
function authoredHere(userId){if(userId)return userId===globalThis.game?.user?.id;return Boolean(game.user?.isGM&&(!game.users?.activeGM||game.users.activeGM.id===game.user.id));}
/** Rename only on identity/role/equipment changes, never token movement or unrelated actor updates. */
export function registerModelIdentities(){
 if(registered)return;registered=true;
 Hooks.on('preCreateActor',(actor,source)=>{
  if(!TYPES.has(source.type)||actor.pack)return;
  const view={type:source.type,name:source.name,system:source.system??{},items:source.items??[],flags:source.flags};
  const generated=generatedModelName(view),custom=source.system?.customName?.trim()||(!blankName(source.name)&&source.name!==generated&&source.name!==source.system?.profileName?source.name:'');
  const name=custom||generated;
  actor.updateSource({name,'system.customName':custom,'prototypeToken.name':name});
 });
 Hooks.on('preUpdateActor',(actor,changes,options={})=>{
  if(!TYPES.has(actor.type)||actor.pack)return;
  const relevant=Object.keys(changes).some(key=>key==='name'||key==='system.customName'||key==='system.role'||/^system\.is(Nco|Loader|Medic|Observer)$/.test(key))||Object.keys(changes.system??{}).some(key=>['customName','role','isNco','isLoader','isMedic','isObserver'].includes(key));
  if(relevant)Object.assign(changes,nameUpdate(actor,changes,options));
 });
 function equipmentChanged(item,_changes,_options,userId){
  const actor=item.parent;if(item.type!=='weapon'||!TYPES.has(actor?.type)||actor.pack||!authoredHere(userId))return;
  clearTimeout(pending.get(actor.uuid));pending.set(actor.uuid,setTimeout(async()=>{pending.delete(actor.uuid);const update=nameUpdate(actor,{}, {boltactionAutoName:true});if(actor.name===update.name)return;try{await actor.update(update,{boltactionAutoName:true,render:false});}catch(error){console.error('Bolt Action: model identity update',error);}},0));
 }
 Hooks.on('updateItem',equipmentChanged);
 for(const hook of ['createItem','deleteItem'])Hooks.on(hook,(item,options,userId)=>equipmentChanged(item,null,options,userId));
 Hooks.on('ready',async()=>{
  if(!authoredHere())return;
  for(const actor of values(game.actors)){
   if(!TYPES.has(actor.type)||actor.pack)continue;
   const generated=generatedModelName(actor),stored=String(actor.system?.customName??'').trim();
   const custom=stored||(!blankName(actor.name)&&actor.name!==generated?actor.name:'');
   const name=custom||generated;
   if(actor.name!==name||stored!==custom)await actor.update({name,'system.customName':custom,'prototypeToken.name':name},{boltactionAutoName:true,render:false});
  }
 });
}
