import test from 'node:test';
import assert from 'node:assert/strict';
import * as groups from '../scripts/services/groups.mjs';
let actors, users, nextId;
function assignPath(target, key, value) {const path = key.split('.'), last = path.pop();let at = target;for (const part of path) at = at[part] ??= {};at[last] = structuredClone(value);}
function mergeData(target, source) {for(const [key,value] of Object.entries(source)){if(value && typeof value==='object' && !Array.isArray(value)) mergeData(target[key] ??= {},value);else target[key]=structuredClone(value);}return target;}
function actor(source = {}) {
  const id = source._id ?? `actor${nextId++}`;
  const doc = {id, uuid:`Actor.${id}`, documentName:'Actor', type:source.type ?? 'model', name:source.name ?? id,
    system:{unitUuids:[], modelUuids:[], unitUuid:'', armyUuid:'', basePoints:0, pointsAdjustment:0, ...structuredClone(source.system ?? {})},
    ownership:structuredClone(source.ownership ?? {default:0,gm:3}), items:structuredClone(source.items ?? []), flags:structuredClone(source.flags ?? {}),
    visible:source.visible ?? true, pack:source.pack,
    get isOwner() {return game.user.isGM || this.ownership[game.user.id] === 3 || this.ownership.default === 3;},
    async update(data, options={}) {
      if (this.failUpdate) {this.failUpdate=false;throw new Error('Injected actor failure');}
      for (const [key,value] of Object.entries(data)) {
        if (['ownership','system','flags'].includes(key) && options.recursive !== false) mergeData(this[key],value);
        else assignPath(this,key,value);
      }
      return this;
    },
    toObject() {return {_id:this.id,name:this.name,type:this.type,system:structuredClone(this.system),ownership:structuredClone(this.ownership),items:structuredClone(this.items),folder:'old-folder',flags:structuredClone(this.flags)};},
    async delete() {actors.splice(actors.indexOf(this),1);}
  };
  actors.push(doc);return doc;
}
function setup() {
  actors=[];nextId=1;
  users=[{id:'p1',character:null,async update(data){if(this.failUpdate){this.failUpdate=false;throw new Error('Injected user failure');}Object.assign(this,data);}}, {id:'p2',character:null,async update(data){Object.assign(this,data);}}];
  globalThis.game={user:{id:'gm',isGM:true,can:()=>true},actors,users};
  globalThis.CONFIG={Actor:{documentClass:{create:async source=>actor(source)}}};
  globalThis.fromUuid=async uuid=>actors.find(doc=>doc.uuid===uuid)??null;
  return {actors,users};
}
test('teams, squads and imported model copies have reciprocal links and inherited permissions',async()=>{
  setup();
  const team=await groups.createTeam({name:'Player One',userIds:['p1']});
  assert.equal(users[0].character,team.id);assert.equal(team.ownership.p1,3);
  const squad=await groups.createGroup(team,{name:'First squad',squadKind:'vehicleStatic'});
  const source=actor({type:'modelVehicle',pack:'world.models',system:{unitUuid:'Actor.old',basePoints:125},items:[{_id:'weapon-id',type:'weapon',system:{cost:5,quantity:2}}]});
  const model=await groups.importModel(squad,source.uuid);
  assert.notEqual(model.id,source.id);assert.equal(model.pack,undefined);
  assert.equal(model.system.unitUuid,squad.uuid);assert.deepEqual(squad.system.modelUuids,[model.uuid]);
  assert.equal(model.ownership.p1,3);assert.equal(model.items[0]._id,undefined);assert.equal(source.items[0]._id,'weapon-id');
  assert.deepEqual(team.system.unitUuids,[squad.uuid]);assert.equal(squad.system.armyUuid,team.uuid);
  assert.equal(groups.groupSummary(team).points,undefined);assert.equal(groups.groupSummary(team).score,undefined);assert.equal(groups.groupSummary(team).modelCount,1);assert.equal(groups.groupSummary(team).squadCount,1);
});
test('assignment preserves existing mixed squads while cascading ownership',async()=>{
  setup();const team=await groups.createTeam({userIds:['p1']});const squad=await groups.createGroup(team);
  for(const type of ['model','modelStatic','modelVehicle']) {const model=actor({type,system:{unitUuid:squad.uuid},ownership:{default:0,p1:3}});squad.system.modelUuids.push(model.uuid);}
  await groups.assignTeam(team,['p2']);
  for(const doc of [team,squad,...actors.filter(a=>a.system.unitUuid===squad.uuid)]){assert.equal(doc.ownership.p1,0);assert.equal(doc.ownership.p2,3);}
  assert.equal(users[0].character,null);assert.equal(users[1].character,team.id);
  assert.equal(groups.groupSummary(team).modelCount,3);
});
test('link and unlink failures restore reciprocal state and do not grant new ownership',async()=>{
  setup();const parent=actor({type:'unit',ownership:{default:0,p1:3}}),child=actor({ownership:{default:0,p2:3}});
  parent.failUpdate=true;
  await assert.rejects(groups.linkGroupMember(parent,child),/Injected/);
  assert.equal(child.system.unitUuid,'');assert.deepEqual(parent.system.modelUuids,[]);assert.equal(child.ownership.p1,undefined);
  await groups.linkGroupMember(parent,child);
  parent.failUpdate=true;await assert.rejects(groups.unlinkGroupMember(parent,child.uuid),/Injected/);
  assert.equal(child.system.unitUuid,parent.uuid);assert.deepEqual(parent.system.modelUuids,[child.uuid]);
});
test('failed player assignment rolls back every actor ownership and previous character',async()=>{
  setup();const team=await groups.createTeam({userIds:['p1']});const squad=await groups.createGroup(team);users[0].failUpdate=true;
  await assert.rejects(groups.assignTeam(team,['p2']),/Injected user/);
  assert.equal(team.ownership.p1,3);assert.equal(team.ownership.p2,0);assert.equal(squad.ownership.p1,3);assert.equal(squad.ownership.p2,0);assert.equal(users[0].character,team.id);assert.equal(users[1].character,null);
});
test('team owners can import and customize faction without permitting cross-owner linking or GM assignment',async()=>{
  setup();const team=await groups.createTeam({userIds:['p1']});const squad=await groups.createGroup(team);
  const faction={uuid:'Item.faction',documentName:'Item',type:'faction'};actors.push(faction);
  game.user={id:'p1',isGM:false,can:()=>true};
  await groups.setTeamFaction(team,faction.uuid);assert.equal(team.system.factionUuid,faction.uuid);
  await assert.rejects(groups.assignTeam(team,['p2']),/GM assigns/);
  const unowned=actor({ownership:{default:0,p2:3}});await assert.rejects(groups.linkGroupMember(squad,unowned),/must own/);
  const source=actor({pack:'world.models',type:'model',ownership:{default:0}});
  const imported=await groups.importModel(squad,source);assert.equal(imported.ownership.p1,3);
  await assert.rejects(groups.linkGroupMember(team,imported),/Armies contain/);
});
test('summary filters hidden children and returns counts without point tracking',async()=>{
  setup();const team=await groups.createTeam();const squad=await groups.createGroup(team);
  await groups.linkGroupMember(squad,actor({system:{basePoints:10,pointsAdjustment:3,dead:true}}));
  await groups.linkGroupMember(squad,actor({visible:false,system:{basePoints:100}}));
  assert.equal(groups.groupSummary(team).points,undefined);assert.equal(groups.groupSummary(team).modelCount,1);
  squad.visible=false;assert.equal(groups.groupSummary(team).points,undefined);assert.equal(groups.groupSummary(team).squadCount,0);
});
test('models have one squad parent and repeated linking stays idempotent',async()=>{
  setup();const first=actor({type:'unit'}),second=actor({type:'unit'}),model=actor();
  await groups.linkGroupMember(first,model);await groups.linkGroupMember(first,model);
  assert.deepEqual(first.system.modelUuids,[model.uuid]);
  await assert.rejects(groups.linkGroupMember(second,model),/already belongs/);
  assert.deepEqual(second.system.modelUuids,[]);assert.equal(model.system.unitUuid,first.uuid);
  await groups.unlinkGroupMember(first,model.uuid);await groups.linkGroupMember(second,model);
  assert.equal(model.system.unitUuid,second.uuid);assert.deepEqual(first.system.modelUuids,[]);
});

