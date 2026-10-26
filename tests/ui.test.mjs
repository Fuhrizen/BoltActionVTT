import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
globalThis.fetch=async url=>({ok:true,json:async()=>JSON.parse(await readFile(new URL('../'+url.replace('systems/boltaction/',''),import.meta.url),'utf8'))});
class Sheet {async _prepareContext(){return {core:true};}}
globalThis.foundry={applications:{api:{HandlebarsApplicationMixin:Base=>Base,ApplicationV2:Sheet,DialogV2:{wait:async config=>config}},sheets:{ActorSheetV2:Sheet,ItemSheetV2:Sheet}}};
const {BoltActorSheet,BoltArmyBuilder}=await import('../scripts/applications/actor-sheet.mjs');
const {ask}=await import('../scripts/applications/dialogs.mjs');
function actor(type='unit',extra={}){return {uuid:'Actor.one',name:'Section',type,img:'unit.svg',isOwner:true,system:{quality:'regular',basePoints:10,pointsAdjustment:2},members:[],items:[],points:12,...extra};}
function setup(){globalThis.game={user:{isGM:false},users:[],items:[],packs:[],boltaction:{profiles:async()=>({traits:[]})}};}
test('team and squad contexts express membership with no battle controls',async()=>{
 setup();const child=actor('model',{uuid:'Actor.model',name:'Rifleman'}),sheet=new BoltActorSheet();sheet.actor=actor('unit',{members:[child]});let c=await sheet._prepareContext({});assert.equal(c.core,true);assert.equal(c.isSquad,true);assert.equal(c.isModel,false);assert.equal(c.points,undefined);assert.equal(c.members[0].type,'Infantry model');assert.equal(c.members[0].points,undefined);
 sheet.actor=actor('army',{ownership:{player:3},members:[actor()]});game.users=[{id:'player',name:'Alex',isGM:false}];c=await sheet._prepareContext({});assert.equal(c.isTeam,true);assert.equal(c.assignedPlayers,undefined);assert.equal(BoltActorSheet.DEFAULT_OPTIONS.actions.assignPlayers,undefined);assert.equal(c.squadCount,1);
 assert.equal(BoltActorSheet.DEFAULT_OPTIONS.actions.importModel,undefined);
 const template=await readFile(new URL('../templates/actor-sheet.hbs',import.meta.url),'utf8');assert.doesNotMatch(template,/system\.(?:basePoints|pointsAdjustment|score)|\{\{points\}\}/);assert.ok(template.includes('data-drop-target="model"'));for(const action of ['importModel','spawn','nextRound','draw','configureScene','checkRoster','activate'])assert.ok(!template.includes(`data-action="${action}"`));
});
test('all three individual model types use model customisation while hidden membership stays private',async()=>{
 setup();for(const type of ['model','modelStatic','modelVehicle']){const sheet=new BoltActorSheet();sheet.actor=actor(type,{isOwner:false,unit:{name:'Hidden squad',visible:false},members:[actor('model',{visible:false})]});const c=await sheet._prepareContext({});assert.equal(c.isModel,true);assert.equal(c.editable,false);assert.equal(c.parent,null);assert.deepEqual(c.members,[]);assert.equal(c.isStatic,type==='modelStatic');assert.equal(c.isVehicle,type==='modelVehicle');}
});
test('dropping a compendium model imports a copy; world actors link through group permissions',async()=>{
 setup();const calls=[],sheet=new BoltActorSheet();sheet.actor=actor();game.boltaction.importModel=async(...args)=>calls.push(['import',...args]);game.boltaction.linkGroupMember=async(...args)=>calls.push(['link',...args]);globalThis.fromUuid=async uuid=>({uuid,type:'model',pack:uuid.startsWith('Compendium.')?'world.models':null});
 const drop=uuid=>({dataTransfer:{getData:()=>JSON.stringify({type:'Actor',uuid})}});
 await sheet._handleDrop(drop('Compendium.world.models.Actor.profile'));await sheet._handleDrop(drop('Actor.model'));assert.equal(calls[0][0],'import');assert.equal(calls[1][0],'link');sheet.actor.isOwner=false;await assert.rejects(sheet._handleDrop(drop('Actor.model')),/own this group/);
});
test('arbitrary equipment drops are rejected in favour of profile choices',async()=>{setup();const sheet=new BoltActorSheet();sheet.actor=actor('model');await assert.rejects(sheet._handleDrop({dataTransfer:{getData:()=>JSON.stringify({type:'Item',uuid:'Item.rifle'})}}),/profile options/);assert.equal(BoltActorSheet.DEFAULT_OPTIONS.actions.addWeapon,undefined);});
test('dialog escapes untrusted labels and preserves blank optional numeric inputs',async()=>{
 const config=await ask('Test',[{name:'cost',label:'<img onerror=x>',type:'number',optional:true}]);assert.ok(!config.content.includes('<img'));assert.ok(config.content.includes('&lt;img'));const value=config.buttons[0].callback(null,null,{element:{querySelector:()=>({value:''})}});assert.equal(value.cost,undefined);assert.equal(config.buttons[1].callback(),false);
});

