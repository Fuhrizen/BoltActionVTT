import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { root } from './package.mjs';

const name = process.argv[2];
if (!/^[a-z][a-z0-9-]*$/.test(name ?? '')) throw new Error('Usage: npm run scaffold -- feature-name');
await mkdir(path.join(root, 'fvtt/scripts/services'), { recursive: true });
await mkdir(path.join(root, 'tests'), { recursive: true });
for (const [file, content] of [
  [`fvtt/scripts/services/${name}.mjs`, `// Pure feature entry point; add Foundry integration through the public API.\nexport function ${name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())}(value) {\n  return value;\n}\n`],
  [`tests/${name}.test.mjs`, `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { ${name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())} } from '../fvtt/scripts/services/${name}.mjs';\n\ntest.todo('${name}: replace with a behavior assertion');\n`]
]) {
  try { await writeFile(path.join(root, file), content, { flag: 'wx' }); console.log(`Created ${file}`); }
  catch (error) { if (error.code !== 'EEXIST') throw error; console.log(`Kept existing ${file}`); }
}
