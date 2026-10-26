import test from 'node:test';
import assert from 'node:assert/strict';
import {manualRollInput,resolveManualPool,manualRollCard,genericRoll,confirmManualRoll,squadShotOptions,selectedShotCount} from '../scripts/services/manual-rolls.mjs';

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
 assert.equal(result.successes,1);assert.equal(posted.rolls[0].formula,'2d6');assert.equal(posted.flags.boltaction.kind,'manual');assert.ok(!posted.content.includes('Fire'));
});
test('manual dialog cancellation leaves chat and actor state untouched',async()=>{
 globalThis.foundry={applications:{api:{DialogV2:{wait:async config=>{assert.equal(config.position.width,500);assert.ok(!config.content.includes('cover'));return null;}}}}};
 assert.equal(await confirmManualRoll({name:'Squad'}),null);
});

test('shot assistant groups actual living weapons and excludes loaders, casualties and unrelated models',()=>{
 const weapon=(name,shots,quantity=1,extra={})=>({type:'weapon',name,system:{slug:name.toLowerCase(),shots,quantity,...extra}});
 const model=(items,system={})=>({items,system:{unitUuid:'Actor.squad',...system}});
 const squad={type:'unit',uuid:'Actor.squad',members:[model([weapon('Rifle',1)]),model([weapon('Rifle',1)]),model([weapon('LMG',4)]),model([weapon('Rifle',1)],{isLoader:true}),model([weapon('Rifle',1)],{dead:true}),model([weapon('Rifle',1)],{unitUuid:'Actor.other'}),model([weapon('Flamethrower',0,1,{shotsFormula:'1d6'})])]};
 const rows=squadShotOptions(squad);assert.equal(rows.length,3);assert.equal(rows[0].count,2);assert.equal(rows[1].shots,4);assert.equal(rows[2].variable,true);
 assert.equal(selectedShotCount(rows.map(row=>({...row,enabled:true}))),7);
 assert.equal(selectedShotCount(rows.map(row=>({...row,enabled:row.name==='LMG',count:1,shots:3}))),3);
 assert.equal(selectedShotCount([{enabled:false,count:'bad',shots:0}] ),0);
 assert.throws(()=>selectedShotCount([{enabled:true,count:-1,shots:4}]));
});
test('shot assistant recalculates dice and can be disabled for a manual count',async()=>{
 const {bindManualShotControls}=await import('../scripts/services/manual-rolls.mjs');
 const fields={assist:{checked:true},count:{value:1},weapon0:{checked:true},weapons0:{value:2},shots0:{value:4}};let listener;
 const controls=[fields.weapon0,fields.weapons0,fields.shots0];
 const root={querySelector:selector=>selector==='.ba-manual-dialog'?{addEventListener:(_name,callback)=>listener=callback}:fields[selector.match(/name="([^"]+)"/)[1]],querySelectorAll:()=>controls};
 bindManualShotControls(root,[{id:0}]);assert.equal(fields.count.value,8);assert.equal(fields.count.readOnly,true);
 fields.weapon0.checked=false;listener();assert.equal(fields.count.value,0);
 fields.assist.checked=false;fields.count.value=11;listener();assert.equal(fields.count.readOnly,false);assert.equal(fields.count.value,11);assert.ok(controls.every(c=>c.disabled));
 fields.assist.checked=true;fields.weapon0.checked=true;fields.shots0.value=3;listener();assert.equal(fields.count.value,6);
});
test('squad roller has weapon opt-outs but no title field',async()=>{
 globalThis.foundry={applications:{api:{DialogV2:{wait:async config=>{assert.ok(!config.content.includes('name="label"'));assert.match(config.content,/name="assist"/);assert.match(config.content,/name="weapon0"/);assert.match(config.content,/Rifle/);assert.ok(typeof config.render==='function');return null;}}}}};
 await confirmManualRoll({type:'unit',members:[{system:{},items:[{type:'weapon',name:'Rifle',system:{shots:1}}]}]});
});
