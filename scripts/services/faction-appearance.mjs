// A consistent tabletop palette, rather than a claim about every historical uniform or theatre.
const palettes = Object.freeze({
  germany:{color:'#37a6b2',uniform:'#62747b',helmet:'#435b65',highlight:'#8ca0a8'},
  'united-states':{color:'#3f8f45',uniform:'#526844',helmet:'#354c32',highlight:'#758c5b'},
  'great-britain':{color:'#c8494d',uniform:'#8b7958',helmet:'#746344',highlight:'#ae9a70'},
  'soviet-union':{color:'#e4a63c',uniform:'#8c8653',helmet:'#6c723e',highlight:'#aaa26c'},
  'imperial-japan':{color:'#a36ed0',uniform:'#a28e59',helmet:'#7d7948',highlight:'#c0aa73'}
});
const root = 'systems/boltaction/assets';

export function factionAppearance(factionSlug, actorType = 'model') {
  const palette = palettes[factionSlug];
  const slug = palette ? factionSlug : '';
  const directory = palette ? `${root}/factions/${slug}` : root;
  const vehicle = actorType === 'modelVehicle';
  const group = ['army','unit'].includes(actorType) ? actorType : null;
  return {slug,color:palette?.color ?? '#758353',img:`${directory}/${group ?? (vehicle?'vehicle-token':'soldier')}.svg?v=13`,tokenSrc:`${directory}/${group ?? (vehicle?'vehicle-token':'model-token')}.svg?v=13`};
}

/** Only system-provided defaults  are eligible for automatic recolouring. */
export function isDefaultModelArt(path) {
  if (!path) return true;
  return typeof path === 'string' && /^systems\/boltaction\/assets\/(?:factions\/(?:germany|united-states|great-britain|soviet-union|imperial-japan)\/)?(?:soldier|model-token|vehicle-token|army|unit)\.svg$/.test(path.split(/[?#]/)[0]);
}
