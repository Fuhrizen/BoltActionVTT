import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadCatalogue} from '../scripts/services/catalogue.mjs';
import {createArmy,newSquad,squadContext,armyReview} from '../web/model.mjs';
import {validateRoster} from '../scripts/roster/format.mjs';
globalThis.fetch=async url=>({ok:true,json:async()=>JSON.parse(await readFile(new URL(url),'utf8'))});
const data=await loadCatalogue({baseUrl:new URL('../compendiums/',import.meta.url)});
test('web journey prices an eight-man British section and exports source choices and loader pairing',async()=>{
 const army=createArmy(),row=data.units.find(r=>r.slug==='great-britain-regular-infantry');const squad=await newSquad(row,army.platoons[0].id);army.squads.push(squad);
 assert.equal(squad.models.length,5);assert.equal(squad.models.filter(m=>m.isNco).length,1);
 for(let i=0;i<3;i++)squad.models.push({id:'extra'+i,customName:'',isNco:false,isLoader:false,loaderForId:'',choices:[]});
 let ctx=await squadContext(row,squad,data);const first=ctx.contexts[0].config.equipment;const smg=first.find(c=>c.weaponSlug==='smg'),lmg=first.find(c=>c.weaponSlug==='lmg'),grenades=first.find(c=>c.id==='trait:anti-tank-grenades');assert.ok(smg&&lmg&&grenades);
 squad.models[0].choices=[smg.id];squad.models[1].choices=[lmg.id];squad.models[2].isLoader=true;squad.models[2].loaderForId=squad.models[1].id;for(const m of squad.models)m.choices.push(grenades.id);
 ctx=await squadContext(row,squad,data);assert.equal(ctx.cost.total,119);assert.deepEqual(ctx.errors,[]);
 const portable=validateRoster(JSON.stringify(army),{units:data.units});assert.equal(portable.squads[0].models[2].loaderForId,squad.models[1].id);assert.equal(armyReview(army,[ctx]).errors.length,2);
});
test('web source vehicle levels and initial models are available for every faction',async()=>{
 for(const faction of data.factions){const army=createArmy();army.faction=faction.slug;const row=data.units.find(r=>r.factionSlug===faction.slug&&r.system.kind==='vehicle'&&r.profile?.sourcePage);assert.ok(row);const squad=await newSquad(row,army.platoons[0].id);army.squads.push(squad);assert.equal(squad.models.length,1);assert.equal(squad.models[0].isNco,false);assert.ok((await squadContext(row,squad,data)).cost.total>0);assert.equal(validateRoster(army,{units:data.units}).faction,faction.slug);}
});
