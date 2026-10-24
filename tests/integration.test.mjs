import test from 'node:test';
import assert from 'node:assert/strict';
import { zip, releaseFiles, root } from '../tools/package.mjs';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import {phases, validateGraph, nextTasks} from '../tools/tasks.mjs';

test('task planner validates the dependency graph and offers only unblocked incomplete phases', () => {
  assert.equal(validateGraph().size, phases.length);
  assert.deepEqual(nextTasks().map(task => task.id), ['understanding']);
  assert.deepEqual(nextTasks(['understanding']).map(task => task.id), ['transfer']);
  const completed = phases.filter(phase => !['production', 'foundry-validation'].includes(phase.id)).map(phase => phase.id);
  assert.deepEqual(nextTasks(completed).map(task => task.id), ['production']);
  assert.deepEqual(nextTasks(phases.map(phase => phase.id)), []);
  assert.throws(() => nextTasks(['unknown']), /Unknown completed/);
  assert.throws(() => validateGraph([{id: 'one', needs: ['missing']}]), /Unknown dependency/);
  assert.throws(() => validateGraph([{id: 'one', needs: []}, {id: 'one', needs: []}]), /Duplicate/);
  assert.throws(() => validateGraph([{id: 'one', needs: ['two']}, {id: 'two', needs: ['one']}]), /cycle/);
});

test('ZIP writer preserves payload, name, CRC and directory offsets deterministically', () => {
  const entries = [{ name: 'boltaction/test.txt', data: Buffer.from('123456789') }];
  const archive = zip(entries);
  assert.deepEqual(archive, zip(entries));
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.equal(archive.readUInt32LE(14), 0xcbf43926);
  const length = archive.readUInt16LE(26);
  assert.equal(archive.subarray(30, 30 + length).toString(), entries[0].name);
  assert.equal(archive.subarray(30 + length, 39 + length).toString(), '123456789');
  const end = archive.length - 22;
  assert.equal(archive.readUInt32LE(end), 0x06054b50);
  assert.equal(archive.readUInt16LE(end + 10), 1);
  assert.equal(archive.readUInt32LE(archive.readUInt32LE(end + 16)), 0x02014b50);
});

test('release whitelist excludes development and private material', async () => {
  const files = await releaseFiles();
  assert.ok(files.includes('system.json'));
  assert.ok(files.includes('README.md'));
  assert.ok(files.every(name => !/(?:^|\/)(?:tests|tools|private|node_modules|docs)(?:\/|$)|\.(?:pdf|absdoc|docx)$/i.test(name)));
});

test('release collection ignores root private material and rejects symlinks and source documents', async () => {
  const base = await mkdtemp(path.join(root, '.test-package-'));
  try {
    for (const dir of ['scripts', 'templates', 'styles', 'assets', 'lang', 'compendiums', 'private', 'tests']) await mkdir(path.join(base, dir));
    await writeFile(path.join(base, 'private/rules.pdf'), 'private');
    await writeFile(path.join(base, 'tests/example.mjs'), 'test');
    await writeFile(path.join(base, 'scripts/main.mjs'), 'export {};');
    assert.deepEqual(await releaseFiles(base), ['README.md', 'scripts/main.mjs', 'system.json']);
    await writeFile(path.join(base, 'assets/design.md'), 'source');
    await assert.rejects(releaseFiles(base), /Unexpected release file type/);
    await rm(path.join(base, 'assets/design.md'));
    await symlink(path.join(base, 'private/rules.pdf'), path.join(base, 'assets/leak.svg'));
    await assert.rejects(releaseFiles(base), /symlink forbidden/);
  } finally { await rm(base, { recursive: true, force: true }); }
});
