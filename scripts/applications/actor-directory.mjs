const SID = 'boltaction';
const SETTING = 'expandedActorGroups';
const MODEL_TYPES = new Set(['model', 'modelStatic', 'modelVehicle']);
const ENTRY_SELECTOR = '[data-entry-id], [data-document-id], [data-actor-id]';
const transforms = new WeakMap();
let registered = false;

const values = collection => collection?.contents ?? Array.from(collection ?? []);
const uuidOf = actor => actor.uuid ?? `Actor.${actor.id}`;
const isGroup = actor => actor.type === 'army' || actor.type === 'unit';

/** Build the visible, reciprocal world-Actor hierarchy without changing documents. */
export function buildActorTree(actors = []) {
  const nodes = new Map();
  for (const actor of values(actors)) {
    if (!actor || actor.visible === false || actor.pack || !actor.id) continue;
    const uuid = uuidOf(actor);
    if (!nodes.has(uuid)) nodes.set(uuid, {actor, children: []});
  }
  const children = new Set();
  for (const node of nodes.values()) {
    const parent = node.actor;
    if (!isGroup(parent)) continue;
    const team = parent.type === 'army';
    const references = parent.system?.[team ? 'unitUuids' : 'modelUuids'];
    for (const uuid of new Set(Array.isArray(references) ? references : [])) {
      const child = nodes.get(uuid);
      if (!child || children.has(uuid)) continue;
      if (team ? child.actor.type !== 'unit' : !MODEL_TYPES.has(child.actor.type)) continue;
      if (child.actor.system?.[team ? 'armyUuid' : 'unitUuid'] !== uuidOf(parent)) continue;
      node.children.push(child);
      children.add(uuid);
    }
  }
  return [...nodes.values()].filter(node => !children.has(uuidOf(node.actor)));
}

function expandedGroups() {
  const value = game.settings.get(SID, SETTING);
  return new Set(Array.isArray(value) ? value : []);
}

function entryRows(root, actors) {
  const known = new Map(values(actors).map(actor => [actor.id, actor]));
  const rows = new Map();
  for (const element of root.querySelectorAll(ENTRY_SELECTOR)) {
    const id = element.dataset.entryId ?? element.dataset.documentId ?? element.dataset.actorId;
    const row = element.tagName === 'LI' ? element : element.closest('li');
    if (known.has(id) && row && !rows.has(id)) rows.set(id, row);
  }
  return rows;
}

function restore(root) {
  const previous = transforms.get(root);
  if (!previous) return;
  previous.controller.abort();
  for (const {row, marker} of previous.entries) {
    // A partial core render can replace a row. Never resurrect its old document entry.
    if (root.contains(row) && marker.parentNode) marker.parentNode.insertBefore(row, marker);
    marker.remove();
  }
  for (const wrapper of root.querySelectorAll('.ba-actor-group')) {
    if (!wrapper.parentNode) continue;
    // Retain new native entries inserted by a partial core update inside our wrapper.
    for (const row of wrapper.querySelectorAll(ENTRY_SELECTOR)) {
      if (row.tagName === 'LI') wrapper.parentNode.insertBefore(row, wrapper);
    }
    wrapper.remove();
  }
  transforms.delete(root);
}

async function dropActor(event, parent, wrapper) {
  if (!parent.isOwner || event.target.closest('.ba-actor-group') !== wrapper) return;
  let data;
  try {data = JSON.parse(event.dataTransfer?.getData('text/plain') || '{}');} catch {return;}
  if (data.type !== 'Actor' || !data.uuid) return;
  event.preventDefault();
  event.stopPropagation();
  try {
    const actor = await fromUuid(data.uuid);
    if (!actor || actor.documentName !== 'Actor') throw new Error('The dragged Actor could not be found.');
    const api = game.boltaction;
    if (parent.type === 'unit' && actor.pack) await api.importModel(parent, actor);
    else await api.linkGroupMember(parent, actor);
  } catch (error) {
    console.error('Bolt Action: group directory drop', error);
    globalThis.ui?.notifications?.warn(error.message ?? 'Could not add this Actor to the group.');
  }
}