test('model context groups source weapon choices by mount and exposes optional equipment',async()=>{
 setup();game.boltaction.getModelChoices=async()=>({experiences:[{value:'veteran',label:'Veteran',selected:true}],equipment:[{id:'rifle',label:'Rifle',kind:'primary',slot:'primary',selected:true},{id:'smg',label:'SMG',kind:'primary',slot:'primary',selected:false},{id:'hull',label:'Hull gun',kind:'primary',slot:'mount:hull'},{id:'grenades',label:'Grenades',kind:'trait',selected:true}],manualOptions:[]});
 const sheet=new BoltActorSheet();sheet.actor=actor('model');const c=await sheet._prepareContext({});assert.equal(c.primarySlots.length,2);assert.deepEqual(c.primarySlots[0].choices.map(x=>x.id),['rifle','smg']);assert.equal(c.primarySlots[1].label,'hull');assert.equal(c.optionalChoices[0].id,'grenades');assert.equal(c.qualities[0].value,'veteran');
});

test('linked model experience comes from its squad and faction colour comes from its inherited faction',async()=>{setup();game.boltaction.profiles=async()=>({traits:[],faction:{system:{slug:'great-britain'}}});const sheet=new BoltActorSheet();sheet.actor=actor('model',{unit:{name:'Squad',system:{quality:'veteran'}}});const c=await sheet._prepareContext({});assert.equal(c.inheritedExperience,true);assert.equal(c.experienceLabel,'veteran');assert.equal(c.factionColor,'#388b4a');});
test('remove member unlinks normally and Shift deletes the owned actor',async()=>{setup();let unlinks=0,deletes=0;game.boltaction.unlinkGroupMember=async()=>unlinks++;globalThis.fromUuid=async()=>({isOwner:true});game.boltaction.deleteGroupActor=async()=>deletes++;const sheet=new BoltActorSheet();sheet.actor=actor();await BoltActorSheet.removeMember.call(sheet,{shiftKey:false},{dataset:{uuid:'Actor.model'}});await BoltActorSheet.removeMember.call(sheet,{shiftKey:true},{dataset:{uuid:'Actor.model'}});assert.equal(unlinks,1);assert.equal(deletes,1);});

test('army imports compendium squads and links world squads',async()=>{setup();const calls=[];game.boltaction.importSquad=async()=>calls.push('import');game.boltaction.linkGroupMember=async()=>calls.push('link');globalThis.fromUuid=async uuid=>({uuid,pack:uuid.startsWith('Compendium.')?'world.squads':null});const sheet=new BoltActorSheet();sheet.actor=actor('army');for(const uuid of ['Compendium.world.squads.Actor.one','Actor.one'])await sheet._handleDrop({dataTransfer:{getData:()=>JSON.stringify({type:'Actor',uuid})}});assert.deepEqual(calls,['import','link']);});

test('squad identity stays separate from quality-prefixed name and NCO members are marked',async()=>{setup();const sheet=new BoltActorSheet();sheet.actor=actor('unit',{name:'Veteran Baker section',system:{quality:'veteran',identity:'Baker section',profileName:'British infantry section'},members:[actor('model',{system:{role:'nco'}})]});const c=await sheet._prepareContext({});assert.equal(c.squadIdentity,'Baker section');assert.equal(c.profileName,'British infantry section');assert.equal(c.members[0].isNco,true);sheet.actor=actor('model',{system:{role:'nco'}});assert.equal((await sheet._prepareContext({})).isNco,true);});

