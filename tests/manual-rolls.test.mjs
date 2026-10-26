import test from 'node:test';
import assert from 'node:assert/strict';
import {manualRollInput,resolveManualPool,manualRollCard,genericRoll,confirmManualRoll} from '../scripts/services/manual-rolls.mjs';

test('manual pool is rules-neutral and optional threshold does not count successes',()=>{
 const result=resolveManualPool([1,3,6],{count:3,target:'',modifier:0});
 assert.equal(result.total,10);assert.equal(result.successes,null);assert.deepEqual(result.dice,[1,3,6]);
 const modified=resolveManualPool([1,3,6],{count:3,target:4,modifier:1});
 assert.equal(modified.successes,2);assert.deepEqual(modified.results,[false,true,true]);assert.equal(modified.modifiedTotal,13);
});
test('manual inputs reject unreasonable counts and invalid numbers before rolling',()=>{
 for(const input of [{count:0},{count:201},{count:1.5},{modifier:NaN},{modifier:101},{target:'oops'},{target:2.5}])assert.throws(()=>manualRollInput(input));
 assert.throws(()=>resolveManualPool([7],{count:1}));assert.throws(()=>resolveManualPool([1],{count:2}));
});
test('manual card escapes names and hides detailed dice behind inspection',()=>{
 const card=manualRollCard({name:'<img src=x>'},resolveManualPool([2,6],{label:'<script>Fire</script>',count:2,target:4}));
 assert.ok(!card.includes('<script>'));assert.ok(!card.includes('<img'));assert.match(card,/1 \/ 2 successes/);assert.match(card,/<details><summary>Inspect dice/);assert.match(card,/no range, cover, traits/);
});
test('generic roller posts native dice without scene, target or activation dependencies',async()=>{
 let posted;globalThis.Roll=class{constructor(formula){this.formula=formula;this.dice=[{results:[{result:1},{result:6}]}];}async evaluate(){return this;}};
 globalThis.ChatMessage={getSpeaker:()=>({}),create:async data=>{posted=data;}};
 const result=await genericRoll({name:'Section',uuid:'Actor.unit',isOwner:true},{count:2,target:5,label:'Fire'});
 assert.equal(result.successes,1);assert.equal(posted.rolls[0].formula,'2d6');assert.equal(posted.flags.boltaction.kind,'manual');assert.match(posted.content,/Fire/);
});
test('manual dialog cancellation leaves chat and actor state untouched',async()=>{
 globalThis.foundry={applications:{api:{DialogV2:{wait:async config=>{assert.equal(config.position.width,420);assert.ok(!config.content.includes('cover'));return null;}}}}};
 assert.equal(await confirmManualRoll({name:'Squad'}),null);
});
