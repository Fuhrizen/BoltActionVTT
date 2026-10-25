import test from 'node:test';
import assert from 'node:assert/strict';
import {buildActorTree, renderActorDirectoryHierarchy, registerActorDirectoryHierarchy} from '../scripts/applications/actor-directory.mjs';

const actor = (id, type, system = {}, extra = {}) => ({id, uuid: `Actor.${id}`, name: id, type,
  documentName: 'Actor', visible: true, isOwner: true, system, ...extra});

test('hierarchy accepts reciprocal visible membership, deduplicates and retains orphans', () => {
  const team = actor('team', 'army', {unitUuids: ['squad', 'squad', 'wrong', 'hidden'] .map(id => `Actor.${id}`)});
  const squad = actor('squad', 'unit', {armyUuid: team.uuid, modelUuids: ['i', 's', 'v', 'stale', 'i'].map(id => `Actor.${id}`)});
  const models = ['model', 'modelStatic', 'modelVehicle'].map((type, i) => actor(['i', 's', 'v'][i], type, {unitUuid: squad.uuid}));
  const wrong = actor('wrong', 'unit', {armyUuid: 'Actor.another'});
  const hidden = actor('hidden', 'unit', {armyUuid: team.uuid}, {visible: false});
  const stale = actor('stale', 'model', {unitUuid: 'Actor.another'});
  const roots = buildActorTree({contents: [team, squad, ...models, wrong, hidden, stale]});
  assert.deepEqual(roots.map(node => node.actor.id), ['team', 'wrong', 'stale']);
  assert.deepEqual(roots[0].children.map(node => node.actor.id), ['squad']);
  assert.deepEqual(roots[0].children[0].children.map(node => node.actor.id), ['i', 's', 'v']);
});

test('hidden or absent parents leave visible children at root and packs are excluded', () => {
  const team = actor('team', 'army', {unitUuids: ['Actor.squad']}, {visible: false});
  const squad = actor('squad', 'unit', {armyUuid: team.uuid, modelUuids: ['Actor.model']});
  const model = actor('model', 'model', {unitUuid: squad.uuid});
  const pack = actor('pack', 'model', {}, {pack: 'boltaction.models'});
  const roots = buildActorTree([team, squad, model, pack]);
  assert.deepEqual(roots.map(node => node.actor.id), ['squad']);
  assert.equal(roots[0].children[0].actor, model);
  assert.equal(buildActorTree([model])[0].actor, model);
});

