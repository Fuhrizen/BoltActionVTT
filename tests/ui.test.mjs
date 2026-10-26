import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
globalThis.fetch=async url=>({ok:true,json:async()=>JSON.parse(await readFile(new URL('../fvtt/'+url.replace('systems/boltaction/',''),import.meta.url),'utf8'))});
class Sheet {async _prepareContext(){return {core:true};}}
globalThis.foundry={applications:{api:{HandlebarsApplicationMixin:Base=>Base,ApplicationV2:Sheet,DialogV2:{wait:async config=>config}},sheets:{ActorSheetV2:Sheet,ItemSheetV2:Sheet}}};
const {BoltActorSheet}=await import('../fvtt/scripts/applications/actor-sheet.mjs');
const {ask}=await import('../fvtt/scripts/applications/dialogs.mjs');
function actor(type='unit',extra={}){return {uuid:'Actor.one',name:'Section',type,img:'unit.svg',isOwner:true,system:{quality:'regular',basePoints:10,pointsAdjustment:2},members:[],items:[],points:12,...extra};}
function setup(){globalThis.game={user:{isGM:false},users:[],items:[],packs:[],boltaction:{profiles:async()=>({traits:[]})}};}
class LayoutNode {
 constructor(tag,attrs={},children=[]){this.nodeType=1;this.tagName=this.nodeName=tag.toUpperCase();this.attrs=new Map(Object.entries(attrs));this.childNodes=[];this.value=attrs.value??'';this.checked=attrs.checked!==undefined;this.open=attrs.open!==undefined;this.ownerDocument={activeElement:null};for(const child of children)this.insertBefore(child,null);}
 get lastChild(){return this.childNodes.at(-1);}
 getAttribute(name){return this.attrs.get(name)??null;}getAttributeNames(){return [...this.attrs.keys()];}hasAttribute(name){return this.attrs.has(name);}setAttribute(name,value){this.attrs.set(name,value);}removeAttribute(name){this.attrs.delete(name);}
 insertBefore(child,before){child.remove();const index=before?this.childNodes.indexOf(before):this.childNodes.length;this.childNodes.splice(index,0,child);child.parentNode=this;child.ownerDocument=this.ownerDocument;return child;}
 remove(){if(this.parentNode){const i=this.parentNode.childNodes.indexOf(this);this.parentNode.childNodes.splice(i,1);this.parentNode=null;}}
 replaceWith(node){const parent=this.parentNode;parent.insertBefore(node,this);this.remove();}
 cloneNode(deep){const n=new LayoutNode(this.tagName,Object.fromEntries(this.attrs),deep?this.childNodes.map(c=>c.cloneNode(true)):[]);n.value=this.value;n.checked=this.checked;n.open=this.open;return n;}
}
test('team and squad contexts express membership with no battle controls',async()=>{
 setup();const child=actor('model',{uuid:'Actor.model',name:'Rifleman'}),sheet=new BoltActorSheet();sheet.actor=actor('unit',{members:[child]});let c=await sheet._prepareContext({});assert.equal(c.core,true);assert.equal(c.isSquad,true);assert.equal(c.isModel,false);assert.equal(c.points,undefined);assert.equal(c.members[0].type,'Infantry model');assert.equal(c.members[0].points,undefined);
 sheet.actor=actor('army',{ownership:{player:3},members:[actor()]});game.users=[{id:'player',name:'Alex',isGM:false}];c=await sheet._prepareContext({});assert.equal(c.isTeam,true);assert.equal(c.assignedPlayers,undefined);assert.equal(BoltActorSheet.DEFAULT_OPTIONS.actions.assignPlayers,undefined);assert.equal(c.squadCount,1);
 assert.equal(BoltActorSheet.DEFAULT_OPTIONS.actions.importModel,undefined);
 const template=await readFile(new URL('../fvtt/templates/actor-sheet.hbs',import.meta.url),'utf8');assert.doesNotMatch(template,/system\.(?:basePoints|pointsAdjustment|score)|\{\{points\}\}/);assert.ok(!template.includes('data-drop-target="model"'));for(const action of ['importModel','spawn','nextRound','draw','configureScene','checkRoster','activate'])assert.ok(!template.includes(`data-action="${action}"`));
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

test('Foundry is import-only for construction and retains gameplay controls',async()=>{const template=await readFile(new URL('../fvtt/templates/actor-sheet.hbs',import.meta.url),'utf8');assert.match(template,/data-action="importArmy"/);assert.match(template,/data-model-flag="dead"/);for(const action of ['openArmyBuilder','exportArmy','addModel','createSquad','addArmySquad','deleteModel'])assert.ok(!template.includes(`data-action="${action}"`));assert.doesNotMatch(template,/data-roster-primary|data-roster-option|data-squad-experience/);});
test('Roll dice delegates to the compact manual roller',async()=>{setup();let passed;game.boltaction.confirmManualRoll=async actor=>{passed=actor;};const sheet=new BoltActorSheet();sheet.actor=actor('unit');await BoltActorSheet.rollAttack.call(sheet);assert.equal(passed,sheet.actor);});
test('live sheet morph keeps focused identity controls and open groups while updating roster membership',async()=>{
 const {morphSheetNode}=await import('../fvtt/scripts/applications/actor-sheet.mjs');
 const identity=new LayoutNode('input',{'data-model-uuid':'Actor.a','data-model-identity':'',value:'Old'});identity.value='Still typing';
 const card=new LayoutNode('article',{'data-roster-card':'Actor.a'},[identity]);
 const details=new LayoutNode('details',{'data-builder-squad':'Actor.s'},[card]);details.open=false;
 const root=new LayoutNode('div',{},[details]);
 const next=new LayoutNode('div',{},[new LayoutNode('details',{'data-builder-squad':'Actor.s',open:''},[new LayoutNode('article',{'data-roster-card':'Actor.a'},[new LayoutNode('input',{'data-model-uuid':'Actor.a','data-model-identity':'',value:'Server name'})]),new LayoutNode('article',{'data-roster-card':'Actor.b'})])]);
 morphSheetNode(root,next,identity);assert.equal(root.childNodes[0],details);assert.equal(details.childNodes[0],card);assert.equal(card.childNodes[0],identity);assert.equal(identity.value,'Still typing');assert.equal(details.open,false);assert.equal(details.childNodes.length,2);
 const updated=new LayoutNode('div',{},[new LayoutNode('details',{'data-builder-squad':'Actor.s'},[new LayoutNode('article',{'data-roster-card':'Actor.b'})])]);morphSheetNode(root,updated,identity);assert.equal(details.childNodes.length,1);assert.equal(details.childNodes[0].getAttribute('data-roster-card'),'Actor.b');
});
test('sheet form writes suppress native redraw and refresh live content after successful persistence',async()=>{const sheet=new BoltActorSheet();let options,refreshed=false;Sheet.prototype._processSubmitData=async(_event,_form,data,opts)=>{options=opts;return {updated:data};};sheet.refreshLive=async()=>{refreshed=true;};const result=await sheet._processSubmitData(null,null,{name:'Army'});assert.equal(options.render,false);assert.equal(refreshed,true);assert.deepEqual(result.updated,{name:'Army'});});

test('weapon traits appear in the unified panel with their inherited provenance',async()=>{setup();game.items=[{type:'trait',name:'Team',system:{slug:'team',effect:'Team weapon rule'}}];const sheet=new BoltActorSheet();sheet.actor=actor('model',{unit:{name:'Gun squad',system:{quality:'regular'},items:[{type:'weapon',name:'Machine gun',system:{traits:['team']}}]}});const c=await sheet._prepareContext({});assert.equal(c.ruleProfiles[0].name,'Team');assert.match(c.ruleProfiles[0].source,/Inherited weapon: Machine gun/);assert.equal(c.ruleProfiles[0].effect,'Team weapon rule');});
test('squad order buttons delegate the selected order to the action service',async()=>{setup();let call;game.boltaction.actions={issueOrder:async(...args)=>{call=args;}};const sheet=new BoltActorSheet();sheet.actor=actor('unit');await BoltActorSheet.issueOrder.call(sheet,null,{dataset:{order:'ambush'}});assert.deepEqual(call,[sheet.actor,'ambush']);});

test('reference inspection uses the selected document and rejects invisible references',async()=>{
 setup();let rendered=false;globalThis.fromUuid=async()=>({visible:true,sheet:{render:async()=>{rendered=true;}}});
 await BoltActorSheet.openReference(null,{dataset:{uuid:'Compendium.world.weapons.rifle'}});assert.equal(rendered,true);
});

test('live morph retains Foundry part identity so later renders replace the original part',async()=>{
 const {morphSheetNode}=await import('../fvtt/scripts/applications/actor-sheet.mjs');
 const root=new LayoutNode('div',{'data-application-part':'main','data-ba-sheet-root':'','class':'old'}),next=new LayoutNode('div',{'data-ba-sheet-root':'','class':'new'});
 morphSheetNode(root,next);assert.equal(root.getAttribute('data-application-part'),'main');assert.equal(root.getAttribute('class'),'new');
});
test('experience choices use source prices and keep named infantry tiers fixed',async()=>{
 const {squadExperienceChoices}=await import('../fvtt/scripts/applications/actor-sheet.mjs');
 const squad=actor('unit',{flags:{boltaction:{catalogueSlug:'tank'}},system:{quality:'veteran'}});
 const data={units:[{slug:'tank',system:{quality:'regular'},profile:{pointsByQuality:{inexperienced:80,regular:100,veteran:120}}},{slug:'named-infantry',system:{quality:'regular'},profile:{}}]};
 assert.deepEqual(squadExperienceChoices(squad,data).map(q=>q.value),['inexperienced','regular','veteran']);assert.equal(squadExperienceChoices(squad,data)[2].selected,true);
 squad.flags.boltaction.catalogueSlug='named-infantry';assert.deepEqual(squadExperienceChoices(squad,data).map(q=>q.value),['regular']);
 squad.flags={};assert.equal(squadExperienceChoices(squad,data).length,3);
});
