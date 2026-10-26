import {factionAppearance} from '../services/faction-appearance.mjs';

const SID = 'boltaction';
const SETTING = 'expandedActorGroups';
const MODEL_TYPES = new Set(['model', 'modelStatic', 'modelVehicle']);
const ENTRY_SELECTOR = '[data-entry-id], [data-document-id], [data-actor-id]';
const transforms = new WeakMap();
let registered = false;
let folderSync = Promise.resolve();

const values = collection => collection?.contents ?? Array.from(collection ?? []);
const uuidOf = actor => actor.uuid ?? `Actor.${actor.id}`;
const isGroup = actor => actor?.type === 'army' || actor?.type === 'unit';
const DIRECTORY_FIELDS = ['name', 'img', 'folder', 'sort', 'type', 'ownership', 'permission',
  'system.armyUuid', 'system.unitUuid', 'system.unitUuids', 'system.modelUuids', 'system.role', 'system.isNco',
  'system.factionUuid', 'flags.boltaction.factionSlug'];

/** Battlefield state and equipment do not affect the Actors sidebar hierarchy. */
export function actorDirectoryNeedsRefresh(changes = {}, prefix = '') {
  for (const [key, value] of Object.entries(changes ?? {})) {
    const path = (prefix ? `${prefix}.${key}` : key).replace(/(^|\.)-=/g, '$1');
    if (DIRECTORY_FIELDS.some(field => path === field || path.startsWith(`${field}.`))) return true;
    if (value && typeof value === 'object' && !Array.isArray(value) && actorDirectoryNeedsRefresh(value, path)) return true;
  }
  return false;
}

