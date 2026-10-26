import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {validateRoster} from '../scripts/roster/format.mjs';
import {importArmyRoster,exportArmyRoster} from '../scripts/services/roster-transfer.mjs';
const draft=()=>({format:'boltaction-army',version:1,name:'Test force',faction:'great-britain',pointsLimit:500,platoons:[{id:'p1',name:'First'}],squads:[{id:'s1',profileSlug:'great-britain-regular-infantry',platoonId:'p1',identity:'Baker',quality:'regular',models:Array.from({length:5},(_,i)=>({id:'m'+i,customName:i===1?'Smith':'',isNco:i===0,choices:['primary:primary:rifle']}))}]});
test('portable roster schema rejects unknown payload fields, world IDs and dangling links',()=>{
 const data=draft();assert.equal(validateRoster(JSON.stringify(data)).squads[0].models[1].customName,'Smith');
 assert.throws(()=>validateRoster({...data,ownership:{default:3}}),/unsupported/);assert.throws(()=>validateRoster({...data,version:999}),/version/);
 data.squads[0].models[1].loaderForId='Actor.secret';assert.throws(()=>validateRoster(data),/local identifier/);data.squads[0].models[1].loaderForId='missing';assert.throws(()=>validateRoster(data),/another model/);
 data.squads[0].models[1].loaderForId='m1';assert.throws(()=>validateRoster(data),/another model/);
});
function setup(){
 const actors=[];let n=0;const faction={uuid:'Item.british',documentName:'Item',type:'faction',system:{slug:'great-britain'}};
 const put=(obj,key,value)=>{const p=key.split('.');let at=obj;for(const k of p.slice(0,-1))at=at[k]??={};at[p.at(-1)]=structuredClone(value);};
 const make=source=>{const a={id:'a'+(++n),uuid:'Actor.a'+n,documentName:'Actor',isOwner:true,visible:true,...structuredClone(source),items:(source.items??[]).map((i,j)=>({...structuredClone(i),id:'i'+j})),ownership:source.ownership??{},system:source.system??{},flags:source.flags??{},getFlag(scope,key){return this.flags?.[scope]?.[key];},toObject(){return {name:this.name,type:this.type,img:this.img,prototypeToken:this.prototypeToken,system:structuredClone(this.system),flags:structuredClone(this.flags),items:structuredClone(this.items),ownership:structuredClone(this.ownership)};},async update(data){for(const [k,v]of Object.entries(data))put(this,k,v);return this;},async delete(){actors.splice(actors.indexOf(this),1);},async createEmbeddedDocuments(_type,rows){const made=rows.map(row=>({...structuredClone(row),id:'i'+(++n)}));this.items.push(...made);return made;},async deleteEmbeddedDocuments(_type,ids){this.items=this.items.filter(i=>!ids.includes(i.id));}};Object.defineProperty(a,'members',{get(){const uuids=this.system[this.type==='army'?'unitUuids':'modelUuids']??[];return actors.filter(m=>uuids.includes(m.uuid));}});actors.push(a);return a;};
 globalThis.fetch=async path=>({ok:true,json:async()=>JSON.parse(await readFile(new URL('../'+path.replace('systems/boltaction/',''),import.meta.url),'utf8'))});
 globalThis.game={user:{id:'gm',isGM:true,can:()=>true},users:[],actors,items:[faction],packs:[]};globalThis.CONFIG={Actor:{documentClass:{create:async data=>make(data),deleteDocuments:async ids=>{for(const id of ids){const i=actors.findIndex(a=>a.id===id);if(i>=0)actors.splice(i,1);}}}}};globalThis.fromUuid=async uuid=>uuid===faction.uuid?faction:actors.find(a=>a.uuid===uuid);
 return actors;
}
test('source roster import creates independent owned models and exports only portable selections',async()=>{
 const actors=setup(),army=await importArmyRoster(draft());assert.equal(army.ownership.gm,3);assert.equal(army.system.unitUuids.length,1);assert.equal(actors.length,7);
 const squad=army.members[0];assert.equal(squad.members.length,5);assert.equal(squad.members[1].system.customName,'Smith');
 const out=await exportArmyRoster(army);assert.equal(out.squads[0].profileSlug,draft().squads[0].profileSlug);assert.equal(out.squads[0].models[1].customName,'Smith');assert.ok(!JSON.stringify(out).includes('Actor.'));assert.equal(out.squads[0].models.filter(m=>m.isNco).length,1);
 const second=await importArmyRoster(out);assert.notEqual(second.uuid,army.uuid);assert.equal(actors.length,14);
});
test('unknown source choices fail before any documents are created',async()=>{const actors=setup(),data=draft();data.squads[0].models[0].choices=['primary:primary:made-up'];await assert.rejects(importArmyRoster(data),/unknown source equipment/);assert.equal(actors.length,0);});
test('failed owned army construction rolls back the complete imported hierarchy',async()=>{const actors=setup(),data=draft();data.squads[0].models[1].loaderForId='m0';await assert.rejects(importArmyRoster(data),/gunner/);assert.equal(actors.length,0);});
test('weapon swaps and paired loader local IDs round-trip to fresh world UUIDs',async()=>{
 setup();const data=draft();data.squads[0].models[0].choices=['primary:primary:smg'];data.squads[0].models[1].choices=['primary:primary:lmg'];data.squads[0].models[2].loaderForId='m1';data.squads[0].models[2].isLoader=true;
 const army=await importArmyRoster(data),out=await exportArmyRoster(army);assert.ok(out.squads[0].models[0].choices.includes('primary:primary:smg'));assert.ok(out.squads[0].models[1].choices.includes('primary:primary:lmg'));assert.equal(out.squads[0].models[2].loaderForId,'m2');
 const again=await importArmyRoster(out),members=again.members[0].members;assert.equal(members[2].system.loaderForUuid,members[1].uuid);assert.notEqual(members[1].uuid,army.members[0].members[1].uuid);
});
