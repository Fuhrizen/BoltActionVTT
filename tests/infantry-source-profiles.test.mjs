import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const units=JSON.parse(await readFile(new URL('../compendiums/units.json',import.meta.url),'utf8'));
test('source infantry composition includes Japan seven-model exception and late-war militia',()=>{
 const infantry=units.filter(r=>r.profile?.entryName);
 assert.equal(infantry.length,15);
 for(const row of infantry){const p=row.profile;assert.equal(p.ncoCount,1,row.slug);assert.equal(p.baseModels,row.slug.startsWith('imperial-japan-')&&!row.slug.endsWith('militia')?7:5,row.slug);assert.ok(p.sourcePage);}
});
test('tier source entries preserve distinct prices, names and weapon allowances',()=>{
 const find=s=>units.find(r=>r.slug===s).profile;
 const brit=find('great-britain-regular-infantry'),veteran=find('great-britain-veteran-infantry');
 assert.equal(brit.basePoints,50);assert.equal(veteran.basePoints,65);assert.notEqual(brit.entryName,veteran.entryName);
 assert.equal(brit.options.find(o=>o.weaponSlug==='smg').max,2);assert.equal(veteran.options.find(o=>o.weaponSlug==='smg').max,5);
 assert.equal(find('imperial-japan-militia').extraModelPoints,5);
});
