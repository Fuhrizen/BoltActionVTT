import {ArmyData,UnitData,ModelData,StaticModelData,VehicleModelData,WeaponData,TraitData,FactionData,SelectorData} from './data/models.mjs';
import {BoltActor} from './documents/actor.mjs';
import {BoltActorSheet,openArmyBuilder} from './applications/actor-sheet.mjs';
import {BoltItemSheet} from './applications/item-sheet.mjs';
import {registerSceneGroups} from './services/scene-groups.mjs';
import {prepareMacros} from './services/macros.mjs';
import * as armyBuilder from './services/army-builder.mjs';
import {registerModelIdentities} from './services/model-identity.mjs';
import * as actions from './services/actions.mjs';
import * as costs from './services/costs.mjs';
import * as lineOfSight from './services/line-of-sight.mjs';
import * as rolls from './services/rolls.mjs';
import * as manualRolls from './services/manual-rolls.mjs';
import {registerTokenArt} from './services/token-art.mjs';
import * as groups from './services/groups.mjs';
import * as modelChoices from './services/model-choices.mjs';
import {registerActorDirectoryHierarchy} from './applications/actor-directory.mjs';
import {prepareCatalogue} from './services/catalogue.mjs';
import {profiles} from './services/group-profiles.mjs';
const SID='boltaction';
const modelTypes=['model','modelStatic','modelVehicle'];
function activeGM(){return game.user.isGM&&(!game.users?.activeGM||game.users.activeGM.id===game.user.id);}
Hooks.once('init',()=>{
 registerActorDirectoryHierarchy();
 registerSceneGroups();registerTokenArt();
 game.settings.register(SID,'battleRound',{scope:'world',config:false,type:Number,default:1});
 registerModelIdentities();
 game.settings.register(SID,'catalogueFolderVersion',{scope:'world',config:false,type:String,default:''});
 CONFIG.Actor.documentClass=BoltActor;
 Object.assign(CONFIG.Actor.dataModels,{army:ArmyData,unit:UnitData,model:ModelData,modelStatic:StaticModelData,modelVehicle:VehicleModelData});
 Object.assign(CONFIG.Item.dataModels,{weapon:WeaponData,trait:TraitData,faction:FactionData,selector:SelectorData});
 foundry.documents.collections.Actors.registerSheet(SID,BoltActorSheet,{types:['army','unit',...modelTypes],makeDefault:true,label:'Team, squad and model sheets'});
 foundry.documents.collections.Items.registerSheet(SID,BoltItemSheet,{types:['weapon','trait','faction','selector'],makeDefault:true,label:'Bolt Action profile'});
 game.boltaction={apiVersion:1,actions,openArmyBuilder,...actions,prepareMacros,...groups,...modelChoices,...armyBuilder,...costs,...rolls,...manualRolls,...lineOfSight,profiles,prepareCatalogue,importStarter:prepareCatalogue};
});
Hooks.once('ready',async()=>{
 if(activeGM())for(const squad of game.actors)if(squad.type==='unit')await groups.ensureInfantryLeader(squad);
 if(activeGM())for(const squad of game.actors){if(squad.type!=='unit'||squad.system.identity&&squad.system.identity!=='Unnamed Squad')continue;const vehicle=squad.members?.find(m=>m.type==='modelVehicle');if(vehicle)await squad.update({'system.identity':vehicle.system.profileName||vehicle.name},{render:false});}
 if(activeGM()&&game.settings.get(SID,'catalogueFolderVersion')!=='alpha22'){
  try{await prepareCatalogue();await prepareMacros();for(const actor of game.actors)if(actor.type==='unit'){if(!actor.system.profileName)await actor.update({'system.identity':actor.name.replace(/^(Inexperienced|Regular|Veteran)\s+/i,'')||'Unnamed Squad','system.profileName':actor.getFlag?.(SID,'sourceName')||''});await groups.setSquadExperience(actor,actor.system.quality||'regular');}for(const actor of game.actors)if(modelTypes.includes(actor.type)&&['nco','loader'].includes(actor.system.role))await actor.update({'system.isNco':actor.system.role==='nco','system.isLoader':actor.system.role==='loader'});await game.settings.set(SID,'catalogueFolderVersion','alpha22');}catch(error){console.error('Bolt Action compendium preparation',error);ui.notifications.error(`Could not prepare model compendiums: ${error.message}`);}
 }
 if(activeGM())for(const actor of game.actors){if(!modelTypes.includes(actor.type)||actor.system.profileName)continue;const source=actor.getFlag?.(SID,'sourceName')||actor.name;const original=actor.getFlag?.(SID,'sourceName');const generic=Boolean(original)&&(actor.name===original||actor.name===original.replace(/squad|section/gi,'model'));await actor.update({'system.profileName':source,...(generic?{name:actor.type==='model'?'Unnamed Soldier':actor.type==='modelStatic'?'Unnamed Crew':'Unnamed Vehicle'}:{})});}

});
Hooks.on('preCreateActor',(actor,source)=>{
 if(modelTypes.includes(source.type)&&!source.system?.profileName)actor.updateSource({'system.profileName':source.name||'Infantry'});
 if(modelTypes.includes(source.type))actor.updateSource({'system.isNco':source.system?.isNco??source.system?.role==='nco','system.isLoader':source.system?.isLoader??source.system?.role==='loader'});
 const icon=source.type==='army'?'army':source.type==='unit'?'unit':source.type==='modelVehicle'?'vehicle-token':'soldier';
 actor.updateSource({img:source.img||`systems/${SID}/assets/${icon}.svg`,prototypeToken:{actorLink:true,texture:{src:source.prototypeToken?.texture?.src||`systems/${SID}/assets/${source.type==='modelVehicle'?'vehicle-token':modelTypes.includes(source.type)?'model-token':icon}.svg?v=13`},sight:{enabled:false}}});
});
Hooks.on('renderActorDirectory',(app,html)=>{
 if(!game.user.isGM)return;
 const root=html instanceof HTMLElement?html:app.element;
 if(!root||root.querySelector('[data-prepare-models]'))return;
 const button=document.createElement('button');button.type='button';button.dataset.prepareModels='true';button.textContent='Prepare model compendiums';
 button.addEventListener('click',()=>prepareCatalogue().catch(e=>ui.notifications.error(e.message)));
 (root.querySelector('.directory-footer')??root).append(button);
});
Hooks.on('updateActor',(actor,changes,options)=>{
 if(options.boltactionOwnership||options.boltactionOwnershipSync||!activeGM()||!['army','unit'].includes(actor.type))return;
 if(changes.ownership)void groups.syncGroupOwnership(actor).catch(e=>ui.notifications.error(e.message));
});
// Refresh only related open group sheets; the edited document owns its own render lifecycle.
const pendingGroupRefresh=new Map();
function refreshRelated(document,changes={},options={}){
 if(document?.isToken || options.boltactionAutoName)return;
 const actor=document?.documentName==='Item'?document.parent:document;
 if(!actor||actor.documentName!=='Actor')return;
 const members=new Set([(['army','unit'].includes(actor.type)?actor.uuid:null),actor.system?.unitUuid,actor.system?.armyUuid,actor.unit?.system?.armyUuid].filter(Boolean));
 for(const uuid of members){const group=game.actors.get?.(uuid.split('.').pop())??Array.from(game.actors).find(a=>a.uuid===uuid);if(!group)continue;
 for(const app of Object.values(group.apps??{})){if(!(app instanceof BoltActorSheet)||!app.rendered)continue;clearTimeout(pendingGroupRefresh.get(app));pendingGroupRefresh.set(app,setTimeout(()=>{pendingGroupRefresh.delete(app);if(app.refreshLive)void app.refreshLive();else app.render({force:false});},120));}}
}
for(const event of ['createActor','updateActor','deleteActor','createItem','updateItem','deleteItem'])Hooks.on(event,refreshRelated);