/** Move native Actor rows into expandable groups, preserving their listeners and data. */
export function renderActorDirectoryHierarchy(app, html) {
  if (app.collection && app.collection !== game.actors) return;
  const root = html?.nodeType === 1 ? html : app.element;
  if (!root?.querySelectorAll) return;
  restore(root);
  const actors = values(game.actors);
  const rows = entryRows(root, actors);
  const renderedActors = actors.filter(actor => rows.has(actor.id));
  const state = {entries: [], controller: new AbortController()};
  const document = root.ownerDocument;
  for (const row of rows.values()) {
    const marker = document.createComment('boltaction-actor-position');
    row.parentNode.insertBefore(marker, row);
    state.entries.push({row, marker});
  }
  const expanded = expandedGroups();
  const groups = [];
  const searching = () => Boolean(root.querySelector('input[name="search"]')?.value?.trim());
  function mount(node) {
    const actor = node.actor, row = rows.get(actor.id);
    if (!isGroup(actor)) return row;
    const wrapper = document.createElement('li');
    wrapper.className = 'ba-actor-group';
    wrapper.dataset.groupUuid = uuidOf(actor);
    wrapper.setAttribute('role', 'treeitem');
    const heading = document.createElement('div');
    heading.className = 'ba-group-heading';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'ba-group-toggle';
    toggle.setAttribute('aria-label', `Expand or collapse ${actor.name}`);
    const nativeList = document.createElement('ol');
    nativeList.className = 'ba-group-document';
    const childList = document.createElement('ol');
    childList.className = 'directory-list ba-group-children';
    childList.setAttribute('role', 'group');
    row.parentNode.insertBefore(wrapper, row);
    nativeList.append(row);
    heading.append(toggle, nativeList);
    wrapper.append(heading, childList);
    function applyExpansion() {
      const open = searching() || expanded.has(uuidOf(actor));
      childList.hidden = !open;
      toggle.textContent = open ? '▾' : '▸';
      toggle.setAttribute('aria-expanded', String(open));
      wrapper.setAttribute('aria-expanded', String(open));
    }
    toggle.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      const uuid = uuidOf(actor);
      if (expanded.has(uuid)) expanded.delete(uuid); else expanded.add(uuid);
      applyExpansion();
      Promise.resolve(game.settings.set(SID, SETTING, [...expanded])).catch(error => console.error('Bolt Action: group expansion', error));
    });
    wrapper.addEventListener('dragover', event => {
      if (actor.isOwner && event.target.closest('.ba-actor-group') === wrapper) event.preventDefault();
    });
    wrapper.addEventListener('drop', event => void dropActor(event, actor, wrapper));
    for (const child of node.children) childList.append(mount(child));
    groups.push(applyExpansion);
    applyExpansion();
    return wrapper;
  }
  for (const node of buildActorTree(renderedActors)) mount(node);
  root.addEventListener('input', event => {
    if (event.target.matches('input[name="search"]')) groups.forEach(apply => apply());
  }, {signal: state.controller.signal});
  transforms.set(root, state);
}

/** Called once during system init. Group services retain membership/ownership authority. */
export function registerActorDirectoryHierarchy() {
  if (registered) return;
  registered = true;
  game.settings.register(SID, SETTING, {scope: 'client', config: false, type: Array, default: []});
  Hooks.on('renderActorDirectory', renderActorDirectoryHierarchy);
  let timer;
  function refresh() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const directory = game.actors.directory ?? globalThis.ui?.actors;
      if (directory?.rendered) directory.render({force:true});
      if (directory?.popout?.rendered) directory.popout.render({force:true});
    }, 40);
  }
  for (const hook of ['createActor', 'updateActor', 'deleteActor', 'updateUser']) Hooks.on(hook, refresh);
}
