import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {previewUpgrade,applyUpgrade,calculateRosterCost} from '../fvtt/scripts/services/upgrades.mjs';
const catalogue=Object.fromEntries(await Promise.all(['weapons','traits','factions','units'].map(async key=>[key,JSON.parse(await readFile(new URL(`../fvtt/compendiums/${key}.json`,import.meta.url),'utf8'))])));
globalThis.fetch=async url=>({ok:true,json:async()=>catalogue[url.split('/').at(-1).replace('.json','')]});
let id=0;
function actor(name,type,system,flags={}){
 const a={name,type,uuid:`Actor.${name}`,isOwner:true,system,flags,items:[],getFlag(ns,key){return this.flags[ns]?.[key];},async update(data){if(this.failUpdate){this.failUpdate=false;throw new Error('injected write failure');}for(const [key,value]of Object.entries(data)){const parts=key.split('.');let at=this;for(const part of parts.slice(0,-1))at=at[part]??={};at[parts.at(-1)]=structuredClone(value);}return this;},async deleteEmbeddedDocuments(_type,ids){this.items=this.items.filter(i=>!ids.includes(i.id));},async createEmbeddedDocuments(_type,sources){if(this.failCreate){this.failCreate=false;throw new Error('injected creation failure');}for(const source of sources){const s=structuredClone(source);this.items.push({...s,id:s._id??`item${++id}`,getFlag(ns,key){return this.flags?.[ns]?.[key];},toObject(){return {_id:this.id,name:this.name,type:this.type,system:structuredClone(this.system),flags:structuredClone(this.flags??{})};}});}}};return a;
}
async function squad(){const profile=catalogue.units.find(u=>u.slug==='germany-wehrmacht').profile;const u=actor('squad','unit',{kind:'infantry',quality:'regular',startingSize:5,points:50,order:'',activated:false},{boltaction:{profile}});u.members=[];for(let i=0;i<5;i++){const m=actor(`soldier${i}`,'model',{role:i?'rifleman':'nco',dead:false});await m.createEmbeddedDocuments('Item',[{name:'Rifle',type:'weapon',system:catalogue.weapons.find(w=>w.slug==='rifle').system}]);u.members.push(m);}return u;}
test('preview is read-only and replacement, added ammunition and per-model pricing remain consistent',async()=>{
 const u=await squad(),m=u.members[0],before=JSON.stringify(u.system);
 const preview=await previewUpgrade(u,{optionIndex:0,modelUuids:[m.uuid]});assert.equal(preview.cost,3);assert.equal(JSON.stringify(u.system),before);assert.equal(m.items[0].system.slug,'rifle');
 await applyUpgrade(u,{optionIndex:0,modelUuids:[m.uuid]});assert.equal(m.items[0].system.slug,'smg');assert.equal(u.system.points,53);
 await applyUpgrade(u,{optionIndex:3,modelUuids:[m.uuid]});assert.deepEqual(m.items.map(i=>i.system.slug),['smg','panzerfaust']);assert.equal(u.system.points,58);assert.equal(calculateRosterCost(u).total,58);
 await assert.rejects(applyUpgrade(u,{optionIndex:4}),/excludes/);
});
test('limits, model ownership, role and distinct loaders are checked before mutation',async()=>{
 const u=await squad();await assert.rejects(previewUpgrade(u,{optionIndex:0,modelUuids:u.members.slice(0,3).map(m=>m.uuid)}),/limit/);
 u.members[1].isOwner=false;await assert.rejects(previewUpgrade(u,{optionIndex:0,modelUuids:[u.members[1].uuid]}),/Own/);u.members[1].isOwner=true;
 await assert.rejects(previewUpgrade(u,{optionIndex:2,modelUuids:[u.members[0].uuid],loaderUuids:[u.members[1].uuid]}),/model role/);
 await assert.rejects(previewUpgrade(u,{optionIndex:2,modelUuids:[u.members[1].uuid]}),/loaders/);
 await applyUpgrade(u,{optionIndex:2,modelUuids:[u.members[1].uuid],loaderUuids:[u.members[2].uuid]});assert.equal(u.system.points,70);assert.equal(u.members[2].system.role,'loader');
 await assert.rejects(previewUpgrade(u,{optionIndex:0,modelUuids:[u.members[2].uuid]}),/loader/);
});
test('failed point write compensates item swaps, loader assignments and upgrade ledger',async()=>{
 const u=await squad();u.failUpdate=true;const gunner=u.members[1],loader=u.members[2],oldId=gunner.items[0].id;
 await assert.rejects(applyUpgrade(u,{optionIndex:2,modelUuids:[gunner.uuid],loaderUuids:[loader.uuid]}),/injected write/);
 assert.equal(u.system.points,50);assert.deepEqual(u.flags.boltaction.upgrades,[]);assert.equal(gunner.items[0].system.slug,'rifle');assert.equal(gunner.items[0].id,oldId);assert.equal(loader.system.role,'rifleman');
});
test('squad-wide upgrades and extra models use purchased models including casualties',async()=>{
 const u=await squad();await applyUpgrade(u,{optionIndex:4});assert.equal(u.system.points,60);u.members[1].system.dead=true;assert.equal(calculateRosterCost(u).total,60);u.system.startingSize=6;assert.equal(calculateRosterCost(u).total,72);
});
test('unresolved conversions and battlefield changes cannot silently modify a roster',async()=>{
 const u=await squad();u.flags.boltaction.profile.options.push({weaponSlug:'mmg',cost:null,unresolvedCost:true});await assert.rejects(previewUpgrade(u,{optionIndex:5,modelUuids:[u.members[1].uuid]}),/unresolved/);u.system.order='fire';await assert.rejects(previewUpgrade(u,{optionIndex:0,modelUuids:[u.members[1].uuid]}),/before issuing/);assert.equal(u.system.points,50);
});
test('simple vehicle mount upgrade applies verified cost and transport capacity',async()=>{
 const row=catalogue.units.find(r=>r.slug==='germany-kubelwagen');
 const v=actor('car','unit',{kind:'vehicle',quality:'regular',startingSize:1,points:21,capacity:3,order:''},{boltaction:{profile:row.profile}});v.members=[];
 const preview=await applyUpgrade(v,{optionIndex:0});assert.equal(preview.cost,15);assert.equal(v.system.points,36);assert.equal(v.system.capacity,0);assert.equal(v.items[0].system.slug,'mmg');assert.equal(v.items[0].getFlag('boltaction','mount'),'pintle-360');
 await assert.rejects(applyUpgrade(v,{optionIndex:0}),/limit/);
});
