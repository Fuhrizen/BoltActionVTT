import test from 'node:test';
import assert from 'node:assert/strict';
import {callObserver,resolveObserver} from '../scripts/services/observer-service.mjs';
test('observer persists one-use mission, waits a round, delays and then arrives',async()=>{
 const u={uuid:'Actor.observer',name:'Observer',type:'unit',isOwner:true,system:{observerKind:'artillery',observerUsed:false,order:'fire'},async update(data){for(const [key,value]of Object.entries(data))this.system[key.slice(7)]=value;}};
 globalThis.canvas={scene:{uuid:'Scene.table'}};
 globalThis.game={user:{isGM:true},combat:{round:1,getFlag:()=>({activeUnitUuid:u.uuid})}};
 globalThis.foundry={documents:{ChatMessage:{getSpeaker:()=>({}),create:async()=>{}}}};
 const queue=[[2],[4],[3]];globalThis.Roll=class{async evaluate(){this.dice=[{results:queue.shift().map(result=>({result}))}];return this;}};
 await callObserver(u,{kind:'artillery',x:100,y:200,visible:true});assert.equal(u.system.observerUsed,true);assert.equal(u.system.observerPending,true);
 await assert.rejects(callObserver(u,{kind:'artillery',x:0,y:0,visible:true}),/unused observer/);
 await assert.rejects(resolveObserver(u),/round after/);game.combat.round=2;
 assert.equal((await resolveObserver(u)).delayed,true);assert.equal(u.system.observerRound,2);
 game.combat.round=3;const result=await resolveObserver(u);assert.equal(result.arrived,true);assert.equal(result.radius,9);assert.equal(u.system.observerPending,false);
});
