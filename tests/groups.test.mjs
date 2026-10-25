import test from 'node:test';
import assert from 'node:assert/strict';
import * as groups from '../scripts/services/groups.mjs';
let actors, users, nextId;
function assignPath(target, key, value) {const path = key.split('.'), last = path.pop();let at = target;for (const part of path) at = at[part] ??= {};at[last] = structuredClone(value);}
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
        if (key === 'ownership' && options.recursive !== false) this.ownership={...this.ownership,...structuredClone(value)};
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
  await assert.rejects(groups.linkGroupMember(team,imported),/Player Teams contain/);
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
