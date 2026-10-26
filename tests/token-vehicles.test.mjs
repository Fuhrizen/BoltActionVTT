import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderVehicle,vehicleShape} from '../scripts/token-art/vehicles.mjs';
import {vehicleTokenAssets} from '../scripts/token-art/vehicle-manifest.mjs';
const rows=JSON.parse(await readFile(new URL('../compendiums/units.json',import.meta.url),'utf8')).filter(r=>r.system.kind==='vehicle');
test('every source vehicle has a deterministic checked-in token and shared heading',async()=>{
 assert.equal(Object.keys(vehicleTokenAssets).length,rows.length);
 for(const row of rows){assert.equal(renderVehicle({row}),renderVehicle({row}));const svg=await readFile(new URL('../'+vehicleTokenAssets[row.slug],import.meta.url),'utf8');assert.match(svg,/viewBox="0 0 128 128"/);assert.match(svg,/front points up/);assert.ok(!svg.includes('<script'));}
});
test('vehicle families and upgrades alter silhouette layers without changing anchors',()=>{
 const truck=rows.find(r=>r.name==='Truck'),tank=rows.find(r=>r.slug==='germany-tiger-i');
 assert.equal(vehicleShape(truck).truck,true);assert.equal(vehicleShape(tank).heavy,true);
 const base=renderVehicle({row:tank}),upgrade=renderVehicle({row:tank,options:['pintle-hmg','flamethrower','armour-skirts']});assert.notEqual(base,upgrade);assert.match(upgrade,/viewBox="0 0 128 128"/);
});
test('vehicle labels are escaped and every profile produces a distinct SVG',()=>{
 const output=rows.map(row=>renderVehicle({row}));assert.equal(new Set(output).size,rows.length);assert.ok(!renderVehicle({row:{name:'<script>x</script>'}}).includes('<script>'));
});
