import test from 'node:test';import assert from 'node:assert/strict';
import {applyFactionWeaponAlias,factionWeaponName} from '../fvtt/scripts/services/faction-weapons.mjs';
test('faction weapon names preserve canonical class statistics and custom flags',()=>{
 const source={name:'Light machine gun',type:'weapon',system:{slug:'lmg',range:36,shots:4,penetration:0,traits:['team']},flags:{boltaction:{mount:'coaxial'},custom:{value:1}}};
 const before=structuredClone(source),weapon=applyFactionWeaponAlias(source,'germany');
 assert.equal(weapon.name,'MG34 / MG42 (LMG)');assert.deepEqual(weapon.system,source.system);assert.deepEqual(source,before);assert.equal(weapon.flags.boltaction.weaponClass,'lmg');assert.equal(weapon.flags.boltaction.mount,'coaxial');assert.deepEqual(weapon.flags.custom,{value:1});
});
test('unknown faction and specialist weapons retain catalogue names; aliases never add statistics',()=>{
 assert.equal(factionWeaponName('rifle','great-britain','Rifle'),'Lee-Enfield .303');
 const source={name:'Medium anti-tank gun',system:{slug:'medium-at-gun',range:60,shots:1,penetration:5,traits:['team']}};
 assert.equal(applyFactionWeaponAlias(source,'great-britain').name,source.name);assert.equal(factionWeaponName('rifle','unknown','Rifle'),'Rifle');
});

test('verified aliases retain source pages and unsupported historical names stay generic',()=>{
 const weapon=applyFactionWeaponAlias({name:'Automatic rifle',system:{slug:'automatic-rifle',range:30,shots:2,penetration:0,traits:[]}},'united-states');
 assert.equal(weapon.name,'Browning Automatic Rifle (BAR)');assert.equal(weapon.flags.boltaction.aliasSource.page,63);assert.equal(weapon.flags.boltaction.aliasSource.weaponClassPage,62);
 assert.equal(factionWeaponName('smg','imperial-japan','Submachine gun'),'Submachine gun');
 assert.equal(factionWeaponName('lmg','united-states','Light machine gun'),'Light machine gun');
});
