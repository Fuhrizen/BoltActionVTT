import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import path from 'node:path';
import {root,releaseFiles,zip} from './package.mjs';
const files=(await releaseFiles()).filter(p=>/^(scripts|compendiums|assets)\//.test(p)).map(p=>'fvtt/'+p);
async function walk(dir){for(const entry of await readdir(path.join(root,dir),{withFileTypes:true})){const name=dir+'/'+entry.name;if(entry.isSymbolicLink())throw Error('Web symlinks forbidden');if(entry.isDirectory())await walk(name);else if(/\.(html|mjs|js|css)$/.test(name))files.push(name);}}
await walk('web');
const entries=await Promise.all(files.sort().map(async name=>({name,data:await readFile(path.join(root,name))})));
entries.push({name:'index.html',data:Buffer.from('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=web/"><a href="web/">Open army builder</a>')});
await mkdir(path.join(root,'dist'),{recursive:true});await writeFile(path.join(root,'dist/web-builder.zip'),zip(entries));console.log(`Packaged standalone web builder (${entries.length} files).`);
