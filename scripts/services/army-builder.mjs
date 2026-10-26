import {calculateCost} from './costs.mjs';
import {loadCatalogue,squadTemplate} from './catalogue.mjs';
import {importSquad,deleteGroupActor} from './groups.mjs';
async function selectedFaction(army){
 if(army?.type!=='army'||!army.isOwner||army.pack)throw new Error('Choose an owned world Army.');
 const faction=army.system.factionUuid?await fromUuid(army.system.factionUuid):null;
 return faction?.system?.slug||faction?.getFlag?.('boltaction','catalogueSlug')||faction?.flags?.boltaction?.catalogueSlug||'';
}
/** Read-only catalogue for the selected Army; no compendium browser or document imports needed. */
export async function armyBuilderCatalogue(army){
 const slug=await selectedFaction(army);if(!slug)return [];
 const data=await loadCatalogue();
 return data.units.filter(row=>row.factionSlug===slug&&row.profile?.sourcePage).map(row=>({slug:row.slug,name:row.profile.entryName??row.name,kind:row.system.kind,quality:row.system.quality,baseModels:row.profile.baseModels??row.count??1,extraModelCost:squadModelLimit(row).extraModelCost,maxModels:squadModelLimit(row).max,sourcePage:row.profile.sourcePage,options:(row.profile.options??[]).map(option=>({...option,...optionPrice(option,row.system.quality),label:option.label??option.name??(option.weaponSlug??option.option??option.variant??'Profile option').replaceAll('-',' ')}))}));
}
export async function addArmySquad(army,slug,{platoonId}={}){
 const faction=await selectedFaction(army),data=await loadCatalogue();
 const row=data.units.find(row=>row.slug===slug&&row.factionSlug===faction&&row.profile?.sourcePage);
 if(!row)throw new Error('Choose a source profile for the selected Army faction.');
 const source=await squadTemplate(row);
 const proxy={...source,documentName:'Actor',pack:'boltaction-source',visible:true,toObject:()=>structuredClone(source)};
 const squad=await importSquad(army,proxy);
 const traits=(row.traitSlugs??[]).map(slug=>data.traits.find(trait=>trait.slug===slug)).filter(Boolean).map(trait=>({name:trait.name,type:'trait',system:structuredClone(trait.system),flags:{boltaction:{catalogueSlug:trait.slug,sourceName:row.name}}}));
 try{if(platoonId)await assignSquadPlatoon(army,squad,platoonId);if(traits.length&&squad.createEmbeddedDocuments)await squad.createEmbeddedDocuments('Item',traits);}catch(error){await deleteGroupActor(squad);throw error;}
 return squad;
}

