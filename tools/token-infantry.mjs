/** Run: node tools/token-infantry.mjs. Runtime layer composition covers every role/loadout combination. */
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {renderInfantry,infantryWeaponSlugs} from '../scripts/token-art/infantry.mjs';
import {palettes} from '../scripts/services/faction-appearance.mjs';
const base=new URL('../assets/tokens/infantry/',import.meta.url);
for(const [faction,palette] of Object.entries(palettes)){const dir=new URL(faction+'/',base);await mkdir(dir,{recursive:true});for(const weaponSlug of infantryWeaponSlugs)await writeFile(new URL(weaponSlug+'.svg',dir),renderInfantry({palette,weaponSlug}));}
console.log(`Generated ${Object.keys(palettes).length*infantryWeaponSlugs.length} infantry base tokens in ${fileURLToPath(base)}`);
