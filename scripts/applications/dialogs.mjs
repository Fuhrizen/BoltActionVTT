const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function ask(title, fields, note = '') {
  const content = `<div class="boltaction dialog-fields">${note ? `<p class="advisory">${esc(note)}</p>` : ''}${fields.map(f => `<div class="form-group"><label>${esc(f.label)}</label>${f.options ? `<select name="${esc(f.name)}">${f.options.map(o => `<option value="${esc(o.value ?? o)}" ${(o.value ?? o) === (f.selected ?? f.value) ? 'selected' : ''}>${esc(o.label ?? o)}</option>`).join('')}</select>` : `<input name="${esc(f.name)}" type="${f.type ?? 'text'}" value="${esc(f.value ?? '')}" ${f.type === 'number' ? 'step="any"' : ''}>`}</div>`).join('')}</div>`;
  return foundry.applications.api.DialogV2.wait({window:{title},content,buttons:[{action:'confirm',label:'Confirm',default:true,callback:(_event,_button,dialog) => {
    const root = dialog.element;
    return Object.fromEntries(fields.map(f => {const e = root.querySelector(`[name="${f.name}"]`); return [f.name, f.type === 'checkbox' ? e.checked : f.type === 'number' ? (f.optional && e.value.trim() === '' ? undefined : Number(e.value)) : e.value];}));
  }},{action:'cancel',label:'Cancel',callback:()=>false}],rejectClose:false});
}
export async function createSquad() {
  const data = await ask('Create an infantry squad', [{name:'name',label:'Squad name',value:'Infantry squad'},{name:'count',label:'Soldiers',type:'number',value:5},{name:'quality',label:'Experience',selected:'regular',options:['inexperienced','regular','veteran']},{name:'side',label:'Side',value:'allies'}]);
  if (data) return game.boltaction.createSquad(data);
}
export function weaponOptions(unit) {
  const groups = new Map();
  for (const weapon of unit.weapons) {
    const p = weapon.system ?? {};
    const key = unit.system.kind === 'vehicle' ? weapon.uuid : JSON.stringify([p.slug,p.range,p.shots,p.penetration,[...(p.traits ?? [])].sort()]);
    const group = groups.get(key) ?? []; group.push(weapon); groups.set(key,group);
  }
  return [...groups.values()].map(group=>({value:group[0].uuid,label:`${group[0].name} × ${group.length}${group.length===1 && group[0].parent?.name ? ' · '+group[0].parent.name : ''}`}));
}
export async function attack(unit, assault = false) {
  const targets = game.actors.filter(a => a.type === 'unit' && a.visible !== false && a.uuid !== unit.uuid && !a.isDestroyed);
  const fields = [{name:'targetUuid',label:'Target unit',options:targets.map(a => ({value:a.uuid,label:a.name}))}];
  if (!targets.length) throw new Error('Create a target unit first.');
  if (!assault) fields.push({name:'weaponId',label:'Weapon',options:weaponOptions(unit)},{name:'shots',label:'Shots (blank uses weapon profile)',type:'number',optional:true},{name:'mode',label:'Firing mode',options:[{value:'direct',label:'Direct / armour-piercing'},{value:'he',label:'HE (manual)'},{value:'indirect',label:'Indirect (manual)'}]},{name:'range',label:'Measured range (inches)',type:'number',value:12},{name:'cover',label:'Cover',options:['none','soft','hard']},{name:'moved',label:'Shooter moved',type:'checkbox'},{name:'targetDown',label:'Target is Down',type:'checkbox'},{name:'smallTeam',label:'Target is a small team',type:'checkbox'},{name:'extraModifier',label:'Other hit modifier (signed)',type:'number',value:0},{name:'penetrationModifier',label:'Other penetration modifier',type:'number',value:0},{name:'facing',label:'Armour facing',options:['front','side','rear','top']},{name:'apply',label:'Apply eligible pin results',type:'checkbox'});
  else fields.push({name:'attackerDice',label:'Attacker attacks (manual)',type:'number',value:unit.livingMembers.length || 1},{name:'defenderDice',label:'Defender attacks (manual)',type:'number',value:1},{name:'range',label:'Measured charge range (inches)',type:'number',value:12},{name:'defensivePosition',label:'Defender in a defensive position (simultaneous attacks)',type:'checkbox'},{name:'reactionsResolved',label:'Charge, terrain and reaction fire have been resolved',type:'checkbox'});
  const data = await ask(assault ? 'Resolve close quarters' : 'Resolve shooting',fields,'Measure and confirm all situational inputs. Special rules, HE, indirect fire, buildings, assault reactions and tied exchanges require manual adjudication. Allocate casualties manually on the soldier roster after reviewing the result.');
  if (data) return game.boltaction[assault ? 'assault':'shoot'](unit,data);
}
export async function safely(callback) {try {return await callback();} catch(error) {console.error('Bolt Action',error);ui.notifications.error(error.message);}}
