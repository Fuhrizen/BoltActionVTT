import {factionWeaponName} from './faction-weapons.mjs';
import {loadCatalogue, resolveWeapon} from './catalogue.mjs';

const qualities = ['inexperienced', 'regular', 'veteran'];
const busy = new WeakSet();
const flag = (doc, key) => doc.getFlag?.('boltaction', key) ?? doc.flags?.boltaction?.[key];
const title = value => value.replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
const family = slug => slug?.replace(/(?:^|-)(inexperienced|regular|veteran)(?=-|$)/g, '');
const items = model => Array.from(model.items ?? []);
const itemId = item => item.id ?? item._id;
const copy = item => structuredClone(item.toObject ? item.toObject() : item);
const weaponMatches = (item, slug, data) => item.type === 'weapon' && (flag(item, 'catalogueSlug') === slug || item.name === data.weapons.find(row => row.slug === slug)?.name);
const matchesChoice = (item, choice) => flag(item, 'modelChoiceId') === choice.id || (choice.kind === 'trait' && item.type === 'trait' && (flag(item,'catalogueSlug') === choice.traitSlug || item.system?.slug === choice.traitSlug));

async function definition(model) {
  const data = await loadCatalogue();
  const source = data.units.find(row => row.slug === flag(model, 'catalogueSlug'));
  const relatives = source ? data.units.filter(row => row.factionSlug === source.factionSlug && row.system.kind === source.system.kind && family(row.slug) === family(source.slug)) : [];
  const row = relatives.find(row => row.system.quality === model.system.quality) ?? source;
  const profile = row?.profile ?? flag(model, 'profile') ?? {};
  let levels = Object.keys(profile.pointsByQuality ?? {}).filter(level => qualities.includes(level));
  if (!levels.length) levels = [...new Set(relatives.map(row => row.system.quality).filter(level => qualities.includes(level)))];
  if (!levels.length) levels = [...qualities];
  // Preserve the current value of an existing customized model without offering other undocumented levels.
  if (qualities.includes(model.system.quality) && !levels.includes(model.system.quality)) levels.push(model.system.quality);
  const equipment = [], manualOptions = [];
  const originals = model.type === 'model'
    ? [{weaponSlug: row?.composition?.find(entry => ['officer','observer','medic'].includes(entry.role))?.weaponSlug || row?.weaponSlug || 'rifle'}]
    : row?.weaponLoadout ?? (row?.weaponSlug ? [{weaponSlug: row.weaponSlug}] : []);
  const addWeapon = (slug, kind, slot, option = {}) => {
    const weapon = data.weapons.find(row => row.slug === slug);
    if (!weapon) return;
    const id = `${kind}:${slot ?? option.mount ?? 'equipment'}:${slug}`;
    if (equipment.some(choice => choice.id === id)) return;
    const price=option.pointsByQuality?.[model.system.quality]??option.costEach??option.costPerModel??option.cost??0;
    const choice = {id, label: factionWeaponName(slug,flag(model,'factionSlug')??source?.factionSlug,weapon.name), cost:Number.isFinite(price)?price:null,costBasis:option.costPerModel!==undefined?'per model':'each',costLabel:Number.isFinite(price)?`${price>=0?'+':''}${price} pts ${option.costPerModel!==undefined?'per model':'each'}`:'Price requires confirmation',max:option.max,ncoOnly:Boolean(option.ncoOnly),loaderEach:option.loaderEach??0,kind, weaponSlug: slug, ...(slot ? {slot} : {}), ...(option.mount ? {mount:option.mount} : {})};
    Object.defineProperty(choice, '_option', {value:option});
    equipment.push(choice);
  };
  if (model.type === 'model') addWeapon(originals[0].weaponSlug, 'primary', 'primary', originals[0]);
  for (const option of profile.options ?? []) {
    if(model.type==='modelVehicle'&&(option.variant||option.replaceAllWeapons||option.requiresOption||option.transportCapacity!==undefined||option.removeTrait)){
      const index=profile.options.indexOf(option),slug=option.weaponSlug||option.weaponSlugs?.[0],weapon=data.weapons.find(w=>w.slug===slug),price=option.pointsByQuality?.[model.system.quality]??option.cost;
      const choice={id:`vehicle:${index}`,kind:'vehicle',weaponSlug:slug,label:title(option.variant||weapon?.name||'Vehicle conversion'),cost:Number.isFinite(price)?price:null,costLabel:Number.isFinite(price)?`${price>=0?'+':''}${price} pts`:'Price requires confirmation',selected:items(model).some(i=>flag(i,'modelChoiceId')===`vehicle:${index}`)};Object.defineProperty(choice,'_option',{value:option});equipment.push(choice);continue;
    }
    if (option.variant || option.replaceAllWeapons || option.removeTrait || option.requiresOption || option.transportCapacity !== undefined || ['additional-model','attendants','spotter','rifles'].includes(option.option)) {
      manualOptions.push({label:title(option.variant ?? option.option ?? option.weaponSlug ?? 'Conversion'), reason:'Configure this group or conversion manually.'});
      continue;
    }
    if (option.weaponSlug || option.weaponSlugs) {
      if (option.replaceWeapon) {
        const candidates = originals.filter(entry => entry.weaponSlug === option.replaceWeapon && (!option.replaceMount || entry.mount === option.replaceMount));
        if (candidates.length !== 1) {
          manualOptions.push({label:title(option.weaponSlug), reason:'Choose the original weapon and mounting manually.'});
          continue;
        }
        const original = candidates[0], slot = `mount:${original.mount ?? option.replaceWeapon}`;
        addWeapon(original.weaponSlug, 'primary', slot, original);
        addWeapon(option.weaponSlug, 'primary', slot, {...option, mount:original.mount, originalWeapon:original.weaponSlug});
      } else {
        for (const slug of option.weaponSlugs ?? [option.weaponSlug]) {
          const kind = model.type === 'model' && !option.additional ? 'primary' : 'additional';
          for (const mount of option.mounts ?? [option.mount]) addWeapon(slug, kind, kind === 'primary' ? 'primary' : undefined, {...option, mount});
        }
      }
    } else if (option.option) {
      const slug = option.trait ?? option.option;
      const trait = data.traits.find(row => row.slug === slug);
      const choice = {cost:option.pointsByQuality?.[model.system.quality]??option.costPerModel??option.costEach??option.cost??null,costBasis:option.costPerModel!==undefined?'per model':'per option',id:`trait:${slug}`, label:trait?.name ?? title(option.option), kind:'trait', traitSlug:slug};
      Object.defineProperty(choice, '_trait', {value:trait});Object.defineProperty(choice,'_option',{value:option});
      equipment.push(choice);
    }
  }
  for (const choice of equipment) {
    const managed = items(model).filter(item => matchesChoice(item, choice));
    choice.selected = managed.length > 0 || (choice.kind === 'primary' && !items(model).some(item => flag(item, 'modelChoiceSlot') === choice.slot) && items(model).some(item => weaponMatches(item, choice.weaponSlug, data) && (!choice.mount || flag(item,'mount') === choice.mount)));
  }
  return {data, originals, experiences:qualities.filter(level => levels.includes(level)).map(value => ({value,label:title(value),selected:value === model.system.quality})), equipment, manualOptions};
}

