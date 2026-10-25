import {ArmyData,UnitData,ModelData,StaticModelData,VehicleModelData,WeaponData,TraitData,FactionData,SelectorData} from './data/models.mjs';
import {BoltActor} from './documents/actor.mjs';
import {BoltActorSheet} from './applications/actor-sheet.mjs';
import {BoltItemSheet} from './applications/item-sheet.mjs';
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
 game.settings.register(SID,'catalogueFolderVersion',{scope:'world',config:false,type:String,default:''});
 CONFIG.Actor.documentClass=BoltActor;
 Object.assign(CONFIG.Actor.dataModels,{army:ArmyData,unit:UnitData,model:ModelData,modelStatic:StaticModelData,modelVehicle:VehicleModelData});
 Object.assign(CONFIG.Item.dataModels,{weapon:WeaponData,trait:TraitData,faction:FactionData,selector:SelectorData});
 foundry.documents.collections.Actors.registerSheet(SID,BoltActorSheet,{types:['army','unit',...modelTypes],makeDefault:true,label:'Team, squad and model sheets'});
 foundry.documents.collections.Items.registerSheet(SID,BoltItemSheet,{types:['weapon','trait','faction','selector'],makeDefault:true,label:'Bolt Action profile'});
 game.boltaction={...groups,...modelChoices,profiles,prepareCatalogue,importStarter:prepareCatalogue};
});
Hooks.once('ready',async()=>{
 if(activeGM()&&game.settings.get(SID,'catalogueFolderVersion')!=='alpha7'){
  try{await prepareCatalogue();await game.settings.set(SID,'catalogueFolderVersion','alpha7');}catch(error){console.error('Bolt Action compendium preparation',error);ui.notifications.error(`Could not prepare model compendiums: ${error.message}`);}
 }
 if(!game.user.isGM&&game.user.character?.type==='army')game.user.character.sheet.render({force:true});
});
Hooks.on('preCreateActor',(actor,source)=>{
 const icon=source.type==='army'?'army':source.type==='unit'?'unit':source.type==='modelVehicle'?'vehicle-token':'soldier';
 actor.updateSource({img:source.img||`systems/${SID}/assets/${icon}.svg`,prototypeToken:{actorLink:true,texture:{src:source.prototypeToken?.texture?.src||`systems/${SID}/assets/${source.type==='modelVehicle'?'vehicle-token':modelTypes.includes(source.type)?'model-token':icon}.svg`},sight:{enabled:false}}});
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
Hooks.on('updateUser',(user,changes)=>{
 if(user.id===game.user.id&&changes.character&&user.character?.type==='army')user.character.sheet.render({force:true});
});
let refreshTimer;
function refresh(){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{for(const actor of game.actors){for(const app of Object.values(actor.apps??{})){if(app instanceof BoltActorSheet&&app.rendered)app.render({force:true});}}},80);}
for(const event of ['createActor','updateActor','deleteActor','createItem','updateItem','deleteItem'])Hooks.on(event,refresh);
