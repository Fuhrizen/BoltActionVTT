import {ROSTER_FORMAT,ROSTER_VERSION,validateRoster} from '../roster/format.mjs';
import {loadCatalogue,squadTemplate} from './catalogue.mjs';
import {addArmySquad} from './army-builder.mjs';
import {createTeam,importModel,deleteGroupActor,setSquadExperience,setInfantryLeader,ensureInfantryLeader,setLoaderPair} from './groups.mjs';
import {getModelChoices,applyModelChoice} from './model-choices.mjs';
const values=c=>c?.contents??Array.from(c??[]);
const flag=(actor,key)=>actor?.getFlag?.('boltaction',key)??actor?.flags?.boltaction?.[key];
const children=parent=>{const army=parent.type==='army';return (parent.system[army?'unitUuids':'modelUuids']??[]).map(uuid=>values(game.actors).find(a=>a.uuid===uuid)).filter(a=>a&&a.system[army?'armyUuid':'unitUuid']===parent.uuid);};
async function factionDocument(slug){
 const world=values(game.items).find(i=>i.type==='faction'&&(i.system?.slug===slug||flag(i,'catalogueSlug')===slug));if(world)return world;
 for(const pack of values(game.packs)){if(pack.documentName!=='Item'&&pack.metadata?.type!=='Item')continue;if(pack.visible===false||!pack.getDocuments)continue;if(pack.metadata?.name!=='boltaction-factions')continue;const found=(await pack.getDocuments()).find(i=>i.type==='faction'&&(i.system?.slug===slug||flag(i,'catalogueSlug')===slug));if(found)return found;}
 throw new Error('Prepare the faction catalogue as GM before importing this army.');
}
/** Exports selections; never copies world UUIDs, permissions, images or embedded document data. */
export async function exportArmyRoster(army){
 if(army?.type!=='army'||army.pack||!army.isOwner)throw new Error('Choose an owned world Army.');
 const faction=army.system.factionUuid?await fromUuid(army.system.factionUuid):null,slug=faction?.system?.slug||flag(faction,'catalogueSlug');
 const data=await loadCatalogue(),definitions=army.system.platoons?.length?army.system.platoons:[{id:'default',name:'Platoon 1'}];
 const platoons=definitions.map((p,i)=>({id:'p'+(i+1),name:p.name||`Platoon ${i+1}`})),squads=[];
 for(const [i,squad] of children(army).entries()){
  if(!squad.isOwner)throw new Error('You must own every squad being exported.');
  const source=data.units.find(row=>row.slug===flag(squad,'catalogueSlug'))??data.units.find(row=>row.name===flag(squad,'sourceName')&&row.factionSlug===slug);if(!source)throw new Error(`${squad.name}: no portable source profile is available.`);
  const members=children(squad),ids=new Map(members.map((m,j)=>[m.uuid,'m'+(j+1)])),models=[];
  for(const member of members){if(!member.isOwner)throw new Error('You must own every exported model.');if(member.system.pointsAdjustment)throw new Error(`${member.name}: manual point adjustments are not portable source choices.`);const choices=await getModelChoices(member);models.push({id:ids.get(member.uuid),customName:member.system.customName||'',isNco:Boolean(member.system.isNco||member.system.role==='nco'),isLoader:Boolean(member.system.isLoader),isMedic:Boolean(member.system.isMedic||member.system.role==='medic'),isObserver:Boolean(member.system.isObserver||member.system.role==='observer'),loaderForId:ids.get(member.system.loaderForUuid)||'',choices:choices.equipment.filter(c=>c.selected).map(c=>c.id)});}
  const p=definitions.findIndex(p=>p.id===squad.system.platoonId);squads.push({id:'s'+(i+1),profileSlug:source.slug,platoonId:platoons[Math.max(0,p)].id,identity:squad.system.identity||source.name,quality:squad.system.quality,nationalAllowance:Boolean(squad.system.nationalAllowance),models});
 }
 return validateRoster({format:ROSTER_FORMAT,version:ROSTER_VERSION,name:army.name,faction:slug,pointsLimit:army.system.pointsLimit||1000,platoons,squads},{units:data.units});
}
/** Import creates a new owned army. Failure removes only documents created by this import. */
export async function importArmyRoster(input){
 if(!game.user?.isGM)throw new Error('The GM imports portable armies.');
 const data=await loadCatalogue(),roster=validateRoster(input,{units:data.units}),faction=await factionDocument(roster.faction),templates=new Map();
 let totalModels=0;
 // Validate all source choice identifiers before the first world document is written.
 for(const squad of roster.squads){const row=data.units.find(r=>r.slug===squad.profileSlug),template=await squadTemplate(row);templates.set(squad.id,template);totalModels+=squad.models?.length??template.flags.boltaction.memberTemplates.length;if(totalModels>1000)throw new Error('An army may contain at most 1000 models.');if(!squad.models)continue;const sources=template.flags.boltaction.memberTemplates;
  for(const [i,selection] of squad.models.entries()){const source=structuredClone(sources[Math.min(i,sources.length-1)]);source.system.quality=squad.quality;const config=await getModelChoices(source);for(const choiceId of selection.choices)if(!config.equipment.some(c=>c.id===choiceId))throw new Error(`${squad.identity}: unknown source equipment choice ${choiceId}.`);const slots=selection.choices.map(id=>config.equipment.find(c=>c.id===id)).filter(c=>c.kind==='primary').map(c=>c.slot);if(new Set(slots).size!==slots.length)throw new Error('Select only one primary weapon per mounting.');}
 }
 let army;
 try{
  army=await createTeam({name:roster.name,factionUuid:faction.uuid});await army.update({ownership:{default:0,[game.user.id]:3},'system.pointsLimit':roster.pointsLimit,'system.platoons':roster.platoons},{render:false});
  for(const selection of roster.squads){const squad=await addArmySquad(army,selection.profileSlug,{platoonId:selection.platoonId});await squad.update({'system.identity':selection.identity,'system.nationalAllowance':selection.nationalAllowance},{render:false});await setSquadExperience(squad,selection.quality);if(!selection.models)continue;
   const sources=templates.get(selection.id).flags.boltaction.memberTemplates;
   while(children(squad).length>selection.models.length)await deleteGroupActor(children(squad).at(-1));
   while(children(squad).length<selection.models.length){const source=structuredClone(sources.at(-1));source.system={...source.system,isNco:false,isLoader:false,loaderForUuid:'',role:source.type==='model'?'rifleman':source.type==='modelStatic'?'crew':'vehicle'};await importModel(squad,{...source,documentName:'Actor',toObject:()=>structuredClone(source)});}
   const members=children(squad),mapped=new Map(selection.models.map((m,i)=>[m.id,members[i]]));
   for(const [i,m] of selection.models.entries())await members[i].update({'system.customName':m.customName,'system.isMedic':m.isMedic,'system.isObserver':m.isObserver,'system.isLoader':false,'system.loaderForUuid':''},{render:false});
   const leader=selection.models.find(m=>m.isNco);if(leader&&mapped.get(leader.id).type==='model')await setInfantryLeader(squad,mapped.get(leader.id).uuid);else await ensureInfantryLeader(squad);
   for(const [i,m] of selection.models.entries()){const model=members[i],config=await getModelChoices(model);for(const choice of config.equipment)if(choice.selected&&!m.choices.includes(choice.id)&&choice.kind!=='primary')await applyModelChoice(model,{choiceId:choice.id,enabled:false});for(const choice of config.equipment.filter(c=>m.choices.includes(c.id)).sort((a,b)=>Number(a.kind==='vehicle')-Number(b.kind==='vehicle')))await applyModelChoice(model,{choiceId:choice.id,enabled:true});}
   for(const m of selection.models)if(m.loaderForId)await setLoaderPair(mapped.get(m.id),mapped.get(m.loaderForId).uuid);
  }
  return army;
 }catch(error){if(army)try{await deleteGroupActor(army);}catch(rollback){throw new Error(`${error.message} Import cleanup needs GM review: ${rollback.message}`);}throw error;}
}
