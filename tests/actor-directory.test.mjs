import test from 'node:test';
import assert from 'node:assert/strict';
import {buildActorTree, renderActorDirectoryHierarchy, registerActorDirectoryHierarchy, syncActorGroupFolder} from '../scripts/applications/actor-directory.mjs';

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
  removeAttribute(name) {delete this.attributes[name];}
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
    const listener = {callback, capture: options === true || Boolean(options?.capture)};
    entries.push(listener); this.listeners.set(type, entries);
    options?.signal?.addEventListener('abort', () => this.listeners.set(type, (this.listeners.get(type) ?? []).filter(entry => entry !== listener)), {once: true});
  }
  async fire(type, fields = {}) {
    const event = {target: this, preventDefault() {this.prevented = true;}, stopPropagation() {this.stopped = true;},
      stopImmediatePropagation() {this.stopped = true; this.immediate = true;}, ...fields};
    const path = [];
    for (let element = event.target; element; element = element.parentNode) path.push(element);
    async function invoke(element, capture) {
      event.currentTarget = element;
      for (const listener of element.listeners.get(type) ?? []) {
        if (listener.capture === capture) await listener.callback(event);
        if (event.immediate) break;
      }
    }
    for (const element of [...path].reverse()) {await invoke(element, true); if (event.stopped) return event;}
    for (const element of path) {await invoke(element, false); if (event.stopped) break;}
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
  const heading = wrappers[0].querySelector('.ba-group-heading');
  const nativeList = heading.querySelector('.ba-group-document');
  assert.match(heading.getAttribute('style'), /display:flex;flex-flow:row nowrap/);
  assert.match(nativeList.getAttribute('style'), /list-style:none;margin:0;padding:0/);
  assert.equal(nativeList.childNodes[0], f.rows[0]);
  assert.equal(heading.childNodes[0].className, 'ba-group-toggle');
  assert.equal(heading.childNodes[1], nativeList);
  assert.equal(wrappers[0].closest('.folder'), f.folder);
  assert.equal(f.root.querySelectorAll('[data-entry-id], [data-document-id], [data-actor-id]').length, 4);
  assert.equal(f.rows[2].closest('.ba-actor-group').dataset.groupUuid, f.squad.uuid);
  assert.equal(f.rows[2].nativeClick(), 'model');
  assert.equal(wrappers[0].querySelector('.ba-group-children').hidden, true);
  assert.match(wrappers[0].querySelector('.ba-group-children').getAttribute('style'), /display:none;list-style:none;margin:0/);
  await wrappers[0].querySelector('.ba-group-toggle').fire('click');
  assert.deepEqual(f.expanded, [f.team.uuid]);
  assert.match(wrappers[0].querySelector('.ba-group-children').getAttribute('style'), /^display:block;/);
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
  assert.deepEqual(hooks.map(([name]) => name).sort(), ['renderActorDirectory', 'createActor', 'updateActor', 'deleteActor', 'updateUser'].sort());
  renderActorDirectoryHierarchy({collection: {metadata: {type: 'Actor'}}}, f.root);
  assert.equal(f.root.querySelectorAll('.ba-actor-group').length, 0);
});

test('folder heading and keyboard toggle expansion while the right icon opens the sheet', async () => {
  const f = fixture(), renders = [];
  f.team.sheet = {render: options => renders.push(options)};
  let nativeClicks = 0;
  f.rows[0].addEventListener('click', () => nativeClicks++);
  renderActorDirectoryHierarchy({collection: game.actors}, f.root);
  const heading = f.rows[0].closest('.ba-group-heading');
  assert.ok(heading.className.includes('folder-header'));
  const event = await f.rows[0].fire('click');
  assert.deepEqual(f.expanded, [f.team.uuid]);
  assert.equal(nativeClicks, 0, 'capture prevents native name click from opening a sheet');
  assert.equal(event.prevented, true);
  assert.ok(heading.querySelector('.ba-group-toggle').querySelector('i').className.includes('fa-folder-open'));
  await heading.querySelector('.ba-group-sheet').fire('click');
  assert.deepEqual(renders, [{force: true}]);
  assert.deepEqual(f.expanded, [f.team.uuid], 'sheet button does not change expansion');
  await heading.fire('keydown', {key: 'Enter'});
  assert.deepEqual(f.expanded, []);
  assert.ok(heading.querySelector('.ba-group-toggle').querySelector('i').className.includes('fa-folder'));
  await heading.fire('keydown', {key: ' '});
  assert.deepEqual(f.expanded, [f.team.uuid]);
});

