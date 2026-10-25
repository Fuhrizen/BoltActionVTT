import {ask} from '../applications/dialogs.mjs';
import {shootingTarget,resolveHits} from '../rules/index.mjs';
const types=['model','modelStatic','modelVehicle'];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function shootingPlan(actor){
 if(!actor?.isOwner||actor.pack||!['unit',...types].includes(actor.type))throw new Error('Choose an owned world model or squad.');
 const models=actor.type==='unit'?actor.members: [actor];
 const alive=models.filter(m=>m.visible!==false&&!m.system.dead&&m.isOwner);
 const rows=alive.flatMap(model=>Array.from(model.items??[]).filter(i=>i.type==='weapon').map(weapon=>({model,weapon,quantity:Number(weapon.system.quantity)||1,team:(weapon.system.traits??[]).includes('team')||['lmg','mmg','hmg'].includes(weapon.system.slug),loader:Boolean(model.system.isLoader||model.system.role==='loader')})));
 return {actor,rows,loaders:alive.filter(m=>m.system.isLoader||m.system.role==='loader').length,quality:actor.unit?.system.quality||actor.system.quality||'regular',pins:actor.unit?.system.pins??actor.system.pins??0};
}
export function validateFiringSelection(plan,values){
 const rows=plan.rows.map((row,i)=>{const count=Number(values['count'+i]),shots=Number(values['shots'+i]);if(!Number.isInteger(count)||count<0||count>row.quantity||!Number.isInteger(shots)||shots<1||shots>200)throw new Error('Invalid firing quantities.');return {...row,count,shots,loaderAvailable:Boolean(values['loader'+i])};}).filter(row=>row.count);
 if(!rows.length)throw new Error('Select at least one firing weapon.');
 if(rows.reduce((n,r)=>n+r.count*r.shots,0)>1000)throw new Error('Limit a single roll to 1000 dice.');
 for(const key of ['range','pins','extraModifier'])if(!Number.isFinite(Number(values[key])))throw new Error('Invalid shooting modifier.');
 return rows;
}
/** Always confirms situational inputs, including when called by a macro. No casualties are applied. */
export async function confirmShooting(actorOrUuid){
 const actor=typeof actorOrUuid==='string'?await fromUuid(actorOrUuid):actorOrUuid,plan=shootingPlan(actor);
 if(!plan.rows.length)throw new Error('This model or squad has no weapons.');
 const fields=[{name:'range',label:'Measured range (inches)',type:'number',value:12},{name:'pins',label:'Pins',type:'number',value:plan.pins},{name:'cover',label:'Target cover',options:['none','soft','hard']},{name:'moved',label:'Shooter moved',type:'checkbox'},{name:'targetDown',label:'Target is Down',type:'checkbox'},{name:'smallTeam',label:'Target is a small team',type:'checkbox'},{name:'extraModifier',label:'Other buffs (+) / debuffs (−), including traits',type:'number',value:0}];
 plan.rows.forEach((row,i)=>{fields.push({name:'count'+i,label:`${row.model.name}: ${row.weapon.name} — firing weapons (0–${row.quantity})`,type:'number',value:row.loader?0:row.quantity},{name:'shots'+i,label:`${row.weapon.name}: shots per weapon (confirm variable shots and special rules)`,type:'number',value:Number(row.weapon.system.shots)||1});if(row.team)fields.push({name:'loader'+i,label:`${row.weapon.name}: loader available and in position (${plan.loaders} marked loaders in selection)`,type:'checkbox',checked:plan.loaders>0});});
 const values=await ask('Confirm shooting',fields,'Confirm visibility, positioning, firing models, weapon shots and all trait modifiers. A missing team-weapon loader applies −1 to hit. Loader models default to not firing. HE, indirect fire, flamethrowers and damage allocation require manual resolution. Cancel makes no rolls.');
 if(!values)return null;
 const rows=validateFiringSelection(plan,values),rolls=[],results=[];
 for(const row of rows){const options={quality:plan.quality,range:Number(values.range),weaponRange:row.weapon.system.range,pins:Number(values.pins),moved:values.moved,targetDown:values.targetDown,smallTeam:values.smallTeam,cover:values.cover,extraModifier:Number(values.extraModifier)-(row.team&&!row.loaderAvailable?1:0),assault:(row.weapon.system.traits??[]).includes('assault')};const target=shootingTarget(options);if(!target.inRange){results.push({name:row.weapon.name,hits:0,note:'Out of range',count:row.count,shots:row.shots});continue;}
 const roll=await new Roll(`${row.count*row.shots}d6`).evaluate();rolls.push(roll);const dice=roll.dice.flatMap(d=>d.results.filter(r=>r.active!==false).map(r=>r.result));let followupDice=[];
 if(target.sixSix&&dice.includes(6)){const followup=await new Roll(`${dice.filter(v=>v===6).length}d6`).evaluate();rolls.push(followup);followupDice=followup.dice.flatMap(d=>d.results.map(r=>r.result));}
 results.push({name:row.weapon.name,...resolveHits({...options,dice,followupDice}),count:row.count,shots:row.shots});}
 await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),rolls,content:`<h3>${esc(actor.name)} — shooting</h3><p>Range ${esc(values.range)}″ · pins ${esc(values.pins)} · cover ${esc(values.cover)} · moved ${Boolean(values.moved)} · Down ${Boolean(values.targetDown)} · small team ${Boolean(values.smallTeam)} · other modifier ${esc(values.extraModifier)}</p>${results.map(r=>`<p>${esc(r.name)}: ${r.count} × ${r.shots} shots, ${r.hits} hits (${esc(r.note|| (r.sixSix?'6 then 6':r.target+'+'))}); modifiers ${esc(JSON.stringify(r.modifiers??{}))}</p>`).join('')}<p>Allocate damage and casualties manually.</p>`});
 return {actorUuid:actor.uuid,results};
}
