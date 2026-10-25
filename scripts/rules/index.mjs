/** Pure, deterministic rules primitives. Distances are inches; callers supply dice. */
export * from './special.mjs';
export {SCENARIOS, scenarioDuration, scenarioScore, objectiveControl, reserveEntry as scenarioReserveEntry, preparatoryBombardment} from './scenarios.mjs';
export const ORDERS = Object.freeze(['fire', 'advance', 'run', 'ambush', 'rally', 'down']);
export const QUALITY = Object.freeze({ inexperienced: { morale: 8, damage: 3 }, regular: { morale: 9, damage: 4 }, veteran: { morale: 10, damage: 5 } });
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const die = n => { if (!Number.isInteger(n) || n < 1 || n > 6) throw new RangeError('Supply a D6 result from 1 to 6'); return n; };
const pair = dice => { if (!Array.isArray(dice) || dice.length !== 2) throw new RangeError('Supply two D6 results'); return dice.map(die); };
const quality = q => { if (!QUALITY[q]) throw new RangeError(`Unknown troop quality: ${q}`); return QUALITY[q]; };
export function moraleValue({quality: q = 'regular', pins = 0, ncoAlive = true, moraleBonus = 0, modifier = 0, ignorePins = false} = {}) {
  return clamp(quality(q).morale + moraleBonus + modifier - (ncoAlive ? 0 : 1) - (ignorePins ? 0 : Math.max(0, pins)), 2, 10);
}
export function moraleTest(options = {}) {
  const dice = pair(options.dice), total = dice[0] + dice[1], target = moraleValue(options);
  return {dice, total, target, passed: total <= target};
}
export function pinRout({quality: q = 'regular', pins = 0} = {}) { return pins >= quality(q).morale; }
export function casualtyMoraleRequired({sizeBefore, casualties} = {}) { return sizeBefore > 0 && casualties > 0 && casualties * 2 >= sizeBefore; }
export function fullStrengthEligible({kind = 'infantry', fullStrength = false, startingSize = 0, maxSize = 0, livingSize = startingSize} = {}) {
  return kind === 'infantry' && fullStrength && startingSize >= 10 && startingSize === maxSize && livingSize === startingSize;
}
export function orderTest(options = {}) {
  const {order = 'fire', pins = 0, forceTest = false, bonusDie, rerollDice} = options;
  if (!ORDERS.includes(order)) throw new RangeError('Unknown order');
  if (order === 'down' || (!pins && !forceTest)) return {passed: true, automatic: true, order, pinsRemoved: 0, remainingPins: pins, fubar: false, courage: false, rerolled: false};
  let result = moraleTest({...options, ignorePins: order === 'rally'}), rerolled = false;
  const canReroll = !result.passed && fullStrengthEligible(options);
  if (canReroll && rerollDice) { result = moraleTest({...options, dice: rerollDice, ignorePins: order === 'rally'}); rerolled = true; }
  const courage = result.total === 2, fubar = result.total === 12;
  const needsBonusDie = result.passed && (order === 'rally' || courage) && pins > 0;
  const pinsRemoved = result.passed ? Math.min(pins, needsBonusDie ? (bonusDie === undefined ? 0 : die(bonusDie) + 1) : 1) : 0;
  return {...result, automatic: false, order: result.passed ? order : 'down', requestedOrder: order, pinsRemoved, remainingPins: pins - pinsRemoved, fubar, courage, rerolled, canReroll: canReroll && !rerolled, needsBonusDie: needsBonusDie && bonusDie === undefined};
}
export function fubarResult({roll, kind = 'infantry', friendlyTargetAvailable = true, enemyVisible = true, canMove = true} = {}) {
  die(roll);
  if (roll <= 2) return {effect: 'friendly-fire', order: friendlyTargetAvailable ? 'fire' : 'down', manualTarget: friendlyTargetAvailable, enemyProximity: 12};
  const panic = kind !== 'vehicle' && enemyVisible && canMove;
  return {effect: 'panic', order: panic ? 'run' : 'down', retreat: panic};
}
export function shootingTarget({pins = 0, quality: q = 'regular', range = 0, weaponRange = 24, moved = false, assault = false, targetDown = false, smallTeam = false, cover = 'none', extraModifier = 0} = {}) {
  quality(q);
  if (!(range >= 0) || !(weaponRange > 0)) throw new RangeError('Invalid range');
  if (!['none', 'soft', 'hard'].includes(cover)) throw new RangeError('Unknown cover');
  const modifiers = {pointBlank: range <= 6 ? 1 : 0, pins: -Math.max(0, pins), longRange: range > weaponRange / 2 ? -1 : 0, inexperienced: q === 'inexperienced' ? -1 : 0, moved: moved && !assault ? -1 : 0, down: targetDown ? -2 : 0, smallTeam: smallTeam ? -1 : 0, cover: cover === 'hard' ? -2 : cover === 'soft' ? -1 : 0, extra: extraModifier};
  const modifier = Object.values(modifiers).reduce((a,b) => a+b, 0), target = Math.max(2, 3 - modifier);
  return {target, modifier, modifiers, sixSix: target > 6, inRange: range <= weaponRange};
}
export function resolveHits({dice = [], followupDice = [], ...options} = {}) {
  const target = shootingTarget(options); let followup = 0;
  const results = dice.map(value => { const roll = die(value); if (!target.inRange) return false; if (!target.sixSix) return roll >= target.target; if (roll !== 6) return false; return die(followupDice[followup++]) === 6; });
  return {...target, hits: results.filter(Boolean).length, results, followupsUsed: followup};
}
export function infantryDamage({dice = [], quality: q = 'regular', penetration = 0, damageValue = quality(q).damage, exceptionalDice = []} = {}) {
  const results = dice.map(value => die(value) !== 1 && value + penetration >= damageValue);
  const exceptionalCandidates = dice.flatMap((value,i) => value === 6 && results[i] ? [i] : []);
  const exceptional = exceptionalCandidates.filter((_,i) => exceptionalDice[i] !== undefined && die(exceptionalDice[i]) === 6);
  return {damageValue, casualties: results.filter(Boolean).length, results, exceptionalCandidates, exceptional, needsExceptionalDice: Math.max(0, exceptionalCandidates.length - exceptionalDice.length)};
}
export function armourPenetration({roll, penetration = 0, damageValue = 7, facing = 'front', longRange = false, rangeExempt = false} = {}) {
  die(roll); if (!['front', 'side', 'rear', 'top'].includes(facing)) throw new RangeError('Unknown armour facing');
  const armoured = damageValue >= 7;
  const modifier = penetration + (armoured ? ({front:0,side:1,rear:2,top:1}[facing]) - (longRange && !rangeExempt ? 1 : 0) : 0);
  const total = roll + modifier, damaged = roll !== 1 && (!armoured || penetration > 0) && total >= damageValue;
  return {total, modifier, damaged, superficial: damaged && armoured && total === damageValue, massive: damaged && total >= damageValue + 3, damageRolls: damaged ? (total >= damageValue + 3 ? 2 : 1) : 0};
}
export function vehiclePin({quality:q = 'regular', damageValue = 7, penetration = 0, openTopped = false, facing = 'front', longRange = false, rangeExempt = false, roll, automatic = false, hits = 1} = {}) {
  quality(q);
  if (hits <= 0) return {pinned:false,needsDie:false};
  if (automatic || openTopped || damageValue <= 6) return {pinned:true,needsDie:false};
  if (penetration < 1) return {pinned:false,needsDie:false};
  const canDamage = armourPenetration({roll:6,penetration,damageValue,facing,longRange,rangeExempt}).damaged;
  if (canDamage || q === 'inexperienced') return {pinned:true,needsDie:false};
  if (q === 'veteran') return {pinned:false,needsDie:false};
  return {pinned:roll === undefined ? false : die(roll) <= 3,needsDie:roll === undefined};
}
export function vehicleDamage({roll, superficial = false, openToppedIndirect = false, carriesFlamethrower = false, alreadyImmobilised = false, activated = false, turrets = 0, fireMoralePassed} = {}) {
  const total = die(roll) - (superficial ? 3 : 0) + (openToppedIndirect ? 1 : 0) + (carriesFlamethrower ? 1 : 0);
  const effect = total <= 1 ? 'stunned' : total === 2 ? 'immobilised' : total === 3 ? 'on-fire' : 'knocked-out';
  const destroyed = effect === 'knocked-out' || (effect === 'immobilised' && alreadyImmobilised) || (effect === 'on-fire' && fireMoralePassed === false);
  return {total, effect, destroyed, immobilised: effect === 'immobilised', pins: total <= 3 ? 1 : 0, order: effect === 'stunned' || (effect === 'on-fire' && fireMoralePassed !== false) || (effect === 'immobilised' && activated) ? 'down' : null, moraleRequired: effect === 'on-fire' && fireMoralePassed === undefined, turretJamRequired: turrets > 0 && total <= 3 && !destroyed && (effect !== 'on-fire' || fireMoralePassed === true)};
}
export function turretJam({roll} = {}) { return {jammed: die(roll) >= 4}; }
/** Standard infantry only; caller allocates casualties and handles traits separately. */
export function assaultRound({attackers, defenders, attackerQuality = 'regular', defenderQuality = 'regular', attackerDice = [], defenderDice = [], defensivePosition = false, subsequentRound = false} = {}) {
  if (![attackers,defenders].every(n => Number.isInteger(n) && n > 0)) throw new RangeError('Assault requires living models on both sides');
  const simultaneous = defensivePosition || subsequentRound;
  if (attackerDice.length !== attackers) throw new RangeError('Supply one attack die per attacker');
  const attackerDamage = infantryDamage({dice:attackerDice,quality:defenderQuality});
  const defenderLosses = Math.min(defenders,attackerDamage.casualties);
  const defenderAttacks = simultaneous ? defenders : defenders - defenderLosses;
  if (defenderDice.length !== defenderAttacks) return {needsDefenderDice:defenderAttacks,simultaneous,defenderLosses};
  const defenderDamage = infantryDamage({dice:defenderDice,quality:attackerQuality});
  const attackerLosses = Math.min(attackers,defenderDamage.casualties);
  let winner = null;
  if (defenderLosses === defenders && attackerLosses < attackers) winner = 'attacker';
  else if (attackerLosses === attackers && defenderLosses < defenders) winner = 'defender';
  else if (defenderLosses > attackerLosses) winner = 'attacker';
  else if (attackerLosses > defenderLosses) winner = 'defender';
  const bothDestroyed = attackerLosses === attackers && defenderLosses === defenders;
  if (bothDestroyed) winner = null;
  return {simultaneous,defenderAttacks,attackerLosses,defenderLosses,winner,bothDestroyed,draw:!winner && !bothDestroyed,attackersRemaining:winner === 'defender' ? 0 : attackers-attackerLosses,defendersRemaining:winner === 'attacker' ? 0 : defenders-defenderLosses,manualExceptionalDamage:attackerDamage.exceptionalCandidates.length > 0 || defenderDamage.exceptionalCandidates.length > 0};
}
export function retainOrder({order, retain = true, pins = 0, roll} = {}) {
  const retained = retain && ['ambush','down'].includes(order);
  const pinsRemoved = retained && order === 'down' && pins > 0 && roll !== undefined ? Math.min(pins, Math.ceil(die(roll) / 2)) : 0;
  return {retained, order: retained ? order : '', activated: retained, pinsRemoved, remainingPins: pins - pinsRemoved, needsDie: retained && order === 'down' && pins > 0 && roll === undefined};
}
export function movementBudget({kind = 'infantry', order = 'advance', terrain = 'open', reverse = false, recce = false, advance, run, gunClass = 'light', crew = 2} = {}) {
  const profiles = {infantry:[6,12,0,0], artillery:[0,6,0,0], tracked:[9,18,1,0], halftrack:[9,18,2,1], wheeled:[12,24,2,1]};
  const profile = profiles[kind]; if (!profile) throw new RangeError('Unknown movement kind');
  const vehicle = ['tracked','halftrack','wheeled'].includes(kind), running = order === 'run';
  let allowed = ['advance','run'].includes(order);
  if (kind === 'artillery' && running && (crew <= 1 || !['light','medium'].includes(gunClass))) allowed = false;
  if (terrain === 'rough' && (kind === 'artillery' || kind === 'wheeled' || running)) allowed = false;
  if (terrain === 'obstacle' && (kind === 'artillery' || kind === 'wheeled' || (kind === 'infantry' && running))) allowed = false;
  if (terrain === 'building' && kind !== 'infantry') allowed = false;
  if (reverse && (!vehicle || running)) allowed = false;
  let distance = running ? (run ?? profile[1]) : (advance ?? profile[0]);
  if (terrain === 'road' && vehicle) distance *= 2;
  if (reverse && !recce) distance /= 2;
  return {allowed, distance: allowed ? distance : 0, pivots: allowed ? (reverse && !recce ? 0 : profile[running ? 3 : 2]) : 0, rotationOnly: kind === 'artillery' && order === 'advance', manual: kind === 'artillery'};
}
/** Connected formation using edge-to-edge distances; radius defaults to zero. */
export function checkFormation(models = [], {gap = 1} = {}) {
  if (!models.length) return {valid: true, disconnected: []};
  const seen = new Set([0]), pending = [0];
  while (pending.length) { const i = pending.pop(); models.forEach((b,j) => { const a = models[i]; if (!seen.has(j) && Math.hypot(a.x-b.x,a.y-b.y) - (a.radius ?? 0) - (b.radius ?? 0) < gap) {seen.add(j); pending.push(j);} }); }
  return {valid: seen.size === models.length, disconnected: models.map((m,i) => seen.has(i) ? null : (m.id ?? i)).filter(i => i !== null)};
}
export function createBag(units = []) {
  return {remaining: units.filter(u => !u.destroyed && !u.activated && !u.retained).map(u => ({id:u.id, side:u.side})), drawn: []};
}
export function drawOrderDie(state, random = Math.random) {
  if (!state.remaining.length) return {state: {remaining: [], drawn: [...state.drawn]}, die: null};
  const value = random(); if (!(value >= 0 && value < 1)) throw new RangeError('Random must return [0,1)');
  const remaining = state.remaining.map(d => ({...d})), [selected] = remaining.splice(Math.floor(value * remaining.length), 1);
  return {state: {remaining, drawn: [...state.drawn, selected]}, die: selected};
}
export function removeOrderDie(state, id) { return {remaining: state.remaining.filter(d => d.id !== id), drawn: state.drawn.filter(d => d.id !== id)}; }