const flag=(actor,key)=>actor.getFlag?.('boltaction',key)??actor.flags?.boltaction?.[key];
const values=c=>c?.contents??Array.from(c??[]);
export function optionPrice(option,quality='regular'){
 const value=option.pointsByQuality?.[quality]??option.costEach??option.costPerModel??option.cost;
 const basis=option.costPerModel!==undefined?'per model':option.costEach!==undefined?'each':'per option';
 return {cost:Number.isFinite(value)?value:null,costBasis:basis,costLabel:Number.isFinite(value)?`${value>=0?'+':''}${value} pts ${basis}`:'Price requires confirmation'};
}
export function squadModelLimit(row,quality=row.system?.quality){const profile=row.profile??{},extra=(profile.options??[]).find(option=>['additional-model','attendants'].includes(option.option)),min=profile.baseModels??row.count??1;return {min,max:profile.maxModels??(extra?.max!==undefined?min+extra.max:row.system?.maxSize??min),extraModelCost:profile.extraModelPoints??extra?.pointsByQuality?.[quality]??extra?.costEach??null};}
/** Source and selected-selector checks; never substitutes an invented theatre selector. */
export async function validateArmy(army){
 const faction=await selectedFaction(army),data=await loadCatalogue(),errors=[],warnings=[];
 if(!faction)errors.push('Select an Army faction.');
 const squads=values(game.actors).filter(a=>a.type==='unit'&&a.visible!==false&&(army.system.unitUuids??[]).includes(a.uuid)&&a.system.armyUuid===army.uuid);
 if(!squads.length)errors.push('Add at least one squad.');
 const rows=new Map();let nationalAllowances=0;
 for(const squad of squads){
  let row=data.units.find(r=>r.slug===flag(squad,'catalogueSlug'))??data.units.find(r=>r.name===flag(squad,'sourceName')&&r.factionSlug===(flag(squad,'factionSlug')||faction));
  if(row){const family=row.slug.replace(/-(inexperienced|regular|veteran)/g,'');row=data.units.find(candidate=>candidate.factionSlug===row.factionSlug&&candidate.slug.replace(/-(inexperienced|regular|veteran)/g,'')===family&&candidate.system.quality===squad.system.quality)??row;}
  if(!row){warnings.push(`${squad.name}: source profile unavailable.`);continue;}rows.set(squad.uuid,row);
  if(row.factionSlug!==faction)errors.push(`${squad.name}: profile belongs to another faction.`);
  const models=values(game.actors).filter(m=>m.visible!==false&&(squad.system.modelUuids??[]).includes(m.uuid)&&m.system.unitUuid===squad.uuid);
  if(squad.system.nationalAllowance){nationalAllowances++;const british=faction==='great-britain'&&row.slug==='great-britain-artillery-observer'&&squad.system.quality==='regular';const soviet=faction==='soviet-union'&&row.slug==='soviet-union-inexperienced-infantry'&&squad.system.quality==='inexperienced'&&models.length===12;if(!british&&!soviet)errors.push(`${squad.name}: national allowance requires a regular British artillery observer (p.178–179) or a 12-man inexperienced Soviet infantry squad (p.189).`);}
  const limit=squadModelLimit(row);const count=row.system.kind==='vehicle'?models.filter(m=>m.type==='modelVehicle').length:models.length;
  const minimum=row.system.kind==='vehicle'?1:limit.min,maximum=row.system.kind==='vehicle'?1:limit.max;
  if(count<minimum||count>maximum)errors.push(`${squad.name}: ${minimum}–${maximum} models required; currently ${count}.`);
  if(Number.isFinite(row.profile?.ncoCount)){const ncos=models.filter(m=>m.system.isNco||m.system.role==='nco').length;if(ncos!==row.profile.ncoCount)errors.push(`${squad.name}: ${row.profile.ncoCount} NCO required; currently ${ncos}.`);}
  const levels=new Set(Object.keys(row.profile?.pointsByQuality??{}));
  for(const sibling of data.units.filter(r=>r.factionSlug===row.factionSlug&&r.slug.replace(/-(inexperienced|regular|veteran)/g,'')===row.slug.replace(/-(inexperienced|regular|veteran)/g,'')))levels.add(sibling.system.quality);
  if(levels.size&&!levels.has(squad.system.quality))errors.push(`${squad.name}: experience is unavailable in its source profile.`);
  for(const option of row.profile?.options??[]){
   if(option.weaponSlug&&Number.isFinite(option.max)){const selected=models.filter(m=>(m.items??[]).some(i=>i.type==='weapon'&&(flag(i,'catalogueSlug')===option.weaponSlug||i.system?.slug===option.weaponSlug))).length;if(selected>option.max)errors.push(`${squad.name}: ${option.weaponSlug} limit ${option.max}, selected ${selected}.`);if(selected&&option.loaderEach){const loaders=models.filter(m=>m.system.isLoader||m.system.role==='loader').length;if(loaders<selected*option.loaderEach)errors.push(`${squad.name}: ${selected*option.loaderEach} loader models required.`);}}
  }
 }
 if(nationalAllowances>1)errors.push('Only one national free-unit allowance is permitted per Army (p.178 or p.189).');
 const selector=army.system.selectorUuid?await fromUuid(army.system.selectorUuid):null;
 let selectorSource={name:'Generic reinforced platoon',page:153,book:'Bolt Action Second Edition'};
 if(army.system.selectorUuid&&(!selector||selector.type!=='selector'))warnings.push('The configured platoon selector is unavailable.');
 else if(selector){
  selectorSource={name:selector.name,page:selector.getFlag?.('boltaction','sourcePage')??null};
  if(selector.system.factionUuid&&selector.system.factionUuid!==army.system.factionUuid)errors.push('The selected platoon selector belongs to another faction.');
  for(const slot of selector.system.slots??[]){const count=squads.filter(s=>{const row=rows.get(s.uuid);return s.system.battlefieldRole===slot.kind||row?.system.kind===slot.kind;}).length;if(count<slot.min||count>slot.max)errors.push(`${slot.kind}: selector permits ${slot.min}–${slot.max}; currently ${count}.`);}
 }else{
  const orbat=await armyOrbat(army);for(const platoon of orbat.platoons)errors.push(...platoon.errors.map(error=>`${platoon.name}: ${error}`));
 }
 const cost=await calculateCost(army);warnings.push(...cost.unknown);
 if(Number.isFinite(army.system.pointsLimit)&&cost.total>army.system.pointsLimit)errors.push(`Army exceeds its ${army.system.pointsLimit} point limit by ${cost.total-army.system.pointsLimit}.`);
 return {valid:errors.length===0&&warnings.length===0,errors:[...new Set(errors)],warnings:[...new Set(warnings)],total:cost.total,selectorSource,platoons:(await armyOrbat(army)).platoons};
}

