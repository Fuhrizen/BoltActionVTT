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
function source(actor,data,quality,inheritedFaction){
 const slug=flag(actor,'catalogueSlug');
 let row=data.units.find(row=>row.slug===slug);
 const faction=flag(actor,'factionSlug')||inheritedFaction;
 const named=data.units.filter(row=>row.name===flag(actor,'sourceName')&&(!faction||row.factionSlug===faction));
 row??=named.length===1?named[0]:null;
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
function parentArmy(actor){
 const actors=values(globalThis.game?.actors);
 if(actor.type==='army')return actor;
 if(actor.type==='unit')return actors.find(parent=>parent.type==='army'&&parent.uuid===actor.system?.armyUuid&&parent.system?.unitUuids?.includes(actor.uuid));
 const squad=actors.find(parent=>parent.type==='unit'&&parent.uuid===actor.system?.unitUuid&&parent.system?.modelUuids?.includes(actor.uuid));
 return squad?parentArmy(squad):null;
}
async function armyFaction(actor){
 const army=parentArmy(actor);if(!army)return null;
 const reference=army.system?.factionUuid;
 let faction=values(globalThis.game?.items).find(item=>item.uuid===reference);
 if(!faction&&reference&&globalThis.fromUuid)try{faction=await fromUuid(reference);}catch{/* Missing references are not inferred. */}
 return faction?.system?.slug||flag(faction??{},'catalogueSlug')||flag(army,'factionSlug')||null;
}
function allowanceEligibility(squad,members,data,faction){
 const quality=squad.system?.quality??'regular';
 let {row}=source(squad,data,quality,faction);
 const memberRows=members.map(member=>source(member,data,quality,faction).row);
 row??=memberRows[0];
 if(!row)return {valid:false,reason:'National allowance needs a verified source profile.'};
 if(parentArmy(squad)&&faction!==row.factionSlug)return {valid:false,reason:'National allowance must match the Army faction.'};
 const allSame=memberRows.every(member=>member&&family(member.slug)===family(row.slug)&&member.factionSlug===row.factionSlug);
 if(!allSame)return {valid:false,reason:'National allowance cannot mix different source profiles.'};
 if(row.factionSlug==='great-britain'&&row.system?.observerKind==='artillery'&&quality==='regular'){
  const officers=members.filter(member=>member.system?.role==='observer');
  if(officers.length!==1)return {valid:false,reason:'British free observer requires exactly one artillery observer.'};
  const {profile}=source(officers[0],data,quality,faction),price=rate(row,profile,quality);
  return number(price)?{valid:true,key:'great-britain',waiver:price}:{valid:false,reason:'British observer base price is unavailable.'};
 }
 if(row.slug==='soviet-union-inexperienced-infantry'&&quality==='inexperienced'&&members.length===12&&members.every(member=>member.type==='model'))return {valid:true,key:'soviet-union',all:true};
 return {valid:false,reason:'National allowance requires a regular British artillery observer or a 12-model inexperienced Soviet infantry squad.'};
}
/** Read-only source-derived points. Unknown entries mean total is a known subtotal, not a complete quote. */
export async function calculateCost(actor){
 if(!actor||actor.visible===false)return result(0,0,['Actor is unavailable.']);
 const data=await loadCatalogue();
 async function calculate(document,qualityOverride,budget){
  const faction=await armyFaction(document);
  if(['army','unit'].includes(document.type)){
   const members=children(document),quality=document.type==='unit'?document.system.quality:qualityOverride;
   const shared=budget??new Set();
   const rows=[];for(const member of members)rows.push(await calculate(member,quality,shared));
   if(!members.length&&document.type==='unit')return result(0,0,['Squad contains no priced models.']);
   let base=rows.reduce((sum,row)=>sum+row.base,0),options=rows.reduce((sum,row)=>sum+row.options,0),unknown=rows.flatMap(row=>row.unknown);
   if(document.type==='unit'&&document.system?.nationalAllowance){
    const eligible=allowanceEligibility(document,members,data,faction);
    if(!eligible.valid)unknown.push(eligible.reason);
    else {
     let duplicate=shared.has(eligible.key);
     // A directly opened squad must use the same allowance order as its Army total.
     if(!budget){const army=parentArmy(document);if(army){for(const sibling of children(army)){if(sibling===document)break;if(sibling.system?.nationalAllowance){const previous=allowanceEligibility(sibling,children(sibling),data,faction);if(previous.valid&&previous.key===eligible.key)duplicate=true;}}}}
     if(duplicate)unknown.push('Only one national allowance of this type is free per Army; this squad is priced normally.');
     else {shared.add(eligible.key);if(eligible.all){base=0;options=0;}else base=Math.max(0,base-eligible.waiver);}
    }
   }
   return result(base,options,unknown);
  }
  const quality=qualityOverride??document.unit?.system?.quality??document.system.quality??'regular';
  const {row,profile}=source(document,data,quality,faction),total=rate(row,profile,quality);
  const base=modelBase(document,row,profile,quality,total),equipment=equipmentCosts(document,row,profile,quality,data);
  return result(base??0,equipment.cost,[...(base===null?[`${document.name}: no verified ${quality} base cost`]:[]),...equipment.unknown]);
 }
 return calculate(actor);
}
