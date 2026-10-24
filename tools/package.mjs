import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
const directories = ['scripts', 'templates', 'styles', 'assets', 'lang', 'compendiums'];
const allowed = {
  scripts: /\.mjs$/i, templates: /\.hbs$/i, styles: /\.css$/i,
  assets: /\.(svg|png|jpe?g|webp|gif|avif|ogg|mp3|wav|woff2?)$/i,
  lang: /\.json$/i, compendiums: /\.json$/i
};
export async function releaseFiles(base = root) {
  const files = ['README.md', 'system.json'];
  async function walk(dir) {
    for (const entry of await readdir(path.join(base, dir), { withFileTypes: true })) {
      const name = `${dir}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Release symlink forbidden: ${name}`);
      if (entry.name.startsWith('.') || /\.(pdf|docx?|absdoc|map)$/i.test(name)) throw new Error(`Unexpected release file: ${name}`);
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) {
        if (!allowed[dir.split('/')[0]].test(name)) throw new Error(`Unexpected release file type: ${name}`);
        files.push(name);
      }
    }
  }
  for (const dir of directories) await walk(dir);
  return files.sort();
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Stored ZIP entries need no executable, package dependency, or platform-specific shell.
export function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const filename = Buffer.from(name);
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6); header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, data);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8);
    directory.writeUInt16LE(33, 14); directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, filename);
    offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export async function build() {
  const manifest = JSON.parse(await readFile(path.join(root, 'system.json'), 'utf8'));
  const entries = await Promise.all((await releaseFiles()).map(async name => ({ name: `boltaction/${name}`, data: await readFile(path.join(root, name)) })));
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await writeFile(path.join(root, 'dist/boltaction.zip'), zip(entries));
  await writeFile(path.join(root, 'dist/system.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Packaged ${entries.length} files for boltaction ${manifest.version}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