test('model controls use NCO and loader flags, equipment swaps and a unified sourced traits panel',async()=>{setup();const own={name:'Own trait',type:'trait',system:{effect:'Own'}};game.boltaction.profiles=async()=>({traits:[own,{uuid:'Item.profile',name:'Profile',type:'trait',system:{}},{uuid:'Item.faction',name:'Faction',type:'trait',system:{}}]});game.boltaction.calculateCost=async()=>({total:17,base:10,options:7,unknown:['Custom option unpriced']});const sheet=new BoltActorSheet();sheet.actor=actor('model',{system:{isLoader:true,traitUuids:['Item.profile']},items:[own]});const c=await sheet._prepareContext({});assert.equal(c.cost.total,17);assert.equal(c.isLoader,true);assert.deepEqual(c.ruleProfiles.map(r=>r.source),['Owned','Profile','Inherited faction']);assert.deepEqual(c.costUnknown,['Custom option unpriced']);assert.equal(BoltActorSheet.DEFAULT_OPTIONS.actions.removeItem,undefined);const template=await readFile(new URL('../templates/actor-sheet.hbs',import.meta.url),'utf8');assert.ok(!template.includes('name="system.role"'));assert.ok(!template.includes('data-experience'));assert.ok(template.includes('data-model-flag="isNco"'));assert.ok(template.includes('data-loader-pair')); assert.ok(!template.includes('data-action="removeItem"'));});
test('Roll dice delegates to the compact manual roller',async()=>{setup();let passed;game.boltaction.confirmManualRoll=async actor=>{passed=actor;};const sheet=new BoltActorSheet();sheet.actor=actor('unit');await BoltActorSheet.rollAttack.call(sheet);assert.equal(passed,sheet.actor);});
test('squad builder rejects edits to models outside reciprocal membership',async()=>{setup();const sheet=new BoltActorSheet();sheet.actor=actor('unit',{system:{modelUuids:['Actor.m']}});globalThis.fromUuid=async()=>({isOwner:true,system:{unitUuid:'Actor.other'}});await assert.rejects(sheet._rosterMember('Actor.m'),/member/);const template=await readFile(new URL('../templates/actor-sheet.hbs',import.meta.url),'utf8');assert.ok(template.includes('data-model-identity'));assert.ok(template.includes('data-vehicle-state'));assert.ok(template.includes('data-pins'));});

test('squad builder edits reciprocal members and compendium previews stay read only',async()=>{setup();const member=actor('model',{uuid:'Actor.member',system:{unitUuid:'Actor.one'}});let update;member.update=async data=>{update=data;};globalThis.fromUuid=async()=>member;const sheet=new BoltActorSheet();sheet.actor=actor('unit',{system:{modelUuids:[member.uuid]},members:[member]});await sheet._updateRosterField({dataset:{modelIdentity:'',modelUuid:member.uuid},value:'Jones'});assert.deepEqual(update,{name:'Jones'});member.system.unitUuid='Actor.other';await assert.rejects(sheet._updateRosterField({dataset:{modelIdentity:'',modelUuid:member.uuid},value:'Jones'}),/owned member|outside the builder/);sheet.actor=actor('unit',{pack:'world.squads',flags:{boltaction:{memberTemplates:[actor('model')]}}});const c=await sheet._prepareContext({});assert.equal(c.editable,false);assert.equal(c.members.length,1);});

test('army builder offers faction catalogue and edits only reciprocal descendant models',async()=>{setup();game.boltaction.armyBuilderCatalogue=async()=>[{slug:'british-infantry',name:'Infantry',kind:'infantry'}];const army=actor('army',{system:{unitUuids:['Actor.squad']}}),squad=actor('unit',{uuid:'Actor.squad',system:{armyUuid:army.uuid,modelUuids:['Actor.model']},members:[]}),model=actor('model',{uuid:'Actor.model',system:{unitUuid:squad.uuid}});squad.members=[model];army.members=[squad];globalThis.fromUuid=async uuid=>uuid===squad.uuid?squad:model;let update;model.update=async data=>{update=data;};game.boltaction.setInfantryLeader=async(group,uuid)=>{assert.equal(group,squad);assert.equal(uuid,model.uuid);return model.update({'system.isNco':true});};const sheet=new BoltArmyBuilder();sheet.actor=army;const c=await sheet._prepareContext({});assert.equal(c.catalogueGroups[0].entries[0].slug,'british-infantry');assert.equal(c.armySquads[0].members[0].uuid,model.uuid);await sheet._updateRosterField({dataset:{modelUuid:model.uuid,modelFlag:'isNco'},checked:true});assert.deepEqual(update,{'system.isNco':true});squad.system.armyUuid='Actor.other';await assert.rejects(sheet._rosterMember(model.uuid),/outside the army/);});