test('long group names retain a separate clickable sheet control including its icon subtree', async () => {
  const f = fixture(), renders = [];
  const longName = 'A very long Army name '.repeat(20);
  f.team.name = longName;
  f.team.sheet = {render: options => renders.push(options)};
  const name = document.createElement('h4');
  name.className = 'document-name'; name.textContent = longName;
  f.rows[0].append(name);
  renderActorDirectoryHierarchy({collection: game.actors}, f.root);
  const heading = f.rows[0].closest('.ba-group-heading');
  const sheet = heading.querySelector('.ba-group-sheet');
  assert.match(heading.querySelector('.ba-group-document').getAttribute('style'), /flex:1 1 0/);
  assert.match(heading.querySelector('.ba-group-document').getAttribute('style'), /min-width:0/);
  assert.match(sheet.getAttribute('style'), /flex:0 0 2rem;width:2rem;min-width:32px/);
  assert.match(sheet.getAttribute('style'), /z-index:2;pointer-events:auto/);
  assert.equal(heading.childNodes.at(-1), sheet);
  await sheet.querySelector('i').fire('click');
  assert.deepEqual(renders, [{force: true}]);
  assert.deepEqual(f.expanded, [], 'nested sheet icons bypass the capture expansion handler');
  await name.fire('click');
  assert.deepEqual(f.expanded, [f.team.uuid]);
  assert.equal(f.team.name, longName);
});

