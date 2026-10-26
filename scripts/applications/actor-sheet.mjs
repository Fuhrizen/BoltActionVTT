import {ask, safely} from './dialogs.mjs';
import {factionAppearance} from '../services/faction-appearance.mjs';
const {HandlebarsApplicationMixin} = foundry.applications.api;
const modelTypes = ['model', 'modelStatic', 'modelVehicle'];
const isNco = actor => Boolean(actor.system?.isNco || actor.system?.role === 'nco' || actor.getFlag?.('boltaction','isNco') || actor.flags?.boltaction?.isNco || actor.flags?.boltaction?.nco);
const labels = {army:'Army',unit:'Squad',model:'Infantry model',modelStatic:'Static model',modelVehicle:'Vehicle model'};
const priceLabel = choice => choice.costLabel ?? (Number.isFinite(choice.cost)?`${choice.cost>=0?'+':''}${choice.cost} pts`:'Cost unverified');
function equipmentSlots(choices) {
  const primary=(choices?.equipment??[]).filter(c=>c.kind==='primary').map(c=>({...c,label:`${c.label} · ${priceLabel(c)}`}));
  return [...new Set(primary.map(c=>c.slot||'primary'))].map(slot=>{const entries=primary.filter(c=>(c.slot||'primary')===slot);return {label:slot==='primary'?'Weapon':slot.replace('mount:','').replaceAll('-',' '),choices:entries.some(c=>c.selected)?entries:[{id:'',label:'Choose a weapon',selected:true},...entries]};});
}
const nodeKey = node => node.nodeType===1 ? node.getAttribute('data-roster-card') || node.getAttribute('data-builder-squad') || (node.hasAttribute('data-model-uuid') ? `${node.tagName}:${node.getAttribute('data-model-uuid')}:${node.getAttribute('data-model-flag')||node.getAttribute('data-choice-id')||node.getAttribute('data-vehicle-state')||node.getAttribute('data-roster-primary')||'identity'}` : null) : null;
/** Update changed content in place; keep focused controls and keyed roster cards alive. */
export function morphSheetNode(current,next,active=current.ownerDocument?.activeElement) {
  if(current.nodeType!==next.nodeType || current.nodeName!==next.nodeName){current.replaceWith(next.cloneNode(true));return;}
  if(current.nodeType===3){if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;return;}
  if(current.nodeType!==1)return;
  const preserveOpen=current.tagName==='DETAILS'?current.open:null;
  const preserveValue=current===active&&['INPUT','SELECT','TEXTAREA'].includes(current.tagName)?current.value:null;
  const preserveSearch=current.hasAttribute('data-catalogue-search')?current.value:null;
  for(const name of current.getAttributeNames())if(!next.hasAttribute(name)&&!(name==='open'&&preserveOpen!==null))current.removeAttribute(name);
  for(const name of next.getAttributeNames())if(!(name==='open'&&preserveOpen!==null)&&current.getAttribute(name)!==next.getAttribute(name))current.setAttribute(name,next.getAttribute(name));
  if(current===active&&current.tagName==='SELECT')return;
  const keyed=new Map(Array.from(current.childNodes).map(n=>[nodeKey(n),n]).filter(([key])=>key));
  for(let index=0;index<next.childNodes.length;index++){
    const desired=next.childNodes[index],key=nodeKey(desired);
    let child=key?keyed.get(key):current.childNodes[index];
    if(child&&key&&current.childNodes[index]!==child)current.insertBefore(child,current.childNodes[index]??null);
    if(!child || (!key&&nodeKey(child)) || child.nodeName!==desired.nodeName){current.insertBefore(desired.cloneNode(true),current.childNodes[index]??null);continue;}
    morphSheetNode(child,desired,active);
  }
  while(current.childNodes.length>next.childNodes.length)current.lastChild.remove();
  if(preserveValue!==null)current.value=preserveValue;
  if(preserveOpen!==null)current.open=preserveOpen;
  if(preserveSearch!==null)current.value=preserveSearch;
  else if(current!==active && ['INPUT','SELECT','TEXTAREA'].includes(current.tagName)){
    if(current.value!==next.value)current.value=next.value;
    if(current.tagName==='INPUT')current.checked=next.checked;
  }
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
  static DEFAULT_OPTIONS = {classes:['boltaction','ba-sheet','actor-sheet','group-sheet'],position:{width:760,height:700},form:{submitOnChange:true},actions:{openMember:this.openMember,removeMember:this.removeMember,createSquad:this.createSquad,chooseFaction:this.chooseFaction,prepareCatalogue:this.prepareCatalogue,openItem:this.openItem,rollAttack:this.rollAttack,openSquad:this.openSquad,addModel:this.addModel,deleteModel:this.deleteModel,addArmySquad:this.addArmySquad,openArmyBuilder:this.openArmyBuilder,nextBattleRound:this.nextBattleRound,markMovement:this.markMovement,resetAction:this.resetAction,checkMorale:this.checkMorale,issueOrder:this.issueOrder}};
  static PARTS = {main:{template:'systems/boltaction/templates/actor-sheet.hbs'}};
  get isArmyBuilder(){return false;}
  async _prepareContext(options) {
    const context = await super._prepareContext(options), actor = this.actor;
    const isTeam = actor.type === 'army', isSquad = actor.type === 'unit', isModel = modelTypes.includes(actor.type);
    const inherited = await globalThis.game?.boltaction?.profiles?.(actor);
    const cost=await globalThis.game?.boltaction?.calculateCost?.(actor);
    const legality=isTeam?await game.boltaction.validateArmy?.(actor):null;
    const reportMessage=entry=>typeof entry==='string'?entry:entry.message??entry.label??entry.reason??entry.name??'Review this entry';
    const legalityErrors=(legality?.errors??[]).map(reportMessage),legalityWarnings=(legality?.warnings??[]).map(reportMessage);
    const legalityPassed=Boolean(legality?.valid&&!legalityErrors.length&&!(cost?.unknown??[]).length);
    const orders=['fire','advance','run','ambush','rally','down'].map(value=>({value,label:value[0].toUpperCase()+value.slice(1),selected:actor.system.order===value}));
    const ownTraits=new Set((actor.items??[]).filter(i=>i.type==='trait'));
    const ruleProfiles=(inherited?.traits??[]).map(i=>({name:i.name,effect:i.system?.effect,notes:i.system?.notes,source:ownTraits.has(i)?'Owned':(actor.system.traitUuids??[]).includes(i.uuid)?'Profile':(inherited?.squad?.system.traitUuids??[]).includes(i.uuid)?'Inherited squad':'Inherited faction'}));
    const weaponActors=isSquad?[actor,...(actor.members??[]).filter(m=>m.visible!==false)]:isModel?[actor,...(actor.unit?[actor.unit]:[])]:[actor];
    const seenWeaponTraits=new Set();
    for(const owner of weaponActors)for(const weapon of (owner.items??[]).filter(item=>item.type==='weapon'))for(const slug of weapon.system?.traits??[]){
      const key=`${weapon.uuid??weapon.id??weapon.name}:${slug}`;if(seenWeaponTraits.has(key))continue;seenWeaponTraits.add(key);
      const reference=(game.items??[]).find(item=>item.type==='trait'&&(item.system?.slug===slug||item.flags?.boltaction?.catalogueSlug===slug));
      ruleProfiles.push({name:reference?.name??String(slug).replaceAll('-',' '),effect:reference?.system?.effect??'Resolve this weapon trait using the rulebook.',notes:reference?.system?.notes??'',source:`${owner===actor?'Weapon':'Inherited weapon'}: ${weapon.name}${owner!==actor?` · ${owner.name}`:''}`});
    }
    const factionSlug=inherited?.faction?.system?.slug || inherited?.faction?.getFlag?.('boltaction','catalogueSlug') || actor.getFlag?.('boltaction','factionSlug');
    const factionColor=factionAppearance(factionSlug,actor.type).color;
    const summary = isTeam || isSquad ? await globalThis.game?.boltaction?.groupSummary?.(actor) : null;
    const parent = isModel ? actor.unit : isSquad ? actor.army : null;
    const editable=actor.isOwner&&!actor.pack&&!isModel;
    const rosterActors=actor.pack&&isSquad?(actor.getFlag?.('boltaction','memberTemplates')??actor.flags?.boltaction?.memberTemplates??[]):(summary?.members??actor.members??[]);
    const memberContext=async m=>{
      const gear=modelTypes.includes(m.type)?await game.boltaction.getModelChoices?.(m):null;
      return {uuid:m.uuid,name:m.name,img:m.img,type:labels[m.type]??m.type,dead:Boolean(m.system?.dead),isNco:isNco(m),isLoader:Boolean(m.system?.isLoader||m.system?.role==='loader'),isMedic:Boolean(m.system?.isMedic||m.system?.role==='medic'),isInfantry:m.type==='model',isVehicle:m.type==='modelVehicle',count:m.members?.filter(c=>c.visible!==false).length??0,primarySlots:equipmentSlots(gear),optionalChoices:(gear?.equipment??[]).filter(c=>c.kind!=='primary').map(c=>({...c,costLabel:priceLabel(c)})),manualOptions:gear?.manualOptions??[],weapons:(m.items??[]).filter(i=>i.type==='weapon').map(i=>i.name).join(', '),vehicleStates:['immobilised','onFire','turretJammed','stunned','engineDamage','knockedOut'].map(value=>({value,label:value.replace(/([A-Z])/g,' $1').toLowerCase(),selected:(m.system?.vehicleStates??[]).includes(value)}))};

    };
    const members=await Promise.all(rosterActors.filter(m=>m.visible!==false).map(memberContext));
    const armyCatalogue=isTeam&&this.isArmyBuilder&&actor.isOwner&&!actor.pack?await game.boltaction.armyBuilderCatalogue?.(actor)??[]:[];
    const catalogueGroups=[...new Set(armyCatalogue.map(row=>row.kind))].map(kind=>({label:kind,entries:armyCatalogue.filter(row=>row.kind===kind)}));
    const armySquads=isTeam&&this.isArmyBuilder?await Promise.all(rosterActors.filter(s=>s.visible!==false&&s.type==='unit').map(async squad=>({uuid:squad.uuid,name:squad.name,identity:squad.system.identity||'Unnamed Squad',nationalAllowance:Boolean(squad.system.nationalAllowance),extraModelCost:(await game.boltaction.squadBuilderLimits?.(squad))?.extraModelCost??(squad.getFlag?.('boltaction','profile')??squad.flags?.boltaction?.profile)?.extraModelPoints,pins:squad.system.pins??0,editable:editable&&squad.isOwner,cost:await game.boltaction.calculateCost?.(squad),qualities:['inexperienced','regular','veteran'].map(value=>({value,label:value,selected:squad.system.quality===value})),members:await Promise.all((squad.members??[]).filter(m=>m.visible!==false).map(memberContext))}))):[];
    const sourceProfile=actor.getFlag?.('boltaction','profile')??actor.flags?.boltaction?.profile??{};
    const sourceOptions=(sourceProfile.options??[]).map(o=>({label:o.label??o.name??(o.weaponSlug??o.option??o.variant??'Profile option').replaceAll('-',' ')}));
    const choices = isModel ? await globalThis.game?.boltaction?.getModelChoices?.(actor) : null;
    const primary = (choices?.equipment ?? []).filter(c=>c.kind==='primary');
    const primarySlots = [...new Set(primary.map(c=>c.slot || 'primary'))].map(slot=>({label:slot==='primary'?'Weapon':slot.replace('mount:','').replaceAll('-',' '),choices:primary.filter(c=>(c.slot || 'primary')===slot)}));
    for (const slot of primarySlots) if (!slot.choices.some(choice=>choice.selected)) slot.choices=[{id:'',label:'Choose a weapon',selected:true},...slot.choices];
    const squadKind = isSquad ? (game.boltaction.getSquadKind?.(actor) ?? actor.system.squadKind ?? 'infantry') : '';
    const incompatible = isSquad && (summary?.members ?? actor.members ?? []).some(m=>squadKind==='infantry'?m.type!=='model':!['modelStatic','modelVehicle'].includes(m.type));
    return {...context,extraModelCost:isSquad?(await game.boltaction.squadBuilderLimits?.(actor))?.extraModelCost:null,isArmyBuilder:this.isArmyBuilder,legality,legalityPassed,legalityErrors,legalityWarnings,orders,actionState:actor.system.actionState||actor.system.order||'Awaiting order',armySquads,catalogueGroups,sourceProfile,sourceOptions,editable,cost,costUnknown:(cost?.unknown??[]).map(entry=>typeof entry==='string'?entry:entry.label??entry.message??entry.reason??entry.name??'Unresolved cost'),isInfantry:actor.type==='model',isLoader:Boolean(actor.system.isLoader || actor.system.role==='loader'),isNco:isNco(actor),squadIdentity:actor.system.identity || 'Unnamed Squad',factionColor,inheritedExperience:isModel&&Boolean(actor.unit),experienceLabel:actor.unit?.system?.quality || actor.system.quality,squadQualities:['inexperienced','regular','veteran'].map(value=>({value,label:value,selected:actor.system.quality===value})),profileName:actor.system.profileName || actor.getFlag?.('boltaction','sourceName') || actor.name,actor,system:actor.system,isGM:globalThis.game?.user?.isGM ?? false,isTeam,isSquad,isModel,isStatic:actor.type==='modelStatic',isVehicle:actor.type==='modelVehicle',kindLabel:labels[actor.type] ?? actor.type,parent:parent?.visible===false?null:parent,members,
      modelCount:actor.pack&&isSquad?members.length:summary?.modelCount ?? (isSquad?members.length:0),squadCount:summary?.squadCount ?? (isTeam?members.length:0),
      factionName:inherited?.faction?.name ?? 'Choose a faction',ruleProfiles,
      qualities:choices?.experiences?.length?choices.experiences:['inexperienced','regular','veteran'].map(value=>({value,label:value,selected:actor.system.quality===value})),
      choices,primarySlots,optionalChoices:(choices?.equipment ?? []).filter(c=>c.kind!=='primary'),incompatible,
      squadKinds:[{value:'infantry',label:'Infantry squad',selected:squadKind==='infantry'},{value:'vehicleStatic',label:'Vehicle / static squad',selected:squadKind==='vehicleStatic'}],
      weapons:(actor.items ?? []).filter(i=>i.type==='weapon').map(i=>({id:i.id,name:i.name,range:i.system.range,shots:i.system.shots,quantity:i.system.quantity ?? 1}))};
  }
  async _onRender(context, options) {
    await super._onRender(context, options);
    this._bindControls(context);
  }
  _bindControls(context) {
    this._builderListeners?.abort();
    if (!context.editable) return;
    this._builderListeners=new AbortController();
    const signal=this._builderListeners.signal;
    const content = this.element.querySelector('.ba-sheet');
    content?.addEventListener('dragover', event => event.preventDefault(),{signal});
    content?.addEventListener('drop', event => {event.preventDefault();void safely(()=>this._handleDrop(event));},{signal});
    const change = (selector, callback) => content?.querySelectorAll(selector).forEach(input=>input.addEventListener('change',event=>{
      event.stopPropagation();
      void safely(()=>callback(input));
    },{signal}));
    change('[data-squad-kind]',input=>game.boltaction.setSquadKind(this.actor,input.value));
    change('[data-squad-experience]',input=>game.boltaction.setSquadExperience(this.actor,input.value));
    change('[data-pins]',async input=>game.boltaction.setPins(await this._builderSquad(input.dataset.squadUuid),Number(input.value)));
    change('[data-national-allowance]',async input=>(await this._builderSquad(input.dataset.squadUuid)).update({'system.nationalAllowance':input.checked},{render:false}));
    change('[data-builder-quality]',async input=>game.boltaction.setSquadExperience(await this._builderSquad(input.dataset.squadUuid),input.value));
    change('[data-builder-identity]',async input=>(await this._builderSquad(input.dataset.squadUuid)).update({'system.identity':input.value.trim()||'Unnamed Squad'},{render:false}));
    content?.querySelector('[data-catalogue-search]')?.addEventListener('input',event=>{const query=event.target.value.toLowerCase().trim();content.querySelectorAll('[data-catalogue-entry]').forEach(row=>{row.hidden=!row.textContent.toLowerCase().includes(query);});},{signal});
    for(const selector of ['[data-model-identity]','[data-model-flag]','[data-roster-primary]','[data-roster-option]','[data-vehicle-state]'])change(selector,input=>this._updateRosterField(input));
  }
  async refreshLive() {
    if(this._liveRefresh){this._liveRefreshAgain=true;return this._liveRefresh;}
    this._liveRefresh=(async()=>{
      do {
        this._liveRefreshAgain=false;
        const root=this.element?.querySelector('.ba-sheet');if(!root)return;
        const context=await this._prepareContext({});
        const html=await foundry.applications.handlebars.renderTemplate(BoltActorSheet.PARTS.main.template,context);
        const template=root.ownerDocument.createElement('template');template.innerHTML=html.trim();
        const next=template.content.firstElementChild;if(!next)return;
        const scrolls=[this.element,...this.element.querySelectorAll('*')].filter(e=>e.scrollTop||e.scrollLeft).map(e=>({e,top:e.scrollTop,left:e.scrollLeft}));
        morphSheetNode(root,next);
        this._bindControls(context);
        const search=root.querySelector('[data-catalogue-search]');if(search?.value){const query=search.value.toLowerCase().trim();root.querySelectorAll('[data-catalogue-entry]').forEach(row=>{row.hidden=!row.textContent.toLowerCase().includes(query);});}
        for(const {e,top,left} of scrolls){e.scrollTop=top;e.scrollLeft=left;}
      }while(this._liveRefreshAgain);
    })();
    try{return await this._liveRefresh;}finally{this._liveRefresh=null;}
  }
  async _processSubmitData(event,form,submitData,options={}) {
    const result=await super._processSubmitData(event,form,submitData,{...options,render:false});
    await this.refreshLive();return result;
  }
  async _builderSquad(uuid=this.actor.uuid) {
    if(!this.actor.isOwner||this.actor.pack)throw new Error('Choose an owned world army or squad.');
    const squad=uuid===this.actor.uuid?this.actor:await fromUuid(uuid);
    if(!squad?.isOwner||squad.pack||squad.type!=='unit')throw new Error('Choose an owned world squad.');
    if(this.actor.type==='army'&&(!(this.actor.system.unitUuids??[]).includes(squad.uuid)||squad.system.armyUuid!==this.actor.uuid))throw new Error('This squad is outside the army.');
    if(this.actor.type!=='army'&&squad.uuid!==this.actor.uuid)throw new Error('This squad is outside the builder.');
    return squad;
  }
  async _rosterMember(uuid) {
    const member=await fromUuid(uuid);
    if(!member?.isOwner||member.pack)throw new Error('This model is not an owned member of the squad.');
    if(this.actor.type==='unit'&&member.system?.unitUuid!==this.actor.uuid)throw new Error('This model is not an owned member of the squad.');
    const squad=await this._builderSquad(member.system?.unitUuid);
    if(!(squad.system.modelUuids??[]).includes(uuid))throw new Error('This model is not an owned member of the squad.');
    return member;
  }
  async _updateRosterField(input) {
    const member=await this._rosterMember(input.dataset.modelUuid);
    if(input.dataset.modelIdentity!==undefined)return member.update({name:input.value.trim()||'Unnamed Soldier'});
    if(input.dataset.modelFlag){const key=input.dataset.modelFlag;if(!['isNco','isLoader','isMedic','dead'].includes(key))throw new Error('Unknown model flag.');return member.update({[`system.${key}`]:input.checked});}
    if(input.dataset.rosterPrimary!==undefined){if(!input.value)return;return game.boltaction.applyModelChoice(member,{choiceId:input.value,enabled:true});}
    if(input.dataset.rosterOption!==undefined)return game.boltaction.applyModelChoice(member,{choiceId:input.dataset.choiceId,enabled:input.checked});
    if(input.dataset.vehicleState){if(member.type!=='modelVehicle'||!['immobilised','onFire','turretJammed','stunned','engineDamage','knockedOut'].includes(input.dataset.vehicleState))throw new Error('Unknown vehicle state.');const states=new Set(member.system.vehicleStates??[]);if(input.checked)states.add(input.dataset.vehicleState);else states.delete(input.dataset.vehicleState);return member.update({'system.vehicleStates':[...states]});}
  }
  async _handleDrop(event) {
    if (!this.actor.isOwner) throw new Error('You do not own this group.');
    let data;try {data=JSON.parse(event.dataTransfer.getData('text/plain'));}catch{return;}
    if (data.type==='Actor' && data.uuid) {
      if(this.actor.type==='unit') {const child=await fromUuid(data.uuid);return child?.pack?game.boltaction.importModel(this.actor,child):game.boltaction.linkGroupMember(this.actor,child);}
      if(this.actor.type==='army') {const child=await fromUuid(data.uuid);return child?.pack?game.boltaction.importSquad(this.actor,child):game.boltaction.linkGroupMember(this.actor,child);}
      throw new Error('Drop models into a squad, or squads into an Army.');
    }
    if(data.type==='Item') throw new Error('Choose equipment from this model’s profile options.');
  }

  static async openMember(_event,target){return safely(async()=>{const actor=await fromUuid(target.dataset.uuid);if(actor?.visible!==false)await actor?.sheet.render({force:true});});}
  static async removeMember(event,target){return safely(async()=>{if(!this.actor.isOwner)throw new Error('You do not own this group.');if(event.shiftKey){const member=await fromUuid(target.dataset.uuid);if(!member?.isOwner||member.pack)throw new Error('You do not own this model.');await game.boltaction.deleteGroupActor(member);}else await game.boltaction.unlinkGroupMember(this.actor,target.dataset.uuid);});}
  static async createSquad(){return safely(async()=>{const values=await ask('Create a squad',[{name:'name',label:'Squad name',value:'Unnamed Squad'},{name:'squadKind',label:'Squad type',options:[{value:'infantry',label:'Infantry squad'},{value:'vehicleStatic',label:'Vehicle / static squad'}]}]);if(values){const squad=await game.boltaction.createGroup(this.actor,values);squad.sheet.render({force:true});}});}
  static async chooseFaction(){return safely(async()=>{const entries=await factions();const values=await ask('Army faction',[{name:'uuid',label:'Faction',selected:this.actor.system.factionUuid,options:[{value:'',label:'No faction'},...entries.map(i=>({value:i.uuid,label:i.name}))]}],'This faction is inherited by every squad and model in the Army.');if(values)await game.boltaction.setTeamFaction(this.actor,values.uuid);});}
  static async prepareCatalogue(){return safely(()=>game.boltaction.prepareCatalogue());}
  static async openItem(_event,target){this.actor.items.get(target.dataset.id)?.sheet.render({force:true});}
  static async rollAttack(_event,target){return safely(async()=>game.boltaction.confirmShooting(await this._builderSquad(target?.dataset?.squadUuid)));}
  static async openArmyBuilder(){return openArmyBuilder(this.actor);}
  static async nextBattleRound(){return safely(()=>game.boltaction.nextBattleRound());}
  static async markMovement(){return safely(()=>game.boltaction.recordMovement(this.actor));}
  static async resetAction(){return safely(()=>game.boltaction.resetSquadAction(this.actor));}
  static async checkMorale(){return safely(()=>game.boltaction.checkSquadMorale(this.actor));}
  static async issueOrder(_event,target){return safely(async()=>{
    const squad=await this._builderSquad(target.dataset.squadUuid);
    const action=game.boltaction.actions?.issueOrder??game.boltaction.issueOrder;
    if(!action)throw new Error('Order actions are unavailable.');
    return action(squad,target.dataset.order);
  });}
  static async openSquad(){return this.actor.unit?.sheet.render({force:true});}
  static async addModel(_event,target){return safely(async()=>game.boltaction.addSquadMember(await this._builderSquad(target?.dataset?.squadUuid)));}
  static async addArmySquad(_event,target){return safely(()=>game.boltaction.addArmySquad(this.actor,target.dataset.slug));}
  static async deleteModel(_event,target){return safely(async()=>{const model=await this._rosterMember(target.dataset.uuid);const squad=await fromUuid(model.system.unitUuid);await game.boltaction.validateSquadRemoval(squad,model);return game.boltaction.deleteGroupActor(model);});}
}

/** A separate document window keeps roster construction out of the Army summary sheet. */
export class BoltArmyBuilder extends BoltActorSheet {
  static DEFAULT_OPTIONS={...BoltActorSheet.DEFAULT_OPTIONS,id:'boltaction-army-builder-{id}',position:{width:1060,height:820},window:{title:'Army Builder'}};
  get isArmyBuilder(){return true;}
  get title(){return `${this.actor?.name??'Army'} — Army Builder`;}
}
export async function openArmyBuilder(army) {
  if(army?.type!=='army'||army.visible===false)throw new Error('Choose an available Army.');
  const existing=Object.values(army.apps??{}).find(app=>app instanceof BoltArmyBuilder);
  const builder=existing??new BoltArmyBuilder({document:army,id:`boltaction-army-builder-${army.id}`});
  return builder.render({force:true});
}