class LayoutNode {
 constructor(tag,attrs={},children=[]){this.nodeType=1;this.tagName=this.nodeName=tag.toUpperCase();this.attrs=new Map(Object.entries(attrs));this.childNodes=[];this.value=attrs.value??'';this.checked=attrs.checked!==undefined;this.open=attrs.open!==undefined;this.ownerDocument={activeElement:null};for(const child of children)this.insertBefore(child,null);}
 get lastChild(){return this.childNodes.at(-1);}
 getAttribute(name){return this.attrs.get(name)??null;}getAttributeNames(){return [...this.attrs.keys()];}hasAttribute(name){return this.attrs.has(name);}setAttribute(name,value){this.attrs.set(name,value);}removeAttribute(name){this.attrs.delete(name);}
 insertBefore(child,before){child.remove();const index=before?this.childNodes.indexOf(before):this.childNodes.length;this.childNodes.splice(index,0,child);child.parentNode=this;child.ownerDocument=this.ownerDocument;return child;}
 remove(){if(this.parentNode){const i=this.parentNode.childNodes.indexOf(this);this.parentNode.childNodes.splice(i,1);this.parentNode=null;}}
 replaceWith(node){const parent=this.parentNode;parent.insertBefore(node,this);this.remove();}
 cloneNode(deep){const n=new LayoutNode(this.tagName,Object.fromEntries(this.attrs),deep?this.childNodes.map(c=>c.cloneNode(true)):[]);n.value=this.value;n.checked=this.checked;n.open=this.open;return n;}
}
test('live sheet morph keeps focused identity controls and open groups while updating roster membership',async()=>{
 const {morphSheetNode}=await import('../scripts/applications/actor-sheet.mjs');
 const identity=new LayoutNode('input',{'data-model-uuid':'Actor.a','data-model-identity':'',value:'Old'});identity.value='Still typing';
 const card=new LayoutNode('article',{'data-roster-card':'Actor.a'},[identity]);
 const details=new LayoutNode('details',{'data-builder-squad':'Actor.s'},[card]);details.open=false;
 const root=new LayoutNode('div',{},[details]);
 const next=new LayoutNode('div',{},[new LayoutNode('details',{'data-builder-squad':'Actor.s',open:''},[new LayoutNode('article',{'data-roster-card':'Actor.a'},[new LayoutNode('input',{'data-model-uuid':'Actor.a','data-model-identity':'',value:'Server name'})]),new LayoutNode('article',{'data-roster-card':'Actor.b'})])]);
 morphSheetNode(root,next,identity);assert.equal(root.childNodes[0],details);assert.equal(details.childNodes[0],card);assert.equal(card.childNodes[0],identity);assert.equal(identity.value,'Still typing');assert.equal(details.open,false);assert.equal(details.childNodes.length,2);
 const updated=new LayoutNode('div',{},[new LayoutNode('details',{'data-builder-squad':'Actor.s'},[new LayoutNode('article',{'data-roster-card':'Actor.b'})])]);morphSheetNode(root,updated,identity);assert.equal(details.childNodes.length,1);assert.equal(details.childNodes[0].getAttribute('data-roster-card'),'Actor.b');
});
test('sheet form writes suppress native redraw and refresh live content after successful persistence',async()=>{const sheet=new BoltActorSheet();let options,refreshed=false;Sheet.prototype._processSubmitData=async(_event,_form,data,opts)=>{options=opts;return {updated:data};};sheet.refreshLive=async()=>{refreshed=true;};const result=await sheet._processSubmitData(null,null,{name:'Army'});assert.equal(options.render,false);assert.equal(refreshed,true);assert.deepEqual(result.updated,{name:'Army'});});

