import test from 'node:test';
import assert from 'node:assert/strict';
import {tokenFootprint,preservesTokenSize} from '../scripts/services/token-sizing.mjs';
const actor=(type,system={},flags={})=>({type,system,flags:{boltaction:flags}});
test('baseline tabletop footprints use infantry, static and vehicle class profiles',()=>{
 assert.deepEqual(tokenFootprint(actor('model')),{width:1,height:1});
 assert.deepEqual(tokenFootprint(actor('modelStatic')),{width:2,height:2});
 assert.deepEqual(tokenFootprint(actor('modelVehicle',{damageValue:7})),{width:2,height:3});
 assert.deepEqual(tokenFootprint(actor('modelVehicle',{damageValue:9})),{width:2,height:3});
 assert.deepEqual(tokenFootprint(actor('modelVehicle',{damageValue:10})),{width:3,height:4});
 assert.deepEqual(tokenFootprint(actor('modelVehicle',{damageValue:11})),{width:3,height:4});
});
test('explicit profile footprint and world defaults override only their intended category',()=>{
 assert.deepEqual(tokenFootprint(actor('modelVehicle',{damageValue:10},{profile:{tokenSize:{width:2.5,height:5}}})),{width:2.5,height:5});
 assert.deepEqual(tokenFootprint(actor('modelStatic'),{footprints:{static:{width:1.5,height:2.5}}}),{width:1.5,height:2.5});
 globalThis.game={settings:{get(_system,key){return key.endsWith('_width')?2:2.5;}}};
 assert.deepEqual(tokenFootprint(actor('model')),{width:2,height:2.5});delete globalThis.game;
});
test('invalid profile sizes fail safely and explicit preservation flags are recognised',()=>{
 assert.deepEqual(tokenFootprint(actor('model',{}, {profile:{tokenSize:{width:Infinity,height:-2}}})),{width:1,height:1});
 assert.deepEqual(tokenFootprint(actor('modelVehicle',{damageValue:11},{profile:{tokenSize:'light'}})),{width:2,height:3});
 assert.equal(preservesTokenSize({flags:{boltaction:{preserveTokenSize:true}}}),true);
 assert.equal(preservesTokenSize({flags:{boltaction:{preserveTokenTransform:true}}}),true);
 assert.equal(preservesTokenSize({flags:{boltaction:{preserveTokenDimensions:true}}}),true);
 assert.equal(preservesTokenSize({}),false);
});
test('static weapon crew retain infantry-sized bases while the operator uses the gun footprint',()=>{assert.deepEqual(tokenFootprint({type:'modelStatic',system:{role:'crew'}},{footprints:{}}),{width:1,height:1});assert.deepEqual(tokenFootprint({type:'modelStatic',system:{role:'operator'}},{footprints:{}}),{width:2,height:2});});
