import {ask} from './dialogs.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function chooseUpgrade(unit){
 const profile=unit.getFlag('boltaction','profile');
 if(!profile?.options?.length)throw new Error('This unit has no catalogue upgrade options.');
 const choice=await ask('Choose a roster upgrade',[{name:'optionIndex',label:'Upgrade',options:profile.options.map((o,i)=>({value:String(i),label:(o.weaponSlug||o.option||o.variant||'Option '+(i+1)).replaceAll('-',' ')}))},{name:'count',label:'Quantity (vehicle or unit options)',type:'number',value:1}]);
 if(!choice)return;
 const models=unit.livingMembers;
 const content=`<div><p>Select the soldiers receiving this upgrade and any required loaders. Loaders keep their personal weapons but cannot fire them while assisting the team weapon.</p>${models.map(m=>`<div class="form-group"><span>${esc(m.name)}</span><label><input type="checkbox" name="gunner" value="${esc(m.uuid)}"> Upgrade</label><label><input type="checkbox" name="loader" value="${esc(m.uuid)}"> Loader</label></div>`).join('')}</div>`;
 const selected=models.length?await foundry.applications.api.DialogV2.wait({window:{title:'Assign equipment'},content,buttons:[{action:'choose',label:'Preview',default:true,callback:(_e,button)=>({modelUuids:[...button.form.querySelectorAll('[name="gunner"]:checked')].map(e=>e.value),loaderUuids:[...button.form.querySelectorAll('[name="loader"]:checked')].map(e=>e.value)})},{action:'cancel',label:'Cancel',callback:()=>false}],rejectClose:false}):{};
 if(!selected)return;
 const options={...selected,optionIndex:Number(choice.optionIndex),count:selected.modelUuids?.length||choice.count};
 const preview=await game.boltaction.previewUpgrade(unit,options);
 const confirmed=await foundry.applications.api.DialogV2.confirm({window:{title:'Confirm roster upgrade'},content:`<p>${esc(preview.label)}: ${esc(preview.cost)} points. Unit total ${esc(preview.pointsBefore)} → ${esc(preview.pointsAfter)}.</p>`,rejectClose:false});
 if(confirmed)return game.boltaction.applyUpgrade(unit,options);
}
