import {chooseUpgrade} from './roster-upgrade.mjs';
import {ask, attack, safely} from './dialogs.mjs';
const {HandlebarsApplicationMixin} = foundry.applications.api;
export class BoltActorSheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
  static DEFAULT_OPTIONS = {classes:['boltaction','actor-sheet'],position:{width:820,height:760},form:{submitOnChange:true},actions:{tankRun:this.tankRun,upgrade:this.upgrade,callObserver:this.callObserver,resolveObserver:this.resolveObserver,resolveObserverTarget:this.resolveObserverTarget,reserve:this.reserve,outflank:this.outflank,shareRoster:this.shareRoster,checkRoster:this.checkRoster,openProfile:this.openProfile,openMember:this.openMember,removeMember:this.removeMember,linkMember:this.linkMember,addModels:this.addModels,spawn:this.spawn,order:this.order,pin:this.pin,casualty:this.casualty,shoot:this.shoot,assault:this.assault,morale:this.morale,openItem:this.openItem,addWeapon:this.addWeapon,activate:this.activate,retain:this.retain,transport:this.transport,unload:this.unload,editTraits:this.editTraits}};
  static PARTS = {main:{template:'systems/boltaction/templates/actor-sheet.hbs'}};
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const a = this.actor;
    const inherited = await globalThis.game?.boltaction?.profiles?.(a);
    const profile = a.getFlag?.('boltaction','profile');
    const profileSummary = profile ? `${profile.baseModels ?? a.system.startingSize} models: ${profile.basePoints ?? a.system.points} pts; maximum ${profile.maxModels ?? a.system.maxSize}; extra model ${profile.extraModelPoints ?? 'manual'} pts.` : '';
    const upgrades = (profile?.options ?? []).map(option => ({name:(option.weaponSlug || option.option || 'Upgrade').replaceAll('-',' '),details:[option.max != null ? `maximum ${option.max}` : '', option.costEach != null ? `${option.costEach} pts each` : '', option.costPerModel != null ? `${option.costPerModel} pts per model` : '', option.cost != null ? `${option.cost} pts` : '', option.loaderEach ? `${option.loaderEach} loader per weapon` : '', option.subtype || ''].filter(Boolean).join(' · ')}));
    const parent = a.type === 'model' ? a.unit : a.army;
    return {...context,profileSummary,upgrades,factionName:inherited?.faction?.name,ruleProfiles:(inherited?.traits ?? []).map(i=>({uuid:i.uuid,name:i.name,notes:i.system.notes,effect:i.system.effect})),actor:a,system:a.system,editable:a.isOwner,isGM:globalThis.game?.user?.isGM??false,isArmy:a.type==='army',isUnit:a.type==='unit',isModel:a.type==='model',parent:parent?.visible === false ? null : parent,morale:a.morale,damageValue:a.damageValue,side:a.effectiveSide,living:a.livingMembers?.length??0,members:(a.members??[]).filter(m=>m.visible!==false).map(m=>({uuid:m.uuid,name:m.name,img:m.img,type:m.type,dead:m.system.dead,pins:m.system.pins,order:m.system.order,quality:m.system.quality})),weapons:a.items.filter(i=>i.type==='weapon').map(i=>({id:i.id,name:i.name,system:i.system})),deployments:['field','reserve','outflank'].map(value=>({value,selected:a.system.deployment===value})),manualOrders:['','fire','advance','run','ambush','rally','down'].map(value=>({value,label:value||'No order',selected:a.system.order===value})),orders:['fire','advance','run','ambush','rally','down'].map(order=>({order,label:order.toUpperCase(),active:a.system.order===order})),qualities:['inexperienced','regular','veteran'].map(value=>({value,selected:a.system.quality===value})),kinds:['infantry','artillery','vehicle'].map(value=>({value,selected:a.system.kind===value}))};
  }
  async _onRender(context, options) {
    await super._onRender(context, options);
    if (!this.actor.isOwner) return;
    const content = this.element.querySelector('.sheet-content');
    content?.addEventListener('dragover', event => event.preventDefault());
    content?.addEventListener('drop', event => {
      event.preventDefault();
      void safely(async () => {
        let data;
        try { data = JSON.parse(event.dataTransfer.getData('text/plain')); } catch { return; }
        if (data.type === 'Actor' && data.uuid) {
          const actor = await fromUuid(data.uuid);
          if (actor?.pack) throw new Error('Import this actor from its compendium to the world before linking it.');
          await game.boltaction.linkMember(this.actor, actor);
        } else if (data.type === 'Item' && data.uuid && this.actor.type !== 'army') {
          const item = await fromUuid(data.uuid);
          if (!item) throw new Error('Dropped profile is missing.');
          const source = item.toObject();
          delete source._id;
          await this.actor.createEmbeddedDocuments('Item', [source]);
        }
      });
    });
  }
  static async reserve(){return safely(()=>game.boltaction.setReserve(this.actor,{outflank:false}));}
  static async outflank(){return safely(()=>game.boltaction.setReserve(this.actor,{outflank:true}));}
  static async tankRun(){return safely(()=>game.boltaction.order(this.actor,'run',{forceTest:true,modifier:-3}));}
  static async upgrade(){return safely(()=>chooseUpgrade(this.actor));}
  static async callObserver(){return safely(async()=>{const d=await ask('Call off-table support',[{name:'kind',label:'Mission',options:['artillery','smoke','air']},{name:'targetUuid',label:'Target unit UUID (required for air)'},{name:'x',label:'Aim point scene X (pixels)',type:'number',value:0},{name:'y',label:'Aim point scene Y (pixels)',type:'number',value:0},{name:'visible',label:'Observer can see aim point / target',type:'checkbox'}]);if(d)await game.boltaction.callObserver(this.actor,d);});}
  static async resolveObserver(){return safely(()=>game.boltaction.resolveObserver(this.actor));}
  static async resolveObserverTarget(){return safely(async()=>{const d=await ask('Resolve support on a unit',[{name:'targetUuid',label:'Affected unit UUID'},{name:'modelsHit',label:'Unique models under template',type:'number',value:0},{name:'placementConfirmed',label:'Effect area and template placement confirmed',type:'checkbox'},{name:'flakResolved',label:'Air preliminary pins and flak resolved',type:'checkbox'},{name:'building',label:'Target in building',type:'checkbox'},{name:'apply',label:'Apply eligible infantry pins',type:'checkbox'}]);if(d)await game.boltaction.resolveObserverTarget(this.actor,d);});}
  static async shareRoster(){return safely(()=>game.boltaction.shareRoster(this.actor));}
  static async checkRoster(){return safely(()=>game.boltaction.validateArmy(this.actor));}
  static async openProfile(_e,t){return safely(async()=>{const profile=await fromUuid(t.dataset.uuid);profile?.sheet.render({force:true});});}
  static async openMember(_e,t) {const a=await fromUuid(t.dataset.uuid);a?.sheet.render({force:true});}
  static async removeMember(_e,t) {return safely(()=>game.boltaction.unlinkMember(this.actor,t.dataset.uuid));}
  static async linkMember() {return safely(async()=>{const d=await ask('Link a roster member',[{name:'uuid',label:'Actor UUID'}]);if(d){const child=await fromUuid(d.uuid);if(!child)throw new Error('Actor not found.');await game.boltaction.linkMember(this.actor,child);}});}
  static async addModels() {return safely(async()=>{const d=await ask('Add soldiers',[{name:'count',label:'Number of soldiers',type:'number',value:1},{name:'weaponSlug',label:'Weapon catalogue slug',value:'rifle'}]);if(d)await game.boltaction.addModels(this.actor,d);});}
  static async spawn() {return safely(()=>game.boltaction.spawnUnit(this.actor));}
  static async order(_e,t) {return safely(()=>game.boltaction.order(this.actor,t.dataset.order));}
  static async pin(_e,t) {return safely(()=>game.boltaction.addPin(this.actor,Number(t.dataset.delta)));}
  static async casualty(_e,t) {return safely(async()=>{const model=t.dataset.uuid?await fromUuid(t.dataset.uuid):this.actor;await game.boltaction.casualty(model,!model.system.dead);});}
  static async shoot() {return safely(()=>attack(this.actor));}
  static async assault() {return safely(()=>attack(this.actor,true));}
  static async morale() {return safely(async()=>{const d=await ask('Morale test',[{name:'modifier',label:'Situational modifier',type:'number',value:0},{name:'wouldBeDestroyed',label:'Failure would destroy this unit (for faction re-roll)',type:'checkbox'}]);if(d)await game.boltaction.morale(this.actor,d);});}
  static async openItem(_e,t) {this.actor.items.get(t.dataset.id)?.sheet.render({force:true});}
  static async addWeapon() {return safely(()=>this.actor.createEmbeddedDocuments('Item',[{name:'New weapon',type:'weapon'}]));}
  static async activate() {return safely(()=>game.boltaction.activateUnit(this.actor));}
  static async retain() {return safely(()=>game.boltaction.retainOrder(this.actor,true));}
  static async transport() {return safely(async()=>{const d=await ask('Embark transport',[{name:'uuid',label:'Transport unit UUID'}]);if(d)await game.boltaction.setTransport(this.actor,d.uuid);});}
  static async editTraits(){return safely(async()=>{if(!this.actor.isOwner)throw new Error('You do not own this actor.');const d=await ask('Edit unit trait references',[{name:'values',label:'Trait UUIDs, separated by commas',value:(this.actor.system.traitUuids??[]).join(', ')}]);if(d)await this.actor.update({'system.traitUuids':d.values.split(',').map(v=>v.trim()).filter(Boolean)});});}
  static async unload() {return safely(()=>game.boltaction.unloadTransport(this.actor));}
}