// A small DOM fixture exercises identity and nesting without a browser dependency.
class Element {
  constructor(tagName, document, nodeType = 1) {
    this.tagName = tagName.toUpperCase(); this.ownerDocument = document; this.nodeType = nodeType;
    this.childNodes = []; this.parentNode = null; this.dataset = {}; this.attributes = {};
    this.listeners = new Map(); this.className = ''; this.hidden = false;
  }
  append(...nodes) {for (const node of nodes) this.insertBefore(node, null);}
  insertBefore(node, reference) {
    node.remove();
    const index = reference ? this.childNodes.indexOf(reference) : this.childNodes.length;
    assert.ok(index >= 0, 'reference is a child');
    this.childNodes.splice(index, 0, node); node.parentNode = this; return node;
  }
  remove() {if (this.parentNode) {const list = this.parentNode.childNodes; list.splice(list.indexOf(this), 1); this.parentNode = null;}}
  contains(node) {return node === this || this.childNodes.some(child => child.contains(node));}
  setAttribute(name, value) {this.attributes[name] = String(value);}
  getAttribute(name) {return this.attributes[name];}
  matches(selector) {
    return selector.split(',').some(part => {
      part = part.trim();
      if (part.startsWith('.')) return this.className.split(' ').includes(part.slice(1));
      const attr = part.match(/^(\w+)?\[([^=\]]+)(?:="([^"]*)")?\]$/);
      if (attr) {
        if (attr[1] && this.tagName !== attr[1].toUpperCase()) return false;
        const name = attr[2];
        const value = name.startsWith('data-') ? this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] : this.attributes[name];
        return attr[3] === undefined ? value !== undefined : value === attr[3];
      }
      return this.tagName === part.toUpperCase();
    });
  }
  closest(selector) {return this.matches(selector) ? this : this.parentNode?.closest(selector) ?? null;}
  querySelectorAll(selector) {return this.childNodes.flatMap(child => [...(child.nodeType === 1 && child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);}
  querySelector(selector) {return this.querySelectorAll(selector)[0] ?? null;}
  addEventListener(type, callback, options) {
    const entries = this.listeners.get(type) ?? [];
    entries.push(callback); this.listeners.set(type, entries);
    options?.signal?.addEventListener('abort', () => this.listeners.set(type, entries.filter(entry => entry !== callback)), {once: true});
  }
  async fire(type, fields = {}) {
    const event = {target: this, preventDefault() {this.prevented = true;}, stopPropagation() {this.stopped = true;}, ...fields};
    for (const callback of this.listeners.get(type) ?? []) await callback(event);
    return event;
  }
}
const document = {createElement: tag => new Element(tag, document), createComment: () => new Element('#comment', document, 8)};

function fixture() {
  const team = actor('team', 'army', {unitUuids: ['Actor.squad']});
  const squad = actor('squad', 'unit', {armyUuid: team.uuid, modelUuids: ['Actor.model']});
  const model = actor('model', 'model', {unitUuid: squad.uuid});
  const lone = actor('lone', 'model');
  const actors = [team, squad, model, lone];
  const root = document.createElement('section');
  const search = document.createElement('input'); search.setAttribute('name', 'search'); search.value = '';
  const directory = document.createElement('ol'); root.append(search, directory);
  const folder = document.createElement('li'); folder.className = 'folder'; directory.append(folder);
  const folderList = document.createElement('ol'); folder.append(folderList);
  const rows = actors.map((entry, index) => {
    const row = document.createElement('li'); row.className = 'directory-item actor';
    row.dataset[['entryId', 'documentId', 'actorId'][index % 3]] = entry.id;
    row.nativeClick = () => entry.id;
    (index === 0 ? folderList : directory).append(row);
    return row;
  });
  let expanded = [];
  globalThis.game = {actors: {contents: actors}, settings: {
    get: () => expanded, set: async (_namespace, _key, value) => {expanded = value;}
  }};
  return {actors, team, squad, model, root, rows, folder, search, get expanded() {return expanded;}};
}

test('native Actor rows retain identity, folder placement and expansion over repeated renders', async () => {
  const f = fixture();
  renderActorDirectoryHierarchy({collection: game.actors}, f.root);
  const wrappers = f.root.querySelectorAll('.ba-actor-group');
  assert.equal(wrappers.length, 2);
  assert.equal(wrappers[0].closest('.folder'), f.folder);
  assert.equal(f.root.querySelectorAll('[data-entry-id], [data-document-id], [data-actor-id]').length, 4);
  assert.equal(f.rows[2].closest('.ba-actor-group').dataset.groupUuid, f.squad.uuid);
  assert.equal(f.rows[2].nativeClick(), 'model');
  assert.equal(wrappers[0].querySelector('.ba-group-children').hidden, true);
  await wrappers[0].querySelector('.ba-group-toggle').fire('click');
  assert.deepEqual(f.expanded, [f.team.uuid]);
  renderActorDirectoryHierarchy({collection: game.actors}, f.root);
  assert.equal(f.root.querySelectorAll('.ba-actor-group').length, 2);
  assert.equal(f.root.querySelector('.ba-group-children').hidden, false);
  for (const row of f.rows) assert.ok(f.root.contains(row));
  f.search.value = 'model'; await f.root.fire('input', {target: f.search});
  assert.ok(f.root.querySelectorAll('.ba-group-children').every(list => !list.hidden));
  f.search.value = ''; await f.root.fire('input', {target: f.search});
  assert.equal(f.rows[2].parentNode.hidden, true);
});

test('partial core row replacement is preserved without resurrecting the old row', () => {
  const f = fixture(); renderActorDirectoryHierarchy({collection: game.actors}, f.root);
  const parent = f.rows[2].parentNode;
  f.rows[2].remove();
  const replacement = document.createElement('li'); replacement.dataset.actorId = f.model.id;
  parent.append(replacement);
  renderActorDirectoryHierarchy({collection: game.actors}, f.root);
  assert.ok(f.root.contains(replacement));
  assert.equal(f.root.contains(f.rows[2]), false);
  assert.equal(f.root.querySelectorAll('[data-entry-id], [data-document-id], [data-actor-id]').length, 4);
  assert.equal(replacement.closest('.ba-actor-group').dataset.groupUuid, f.squad.uuid);
});

test('compendium drop delegates to guarded model importer once at the destination squad', async () => {
  const f = fixture(), imported = [];
  const source = actor('source', 'model', {}, {pack: 'boltaction.models'});
  globalThis.fromUuid = async uuid => uuid === source.uuid ? source : null;
  game.boltaction = {importModel: async (...args) => imported.push(args), linkGroupMember: () => assert.fail('pack must be imported')};
  renderActorDirectoryHierarchy({collection: game.actors}, f.root);
  const squad = f.rows[1].closest('.ba-actor-group');
  const event = await squad.fire('drop', {target: f.rows[1], dataTransfer: {getData: () => JSON.stringify({type: 'Actor', uuid: source.uuid})}});
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(imported, [[f.squad, source]]);
  assert.equal(event.stopped, true);
  assert.equal(event.prevented, true);
  assert.equal(f.rows[1].nativeClick(), 'squad');
});

test('registration is idempotent and compendium directories are left unchanged', () => {
  const f = fixture(), settings = [], hooks = [];
  game.settings.register = (...args) => settings.push(args);
  globalThis.Hooks = {on: (...args) => hooks.push(args)};
  registerActorDirectoryHierarchy(); registerActorDirectoryHierarchy();
  assert.equal(settings.length, 1);
  assert.equal(settings[0][1], 'expandedActorGroups');
  assert.equal(settings[0][2].scope, 'client');
  assert.deepEqual(hooks.map(([name]) => name), ['renderActorDirectory', 'createActor', 'updateActor', 'deleteActor', 'updateUser']);
  renderActorDirectoryHierarchy({collection: {metadata: {type: 'Actor'}}}, f.root);
  assert.equal(f.root.querySelectorAll('.ba-actor-group').length, 0);
});
