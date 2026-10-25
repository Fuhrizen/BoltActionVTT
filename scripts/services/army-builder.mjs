import {loadCatalogue,preferredModelRows,squadTemplate} from './catalogue.mjs';
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
 return preferredModelRows(data.units.filter(row=>row.factionSlug===slug&&row.profile?.sourcePage)).map(row=>({slug:row.slug,name:row.name,kind:row.system.kind,quality:row.system.quality,baseModels:row.profile.baseModels??row.count??1,sourcePage:row.profile.sourcePage,options:(row.profile.options??[]).map(option=>({label:option.label??option.name??(option.weaponSlug??option.option??option.variant??'Profile option').replaceAll('-',' ')}))}));
}
export async function addArmySquad(army,slug){
 const faction=await selectedFaction(army),data=await loadCatalogue();
 const row=data.units.find(row=>row.slug===slug&&row.factionSlug===faction&&row.profile?.sourcePage);
 if(!row)throw new Error('Choose a source profile for the selected Army faction.');
 const source=await squadTemplate(row);
 const proxy={...source,documentName:'Actor',pack:'boltaction-source',visible:true,toObject:()=>structuredClone(source)};
 const squad=await importSquad(army,proxy);
 const traits=(row.traitSlugs??[]).map(slug=>data.traits.find(trait=>trait.slug===slug)).filter(Boolean).map(trait=>({name:trait.name,type:'trait',system:structuredClone(trait.system),flags:{boltaction:{catalogueSlug:trait.slug,sourceName:row.name}}}));
 try{if(traits.length&&squad.createEmbeddedDocuments)await squad.createEmbeddedDocuments('Item',traits);}catch(error){await deleteGroupActor(squad);throw error;}
 return squad;
}
