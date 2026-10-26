import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, systemRoot, releaseFiles } from './package.mjs';

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
async function walk(dir) {
  const result = [];
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ['node_modules', 'dist'].includes(entry.name)) continue;
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await walk(name));
    else result.push(name);
  }
  return result;
}
const files = await walk('');
for (const name of files) {
  const full = path.join(root, name);
  if (name.endsWith('.json')) {
    try { JSON.parse(await readFile(full, 'utf8')); } catch (error) { failures.push(`${name}: ${error.message}`); }
  }
  if (!name.endsWith('.mjs')) continue;
  const syntax = spawnSync(process.execPath, ['--check', full], { encoding: 'utf8' });
  check(syntax.status === 0, `${name}: ${syntax.stderr}`);
  const source = await readFile(full, 'utf8');
  for (const match of source.matchAll(/(?:from\s*|import\s*\()(['"])([^'"]+)\1/g)) {
    const specifier = match[2];
    // Scaffold source embeds generated import statements in template literals.
    if (specifier.includes('${')) continue;
    if (specifier.startsWith('.')) {
      const resolved = path.resolve(path.dirname(full), specifier);
      check(resolved.startsWith(root), `${name}: import escapes repository`);
      check(await stat(resolved).then(s => s.isFile()).catch(() => false), `${name}: missing import ${specifier}`);
    } else check(!name.startsWith('fvtt/scripts') || specifier.startsWith('node:') === false && specifier.startsWith('systems/'), `${name}: external runtime import ${specifier}`);
  }
}
const manifest = JSON.parse(await readFile(path.join(systemRoot, 'system.json'), 'utf8'));
check(manifest.id === 'boltaction', 'Manifest ID must be boltaction');
check(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version), 'Manifest version must be semantic');
check(String(manifest.compatibility?.minimum) === '14', 'Foundry minimum must be 14');
check(manifest.compatibility?.verified === undefined || String(manifest.compatibility.verified) === '14', 'Foundry verified, if declared, must be 14');
for (const url of ['manifest', 'download']) check(/^https:\/\/github\.com\/Fuhrizen\/BoltActionVTT\/releases\//.test(manifest[url] ?? ''), `Manifest ${url} must use canonical GitHub releases`);
check(manifest.manifest === 'https://github.com/Fuhrizen/BoltActionVTT/releases/latest/download/system.json', 'Manifest URL must point to latest release system.json');
check(manifest.download?.endsWith('/boltaction.zip'), 'Download URL must name boltaction.zip');
check(manifest.compatibility?.maximum === '14' || manifest.compatibility?.maximum === 14, 'Foundry maximum must be 14');
check((manifest.esmodules ?? []).length > 0, 'Manifest needs an ES module entry point');
check(manifest.download?.includes(`/v${manifest.version}/`), 'Download URL must match version');
const tag = process.env.RELEASE_TAG;
if (tag) check(tag === `v${manifest.version}`, `Release tag ${tag} does not match v${manifest.version}`);
const release = await releaseFiles();
for (const name of [...(manifest.esmodules ?? []), ...(manifest.styles ?? []).map(style => typeof style === 'string' ? style : style.src), ...(manifest.languages ?? []).map(language => language.path)]) check(release.includes(name), `Missing manifest asset ${name}`);
for (const name of release.filter(name => name.endsWith('.hbs'))) {
  const source = await readFile(path.join(systemRoot, name), 'utf8');
  check(!source.includes('{{{'), `${name}: unescaped triple braces forbidden`);
  const blocks = [];
  for (const match of source.matchAll(/{{\s*([#/])\s*([\w.]+)/g)) {
    if (match[1] === '#') blocks.push(match[2]);
    else check(blocks.pop() === match[2], `${name}: mismatched block ${match[2]}`);
  }
  check(blocks.length === 0, `${name}: unclosed template blocks`);
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Validated ${files.length} source files and ${release.length} release files.`);
