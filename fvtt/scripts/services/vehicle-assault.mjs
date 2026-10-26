import * as rules from '../rules/index.mjs';
const pending = new Set();
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function number(value, fallback, min, max, integer = false) {
  const result = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isFinite(result) || result < min || result > max || integer && !Number.isInteger(result)) throw new Error(`Enter ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}.`);
  return result;
}
async function dice(count, rolls) {
  if (!count) return [];
  const roll = await new Roll(`${count}d6`).evaluate();
  rolls.push(roll);
  return roll.dice.flatMap(d => d.results.filter(r => r.active !== false).map(r => r.result));
}
async function report(unit, lines, rolls) {
  await foundry.documents.ChatMessage.create({speaker: foundry.documents.ChatMessage.getSpeaker({actor: unit}),
    content: `<section class="boltaction chat-card"><h3>Vehicle assault</h3>${lines.map(line => `<p>${esc(line)}</p>`).join('')}</section>`, rolls});
}
function moraleOptions(unit) {
  const s = unit.system;
  return {quality: s.quality, pins: s.pins, ncoAlive: s.ncoAlive, moraleBonus: s.moraleBonus};
}
function tankFearRequired(unit, target, mode, options) {
  return mode === 'ram' ? target.damageValue >= 8 : mode === 'infantry' && target.damageValue >= 7 && !target.system.openTopped && !options.tankHunters;
}
/** Resolve dice after the legal Run order and reactions; positioning and casualties remain referee controlled. */
export async function vehicleAssault(actor, options = {}) {
  const unit = actor?.unit ?? actor;
  if (!unit || unit.type !== 'unit' || !unit.isOwner || unit.pack) throw new Error('Own a world unit before resolving its assault.');
  if (pending.has(unit.uuid)) throw new Error('This unit is already resolving a vehicle assault.');
  pending.add(unit.uuid);
  try { return await resolve(unit, options); } finally { pending.delete(unit.uuid); }
}
async function resolve(unit, options) {
  if (unit.isDestroyed || unit.system.transportUuid || unit.system.reserve) throw new Error('This unit cannot assault from its current state.');
  if (unit.system.order !== 'run') throw new Error('Give the assaulting unit a Run order first.');
  if (unit.system.arrivalRound && unit.system.arrivalRound === game.combat?.round) throw new Error('A unit cannot assault in its reserve arrival round.');
  const bag = game.combat?.getFlag('boltaction', 'bag');
  if (bag && bag.activeUnitUuid !== unit.uuid) throw new Error('Activate the assaulting unit from the drawn side first.');
  const target = await fromUuid(options.targetUuid);
  if (!target || target.type !== 'unit' || target.uuid === unit.uuid || target.visible === false || target.isDestroyed) throw new Error('Choose another surviving visible target unit.');
  if (unit.effectiveSide && target.effectiveSide && unit.effectiveSide === target.effectiveSide) throw new Error('Choose an enemy unit for an assault.');
  const vehicle = unit.system.kind === 'vehicle', targetVehicle = target.system.kind === 'vehicle';
  const mode = options.mode || (!vehicle && targetVehicle ? 'infantry' : vehicle && targetVehicle ? 'ram' : vehicle ? 'overrun' : '');
  if (!['infantry','ram','overrun'].includes(mode) || mode === 'infantry' && (vehicle || !targetVehicle) || mode === 'ram' && (!vehicle || !targetVehicle) || mode === 'overrun' && (!vehicle || targetVehicle)) throw new Error('Choose an infantry assault on a vehicle, tank ram, or tank overrun.');
  if (vehicle && (unit.damageValue < 8 || unit.system.immobilised)) throw new Error('Only a mobile tank with damage value 8 or higher may make this assault.');
  if (mode === 'infantry' && target.system.order === 'run' && !target.system.immobilised) throw new Error('Infantry cannot assault a vehicle moving at Run speed.');
  const range = number(options.range, unit.system.moveRun, 0, 1000);
  if (range > unit.system.moveRun) throw new Error('The measured legal assault route exceeds the Run allowance.');
  if (!options.geometryConfirmed || !options.reactionsResolved) throw new Error('Confirm legal movement, tank straight-line and minimum-distance restrictions, and all reaction fire before rolling.');
  if (tankFearRequired(unit, target, mode, options) && !options.orderTestConfirmed) throw new Error('Tank fear requires the preceding Run order to pass a forced order test with -3 morale. Issue that order with forceTest:true, modifier:-3, then confirm it here; do not take a second test after an ordinary Run.');
  const prior = unit.getFlag?.('boltaction', 'vehicleAssaultTargets') ?? [];
  const continuing = mode === 'overrun' && options.continueOverrun && unit.system.assaultResolved && unit.getFlag?.('boltaction', 'vehicleAssaultMode') === 'overrun';
  if (unit.system.assaultResolved && !continuing) throw new Error('This Run order already resolved an assault. Only a further unit along the same tank-overrun path may continue.');
  if (continuing && prior.includes(target.uuid)) throw new Error('This unit was already resolved along the current overrun path.');
  const count = mode === 'infantry' ? number(options.attacks, unit.livingMembers.length, 1, unit.livingMembers.length, true) : 0;
  await unit.update({'system.assaultResolved': true, 'flags.boltaction.vehicleAssaultMode':mode, 'flags.boltaction.vehicleAssaultTargets': continuing ? [...prior, target.uuid] : [target.uuid]});
  const rolls = [], lines = [`${unit.name} → ${target.name}; ${mode} assault at measured route ${range} inches.`];
  let result, damageResults = [];
  if (mode === 'infantry') {
    const attackDice = await dice(count, rolls), [damageDie] = await dice(1, rolls);
    result = rules.infantryVehicleAssault({dice: attackDice, damageDie, damageValue: target.damageValue, order: target.system.order,
      immobilised: target.system.immobilised, openTopped: target.system.openTopped, tankHunters: Boolean(options.tankHunters), hasAntiTank: Boolean(options.hasAntiTank || options.tankHunters)});
    if (result.damageRolls) damageResults = (await dice(result.damageRolls, rolls)).map(roll => rules.vehicleDamage({roll, superficial: result.superficial, alreadyImmobilised: target.system.immobilised, activated: target.system.activated}));
    lines.push(`${count} attacks needing ${result.target}+: ${result.hits} hits. Damage total ${result.total} against front armour ${target.damageValue}.`);
    lines.push(result.destroyed ? 'Target destroyed: apply the result after checking applicable exceptions.' : result.damaged ? `Vehicle damage: ${damageResults.map(r => r.effect).join(', ')}. Confirm fire, pins, turret damage and other secondary results.` : 'No vehicle damage.');
    lines.push('Surviving assaulting infantry regroup; choose and move individual models manually.');
  } else if (mode === 'ram') {
    const [attackerDie, defenderDie] = await dice(2, rolls);
    result = rules.vehicleRam({attackerDie, defenderDie, attackerArmour: unit.damageValue, defenderArmour: target.damageValue});
    lines.push(`Ram totals: attacker ${result.attackerTotal}; defender ${result.defenderTotal}. Equal totals make both vehicles losers.`);
    for (const [side, actor] of [['attacker', unit], ['defender', target]]) {
      const effect = result[side];
      if (effect.destroyed) lines.push(`${actor.name}: destroyed.`);
      else if (effect.damage) {
        const [roll] = await dice(1, rolls);
        const damage = rules.vehicleDamage({roll, superficial: effect.superficial, alreadyImmobilised: actor.system.immobilised, activated: actor.system.activated});
        damageResults.push({side, ...damage});
        lines.push(`${actor.name}: ${effect.superficial ? 'superficial ' : ''}damage result ${damage.effect}.`);
      } else lines.push(`${actor.name}: no collision damage.`);
    }
    lines.push('Every surviving vehicle halts, receives a Down order and one additional pin. Apply these and any damage-table pins manually; neither vehicle is changed automatically.');
  } else {
    const moraleDice = await dice(2, rolls), morale = rules.moraleTest({...moraleOptions(target), dice: moraleDice});
    result = {...rules.tankOverrun({damageValue: unit.damageValue, targetKind: target.system.kind, moralePassed: morale.passed, order: unit.system.order, straight: true}), morale};
    lines.push(`Target morale ${morale.total} against ${morale.target}: ${morale.passed ? 'passed' : 'failed; target destroyed even if fanatical'}.`);
    if (target.system.kind === 'artillery') lines.push(`The artillery piece is destroyed regardless of morale; ${morale.passed ? 'surviving crew may re-crew eligible guns' : 'crew are also destroyed'}.`);
    lines.push('Continue the same straight tank Run path if legal. Move surviving infantry aside while maintaining formation and the one-inch gap. Resolve any further unit along that path separately with continueOverrun:true.');
  }
  lines.push('Movement, compulsory distances, reactions, casualties, passenger effects and resulting actor changes require referee confirmation. No models or vehicle states were automatically removed or altered.');
  await report(unit, lines, rolls);
  return {mode, ...result, damageResults};
}