test('squad categories reject incompatible links and imports before creating actors',async()=>{
  setup();const team=await groups.createTeam();
  const infantry=await groups.createGroup(team), vehicles=await groups.createGroup(team,{squadKind:'vehicleStatic'});
  assert.equal(infantry.system.squadKind,'infantry');assert.equal(infantry.system.points,undefined);
  const soldier=actor({type:'model'}),gun=actor({type:'modelStatic'}),tank=actor({type:'modelVehicle',pack:'world.models'});
  await groups.linkGroupMember(infantry,soldier);await groups.linkGroupMember(vehicles,gun);
  await assert.rejects(groups.linkGroupMember(infantry,gun),/Infantry squads contain/);
  const before=actors.length;await assert.rejects(groups.importModel(infantry,tank),/Infantry squads contain/);assert.equal(actors.length,before);
  const imported=await groups.importModel(vehicles,tank);assert.equal(imported.system.unitUuid,vehicles.uuid);
  await assert.rejects(groups.linkGroupMember(vehicles,soldier),/Infantry squads contain/);
});
test('changing squad categories requires compatible members and ownership',async()=>{
  setup();const parent=actor({type:'unit',system:{squadKind:'infantry'}});
  await groups.setSquadKind(parent,'vehicleStatic');
  const model=actor({type:'modelVehicle'});await groups.linkGroupMember(parent,model);
  await assert.rejects(groups.setSquadKind(parent,'infantry'),/Unlink incompatible/);
  assert.equal(parent.system.squadKind,'vehicleStatic');
  await assert.rejects(groups.setSquadKind(parent,'unknown'),/Choose an infantry/);
  await groups.unlinkGroupMember(parent,model.uuid);await groups.setSquadKind(parent,'infantry');
  game.user={id:'p1',isGM:false,can:()=>true};
  await assert.rejects(groups.setSquadKind(parent,'vehicleStatic'),/must own/);
});
test('legacy vehicle groups infer their category while mixed groups must be sorted',async()=>{
  setup();const legacy=actor({type:'unit',system:{squadKind:''}});
  const tank=actor({type:'modelVehicle',system:{unitUuid:legacy.uuid}});legacy.system.modelUuids=[tank.uuid];
  assert.equal(groups.getSquadKind(legacy),'vehicleStatic');
  await groups.linkGroupMember(legacy,actor({type:'modelStatic'}));
  const soldier=actor({type:'model',system:{unitUuid:legacy.uuid}});legacy.system.modelUuids.push(soldier.uuid);
  const before=[...legacy.system.modelUuids];
  await assert.rejects(groups.linkGroupMember(legacy,actor({type:'model'})),/incompatible models/);
  assert.deepEqual(legacy.system.modelUuids,before);
  await groups.unlinkGroupMember(legacy,soldier.uuid);await groups.setSquadKind(legacy,'vehicleStatic');
  await groups.linkGroupMember(legacy,actor({type:'modelVehicle'}));
});

