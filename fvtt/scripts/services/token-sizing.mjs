/** Configurable tabletop footprints, not claims about historical vehicle dimensions. */
export const DEFAULT_TOKEN_FOOTPRINTS = Object.freeze({
  infantry:{width:1,height:1},static:{width:2,height:2},
  vehicleLight:{width:2,height:3},vehicleMedium:{width:2,height:3},vehicleHeavy:{width:3,height:4}
});
const flag = (actor,key) => actor?.getFlag?.('boltaction',key) ?? actor?.flags?.boltaction?.[key];
const valid = footprint => footprint && ['width','height'].every(key=>typeof footprint[key]==='number' && Number.isFinite(footprint[key]) && footprint[key]>0 && footprint[key]<=20);
export function tokenFootprint(actor, {footprints} = {}) {
  const profile=flag(actor,'profile') ?? {};
  const specific=flag(actor,'tokenSize') ?? profile.tokenSize ?? actor?.system?.tokenSize;
  if(valid(specific))return {width:specific.width,height:specific.height};
  let key='infantry';
  if(actor?.type==='modelStatic')key=actor.system?.role==='crew'?'infantry':'static';
  if(actor?.type==='modelVehicle'){
    const category=typeof specific==='string'?specific:profile.vehicleClass ?? actor.system?.vehicleClass;
    const damage=Number(actor.system?.damageValue ?? profile.damageValue ?? 7);
    key=category==='heavy'||!category&&damage>=10?'vehicleHeavy':category==='light'||!category&&damage<=8?'vehicleLight':'vehicleMedium';
  }
  let configured=footprints;
  if(!configured)try{configured={[key]:{width:globalThis.game?.settings?.get('boltaction',`tokenSize_${key}_width`),height:globalThis.game?.settings?.get('boltaction',`tokenSize_${key}_height`)}};}catch{/* Settings may not be ready while importing a source profile. */}
  const selected=configured?.[key];
  return {...(valid(selected)?selected:DEFAULT_TOKEN_FOOTPRINTS[key])};
}
export function preservesTokenSize(source) {
  return source?.flags?.boltaction?.preserveTokenTransform===true || source?.flags?.boltaction?.preserveTokenSize===true || source?.flags?.boltaction?.preserveTokenDimensions===true;
}