/** Source-backed customization only; army composition restrictions are deliberately separate. */
export async function getModelChoices(model) {
  const {experiences,equipment,manualOptions} = await definition(model);
  return {experiences,equipment,manualOptions};
}

function assertEditable(model) {
  if (!model || !['model','modelStatic','modelVehicle'].includes(model.type)) throw new Error('Choose an individual model.');
  if (model.pack || model.compendium || model.isEmbedded) throw new Error('Import the model into the world before customizing it.');
  if (!model.isOwner) throw new Error('You must own this model to customize it.');
}

/** Apply one experience or equipment selection, preserving unrelated embedded equipment. */
async function applySingleModelChoice(model, {experience, choiceId, enabled = true} = {}) {
  assertEditable(model);
  if(experience!==undefined && model.system.unitUuid)throw new Error('Set experience on the squad sheet.');
  if (busy.has(model)) throw new Error('This model is already being customized.');
  busy.add(model);
  let snapshot, quality;
  try {
    const config = await definition(model);
    if (experience !== undefined && !config.experiences.some(choice => choice.value === experience)) throw new Error('Unknown experience choice.');
    const choice = choiceId === undefined ? undefined : config.equipment.find(choice => choice.id === choiceId);
    if (choiceId !== undefined && !choice) throw new Error('Unknown equipment choice.');
    if(choice&&choice.kind!=='vehicle'&&items(model).some(i=>flag(i,'vehicleOption')))throw new Error('Remove the vehicle conversion before changing other equipment.');
    if(choice?.kind==='vehicle'){await applyVehicleOption(model,choice,config,enabled);return model;}
    if(choice?.kind==='primary'&&!enabled)throw new Error('Primary weapons must be swapped rather than removed.');
    if(choice&&enabled){const option=choice._option??{};if(option.ncoOnly&&!model.system.isNco&&model.system.role!=='nco')throw new Error('This option is reserved for the NCO.');if(Number.isFinite(option.max)&&model.system.unitUuid){const peers=Array.from(globalThis.game?.actors??[]).filter(a=>a.system?.unitUuid===model.system.unitUuid&&a.uuid!==model.uuid);const selected=peers.filter(a=>items(a).some(i=>flag(i,'modelChoiceId')===choice.id||choice.weaponSlug&&(flag(i,'catalogueSlug')===choice.weaponSlug||i.system?.slug===choice.weaponSlug))).length;if(selected>=option.max)throw new Error(`This squad option is limited to ${option.max} models.`);if(option.ncoAllowed&& !model.system.isNco&&model.system.role!=='nco'){const nonNcos=peers.filter(a=>!a.system.isNco&&a.system.role!=='nco'&&items(a).some(i=>flag(i,'modelChoiceId')===choice.id||choice.weaponSlug&&(flag(i,'catalogueSlug')===choice.weaponSlug||i.system?.slug===choice.weaponSlug))).length;if(nonNcos>=option.max-1)throw new Error(`Only ${option.max-1} non-NCO models may take this option.`);}}}
    snapshot = items(model).map(copy); quality = model.system.quality;
    if (experience !== undefined && experience !== quality) await model.update({'system.quality':experience});
    if (!choice) return model;
    const selected = items(model).filter(item => matchesChoice(item, choice));
    if (!enabled && choice.kind !== 'primary') {
      if (selected.length) await model.deleteEmbeddedDocuments('Item', selected.map(itemId));
      return model;
    }
    if (selected.length) return model;
    let removing = [];
    if (choice.kind === 'primary') {
      removing = items(model).filter(item => flag(item,'modelChoiceSlot') === choice.slot);
      if (!removing.length) {
        const originalSlug = choice._option.originalWeapon ?? (choice.slot === 'primary' ? config.originals[0]?.weaponSlug : choice.weaponSlug);
        const mount = choice.mount;
        const candidates = items(model).filter(item => weaponMatches(item, originalSlug, config.data) && (!mount || flag(item,'mount') === mount));
        if (candidates.length > 1) throw new Error('The original equipment is ambiguous; remove duplicate original weapons before choosing.');
        removing = candidates;
      }
    }
    let source;
    if (choice.kind === 'trait') {
      source = choice._trait ? {name:choice._trait.name,type:'trait',system:structuredClone(choice._trait.system)} : {name:choice.label,type:'trait',system:{slug:choice.traitSlug,effect:'Source-listed optional equipment. Resolve its effects manually.',notes:'Optional equipment selected on the model sheet.'}};
    } else {
      source = await resolveWeapon(choice.weaponSlug,flag(model,'factionSlug'));
      delete source.system.cost;
      source.system.quantity = choice._option.quantity ?? 1;
      for (const key of ['heDiameter','penetration']) if (Number.isFinite(choice._option[key])) source.system[key] = choice._option[key];
    }
    source.flags = {...source.flags,boltaction:{...source.flags?.boltaction,catalogueSlug:choice.weaponSlug ?? choice.traitSlug,modelChoiceId:choice.id,...(choice.slot ? {modelChoiceSlot:choice.slot} : {}),...(choice.mount ? {mount:choice.mount} : {})}};
    await model.createEmbeddedDocuments('Item', [source]);
    if (removing.length) await model.deleteEmbeddedDocuments('Item', removing.map(itemId));
    return model;
  } catch (error) {
    if (snapshot) {
      try {
        const before = new Set(snapshot.map(item => item._id));
        const added = items(model).filter(item => !before.has(itemId(item))).map(itemId);
        if (added.length) await model.deleteEmbeddedDocuments('Item', added);
        const current = new Set(items(model).map(itemId));
        const missing = snapshot.filter(item => !current.has(item._id));
        if (missing.length) await model.createEmbeddedDocuments('Item', missing, {keepId:true});
        if (model.system.quality !== quality) await model.update({'system.quality':quality});
      } catch (rollbackError) { throw new AggregateError([error,rollbackError], 'Customization failed and could not be fully restored.'); }
    }
    throw error;
  } finally { busy.delete(model); }
}