test('squad experience updates reciprocal members and is inherited by later imports',async()=>{
  setup();const army=await groups.createTeam({userIds:['p1']});const squad=await groups.createGroup(army);
  const first=actor({system:{quality:'inexperienced'}}),second=actor({system:{quality:'regular'}});
  await groups.linkGroupMember(squad,first);await groups.linkGroupMember(squad,second);
  const unrelated=actor({system:{unitUuid:'Actor.other',quality:'inexperienced'}});
  squad.system.modelUuids.push(unrelated.uuid);
  await groups.setSquadExperience(squad,'veteran');
  for(const member of [squad,first,second])assert.equal(member.system.quality,'veteran');
  assert.equal(unrelated.system.quality,'inexperienced');
  const source=actor({pack:'world.models',system:{quality:'regular'}}),imported=await groups.importModel(squad,source);
  assert.equal(imported.system.quality,'veteran');assert.equal(source.system.quality,'regular');
  await assert.rejects(groups.setSquadExperience(squad,'elite'),/valid squad experience/);
  assert.equal(squad.system.quality,'veteran');
  game.user={id:'p2',isGM:false,can:()=>true};
  await assert.rejects(groups.setSquadExperience(squad,'regular'),/must own/);
});
test('failed squad experience cascades restore every previous individual quality',async()=>{
  setup();const parent=actor({type:'unit',system:{quality:'regular'}});
  const first=actor({system:{quality:'inexperienced',unitUuid:parent.uuid}}),second=actor({system:{quality:'veteran',unitUuid:parent.uuid}});
  parent.system.modelUuids=[first.uuid,second.uuid];second.failUpdate=true;
  await assert.rejects(groups.setSquadExperience(parent,'veteran'),/Injected actor failure/);
  assert.equal(parent.system.quality,'regular');assert.equal(first.system.quality,'inexperienced');assert.equal(second.system.quality,'veteran');
});
test('failed model links restore experience as well as membership and ownership',async()=>{
  setup();const parent=actor({type:'unit',system:{quality:'veteran'}}),child=actor({system:{quality:'inexperienced'}});
  parent.failUpdate=true;
  await assert.rejects(groups.linkGroupMember(parent,child),/Injected actor failure/);
  assert.equal(child.system.quality,'inexperienced');assert.equal(child.system.unitUuid,'');assert.deepEqual(parent.system.modelUuids,[]);
});
test('squad compendium import creates independent model actors with reciprocal links and army ownership',async()=>{
  setup();const army=await groups.createTeam({userIds:['p1']});
  const memberTemplates=[{_id:'template-a',name:'Unnamed Soldier',type:'model',system:{quality:'regular',unitUuid:'Actor.old'},items:[{name:'Rifle',type:'weapon',system:{slug:'rifle'}}]},
    {_id:'template-b',name:'Unnamed Soldier',type:'model',system:{quality:'regular'},items:[]}];
  const source=actor({name:'British infantry',type:'unit',pack:'world.squads',system:{quality:'veteran',squadKind:'infantry'},flags:{boltaction:{memberTemplates}}});
  const before=structuredClone(source.flags);
  const squad=await groups.importSquad(army,source.uuid);
  assert.notEqual(squad.id,source.id);assert.equal(squad.pack,undefined);assert.equal(squad.system.identity,'Unnamed Squad');assert.equal(squad.system.profileName,'British infantry');
  assert.deepEqual(army.system.unitUuids,[squad.uuid]);assert.equal(squad.system.armyUuid,army.uuid);assert.equal(squad.system.quality,'veteran');
  assert.equal(squad.system.modelUuids.length,2);assert.equal(new Set(squad.system.modelUuids).size,2);
  for(const uuid of squad.system.modelUuids){const member=actors.find(a=>a.uuid===uuid);assert.ok(member);assert.equal(member.system.unitUuid,squad.uuid);assert.equal(member.system.quality,'veteran');assert.equal(member.ownership.p1,3);assert.ok(!['template-a','template-b'].includes(member.id));}
  assert.equal(squad.ownership.p1,3);assert.deepEqual(source.flags,before);assert.equal(groups.groupSummary(army).modelCount,2);
  const repeated=await groups.importSquad(army,source);
  assert.equal(repeated.system.modelUuids.some(uuid=>squad.system.modelUuids.includes(uuid)),false);
});
test('failed squad import removes every created actor and restores the army membership',async()=>{
  setup();const army=await groups.createTeam({userIds:['p1']});const existing=await groups.createGroup(army);
  const source=actor({type:'unit',pack:'world.squads',system:{quality:'regular',squadKind:'infantry'},flags:{boltaction:{memberTemplates:[
    {name:'Infantry',type:'model',system:{}},{name:'Incompatible tank',type:'modelVehicle',system:{}}
  ]}}});
  const before=actors.map(a=>a.id);
  await assert.rejects(groups.importSquad(army,source),/Infantry squads contain/);
  assert.deepEqual(actors.map(a=>a.id),before);assert.deepEqual(army.system.unitUuids,[existing.uuid]);
  assert.equal(existing.system.armyUuid,army.uuid);
});
test('squad import rejects missing templates and world squads before creating actors',async()=>{
  setup();const army=await groups.createTeam();
  const world=actor({type:'unit'}),empty=actor({type:'unit',pack:'world.squads',flags:{boltaction:{memberTemplates:[]}}});
  const before=actors.length;
  await assert.rejects(groups.importSquad(army,world),/compendium template/);
  await assert.rejects(groups.importSquad(army,empty),/no model definitions/);
  assert.equal(actors.length,before);assert.deepEqual(army.system.unitUuids,[]);
});
test('squad display names prefix experience while identity remains independent',()=>{
 assert.equal(groups.squadDisplayName('Red Devils','veteran'),'Veteran Red Devils');assert.equal(groups.squadDisplayName('','regular'),'Regular Unnamed Squad');
});
test('deleting a squad deletes its reciprocal models and removes the army reference',async()=>{
 setup();const army=await groups.createTeam(),squad=await groups.createGroup(army),one=actor(),two=actor(),stranger=actor();await groups.linkGroupMember(squad,one);await groups.linkGroupMember(squad,two);
 const deleted=await groups.deleteGroupActor(squad);assert.deepEqual(deleted.map(x=>x.uuid),[one.uuid,two.uuid,squad.uuid]);assert.ok(actors.includes(army));assert.ok(actors.includes(stranger));assert.deepEqual(army.system.unitUuids,[]);
});
test('squad deletion validates every model ownership before deleting anything',async()=>{
 setup();const army=await groups.createTeam(),squad=await groups.createGroup(army),model=actor();await groups.linkGroupMember(squad,model);game.user={id:'player',isGM:false};squad.ownership={player:3};model.ownership={other:3};await assert.rejects(groups.deleteGroupActor(squad),/own/);assert.ok(actors.includes(model));assert.ok(actors.includes(squad));
});