/** Slot names from the generic selector, rulebook p.153; US MMG exception p.169. */
export function reinforcedPlatoonCategory(row,squad={}){
 const slug=row.slug,name=row.name.toLowerCase(),weapon=row.weaponSlug??'';
 if(/-(first|second)-lieutenant$/.test(slug))return 'lieutenant';
 if(/-(captain|major)$/.test(slug))return 'seniorOfficer';
 if(/medic/.test(slug))return 'medic';
 if(/observer/.test(slug))return 'observer';
 if(row.system.kind==='artillery')return 'artillery';
 if(row.system.kind==='vehicle'){
  const live=(squad.members??[]).find(m=>m.type==='modelVehicle');
  const capacity=live?.system.capacity??row.system.capacity??0;
  if(capacity>0)return 'transport';
  const armoured=['germany-sdkfz234','united-states-greyhound','great-britain-humber-daimler','soviet-union-ba64','imperial-japan-type94'];
  if(armoured.includes(slug))return 'armouredCar';
  if((row.system.capacity??0)>0&&capacity===0)return row.system.damageValue<=7&&row.system.moveAdvance>=12?'armouredCar':'combatVehicle';
  return 'combatVehicle';
 }
 if(/sniper/.test(slug)||(row.traitSlugs??[]).includes('sniper'))return 'sniper';
 if(/mortar/.test(weapon))return 'mortar';
 if(/flamethrower/.test(weapon))return 'flamethrower';
 if(['mmg','hmg','lmg'].includes(weapon))return 'machineGun';
 if(/at-rifle|anti-tank-rifle|bazooka|piat|panzerschreck/.test(weapon))return 'antiTank';
 if(row.profile?.ncoCount||/infantry|wehrmacht|militia|rifle.squad/.test(slug))return 'infantry';
 return null;
}
export async function squadBuilderLimits(squad){
 const data=await loadCatalogue(),faction=flag(squad,'factionSlug'),name=flag(squad,'sourceName'),slug=flag(squad,'catalogueSlug');
 const source=data.units.find(row=>row.slug===slug)??data.units.find(row=>row.name===name&&(!faction||row.factionSlug===faction));
 if(!source)return null;
 const family=value=>value.replace(/(?:^|-)(inexperienced|regular|veteran)(?=-|$)/g,'');
 const row=data.units.find(row=>row.factionSlug===source.factionSlug&&family(row.slug)===family(source.slug)&&row.system.quality===squad.system.quality)??source;
 return {...squadModelLimit(row,squad.system.quality),qualities:[...new Set([row.system.quality,...Object.keys(row.profile?.pointsByQuality??{})])]};
}