const updatingSquads=new WeakSet();
/** Per-model-priced unit upgrades are purchased and removed for the entire squad. */
export async function applyModelChoice(model,options={}){
 assertEditable(model);
 if(!options.choiceId)return applySingleModelChoice(model,options);
 const config=await definition(model),choice=config.equipment.find(row=>row.id===options.choiceId);
 if(!choice)throw new Error('Unknown equipment choice.');
 const squad=model.unit??Array.from(globalThis.game?.actors??[]).find(actor=>actor.uuid===model.system.unitUuid&&actor.type==='unit');
 if(choice.kind!=='trait'||choice._option?.costPerModel===undefined||!squad)return applySingleModelChoice(model,options);
 if(!squad.isOwner||updatingSquads.has(squad))throw new Error('Own this squad and wait for its current option change.');
 const models=Array.from(globalThis.game?.actors??[]).filter(actor=>(squad.system.modelUuids??[]).includes(actor.uuid)&&actor.system.unitUuid===squad.uuid);
 for(const member of models)assertEditable(member);
 const snapshots=models.map(member=>({member,items:items(member).filter(item=>matchesChoice(item,choice)).map(copy)}));
 updatingSquads.add(squad);
 try{for(const member of models)await applySingleModelChoice(member,options);return model;}
 catch(error){for(const snapshot of snapshots){const current=items(snapshot.member).filter(item=>matchesChoice(item,choice));if(current.length)await snapshot.member.deleteEmbeddedDocuments('Item',current.map(itemId));if(snapshot.items.length)await snapshot.member.createEmbeddedDocuments('Item',snapshot.items,{keepId:true});}throw error;}
 finally{updatingSquads.delete(squad);}
}