test('only system art is eligible for automatic faction replacement',async()=>{const {isDefaultModelArt}=await import('../scripts/services/faction-appearance.mjs');assert.equal(isDefaultModelArt('icons/svg/mystery-man.svg'),false);assert.equal(isDefaultModelArt('worlds/campaign/my-nco.webp'),false);assert.equal(isDefaultModelArt('systems/boltaction/assets/soldier.svg'),true);});
test('pin counters require an owned squad and bounded whole numbers',async()=>{setup();const squad=actor({type:'unit'});await groups.setPins(squad,4);assert.equal(squad.system.pins,4);await assert.rejects(groups.setPins(squad,-1),/Pins/);await assert.rejects(groups.setPins(squad,2.5),/Pins/);game.user={id:'other',isGM:false};await assert.rejects(groups.setPins(squad,1),/own/);});

test('army Delete All deletes nested reciprocal descendants and preserves unrelated actors',async()=>{
 setup();const army=await groups.createTeam(),squad=await groups.createGroup(army),model=actor(),stranger=actor();await groups.linkGroupMember(squad,model);
 const deleted=await groups.deleteGroupActor(army);assert.deepEqual(new Set(deleted.map(a=>a.uuid)),new Set([army.uuid,squad.uuid,model.uuid]));assert.ok(actors.includes(stranger));assert.ok(!actors.includes(model));assert.ok(!actors.includes(squad));assert.ok(!actors.includes(army));
});
test('army Delete All validates descendant ownership before any deletion',async()=>{
 setup();const army=await groups.createTeam(),squad=await groups.createGroup(army),model=actor();await groups.linkGroupMember(squad,model);game.user={id:'player',isGM:false};army.ownership={player:3};squad.ownership={player:3};model.ownership={other:3};await assert.rejects(groups.deleteGroupActor(army),/own/);for(const a of [army,squad,model])assert.ok(actors.includes(a));
});

