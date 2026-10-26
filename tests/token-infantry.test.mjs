import test from 'node:test';
import assert from 'node:assert/strict';
import {renderInfantry,infantryWeaponSlugs,infantryKey} from '../fvtt/scripts/token-art/infantry.mjs';
test('infantry layers are deterministic for unordered role and equipment selections',()=>{assert.equal(renderInfantry({roles:['nco','medic'],extras:['panzerfaust','pistol']}),renderInfantry({roles:['medic','nco','nco'],extras:['pistol','panzerfaust']}));assert.equal(infantryKey({roles:['medic','nco']}),'rifle--role-medic--role-nco');});
test('all infantry weapons produce distinct centred SVG profiles',()=>{const profiles=infantryWeaponSlugs.map(weaponSlug=>renderInfantry({weaponSlug}));assert.equal(new Set(profiles).size,infantryWeaponSlugs.length);for(const svg of profiles){assert.match(svg,/viewBox="0 0 128 128"/);assert.match(svg,/translate\(64 70\)/);assert.doesNotMatch(svg,/NaN|undefined|https?:\/\/(?!www.w3.org)/);}});
test('infantry arbitrary palette values and labels are escaped',()=>{const svg=renderInfantry({palette:{uniform:'"><script>alert(1)</script>'},roles:['<bad>']});assert.doesNotMatch(svg,/<script>|<bad>/);assert.match(svg,/&lt;script&gt;/);});