Hooks.on('preUpdateActor',(actor,changes)=>{if(modelTypes.includes(actor.type)&&typeof changes.name==='string')changes['prototypeToken.name']=changes.name.trim()||'Unnamed Soldier';});

Hooks.on('preUpdateActor',(actor,changes)=>{
 if(actor.type!=='unit'||actor.pack)return;
 const identity=changes['system.identity']??changes.system?.identity??actor.system.identity??'Unnamed Squad';
 const quality=changes['system.quality']??changes.system?.quality??actor.system.quality;
 const generated=groups.squadDisplayName(identity,quality);
 if(generated!==actor.name||typeof changes.name==='string')changes.name=generated;
});
Hooks.on('preCreateActor',(actor,source)=>{
 if(source.type!=='unit'||actor.pack)return;
 const identity=source.system?.identity || source.name || 'Unnamed Squad';
 actor.updateSource({'system.identity':identity,name:groups.squadDisplayName(identity,source.system?.quality)});
});

Hooks.on('preUpdateActor',(actor,changes)=>{if(!modelTypes.includes(actor.type)||changes['system.role']!==undefined||changes.system?.role!==undefined||['officer','observer','medic'].includes(actor.system.role))return;const nco=changes['system.isNco']??changes.system?.isNco,loader=changes['system.isLoader']??changes.system?.isLoader;if(nco!==undefined)changes['system.role']=nco?'nco':(actor.system.isLoader?'loader':'rifleman');if(loader!==undefined)changes['system.role']=loader?'loader':(actor.system.isNco?'nco':'rifleman');});

Hooks.on('preUpdateActor',(actor,changes)=>{if(!modelTypes.includes(actor.type))return;for(const [flag,role]of [['isMedic','medic'],['isObserver','observer']]){const value=changes['system.'+flag]??changes.system?.[flag];if(value===true)changes['system.role']=role;else if(value===false&&actor.system.role===role)changes['system.role']=actor.system.isNco?'nco':actor.system.isLoader?'loader':'rifleman';}});
