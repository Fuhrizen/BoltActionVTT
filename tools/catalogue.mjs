import {readFile} from 'node:fs/promises';
import {CATALOGUE_FILES,validateCatalogue} from '../scripts/services/catalogue.mjs';
export async function readCatalogue() {
  const entries = await Promise.all(CATALOGUE_FILES.map(async key => {
    const source = await readFile(new URL(`../compendiums/${key}.json`,import.meta.url),'utf8');
    return [key, JSON.parse(source)];
  }));
  return validateCatalogue(Object.fromEntries(entries));
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1],`file://${process.cwd()}/`).href) {
  const data = await readCatalogue();
  console.log(CATALOGUE_FILES.map(key => `${key}: ${data[key].length}`).join(', '));
}
