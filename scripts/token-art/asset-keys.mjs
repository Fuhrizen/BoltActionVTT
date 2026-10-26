import {infantryWeaponSlugs} from './infantry.mjs';
export const infantryRoles=['','nco','loader','medic','observer','crew'];
export const personalWeapons=['unarmed','rifle','pistol','smg','automatic-rifle','assault-rifle','lmg','anti-tank-rifle','piat','bazooka','panzerschreck','infantry-flamethrower'];
export function infantryAssetKey({weaponSlug='rifle',roles=[],extras=[]}={}) {
 const primary=infantryWeaponSlugs.includes(weaponSlug)?weaponSlug:'rifle';
 const role=infantryRoles.slice(1).find(r=>roles.includes(r))||'';
 const secondary=extras.includes('panzerfaust')&&primary!=='panzerfaust'?'panzerfaust':'';
 return primary+(role?'--'+role:'')+(secondary?'--'+secondary:'');
}
export const vehicleLayers=['hmg','flame','howitzer','dozer','capacity','skirts','enclosed','upgrade'];
export function vehicleVisualKey(options=[]){
 const text=options.map(o=>typeof o==='string'?o:JSON.stringify(o)).join(' ').toLowerCase();
 const bits=[/hmg|pintle|additional.mmg/,/flame/,/howitzer|105/,/dozer/,/capacity|transport/,/skirts|armour/,/enclosed/,/./];
 return bits.reduce((key,re,i)=>key|(re.test(text)?1<<i:0),0);
}
export function vehicleVisualLabels(key){return vehicleLayers.filter((_,i)=>key&(1<<i));}
