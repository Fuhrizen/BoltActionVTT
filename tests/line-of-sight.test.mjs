import test from 'node:test';
import assert from 'node:assert/strict';
import {squadLineOfSight} from '../scripts/services/line-of-sight.mjs';
function setup(){
 const squad={id:'s',uuid:'Actor.s',type:'unit',isOwner:true,system:{modelUuids:['Actor.a','Actor.b','Actor.dead','Actor.loader','Actor.stale','Actor.absent']}};
 const model=(id,system={})=>({id,uuid:`Actor.${id}`,type:'model',isOwner:true,visible:true,system:{unitUuid:squad.uuid,...system}});
 const a=model('a'),b=model('b'),dead=model('dead',{dead:true}),loader=model('loader',{isLoader:true}),stale=model('stale',{unitUuid:'Actor.other'}),absent=model('absent'),enemy=model('enemy',{unitUuid:'Actor.enemy'});
 const token=(actor,x)=>({actor,visible:true,center:{x,y:50},document:{uuid:`Scene.scene.Token.${actor.id}`,elevation:0,level:'floor'}});
 const ta=token(a,10),tb=token(b,20),tl=token(loader,30),target=token(enemy,100);
 globalThis.game={actors:[squad,a,b,dead,loader,stale,absent,enemy],user:{isGM:false}};
 const canvas={ready:true,scene:{id:'scene',grid:{size:100}},tokens:{placeables:[ta,tb,tl,target]}};
 const calls=[];globalThis.CONFIG={Canvas:{polygonBackends:{sight:{testCollision(origin,destination,options){calls.push({origin,destination,options});return origin.x===20;}}}}};
 return {squad,a,b,ta,tb,tl,target,canvas,calls};
}
test('squad LOS checks only reciprocal living models and distinguishes blocked, loader and undeployed models',()=>{
 const {squad,target,canvas,calls}=setup();const rows=squadLineOfSight(squad,target,{canvas});
 assert.deepEqual(rows.map(row=>row.modelUuid),['Actor.a','Actor.b','Actor.loader','Actor.absent']);
 assert.deepEqual(rows.map(row=>row.eligible),[true,false,false,false]);assert.equal(rows[1].blocked,true);assert.match(rows[2].reason,/loader/);assert.match(rows[3].reason,/No visible/);
 assert.equal(calls.length,2);assert.equal(calls[0].options.type,'sight');assert.equal(calls[0].options.mode,'any');assert.equal(calls[0].options.level,'floor');assert.equal(calls[0].destination.x,100);
});
test('missing offscene hidden friendly targets, unavailable backend and unowned squad fail closed',()=>{
 const {squad,target,canvas}=setup();assert.throws(()=>squadLineOfSight(squad,null,{canvas}),/visible target/);assert.throws(()=>squadLineOfSight(squad,{...target},{canvas}),/visible target/);
 target.visible=false;assert.throws(()=>squadLineOfSight(squad,target,{canvas}),/visible target/);target.visible=true;
 assert.throws(()=>squadLineOfSight(squad,canvas.tokens.placeables[0],{canvas}),/outside/);
 squad.isOwner=false;assert.throws(()=>squadLineOfSight(squad,target,{canvas}),/own/);squad.isOwner=true;
 delete CONFIG.Canvas.polygonBackends.sight;assert.throws(()=>squadLineOfSight(squad,target,{canvas}),/backend/);
});
test('different levels and hidden shooters cannot silently fire; duplicated model tokens never duplicate shots',()=>{
 const {squad,target,canvas,ta,tb}=setup();tb.document.level='upstairs';ta.visible=false;canvas.tokens.placeables.push({...tb,document:{...tb.document,uuid:'duplicate'}});
 const rows=squadLineOfSight(squad,target,{canvas});assert.equal(rows.length,4);assert.equal(rows[0].eligible,false);assert.match(rows[1].reason,/different scene level/);
});
