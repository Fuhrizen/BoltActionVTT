import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {modelTokenArt,synchronizeModelArt} from '../scripts/services/token-art.mjs';
import {isDefaultModelArt,isGeneratedTokenArt,GENERATED_ART_PREFIX} from '../scripts/services/faction-appearance.mjs';
const weapon=slug=>({name:slug,type:'weapon',system:{slug}});
const actor=(type='model',extra={})=>({id:'m',uuid:'Actor.m',type,isOwner:true,name:'Rifleman',system:{},flags:{boltaction:{factionSlug:'germany'}},items:[weapon('rifle')],img:'systems/boltaction/assets/soldier.svg',prototypeToken:{texture:{src:'systems/boltaction/assets/model-token.svg'}},...extra});
test('infantry loadouts resolve existing tracked SVG files rather than rejected data URIs',async()=>{
 const a=actor(),base=modelTokenArt(a);assert.equal(base,modelTokenArt(a));assert.ok(isGeneratedTokenArt(base));assert.ok(isDefaultModelArt(base));assert.match(base,/\.svg\?v=22$/);assert.ok(!base.startsWith('data:'));
 const paired=modelTokenArt({...a,items:[weapon('lmg'),weapon('panzerfaust')],system:{isLoader:true}});assert.notEqual(base,paired);
 for(const src of [base,paired,modelTokenArt(a,'great-britain')])await access(src.replace('systems/boltaction/','').split('?')[0]);
 assert.equal(isDefaultModelArt('worlds/campaign/custom.svg'),false);assert.equal(isDefaultModelArt('data:image/svg+xml;base64,custom'),false);assert.equal(isDefaultModelArt(GENERATED_ART_PREFIX+'old'),true);
});
test('source vehicle conversions select tracked variant SVGs',async()=>{
 const a=actor('modelVehicle',{flags:{boltaction:{factionSlug:'great-britain',catalogueSlug:'great-britain-sherman-75'}},name:'Sherman',system:{profileName:'Sherman',damageValue:9},items:[weapon('medium-at-gun')]});
 const base=modelTokenArt(a),upgrade=modelTokenArt({...a,items:[...a.items,{name:'Pintle HMG',type:'trait',flags:{boltaction:{modelChoiceId:'vehicle:1'}}}]});assert.notEqual(base,upgrade);
 for(const src of [base,upgrade])await access(src.replace('systems/boltaction/','').split('?')[0]);
});
test('art synchronization preserves custom portrait and placed token independently',async()=>{
 const updates=[],tokens=[];const a=actor('model',{img:'worlds/a/portrait.webp',update:async(data)=>updates.push(data)});
 globalThis.game={actors:[a],scenes:[{tokens:[{id:'default',actorId:'m',actorLink:true,texture:{src:'systems/boltaction/assets/model-token.svg'}},{id:'custom',actorId:'m',actorLink:true,texture:{src:'worlds/a/token.webp'}}],updateEmbeddedDocuments:async(type,data)=>tokens.push(...data)}]};
 await synchronizeModelArt(a);assert.equal(updates.length,1);assert.equal(updates[0].img,undefined);assert.match(updates[0]['prototypeToken.texture.src'],/\.svg\?v=22$/);assert.equal(tokens.length,1);assert.equal(tokens[0]._id,'default');assert.equal(tokens[0]['texture.scaleY'],-1);
});

test('every generated infantry and vehicle asset manifest references a real extension-safe SVG',async()=>{
 const {infantryTokenAssets}=await import('../scripts/token-art/infantry-manifest.mjs');
 const {vehicleTokenVariants}=await import('../scripts/token-art/vehicle-manifest.mjs');
 for(const path of [...Object.values(infantryTokenAssets),...Object.values(vehicleTokenVariants)]){
  assert.match(path,/^assets\/tokens\/(infantry|vehicles)\/[a-z0-9-]+\/[a-z0-9-]+\.svg$/);await access(path);
 }
});


test('matching managed artwork still repairs facing once without touching custom transforms',async()=>{
 const writes=[],tokenWrites=[];const a=actor();const src=modelTokenArt(a);a.img=src;a.prototypeToken={texture:{src,scaleY:1}};a.update=async data=>writes.push(data);
 globalThis.game={actors:[a],scenes:[{tokens:[{id:'same',actorId:a.id,actorLink:true,texture:{src,scaleY:1}},{id:'optout',actorId:a.id,actorLink:true,texture:{src,scaleY:1},flags:{boltaction:{preserveTokenTransform:true}}}],updateEmbeddedDocuments:async(type,data)=>tokenWrites.push(...data)}]};
 await synchronizeModelArt(a);assert.deepEqual(writes,[{'prototypeToken.texture.scaleY':-1}]);assert.deepEqual(tokenWrites,[{_id:'same','texture.scaleY':-1}]);
 a.prototypeToken.texture.scaleY=-1;game.scenes[0].tokens[0].texture.scaleY=-1;await synchronizeModelArt(a);assert.equal(writes.length,1);assert.equal(tokenWrites.length,1);
});