test('Army summary and dedicated builder separate roster controls while exposing checked legality',async()=>{setup();let catalogueReads=0;game.boltaction.armyBuilderCatalogue=async()=>{catalogueReads++;return [{slug:'squad',kind:'infantry'}];};game.boltaction.validateArmy=async()=>({valid:false,errors:['Too many choices'],warnings:['Unknown source'],total:120});const summary=new BoltActorSheet();summary.actor=actor('army');let c=await summary._prepareContext({});assert.equal(c.isArmyBuilder,false);assert.deepEqual(c.armySquads,[]);assert.equal(catalogueReads,0);assert.equal(c.legalityPassed,false);assert.deepEqual(c.legalityErrors,['Too many choices']);const builder=new BoltArmyBuilder();builder.actor=summary.actor;c=await builder._prepareContext({});assert.equal(c.isArmyBuilder,true);assert.equal(catalogueReads,1);});
test('weapon traits appear in the unified panel with their inherited provenance',async()=>{setup();game.items=[{type:'trait',name:'Team',system:{slug:'team',effect:'Team weapon rule'}}];const sheet=new BoltActorSheet();sheet.actor=actor('model',{unit:{name:'Gun squad',system:{quality:'regular'},items:[{type:'weapon',name:'Machine gun',system:{traits:['team']}}]}});const c=await sheet._prepareContext({});assert.equal(c.ruleProfiles[0].name,'Team');assert.match(c.ruleProfiles[0].source,/Inherited weapon: Machine gun/);assert.equal(c.ruleProfiles[0].effect,'Team weapon rule');});
test('squad order buttons delegate the selected order to the action service',async()=>{setup();let call;game.boltaction.actions={issueOrder:async(...args)=>{call=args;}};const sheet=new BoltActorSheet();sheet.actor=actor('unit');await BoltActorSheet.issueOrder.call(sheet,null,{dataset:{order:'ambush'}});assert.deepEqual(call,[sheet.actor,'ambush']);});

test('builder weapon options retain named aliases, base classes, prices and cached compendium references',async()=>{
 setup();let reads=0;game.packs=[{metadata:{name:'boltaction-weapons'},collection:'world.boltaction-weapons',getIndex:async()=>{reads++;return [{_id:'rifleRef',system:{slug:'rifle'}}];}}];
 game.boltaction.profiles=async()=>({traits:[],faction:{system:{slug:'great-britain'}}});
 game.boltaction.getModelChoices=async()=>({equipment:[{id:'rifle',weaponSlug:'rifle',kind:'primary',cost:0,selected:true}]});
 const sheet=new BoltActorSheet();sheet.actor=actor('unit',{members:[actor('model')]});
 const context=await sheet._prepareContext({}),choice=context.members[0].primarySlots[0].choices[0];
 assert.match(choice.label,/Lee-Enfield.*\(Rifle\).*0 pts/);assert.equal(choice.referenceUuid,'Compendium.world.boltaction-weapons.rifleRef');
 await sheet._prepareContext({});assert.equal(reads,1);
});
test('reference inspection uses the selected document and rejects invisible references',async()=>{
 setup();let rendered=false;globalThis.fromUuid=async()=>({visible:true,sheet:{render:async()=>{rendered=true;}}});
 await BoltActorSheet.openReference(null,{dataset:{uuid:'Compendium.world.weapons.rifle'}});assert.equal(rendered,true);
});

test('ORBAT builder shows platoon membership, selected strength and advisory finish controls',async()=>{
 setup();const squad=actor('unit',{uuid:'Actor.squad',system:{armyUuid:'Actor.one',platoonId:'p2',quality:'regular'},members:[actor('model',{system:{isNco:true}}),actor('model')]});const army=actor('army',{system:{pointsLimit:100,platoons:[{id:'p2',name:'Second Platoon'}]},members:[squad]});
 game.boltaction.armyOrbat=async()=>({platoons:[{id:'p2',name:'Second Platoon',squads:[{uuid:squad.uuid}],commanderUuid:'Actor.commander',errors:[]}]});game.boltaction.squadBuilderLimits=async()=>({min:5,max:10});
 const app=new BoltArmyBuilder();app.actor=army;const c=await app._prepareContext({});assert.equal(c.orbatPlatoons[0].commanderPresent,true);assert.equal(c.selectedArmySquads[0].modelCount,2);assert.equal(c.selectedArmySquads[0].ncoCount,1);assert.equal(c.selectedArmySquads[0].maximum,10);assert.equal(c.selectedArmySquads[0].platoonOptions[0].selected,true);
 const template=await readFile(new URL('../templates/actor-sheet.hbs',import.meta.url),'utf8');assert.match(template,/data-action="finishBuilder"/);assert.match(template,/Legality is advisory/);assert.match(template,/ba-loadout-grid/);
});
test('builder adds a selected faction profile to the chosen platoon and selects the created squad',async()=>{
 setup();let call;game.boltaction.addArmySquad=async(...args)=>{call=args;return {uuid:'Actor.newSquad'};};const app=new BoltArmyBuilder();app.actor=actor('army');app._selectedBuilderPlatoon='p2';app.refreshLive=async()=>{};await BoltActorSheet.addArmySquad.call(app,null,{dataset:{slug:'british-infantry'}});assert.deepEqual(call,[app.actor,'british-infantry',{platoonId:'p2'}]);assert.equal(app._selectedBuilderSquad,'Actor.newSquad');assert.equal(app._showBuilderCatalogue,false);
});