test('loader pairing requires a living reciprocal team gunner and yields matching pair identity',async()=>{
 setup();const squad=actor({type:'unit'}),gunner=actor({items:[{type:'weapon',system:{slug:'lmg'}}]}),loader=actor(),stranger=actor({items:[{type:'weapon',system:{slug:'lmg'}}]});await groups.linkGroupMember(squad,gunner);await groups.linkGroupMember(squad,loader);
 await groups.setLoaderPair(loader,gunner.uuid);assert.equal(loader.system.isLoader,true);assert.equal(loader.system.loaderForUuid,gunner.uuid);assert.equal(groups.getLoaderPair(loader).gunner,gunner);assert.deepEqual(groups.getLoaderPair(gunner).loaders,[loader]);assert.equal(groups.getLoaderPair(loader).pairLabel,groups.getLoaderPair(gunner).pairLabel);
 await assert.rejects(groups.setLoaderPair(loader,stranger.uuid),/same squad/);await assert.rejects(groups.setLoaderPair(loader,loader.uuid),/same squad/);gunner.system.dead=true;await assert.rejects(groups.setLoaderPair(loader,gunner.uuid),/living/);gunner.system.dead=false;
 await groups.unlinkGroupMember(squad,gunner.uuid);assert.equal(loader.system.loaderForUuid,'');assert.equal(loader.system.isLoader,false);
});
test('deleting a paired gunner clears surviving loader assignment',async()=>{
 setup();const squad=actor({type:'unit'}),gunner=actor({items:[{type:'weapon',system:{slug:'lmg'}}]}),loader=actor();await groups.linkGroupMember(squad,gunner);await groups.linkGroupMember(squad,loader);await groups.setLoaderPair(loader,gunner.uuid);await groups.deleteGroupActor(gunner);assert.equal(loader.system.loaderForUuid,'');assert.equal(loader.system.isLoader,false);assert.ok(actors.includes(loader));
});

