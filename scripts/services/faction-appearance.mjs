// A consistent tabletop palette, rather than a claim about every historical uniform or theatre.
export const palettes = Object.freeze({
 germany:{color:'#7f8c99',uniform:'#65717d',helmet:'#454f59',highlight:'#929eaa'},
 'united-states':{color:'#387be0',uniform:'#476c9c',helmet:'#304d73',highlight:'#7697c2'},
 'great-britain':{color:'#388b4a',uniform:'#526f42',helmet:'#344d31',highlight:'#7fa367'},
 'soviet-union':{color:'#d44949',uniform:'#9b4c43',helmet:'#71362f',highlight:'#c77a68'},
 'imperial-japan':{color:'#e4a22c',uniform:'#b58b3f',helmet:'#80672e',highlight:'#d9b966'}
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
  if (isGeneratedTokenArt(path)) return true;
  if(typeof path==='string'&&/^systems\/boltaction\/assets\/tokens\/(infantry|vehicles)\/[a-z0-9-]+\/[a-z0-9-]+\.svg(?:[?#].*)?$/.test(path))return true;
  return typeof path === 'string' && /^systems\/boltaction\/assets\/(?:factions\/(?:germany|united-states|great-britain|soviet-union|imperial-japan)\/)?(?:soldier|model-token|vehicle-token|army|unit)\.svg$/.test(path.split(/[?#]/)[0]);
}

export const GENERATED_ART_PREFIX='data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<!--boltaction-generated:v1-->');
export function isGeneratedTokenArt(path){return typeof path==='string'&&(path.startsWith(GENERATED_ART_PREFIX)||/^systems\/boltaction\/assets\/tokens\/(infantry|vehicles)\//.test(path));}