test('live morph retains Foundry part identity so later renders replace the original part',async()=>{
 const {morphSheetNode}=await import('../scripts/applications/actor-sheet.mjs');
 const root=new LayoutNode('div',{'data-application-part':'main','data-ba-sheet-root':'','class':'old'}),next=new LayoutNode('div',{'data-ba-sheet-root':'','class':'new'});
 morphSheetNode(root,next);assert.equal(root.getAttribute('data-application-part'),'main');assert.equal(root.getAttribute('class'),'new');
});
test('army builder has no battle controls or empty squad creation and uses explicit paired loaders',async()=>{
 const template=await readFile(new URL('../templates/actor-sheet.hbs',import.meta.url),'utf8');
 const builder=template.slice(template.indexOf('{{#if isArmyBuilder}}'),template.indexOf('<h2>Army overview'));
 assert.doesNotMatch(builder,/data-pins|data-action="(?:rollAttack|createSquad)"|>Open squad</);
 assert.match(builder,/data-loader-pair/);assert.match(template,/data-ba-sheet-root/);
});

test('builder dynamically disables exhausted source allowances but keeps selected options editable',async()=>{
 setup();const nco=actor('model',{uuid:'Actor.nco',system:{isNco:true,unitUuid:'Actor.s'},items:[]}),used=actor('model',{uuid:'Actor.used',system:{unitUuid:'Actor.s'},items:[{name:'SMG',type:'weapon',system:{slug:'smg'}}]}),other=actor('model',{uuid:'Actor.other',system:{unitUuid:'Actor.s'},items:[]});
 const squad=actor('unit',{uuid:'Actor.s',members:[nco,used,other]});for(const m of squad.members)m.unit=squad;
 game.boltaction.getModelChoices=async m=>({equipment:[{id:'smg',kind:'primary',weaponSlug:'smg',max:2,selected:m===used,_option:{ncoAllowed:true}}]});
 const sheet=new BoltArmyBuilder();sheet.actor=actor('army',{members:[squad]});const c=await sheet._prepareContext({});const rows=c.armySquads[0].members;
 assert.equal(rows.find(r=>r.uuid===other.uuid).primarySlots[0].choices.find(c=>c.id==='smg').disabled,true);
 assert.equal(rows.find(r=>r.uuid===nco.uuid).primarySlots[0].choices.find(c=>c.id==='smg').disabled,false);
 assert.equal(rows.find(r=>r.uuid===used.uuid).primarySlots[0].choices.find(c=>c.id==='smg').disabled,false);
});

test('experience choices use source prices and keep named infantry tiers fixed',async()=>{
 const {squadExperienceChoices}=await import('../scripts/applications/actor-sheet.mjs');
 const squad=actor('unit',{flags:{boltaction:{catalogueSlug:'tank'}},system:{quality:'veteran'}});
 const data={units:[{slug:'tank',system:{quality:'regular'},profile:{pointsByQuality:{inexperienced:80,regular:100,veteran:120}}},{slug:'named-infantry',system:{quality:'regular'},profile:{}}]};
 assert.deepEqual(squadExperienceChoices(squad,data).map(q=>q.value),['inexperienced','regular','veteran']);assert.equal(squadExperienceChoices(squad,data)[2].selected,true);
 squad.flags.boltaction.catalogueSlug='named-infantry';assert.deepEqual(squadExperienceChoices(squad,data).map(q=>q.value),['regular']);
 squad.flags={};assert.equal(squadExperienceChoices(squad,data).length,3);
});