function groupColor(actor, actors) {
  const army = actor.type === 'army' ? actor : actors.find(parent => parent.type === 'army' && uuidOf(parent) === actor.system?.armyUuid);
  const factionUuid = army?.system?.factionUuid || actor.system?.factionUuid;
  let faction;
  if (factionUuid) {
    try {faction = globalThis.fromUuidSync?.(factionUuid);} catch { /* The pack may not have been loaded yet. */ }
    faction ??= values(game.items).find(item => item.uuid === factionUuid);
  }
  const slug = faction?.system?.slug || faction?.getFlag?.(SID, 'catalogueSlug')
    || army?.flags?.boltaction?.factionSlug || actor.flags?.boltaction?.factionSlug;
  const color = factionAppearance(slug, actor.type).color;
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '#758353';
}

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
  for (const badge of previous.badges) badge.remove();
  for (const portrait of previous.portraits) portrait.remove();
  for (const {row, marker, tabIndex} of previous.entries) {
    // A partial core render can replace a row. Never resurrect its old document entry.
    if (root.contains(row) && marker.parentNode) marker.parentNode.insertBefore(row, marker);
    if (tabIndex === null) row.removeAttribute('tabindex');
    else row.setAttribute('tabindex', tabIndex);
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

/** Keep a group's actual Foundry folder consistent without creating Folder documents. */
export async function syncActorGroupFolder(actor, changes = {}, options = {}) {
  if (options.boltactionFolderSync || !Object.hasOwn(changes, 'folder') || actor?.pack || !isGroup(actor)) return [];
  const isActiveGM = () => game.user?.isGM && (!game.users?.activeGM || game.users.activeGM.id === game.user.id);
  if (!isActiveGM()) return [];
  const folder = typeof changes.folder === 'string' ? changes.folder : changes.folder?.id ?? null;
  const task = folderSync.catch(() => {}).then(async () => {
    if (!isActiveGM()) return [];
    const actors = new Map(values(game.actors).filter(member => !member.pack).map(member => [uuidOf(member), member]));
    const descendants = [];
    function collect(parent) {
      if (!isGroup(parent)) return;
      const army = parent.type === 'army';
      for (const uuid of new Set(parent.system?.[army ? 'unitUuids' : 'modelUuids'] ?? [])) {
        const child = actors.get(uuid);
        if (!child || (army ? child.type !== 'unit' : !MODEL_TYPES.has(child.type))) continue;
        if (child.system?.[army ? 'armyUuid' : 'unitUuid'] !== uuidOf(parent)) continue;
        descendants.push(child);
        collect(child);
      }
    }
    collect(actor);
    const updates = descendants.filter(child => (child.folder?.id ?? child.folder ?? null) !== folder)
      .map(child => ({_id: child.id, folder}));
    if (updates.length) await CONFIG.Actor.documentClass.updateDocuments(updates, {boltactionFolderSync: true});
    return updates;
  });
  folderSync = task;
  return task;
}

async function deleteFocusedActor(event, actors) {
  if (event.key !== 'Delete' || !event.shiftKey || event.repeat) return;
  if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  const entry = event.target.closest(ENTRY_SELECTOR);
  const id = entry?.dataset.entryId ?? entry?.dataset.documentId ?? entry?.dataset.actorId;
  const groupUuid = event.target.closest('.ba-actor-group')?.dataset.groupUuid;
  const actor = id ? actors.find(actor => actor.id === id) : actors.find(actor => uuidOf(actor) === groupUuid);
  if (!actor?.isOwner || actor.pack) return;
  event.preventDefault(); event.stopPropagation();
  event.stopImmediatePropagation?.();
  try {await game.boltaction.deleteGroupActor(actor);}
  catch (error) {globalThis.ui?.notifications?.warn(error.message ?? 'Could not delete this Actor.');}
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
    else if (parent.type === 'army' && actor.pack) await api.importSquad(parent, actor);
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
  const state = {entries: [], badges: [], portraits: [], controller: new AbortController()};
  const document = root.ownerDocument;
  for (const row of rows.values()) {
    const marker = document.createComment('boltaction-actor-position');
    row.parentNode.insertBefore(marker, row);
    const tabIndex = row.getAttribute('tabindex') ?? null;
    state.entries.push({row, marker, tabIndex});
    if (tabIndex === null) row.setAttribute('tabindex', '0');
  }
  for (const actor of renderedActors) {
    if (!MODEL_TYPES.has(actor.type) || !(actor.system?.isNco || String(actor.system?.role ?? '').trim().toLowerCase() === 'nco')) continue;
    const badge = document.createElement('span');
    badge.className = 'ba-nco-badge';
    badge.setAttribute('title', 'NCO — squad leader');
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', 'NCO, squad leader');
    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-star fa-fw';
    icon.setAttribute('aria-hidden', 'true');
    badge.append(icon);
    const row = rows.get(actor.id);
    (row.querySelector('.document-name, .entry-name') ?? row).append(badge);
    state.badges.push(badge);
  }
  const expanded = expandedGroups();
  const groups = [];
  const searching = () => Boolean(root.querySelector('input[name="search"]')?.value?.trim());
  function mount(node) {
    const actor = node.actor, row = rows.get(actor.id);
    if (!isGroup(actor)) return row;
    // Core normally supplies the Actor portrait. Retain that native image and
    // provide a view-only fallback for alternate directory row templates.
    if (actor.img && !row.querySelector('img')) {
      const portrait = document.createElement('img');
      portrait.className = 'ba-group-portrait';
      portrait.setAttribute('src', actor.img);
      portrait.setAttribute('alt', '');
      portrait.setAttribute('loading', 'lazy');
      row.insertBefore(portrait, row.childNodes[0] ?? null);
      state.portraits.push(portrait);
    }
    const wrapper = document.createElement('li');
    wrapper.className = 'ba-actor-group';
    // Core sidebar list rules vary between docked and pop-out directories. Keep
    // structural layout on our own elements; native Actor rows retain all hooks.
    wrapper.setAttribute('style', 'display:block;flex:0 0 auto;align-self:stretch;box-sizing:border-box;width:100%;max-width:100%;list-style:none;margin:0;padding:0;min-width:0;');
    wrapper.dataset.groupUuid = uuidOf(actor);
    wrapper.setAttribute('role', 'treeitem');
    const heading = document.createElement('div');
    heading.className = 'folder-header flexrow ba-group-heading';
    const color = groupColor(actor, actors);
    heading.setAttribute('style', `display:flex;flex-flow:row nowrap;align-items:center;gap:0;box-sizing:border-box;min-width:0;width:100%;min-height:2rem;isolation:isolate;--ba-group-color:${color};background:color-mix(in srgb,${color} 35%,transparent);border-inline-start:5px solid ${color};`);
    heading.setAttribute('role', 'button');
    heading.setAttribute('tabindex', '0');
    heading.setAttribute('aria-label', `${actor.name}: expand or collapse`);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'ba-group-toggle';
    toggle.setAttribute('style', 'flex:0 0 1.5rem;width:1.5rem;min-width:1.5rem;height:2rem;margin:0;padding:0;');
    toggle.setAttribute('aria-label', `Expand or collapse ${actor.name}`);
    toggle.setAttribute('tabindex', '-1');
    const folderIcon = document.createElement('i');
    folderIcon.setAttribute('aria-hidden', 'true');
    folderIcon.setAttribute('style', 'color:color-mix(in srgb,var(--ba-group-color) 70%,currentColor);');
    toggle.append(folderIcon);
    const nativeList = document.createElement('ol');
    nativeList.className = 'ba-group-document';
    nativeList.setAttribute('style', 'display:flex;flex:1 1 0;align-self:stretch;box-sizing:border-box;min-width:0;list-style:none;margin:0;padding:0;position:relative;z-index:0;');
    const childList = document.createElement('ol');
    childList.className = 'directory-list ba-group-children';
    childList.setAttribute('role', 'group');
    const sheetButton = document.createElement('button');
    sheetButton.type = 'button';
    sheetButton.className = 'ba-group-sheet';
    sheetButton.setAttribute('style', 'flex:0 0 2rem;width:2rem;min-width:32px;height:2rem;margin:0;padding:0;position:relative;z-index:2;pointer-events:auto;');
    sheetButton.setAttribute('title', `Open ${actor.name} sheet`);
    sheetButton.setAttribute('aria-label', `Open ${actor.name} sheet`);
    const sheetIcon = document.createElement('i');
    sheetIcon.className = 'fa-solid fa-file-lines fa-fw';
    sheetIcon.setAttribute('aria-hidden', 'true');
    sheetIcon.setAttribute('style', 'pointer-events:none;');
    sheetButton.append(sheetIcon);
    row.parentNode.insertBefore(wrapper, row);
    nativeList.append(row);
    heading.append(toggle, nativeList, sheetButton);
    wrapper.append(heading, childList);
    function applyExpansion() {
      const open = searching() || expanded.has(uuidOf(actor));
      childList.hidden = !open;
      childList.setAttribute('style', `display:${open ? 'block' : 'none'};list-style:none;margin:0;padding:0 0 0 1rem;box-sizing:border-box;width:100%;min-width:0;`);
      folderIcon.className = `fa-solid ${open ? 'fa-folder-open' : 'fa-folder'} fa-fw`;
      toggle.setAttribute('aria-expanded', String(open));
      heading.setAttribute('aria-expanded', String(open));
      wrapper.setAttribute('aria-expanded', String(open));
    }
    function toggleExpansion(event) {
      event.preventDefault(); event.stopPropagation();
      event.stopImmediatePropagation?.();
      const uuid = uuidOf(actor);
      if (expanded.has(uuid)) expanded.delete(uuid); else expanded.add(uuid);
      applyExpansion();
      Promise.resolve(game.settings.set(SID, SETTING, [...expanded])).catch(error => console.error('Bolt Action: group expansion', error));
    }
    // Capture before native Actor name listeners: folder headings expand, and
    // the separate sheet control is the explicit way to open the Actor sheet.
    heading.addEventListener('click', event => {
      if (!sheetButton.contains(event.target)) toggleExpansion(event);
    }, {capture: true});
    heading.addEventListener('keydown', event => {
      if (event.target === heading && ['Enter', ' '].includes(event.key)) toggleExpansion(event);
    });
    sheetButton.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      actor.sheet?.render({force: true});
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
  root.addEventListener('keydown', event => void deleteFocusedActor(event, actors), {capture: true, signal: state.controller.signal});
  transforms.set(root, state);
}

/** Replace the native single-document deletion for folder-like group actors. */
export function groupDeletionContextOptions(application, entries) {
  const resolve = element => {
    const node = element?.[0] ?? element;
    const row = node?.closest?.(ENTRY_SELECTOR) ?? node;
    const id = row?.dataset?.entryId ?? row?.dataset?.documentId ?? row?.dataset?.actorId;
    return game.actors.get?.(id) ?? values(game.actors).find(actor => actor.id === id);
  };
  for (const entry of entries) {
    if (!/trash/.test(entry.icon ?? '') && !/(^|\.)Delete$/.test(entry.name ?? '')) continue;
    const original = entry.condition;
    entry.condition = element => !isGroup(resolve(element)) && (typeof original === 'function' ? original(element) : original !== false);
  }
  entries.push({name:'Delete All',icon:'<i class="fas fa-trash"></i>',
    condition:element=>{const actor=resolve(element);return isGroup(actor)&&actor.isOwner&&!actor.pack;},
    callback:async element=>{
      const actor=resolve(element);if(!isGroup(actor))return;
      const confirmed=await foundry.applications.api.DialogV2.confirm({window:{title:'Delete All'},content:'<p>Delete this group and all of its contained squads and models? This cannot be undone.</p>'});
      if(!confirmed)return;
      try {await game.boltaction.deleteGroupActor(actor);}
      catch(error){globalThis.ui?.notifications?.error(error.message??'Could not delete this group.');}
    }});
}

/** Called once during system init. Group services retain membership/ownership authority. */
export function registerActorDirectoryHierarchy() {
  if (registered) return;
  registered = true;
  game.settings.register(SID, SETTING, {scope: 'client', config: false, type: Array, default: []});
  Hooks.on('renderActorDirectory', renderActorDirectoryHierarchy);
  Hooks.on('getActorContextOptions', groupDeletionContextOptions);
  let timer;
  function refresh() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const directory = game.actors.directory ?? globalThis.ui?.actors;
      if (directory?.rendered) directory.render({force:true});
      if (directory?.popout?.rendered) directory.popout.render({force:true});
    }, 40);
  }
  for (const hook of ['createActor', 'deleteActor']) Hooks.on(hook, actor => {
    if (!actor?.pack && !actor?.isToken) refresh();
  });
  Hooks.on('updateUser', refresh);
  Hooks.on('updateActor', (actor, changes, options) => {
    if (actor?.pack || actor?.isToken) return;
    if (actorDirectoryNeedsRefresh(changes)) refresh();
    if (!Object.hasOwn(changes ?? {}, 'folder')) return;
    void syncActorGroupFolder(actor, changes, options).catch(error => {
      console.error('Bolt Action: group folder synchronization', error);
      globalThis.ui?.notifications?.warn('Could not move all group members into the new folder.');
    });
  });
}