test('infantry groups designate an officer leader without replacing the source role or custom identity',async()=>{
 setup();const parent=actor({type:'unit'}),officer=actor({name:'Captain Allen',system:{role:'officer',customName:'Captain Allen'}}),attendant=actor({system:{role:'rifleman'}});await groups.linkGroupMember(parent,officer);await groups.linkGroupMember(parent,attendant);assert.equal(officer.system.isNco,true);assert.equal(officer.system.role,'officer');assert.equal(officer.name,'Captain Allen');assert.equal(Boolean(attendant.system.isNco),false);
 await groups.setInfantryLeader(parent,attendant.uuid);assert.equal(attendant.system.isNco,true);assert.equal(officer.system.isNco,false);assert.equal(officer.system.role,'officer');
});
test('leader repair preserves dead designated leaders and excludes static or vehicle models',async()=>{
 setup();const parent=actor({type:'unit'}),dead=actor({system:{role:'nco',dead:true,unitUuid:parent.uuid}}),other=actor({system:{unitUuid:parent.uuid}});parent.system.modelUuids=[dead.uuid,other.uuid];await groups.ensureInfantryLeader(parent);assert.equal(dead.system.isNco,true);assert.equal(Boolean(other.system.isNco),false);
 const staticGroup=actor({type:'unit',system:{squadKind:'vehicleStatic'}}),gun=actor({type:'modelStatic',system:{isNco:true,role:'nco',unitUuid:staticGroup.uuid}}),vehicle=actor({type:'modelVehicle',system:{isNco:true,unitUuid:staticGroup.uuid}});staticGroup.system.modelUuids=[gun.uuid,vehicle.uuid];await groups.ensureInfantryLeader(staticGroup);assert.equal(gun.system.isNco,false);assert.equal(gun.system.role,'crew');assert.equal(vehicle.system.isNco,false);await assert.rejects(groups.setInfantryLeader(staticGroup,gun.uuid),/infantry/);
});