/** Explicit ORBAT groups; legacy unassigned squads belong to the first platoon. */
export async function armyOrbat(army){
 const faction=await selectedFaction(army),data=await loadCatalogue();
 const definitions=(army.system.platoons?.length?army.system.platoons:[{id:'platoon-1',name:'Platoon 1'}]).filter(p=>p?.id);
 const squads=values(game.actors).filter(s=>s.type==='unit'&&(army.system.unitUuids??[]).includes(s.uuid)&&s.system.armyUuid===army.uuid&&s.visible!==false);
 const platoons=definitions.map((definition,index)=>{
  const members=squads.filter(s=>s.system.platoonId===definition.id||index===0&&!definitions.some(p=>p.id===s.system.platoonId));
  const entries=members.map(s=>{const row=data.units.find(r=>r.slug===flag(s,'catalogueSlug'))??data.units.find(r=>r.name===flag(s,'sourceName')&&r.factionSlug===(flag(s,'factionSlug')||faction));return {uuid:s.uuid,name:s.name,category:row?reinforcedPlatoonCategory(row,s):null};});
  const counts={};for(const e of entries)if(e.category)counts[e.category]=(counts[e.category]??0)+1;
  const errors=[];if(counts.lieutenant!==1)errors.push(`Requires 1 first or second lieutenant; currently ${counts.lieutenant??0} (p.153).`);
  if((counts.infantry??0)<2||(counts.infantry??0)>5)errors.push(`Requires 2–5 infantry squads; currently ${counts.infantry??0} (p.153).`);
  for(const category of ['seniorOfficer','medic','observer','machineGun','mortar','sniper','flamethrower','antiTank','artillery','armouredCar','combatVehicle']){
   const max=category==='machineGun'&&faction==='united-states'?3:1;if((counts[category]??0)>max)errors.push(`${category}: ${counts[category]} selected; maximum ${max}.`);
  }
  const transportMax=entries.filter(e=>e.category&&!['transport','armouredCar','combatVehicle'].includes(e.category)).length;
  if((counts.transport??0)>transportMax)errors.push(`Transport/tow allowance ${transportMax}; currently ${counts.transport}.`);
  for(const entry of entries)if(!entry.category)errors.push(`${entry.name}: slot could not be verified.`);
  return {...definition,squads:entries,counts,commanderUuid:entries.find(e=>e.category==='lieutenant')?.uuid??'',errors,valid:errors.length===0};
 });return {platoons};
}
export async function createArmyPlatoon(army,name){
 await selectedFaction(army);const existing=(await armyOrbat(army)).platoons.map(({id,name})=>({id,name}));
 const id=globalThis.crypto?.randomUUID?.()??`platoon-${Date.now()}-${Math.random()}`;
 const platoon={id,name:String(name||`Platoon ${existing.length+1}`).trim()||`Platoon ${existing.length+1}`};
 await army.update({'system.platoons':[...existing,platoon]},{render:false});return platoon;
}
export const addPlatoon=createArmyPlatoon;
export async function assignSquadPlatoon(army,squad,platoonId){
 await selectedFaction(army);if(!squad?.isOwner||squad.pack||squad.type!=='unit'||squad.system.armyUuid!==army.uuid||!(army.system.unitUuids??[]).includes(squad.uuid))throw new Error('Choose an owned squad in this Army.');
 if(!(await armyOrbat(army)).platoons.some(p=>p.id===platoonId))throw new Error('Choose a platoon in this Army.');
 await squad.update({'system.platoonId':platoonId},{render:false});return squad;
}