/** Complex source-listed vehicle conversions retain the exact replaced equipment for reversal. */
async function applyVehicleOption(model,choice,config,enabled){
 const markers=items(model).filter(i=>flag(i,'vehicleOption'));
 const selected=markers.find(i=>flag(i,'modelChoiceId')===choice.id);
 if(enabled&&selected||!enabled&&!selected)return;
 if(markers.length&&enabled&&!choice._option.requiresOption)throw new Error('Remove the existing vehicle conversion before selecting another.');
 if(!enabled){
  if(markers.some(i=>i!==selected&&flag(i,'vehicleOption').removed.some(w=>flag(w,'vehicleOptionWeapon')===choice.id)))throw new Error('Remove the dependent upgrade first.');
  const state=flag(selected,'vehicleOption');
  const generated=items(model).filter(i=>flag(i,'vehicleOptionWeapon')===choice.id);
  await model.createEmbeddedDocuments('Item',state.removed,{keepId:true});
  await model.deleteEmbeddedDocuments('Item',[...generated.map(itemId),itemId(selected)]);
  await model.update({'system.capacity':state.capacity,'system.openTopped':state.openTopped},{render:false});return;
 }
 const option=choice._option;
 let removing=items(model).filter(i=>i.type==='weapon'&&(option.replaceAllWeapons?config.originals.some(w=>w.weaponSlug===(flag(i,'catalogueSlug')||i.system.slug)):(flag(i,'catalogueSlug')||i.system.slug)===option.replaceWeapon&&(!option.replaceMount||flag(i,'mount')===option.replaceMount)));
 if(option.replaceWeapon&&removing.length!==1)throw new Error(option.requiresOption?'Select the required machine gun upgrade first.':'The source weapon for this conversion is missing or ambiguous.');
 const sourceMount=option.mount??flag(removing[0]??{},'mount');
 const created=[];
 for(const slug of option.weaponSlugs??[option.weaponSlug]){
  if(!slug)continue;const weapon=await resolveWeapon(slug,flag(model,'factionSlug'));delete weapon.system.cost;weapon.system.quantity=option.quantity??1;
  weapon.flags={...weapon.flags,boltaction:{...weapon.flags?.boltaction,catalogueSlug:slug,vehicleOptionWeapon:choice.id,...(sourceMount?{mount:sourceMount}:{})}};created.push(weapon);
 }
 const dependency=option.requiresOption?(config.data.units.find(r=>r.slug===flag(model,'catalogueSlug'))?.profile?.options??[]).find(o=>o.weaponSlug===option.requiresOption&&!o.requiresOption):null;
 const extra=removing.some(i=>flag(i,'vehicleOptionWeapon'))?0:dependency?.cost??0;
 created.push({name:choice.label,type:'trait',system:{slug:choice.id,effect:'Source-listed vehicle conversion; weapon and capacity changes applied. Confirm variant-specific rules in the rulebook.'},flags:{boltaction:{modelChoiceId:choice.id,vehicleOption:{removed:removing.map(copy),capacity:model.system.capacity??0,openTopped:Boolean(model.system.openTopped),price:Number.isFinite(choice.cost)?choice.cost+extra:null}}}});
 await model.createEmbeddedDocuments('Item',created);
 if(removing.length)await model.deleteEmbeddedDocuments('Item',removing.map(itemId));
 const changes={};if(option.transportCapacity!==undefined)changes['system.capacity']=option.transportCapacity;if(option.removeTrait==='open-topped')changes['system.openTopped']=false;if(Object.keys(changes).length)await model.update(changes,{render:false});
}
