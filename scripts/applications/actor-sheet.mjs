import {ask, safely} from './dialogs.mjs';
import {factionAppearance} from '../services/faction-appearance.mjs';
const {HandlebarsApplicationMixin} = foundry.applications.api;
const modelTypes = ['model', 'modelStatic', 'modelVehicle'];
const isNco = actor => Boolean(actor.system?.isNco || actor.system?.role === 'nco' || actor.getFlag?.('boltaction','isNco') || actor.flags?.boltaction?.isNco || actor.flags?.boltaction?.nco);
const labels = {army:'Army',unit:'Squad',model:'Infantry model',modelStatic:'Static model',modelVehicle:'Vehicle model'};
function equipmentSlots(choices) {
  const primary=(choices?.equipment??[]).filter(c=>c.kind==='primary');
  return [...new Set(primary.map(c=>c.slot||'primary'))].map(slot=>{const entries=primary.filter(c=>(c.slot||'primary')===slot);return {label:slot==='primary'?'Weapon':slot.replace('mount:','').replaceAll('-',' '),choices:entries.some(c=>c.selected)?entries:[{id:'',label:'Choose a weapon',selected:true},...entries]};});
}
async function factions() {
  const entries = (game.items ?? []).filter(i => i.type === 'faction' && i.visible !== false);
  for (const pack of game.packs ?? []) {
    if (pack.metadata?.name !== 'boltaction-factions' || pack.visible === false) continue;
    entries.push(...await pack.getDocuments());
  }
  return [...new Map(entries.map(i => [i.uuid, i])).values()];
}
export class BoltActorSheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
  static DEFAULT_OPTIONS = {classes:['boltaction','ba-sheet','actor-sheet','group-sheet'],position:{width:760,height:700},form:{submitOnChange:true},actions:{openMember:this.openMember,removeMember:this.removeMember,createSquad:this.createSquad,chooseFaction:this.chooseFaction,prepareCatalogue:this.prepareCatalogue,openItem:this.openItem,rollAttack:this.rollAttack,openSquad:this.openSquad,addModel:this.addModel,deleteModel:this.deleteModel}};
  static PARTS = {main:{template:'systems/boltaction/templates/actor-sheet.hbs'}};
  async _prepareContext(options) {
    const context = await super._prepareContext(options), actor = this.actor;
    const isTeam = actor.type === 'army', isSquad = actor.type === 'unit', isModel = modelTypes.includes(actor.type);
    const inherited = await globalThis.game?.boltaction?.profiles?.(actor);
    const cost=await globalThis.game?.boltaction?.calculateCost?.(actor);
    const ownTraits=new Set((actor.items??[]).filter(i=>i.type==='trait'));
    const ruleProfiles=(inherited?.traits??[]).map(i=>({name:i.name,effect:i.system?.effect,notes:i.system?.notes,source:ownTraits.has(i)?'Owned':(actor.system.traitUuids??[]).includes(i.uuid)?'Profile':(inherited?.squad?.system.traitUuids??[]).includes(i.uuid)?'Inherited squad':'Inherited faction'}));
    const factionSlug=inherited?.faction?.system?.slug || inherited?.faction?.getFlag?.('boltaction','catalogueSlug') || actor.getFlag?.('boltaction','factionSlug');
    const factionColor=factionAppearance(factionSlug,actor.type).color;
    const summary = isTeam || isSquad ? await globalThis.game?.boltaction?.groupSummary?.(actor) : null;
    const parent = isModel ? actor.unit : isSquad ? actor.army : null;
    const editable=actor.isOwner&&!actor.pack&&!isModel;
    const members=await Promise.all((summary?.members??actor.members??[]).filter(m=>m.visible!==false).map(async m=>{
      const gear=isSquad?await game.boltaction.getModelChoices?.(m):null;
      return {uuid:m.uuid,name:m.name,img:m.img,type:labels[m.type]??m.type,dead:Boolean(m.system?.dead),isNco:isNco(m),isLoader:Boolean(m.system?.isLoader||m.system?.role==='loader'),isMedic:Boolean(m.system?.isMedic||m.system?.role==='medic'),isInfantry:m.type==='model',isVehicle:m.type==='modelVehicle',count:m.members?.filter(c=>c.visible!==false).length??0,primarySlots:equipmentSlots(gear),optionalChoices:(gear?.equipment??[]).filter(c=>c.kind!=='primary'),manualOptions:gear?.manualOptions??[],weapons:(m.items??[]).filter(i=>i.type==='weapon').map(i=>i.name).join(', '),vehicleStates:['immobilised','onFire','turretJammed','stunned','engineDamage','knockedOut'].map(value=>({value,label:value.replace(/([A-Z])/g,' $1').toLowerCase(),selected:(m.system?.vehicleStates??[]).includes(value)}))};
    }));
    const sourceProfile=actor.getFlag?.('boltaction','profile')??actor.flags?.boltaction?.profile??{};
    const sourceOptions=(sourceProfile.options??[]).map(o=>({label:o.label??o.name??(o.weaponSlug??o.option??o.variant??'Profile option').replaceAll('-',' ')}));
    const choices = isModel ? await globalThis.game?.boltaction?.getModelChoices?.(actor) : null;
    const primary = (choices?.equipment ?? []).filter(c=>c.kind==='primary');
    const primarySlots = [...new Set(primary.map(c=>c.slot || 'primary'))].map(slot=>({label:slot==='primary'?'Weapon':slot.replace('mount:','').replaceAll('-',' '),choices:primary.filter(c=>(c.slot || 'primary')===slot)}));
    for (const slot of primarySlots) if (!slot.choices.some(choice=>choice.selected)) slot.choices=[{id:'',label:'Choose a weapon',selected:true},...slot.choices];
    const squadKind = isSquad ? (game.boltaction.getSquadKind?.(actor) ?? actor.system.squadKind ?? 'infantry') : '';
    const incompatible = isSquad && (summary?.members ?? actor.members ?? []).some(m=>squadKind==='infantry'?m.type!=='model':!['modelStatic','modelVehicle'].includes(m.type));
    return {...context,sourceProfile,sourceOptions,editable,cost,costUnknown:(cost?.unknown??[]).map(entry=>typeof entry==='string'?entry:entry.label??entry.message??entry.reason??entry.name??'Unresolved cost'),isInfantry:actor.type==='model',isLoader:Boolean(actor.system.isLoader || actor.system.role==='loader'),isNco:isNco(actor),squadIdentity:actor.system.identity || 'Unnamed Squad',factionColor,inheritedExperience:isModel&&Boolean(actor.unit),experienceLabel:actor.unit?.system?.quality || actor.system.quality,squadQualities:['inexperienced','regular','veteran'].map(value=>({value,label:value,selected:actor.system.quality===value})),profileName:actor.system.profileName || actor.getFlag?.('boltaction','sourceName') || actor.name,actor,system:actor.system,isGM:globalThis.game?.user?.isGM ?? false,isTeam,isSquad,isModel,isStatic:actor.type==='modelStatic',isVehicle:actor.type==='modelVehicle',kindLabel:labels[actor.type] ?? actor.type,parent:parent?.visible===false?null:parent,members,
      modelCount:summary?.modelCount ?? (isSquad?members.length:0),squadCount:summary?.squadCount ?? (isTeam?members.length:0),
      factionName:inherited?.faction?.name ?? 'Choose a faction',ruleProfiles,
      qualities:choices?.experiences?.length?choices.experiences:['inexperienced','regular','veteran'].map(value=>({value,label:value,selected:actor.system.quality===value})),
      choices,primarySlots,optionalChoices:(choices?.equipment ?? []).filter(c=>c.kind!=='primary'),incompatible,
      squadKinds:[{value:'infantry',label:'Infantry squad',selected:squadKind==='infantry'},{value:'vehicleStatic',label:'Vehicle / static squad',selected:squadKind==='vehicleStatic'}],
      weapons:(actor.items ?? []).filter(i=>i.type==='weapon').map(i=>({id:i.id,name:i.name,range:i.system.range,shots:i.system.shots,quantity:i.system.quantity ?? 1}))};
  }
  async _onRender(context, options) {
    await super._onRender(context, options);
    if (!context.editable) return;
    const content = this.element.querySelector('.ba-sheet');
    content?.addEventListener('dragover', event => event.preventDefault());
    content?.addEventListener('drop', event => {event.preventDefault();void safely(()=>this._handleDrop(event));});
    const change = (selector, callback) => content?.querySelectorAll(selector).forEach(input=>input.addEventListener('change',event=>{
      event.stopPropagation();
      void safely(async()=>{try {await callback(input);} finally {this.render({force:true});}});
    }));
    change('[data-squad-kind]',input=>game.boltaction.setSquadKind(this.actor,input.value));
    change('[data-squad-experience]',input=>game.boltaction.setSquadExperience(this.actor,input.value));
    change('[data-pins]',input=>game.boltaction.setPins(this.actor,Number(input.value)));
    for(const selector of ['[data-model-identity]','[data-model-flag]','[data-roster-primary]','[data-roster-option]','[data-vehicle-state]'])change(selector,input=>this._updateRosterField(input));
  }
  async _rosterMember(uuid) {
    if(this.actor.type!=='unit'||!this.actor.isOwner||this.actor.pack)throw new Error('Choose an owned world squad.');
    const member=await fromUuid(uuid);
    if(!member?.isOwner||member.pack||member.system?.unitUuid!==this.actor.uuid||!(this.actor.system.modelUuids??[]).includes(uuid))throw new Error('This model is not an owned member of the squad.');
    return member;
  }
  async _updateRosterField(input) {
    const member=await this._rosterMember(input.dataset.modelUuid);
    if(input.dataset.modelIdentity!==undefined)return member.update({name:input.value.trim()||'Unnamed Soldier'});
    if(input.dataset.modelFlag){const key=input.dataset.modelFlag;if(!['isNco','isLoader','isMedic','dead'].includes(key))throw new Error('Unknown model flag.');return member.update({[`system.${key}`]:input.checked});}
    if(input.dataset.rosterPrimary!==undefined){if(!input.value)return;return game.boltaction.applyModelChoice(member,{choiceId:input.value,enabled:true});}
    if(input.dataset.rosterOption!==undefined)return game.boltaction.applyModelChoice(member,{choiceId:input.dataset.choiceId,enabled:input.checked});
    if(input.dataset.vehicleState){const states=new Set(member.system.vehicleStates??[]);if(input.checked)states.add(input.dataset.vehicleState);else states.delete(input.dataset.vehicleState);return member.update({'system.vehicleStates':[...states]});}
  }
  async _handleDrop(event) {
    if (!this.actor.isOwner) throw new Error('You do not own this group.');
    let data;try {data=JSON.parse(event.dataTransfer.getData('text/plain'));}catch{return;}
    if (data.type==='Actor' && data.uuid) {
      if(this.actor.type==='unit') {const child=await fromUuid(data.uuid);return child?.pack?game.boltaction.importModel(this.actor,child):game.boltaction.linkGroupMember(this.actor,child);}
      if(this.actor.type==='army') {const child=await fromUuid(data.uuid);return child?.pack?game.boltaction.importSquad(this.actor,child):game.boltaction.linkGroupMember(this.actor,child);}
      throw new Error('Drop models into a squad, or squads into a Army.');
    }
    if(data.type==='Item') throw new Error('Choose equipment from this model’s profile options.');
  }

  static async openMember(_event,target){return safely(async()=>{const actor=await fromUuid(target.dataset.uuid);if(actor?.visible!==false)await actor?.sheet.render({force:true});});}
  static async removeMember(event,target){return safely(async()=>{if(!this.actor.isOwner)throw new Error('You do not own this group.');if(event.shiftKey){const member=await fromUuid(target.dataset.uuid);if(!member?.isOwner||member.pack)throw new Error('You do not own this model.');await game.boltaction.deleteGroupActor(member);}else await game.boltaction.unlinkGroupMember(this.actor,target.dataset.uuid);});}
  static async createSquad(){return safely(async()=>{const values=await ask('Create a squad',[{name:'name',label:'Squad name',value:'Unnamed Squad'},{name:'squadKind',label:'Squad type',options:[{value:'infantry',label:'Infantry squad'},{value:'vehicleStatic',label:'Vehicle / static squad'}]}]);if(values){const squad=await game.boltaction.createGroup(this.actor,values);squad.sheet.render({force:true});}});}
  static async chooseFaction(){return safely(async()=>{const entries=await factions();const values=await ask('Team faction',[{name:'uuid',label:'Faction',selected:this.actor.system.factionUuid,options:[{value:'',label:'No faction'},...entries.map(i=>({value:i.uuid,label:i.name}))]}],'This faction is inherited by every squad and model in the Army.');if(values)await game.boltaction.setTeamFaction(this.actor,values.uuid);});}
  static async prepareCatalogue(){return safely(()=>game.boltaction.prepareCatalogue());}
  static async openItem(_event,target){this.actor.items.get(target.dataset.id)?.sheet.render({force:true});}
  static async rollAttack(){return safely(async()=>{if(this.actor.type!=='unit'||this.actor.pack)throw new Error('Attacks are made from a world squad.');return game.boltaction.confirmShooting(this.actor);});}
  static async openSquad(){return this.actor.unit?.sheet.render({force:true});}
  static async addModel(){return safely(()=>game.boltaction.addSquadMember(this.actor));}
  static async deleteModel(_event,target){return safely(async()=>game.boltaction.deleteGroupActor(await this._rosterMember(target.dataset.uuid)));}
}
