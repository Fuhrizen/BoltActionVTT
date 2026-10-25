// A consistent tabletop palette, rather than a claim about every historical uniform or theatre.
const palettes = Object.freeze({
  germany:{color:'#65736b',uniform:'#667267',helmet:'#526257',highlight:'#8d998a'},
  'united-states':{color:'#728052',uniform:'#78815a',helmet:'#5c6c42',highlight:'#96a16b'},
  'great-britain':{color:'#8b7958',uniform:'#8b7958',helmet:'#746344',highlight:'#ae9a70'},
  'soviet-union':{color:'#8c8653',uniform:'#8c8653',helmet:'#6c723e',highlight:'#aaa26c'},
  'imperial-japan':{color:'#a28e59',uniform:'#a28e59',helmet:'#7d7948',highlight:'#c0aa73'}
});
const root = 'systems/boltaction/assets';

export function factionAppearance(factionSlug, actorType = 'model') {
  const palette = palettes[factionSlug];
  const slug = palette ? factionSlug : '';
  const directory = palette ? `${root}/factions/${slug}` : root;
  const vehicle = actorType === 'modelVehicle';
  return {slug,color:palette?.color ?? '#758353',img:`${directory}/${vehicle?'vehicle-token':'soldier'}.svg`,tokenSrc:`${directory}/${vehicle?'vehicle-token':'model-token'}.svg`};
}

/** Only system-provided defaults and Foundry's empty portrait are eligible for automatic recolouring. */
export function isDefaultModelArt(path) {
  if (!path || path === 'icons/svg/mystery-man.svg') return true;
  return /^systems\/boltaction\/assets\/(?:factions\/(?:germany|united-states|great-britain|soviet-union|imperial-japan)\/)?(?:soldier|model-token|vehicle-token)\.svg$/.test(path);
}