test('group rows retain native drag/context listeners and faction color follows the Army', async () => {
  const f = fixture();
  f.team.system.factionUuid = 'Item.britain';
  game.items = {contents: [{uuid: 'Item.britain', system: {slug: 'great-britain'}}]};
  const native = [];
  f.rows[0].addEventListener('contextmenu', () => native.push('context'));
  f.rows[0].addEventListener('dragstart', () => native.push('drag'));
  renderActorDirectoryHierarchy({collection: game.actors}, f.root);
  for (const row of f.rows.slice(0, 2)) {
    const style = row.closest('.ba-group-heading').getAttribute('style');
    assert.match(style, /--ba-group-color:#8b7958/);
    assert.match(style, /background:color-mix\(in srgb,#8b7958 35%,transparent\)/);
    assert.match(style, /border-inline-start:5px solid #8b7958/);
  }
  await f.rows[0].fire('contextmenu');
  await f.rows[0].fire('dragstart');
  assert.deepEqual(native, ['context', 'drag']);
  game.items.contents[0].system.slug = '__proto__';
  renderActorDirectoryHierarchy({collection: game.actors}, f.root);
  assert.match(f.rows[0].closest('.ba-group-heading').getAttribute('style'), /--ba-group-color:#758353/);
});

test('compendium Squad dropped on Army delegates to guarded squad importer', async () => {
  const f = fixture(), imported = [];
  const source = actor('source', 'unit', {}, {pack: 'boltaction.squads'});
  globalThis.fromUuid = async () => source;
  game.boltaction = {importSquad: async (...args) => imported.push(args), linkGroupMember: () => assert.fail('pack must be imported')};
  renderActorDirectoryHierarchy({collection: game.actors}, f.root);
  await f.rows[0].fire('drop', {dataTransfer: {getData: () => JSON.stringify({type: 'Actor', uuid: source.uuid})}});
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(imported, [[f.team, source]]);
});

test('Shift+Delete delegates focused owned Actor deletion to the group service', async () => {
  const f = fixture(), deleted = [], requests = [];
  for (const entry of f.actors) entry.delete = async () => deleted.push(entry.id);
  game.boltaction = {deleteGroupActor: async actor => {requests.push(actor); await actor.delete();}};
  renderActorDirectoryHierarchy({collection: game.actors}, f.root);
  const heading = f.rows[0].closest('.ba-group-heading');
  await heading.fire('keydown', {key: 'Delete', shiftKey: true});
  assert.deepEqual(deleted, [f.team.id]);
  await f.rows[2].fire('keydown', {key: 'Delete', shiftKey: true});
  assert.deepEqual(deleted, [f.team.id, f.model.id]);
  await f.rows[1].fire('keydown', {key: 'Delete', shiftKey: true});
  assert.deepEqual(requests, [f.team, f.model, f.squad], 'the service decides how to cascade Squad deletion');
  f.squad.isOwner = false;
  await f.rows[1].fire('keydown', {key: 'Delete', shiftKey: true});
  await f.rows[3].fire('keydown', {key: 'Delete', shiftKey: false});
  await f.search.fire('keydown', {key: 'Delete', shiftKey: true});
  assert.deepEqual(deleted, [f.team.id, f.model.id, f.squad.id]);
  assert.deepEqual(requests, [f.team, f.model, f.squad]);
});

test('NCO roles receive a removable badge without changing model names or artwork', () => {
  const f = fixture();
  f.model.system.role = ' nCo ';
  f.model.name = 'Private Allen'; f.model.img = 'worlds/test/allen.webp';
  f.squad.system.role = 'nco';
  const before = structuredClone(f.model);
  renderActorDirectoryHierarchy({collection: game.actors}, f.root);
  assert.equal(f.rows[2].querySelectorAll('.ba-nco-badge').length, 1);
  assert.equal(f.rows[1].querySelectorAll('.ba-nco-badge').length, 0, 'group documents do not acquire model badges');
  const badge = f.rows[2].querySelector('.ba-nco-badge');
  assert.equal(badge.getAttribute('aria-label'), 'NCO, squad leader');
  assert.match(badge.querySelector('i').className, /fa-star/);
  renderActorDirectoryHierarchy({collection: game.actors}, f.root);
  assert.equal(f.rows[2].querySelectorAll('.ba-nco-badge').length, 1, 're-rendering never duplicates badges');
  assert.deepEqual(f.model, before);
  f.model.system.role = 'rifleman';
  renderActorDirectoryHierarchy({collection: game.actors}, f.root);
  assert.equal(f.rows[2].querySelectorAll('.ba-nco-badge').length, 0);
  assert.equal(f.model.name, before.name); assert.equal(f.model.img, before.img);
});

test('only the active GM cascades a group folder move to reciprocal descendants', async () => {
  const f = fixture(), batches = [];
  game.user = {id: 'gm', isGM: true}; game.users = {activeGM: game.user};
  f.model.visible = false;
  f.team.system.unitUuids.push('Actor.lone'); // A stale wrong-type link never receives the move.
  f.squad.folder = {id: 'old'}; f.model.folder = {id: 'old'};
  globalThis.CONFIG = {Actor: {documentClass: {updateDocuments: async (updates, options) => {
    batches.push({updates, options});
    for (const update of updates) f.actors.find(entry => entry.id === update._id).folder = update.folder;
  }}}};
  const updates = await syncActorGroupFolder(f.team, {folder: 'new'});
  assert.deepEqual(updates, [{_id: f.squad.id, folder: 'new'}, {_id: f.model.id, folder: 'new'}]);
  assert.deepEqual(batches[0].options, {boltactionFolderSync: true});
  assert.deepEqual(await syncActorGroupFolder(f.squad, {folder: 'new'}, batches[0].options), []);
  assert.deepEqual(await syncActorGroupFolder(f.team, {name: 'Renamed'}), []);
  game.users.activeGM = {id: 'another-gm'};
  assert.deepEqual(await syncActorGroupFolder(f.team, {folder: 'other'}), []);
  game.users.activeGM = game.user;
  await syncActorGroupFolder(f.squad, {folder: null});
  assert.deepEqual(batches[1].updates, [{_id: f.model.id, folder: null}]);
  assert.equal(f.squad.folder, 'new', 'moving a Squad never moves its Army or sibling groups');
  assert.equal(batches.length, 2);
  game.users.activeGM = null;
  await syncActorGroupFolder(f.team, {folder: 'fallback'});
  assert.deepEqual(batches[2].updates, [{_id: f.squad.id, folder: 'fallback'}, {_id: f.model.id, folder: 'fallback'}]);
});
