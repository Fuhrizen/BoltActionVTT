import test from 'node:test';
import assert from 'node:assert/strict';
import {modelTokenArt,synchronizeModelArt} from '../scripts/services/token-art.mjs';
import {isDefaultModelArt,isGeneratedTokenArt,GENERATED_ART_PREFIX} from '../scripts/services/faction-appearance.mjs';
const weapon=slug=>({name:slug,type:'weapon',system:{slug}});
const actor=(type='model',extra={})=>({id:'m',uuid:'Actor.m',type,isOwner:true,name:'Rifleman',system:{},flags:{boltaction:{factionSlug:'germany'}},items:[weapon('rifle')],img:'systems/boltaction/assets/soldier.svg',prototypeToken:{texture:{src:'systems/boltaction/assets/model-token.svg'}},...extra});
test('every infantry combination is layered deterministic managed SVG without overwriting custom files',()=>{
 const a=actor(),base=modelTokenArt(a);assert.equal(base,modelTokenArt(a));assert.ok(isGeneratedTokenArt(base));assert.ok(isDefaultModelArt(base));assert.match(decodeURIComponent(base.slice('data:image/svg+xml;charset=utf-8,'.length)),/<svg/);
 assert.notEqual(base,modelTokenArt({...a,items:[weapon('lmg'),weapon('panzerfaust')],system:{isLoader:true}}));
 assert.notEqual(base,modelTokenArt(a,'great-britain'));
 assert.equal(isDefaultModelArt('worlds/campaign/custom.svg'),false);assert.equal(isDefaultModelArt('data:image/svg+xml;base64,custom'),false);
});
test('vehicle source and conversions alter layered art deterministically',()=>{
 const a=actor('modelVehicle',{name:'Sherman',system:{profileName:'Sherman',damageValue:9},items:[weapon('medium-at-gun')]});
 const base=modelTokenArt(a);assert.notEqual(base,modelTokenArt({...a,name:'Tiger',system:{profileName:'Tiger',damageValue:10}}));
 assert.notEqual(base,modelTokenArt({...a,items:[...a.items,{name:'Pintle HMG',type:'trait',flags:{boltaction:{modelChoiceId:'vehicle:1'}}}]}));
});
test('art synchronization preserves custom portrait and placed token independently',async()=>{
 const updates=[],tokens=[];const a=actor('model',{img:'worlds/a/portrait.webp',update:async(data)=>updates.push(data)});
 globalThis.game={actors:[a],scenes:[{tokens:[{id:'default',actorId:'m',actorLink:true,texture:{src:'systems/boltaction/assets/model-token.svg'}},{id:'custom',actorId:'m',actorLink:true,texture:{src:'worlds/a/token.webp'}}],updateEmbeddedDocuments:async(type,data)=>tokens.push(...data)}]};
 await synchronizeModelArt(a);assert.equal(updates.length,1);assert.equal(updates[0].img,undefined);assert.ok(updates[0]['prototypeToken.texture.src'].startsWith(GENERATED_ART_PREFIX));assert.equal(tokens.length,1);assert.equal(tokens[0]._id,'default');assert.equal(tokens[0]['texture.scaleY'],1);
});
