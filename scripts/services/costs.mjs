import {loadCatalogue} from './catalogue.mjs';
const flag=(actor,key)=>actor.getFlag?.('boltaction',key)??actor.flags?.boltaction?.[key];
const values=collection=>collection?.contents??Array.from(collection??[]);
const family=slug=>slug?.replace(/(?:^|-)(inexperienced|regular|veteran)(?=-|$)/g,'');
const number=value=>typeof value==='number'&&Number.isFinite(value);
const result=(base=0,options=0,unknown=[])=>({total:Math.round((base+options)*100)/100,base,options,unknown:[...new Set(unknown)]});
function children(actor){
 if(actor.type==='unit'&&actor.pack&&Array.isArray(flag(actor,'memberTemplates')))return flag(actor,'memberTemplates').filter(member=>['model','modelStatic','modelVehicle'].includes(member.type));
 const army=actor.type==='army',field=army?'unitUuids':'modelUuids',back=army?'armyUuid':'unitUuid';
 const actors=values(globalThis.game?.actors);
 return [...new Set(actor.system?.[field]??[])].map(uuid=>actors.find(a=>a.uuid===uuid)).filter(a=>a&&a.visible!==false&&a.system?.[back]===actor.uuid&&(army?a.type==='unit':['model','modelStatic','modelVehicle'].includes(a.type)));
}
function source(actor,data,quality){
 const slug=flag(actor,'catalogueSlug');
 let row=data.units.find(row=>row.slug===slug);
 row??=data.units.find(row=>row.name===flag(actor,'sourceName'));
 if(row)row=data.units.find(candidate=>candidate.factionSlug===row.factionSlug&&family(candidate.slug)===family(row.slug)&&candidate.system.quality===quality)??row;
 return {row,profile:row?.profile??flag(actor,'profile')??{}};
}
function rate(row,profile,quality){
 if(number(profile.pointsByQuality?.[quality]))return profile.pointsByQuality[quality];
 if(profile.pointsByQuality)return null;
 if(row?.system.quality!==quality)return null;
 return number(profile.basePoints)?profile.basePoints:number(row?.system.points)&&row.system.points>0?row.system.points:null;
}
function extraRate(profile,quality){return profile.options?.find(o=>['attendants','additional-model'].includes(o.option))?.pointsByQuality?.[quality]??profile.extraModelPoints;}
function modelBase(actor,row,profile,quality,total){
 if(total===null)return null;
 if(actor.type==='modelVehicle')return total;
 const count=profile.baseModels??row?.count??1;
 if(actor.type==='modelStatic')return actor.system.crew>1?total:total/Math.max(1,count);
 const personal=row?.composition?.some(entry=>['officer','observer','medic'].includes(entry.role));
 if(personal){if(['officer','observer','medic'].includes(actor.system.role))return total;return extraRate(profile,quality)??null;}
 return total/Math.max(1,count);
}
function optionCost(option,quality,quantity){
 if(number(option.costEach))return option.costEach*quantity;
 if(number(option.costPerModel))return option.costPerModel;
 if(number(option.cost))return option.cost;
 if(number(option.pointsByQuality?.[quality]))return option.pointsByQuality[quality];
 return null;
}
function equipmentCosts(actor,row,profile,quality,data){
 let cost=0;const unknown=[],seen=new Set();
 for(const item of values(actor.items)){
  if(!['weapon','trait'].includes(item.type))continue;
  const choice=flag(item,'modelChoiceId'),slug=flag(item,'catalogueSlug')??item.system?.slug;
  const isDefault= !choice && ((item.type==='weapon'&&(row?.weaponSlug===slug||row?.weaponLoadout?.some(w=>w.weaponSlug===slug)||[row?.weaponSlug,...(row?.weaponLoadout??[]).map(w=>w.weaponSlug)].some(s=>data.weapons.find(w=>w.slug===s)?.name===item.name))) || item.type==='trait'&&row?.traitSlugs?.includes(slug));
  if(isDefault)continue;
  let candidates=(profile.options??[]).filter(o=>slug && (item.type==='weapon'?(o.weaponSlug===slug||o.weaponSlugs?.includes(slug)):(o.trait??o.option)===slug));
  const mount=flag(item,'mount');if(mount)candidates=candidates.filter(o=>!o.mount&&!o.mounts||o.mount===mount||o.mounts?.includes(mount)||o.replaceWeapon);
  // Reverting a primary slot to the included source weapon is free.
  if(choice?.startsWith('primary:') && !candidates.length && (row?.weaponSlug===slug||row?.weaponLoadout?.some(w=>w.weaponSlug===slug)))continue;
  const prices=[...new Set(candidates.map(o=>optionCost(o,quality,Number(item.system?.quantity)||1)))];
  if(prices.length!==1||prices[0]===null){unknown.push(`${actor.name}: price unavailable for ${item.name}`);continue;}
  const fixedBundle=candidates.length===1&&number(candidates[0].cost)&&!number(candidates[0].costEach)&&candidates[0].mounts?.length>1;
  const key=fixedBundle?'bundle:'+profile.options.indexOf(candidates[0]):choice??item.id??item._id??item.name;if(seen.has(key))continue;seen.add(key);cost+=prices[0];
 }
 return {cost,unknown};
}
/** Read-only source-derived points. Unknown entries mean total is a known subtotal, not a complete quote. */
export async function calculateCost(actor){
 if(!actor||actor.visible===false)return result(0,0,['Actor is unavailable.']);
 const data=await loadCatalogue();
 async function calculate(document,qualityOverride){
  if(['army','unit'].includes(document.type)){
   const members=children(document),quality=document.type==='unit'?document.system.quality:qualityOverride;
   const rows=await Promise.all(members.map(member=>calculate(member,quality)));
   if(!members.length&&document.type==='unit')return result(0,0,['Squad contains no priced models.']);
   return result(rows.reduce((sum,row)=>sum+row.base,0),rows.reduce((sum,row)=>sum+row.options,0),rows.flatMap(row=>row.unknown));
  }
  const quality=qualityOverride??document.unit?.system?.quality??document.system.quality??'regular';
  const {row,profile}=source(document,data,quality),total=rate(row,profile,quality);
  const base=modelBase(document,row,profile,quality,total),equipment=equipmentCosts(document,row,profile,quality,data);
  return result(base??0,equipment.cost,[...(base===null?[`${document.name}: no verified ${quality} base cost`]:[]),...equipment.unknown]);
 }
 return calculate(actor);
}
