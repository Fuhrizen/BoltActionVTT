// Pure scenario bookkeeping; players supply adjudicated locations and objectives.
const definitions = [
  [1, 'no-mans-land', 6, 7, 'attrition'], [2, 'meeting-engagement', 6, 7, 'attrition'],
  [3, 'key-positions', 6, 7, 'objectives'], [4, 'double-envelopment', 6, 8, 'envelopment'],
  [5, 'top-secret', 6, 7, 'extraction'], [6, 'demolition', 6, 7, 'demolition'],
  [7, 'envelopment', 6, 7, 'attacker-envelopment'], [8, 'manhunt', 7, 8, 'manhunt'],
  [9, 'point-defence', 6, 7, 'point-defence'], [10, 'hold-until-relieved', 6, 7, 'single-objective'],
  [11, 'surrounded', 6, 7, 'attrition'], [12, 'sectors', 6, 8, 'sectors']
].map(([id, slug, baseTurns, maxTurns, scoring]) => Object.freeze({id, slug, duration: Object.freeze({baseTurns, maxTurns, extensionMinimum: 4}), scoring}));
export const SCENARIOS = Object.freeze(definitions);
function configuration(scenario) {
  const id = typeof scenario === 'object' ? scenario?.id : scenario;
  const result = definitions.find(entry => entry.id === id || entry.slug === id);
  if (!result) throw new Error('Unknown scenario');
  return result;
}
function integer(value, label, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${label}`);
  return value;
}
const count = (facts, key) => integer(facts[key] ?? 0, key);
const winner = (a, b, margin = 1) => Math.abs(a - b) < margin ? 'draw' : a > b ? 'a' : 'b';

export function scenarioDuration({scenario, turn, die, eventEnded = false} = {}) {
  const config = configuration(scenario), {baseTurns, maxTurns, extensionMinimum} = config.duration;
  integer(turn, 'turn', 1);
  if (die !== undefined) integer(die, 'duration die', 1, 6);
  const early = eventEnded && [6, 8].includes(config.id);
  if (early || turn >= maxTurns) return {ended: true, needsDie: false, nextTurn: null};
  if (turn < baseTurns) return {ended: false, needsDie: false, nextTurn: turn + 1};
  if (die === undefined) return {ended: false, needsDie: true, nextTurn: null};
  const ended = die < extensionMinimum;
  return {ended, needsDie: false, nextTurn: ended ? null : turn + 1};
}

// For asymmetric scenarios, a is the attacker and b the defender.
export function scenarioScore({scenario, a = {}, b = {}} = {}) {
  const config = configuration(scenario);
  let scoreA = 0, scoreB = 0, result;
  const kills = facts => count(facts, 'destroyedEnemy');
  const envelop = facts => kills(facts) + 2 * count(facts, 'unitsEnemyZone') + 3 * count(facts, 'unitsExited');
  switch (config.scoring) {
    case 'attrition': scoreA = kills(a); scoreB = kills(b); break;
    case 'objectives': scoreA = count(a, 'controlledObjectives'); scoreB = count(b, 'controlledObjectives'); break;
    case 'envelopment': scoreA = envelop(a); scoreB = envelop(b); break;
    case 'attacker-envelopment': scoreA = envelop(a); scoreB = 2 * kills(b); break;
    case 'sectors':
      scoreA = kills(a) + count(a, 'neutralQuarterUnits') + 3 * count(a, 'enemyQuarterUnits');
      scoreB = kills(b) + count(b, 'neutralQuarterUnits') + 3 * count(b, 'enemyQuarterUnits');
      break;
    case 'extraction': scoreA = Number(Boolean(a.objectiveExited)); scoreB = Number(Boolean(b.objectiveExited)); break;
    case 'demolition': scoreA = Number(Boolean(a.enemyBaseDestroyed)); scoreB = Number(Boolean(b.enemyBaseDestroyed)); break;
    case 'single-objective': scoreA = Number(Boolean(a.controlsObjective)); scoreB = Number(Boolean(b.controlsObjective)); break;
    case 'manhunt': {
      const state = b.officerState ?? 'alive';
      if (!['alive', 'captured', 'killed'].includes(state)) throw new Error('Invalid officer state');
      result = state === 'captured' ? 'a' : state === 'alive' ? 'b' : 'draw';
      scoreA = Number(result === 'a'); scoreB = Number(result === 'b');
      break;
    }
    case 'point-defence': {
      scoreA = integer(a.controlledObjectives ?? 0, 'attacker objectives', 0, 3);
      scoreB = 3 - scoreA;
      result = scoreA >= 2 ? 'a' : scoreA === 1 ? 'draw' : 'b';
      break;
    }
  }
  const margin = ['attrition', 'envelopment', 'attacker-envelopment', 'sectors'].includes(config.scoring) ? 2 : 1;
  return {a: scoreA, b: scoreB, winner: result ?? winner(scoreA, scoreB, margin)};
}

export function objectiveControl({nearby = [], previous = null, sticky = false} = {}) {
  if (!Array.isArray(nearby)) throw new Error('Nearby units must be an array');
  const present = nearby.filter(unit => {
    if (!Number.isFinite(unit.distance) || unit.distance < 0 || typeof unit.side !== 'string' || !unit.side) throw new Error('Invalid objective proximity');
    return unit.distance <= 3 && !unit.destroyed && unit.active !== false;
  });
  const sides = new Set(present.map(unit => unit.side));
  const holder = sides.size === 1 && present.some(unit => ['infantry', 'artillery'].includes(unit.kind) || ['infantry', 'artillery'].includes(unit.embarkedKind)) ? present[0].side : null;
  return holder || (sticky ? previous : null);
}

export function reserveEntry({scenario, turn, outflank = false, distanceFromOwnEdge, tableDepth = 48, edge, lastEnemyEdge} = {}) {
  const config = configuration(scenario);
  integer(turn, 'turn', 1);
  if (!Number.isFinite(tableDepth) || tableDepth <= 0) throw new Error('Invalid table depth');
  if (distanceFromOwnEdge !== undefined && (!Number.isFinite(distanceFromOwnEdge) || distanceFromOwnEdge < 0)) throw new Error('Invalid entry distance');
  const firstTurn = outflank ? 3 : config.id === 5 ? 1 : 2;
  const maxSideEdgeDistance = outflank ? Math.min(tableDepth, 24 + Math.max(0, turn - 3) * 12) : null;
  const permitted = !outflank || ![4, 7, 12].includes(config.id);
  const confused = [8, 11].includes(config.id);
  const blockedEdge = confused && edge !== undefined && edge === lastEnemyEdge;
  const tooFar = outflank && distanceFromOwnEdge !== undefined && distanceFromOwnEdge > maxSideEdgeDistance;
  const eligible = permitted && turn >= firstTurn && !blockedEdge && !tooFar;
  return {eligible, firstTurn, orderTestModifier: -1, orders: eligible ? ['advance', 'run'] : ['down'], canAssault: false, canExit: false, maxSideEdgeDistance, confusedFight: confused};
}

export function preparatoryBombardment({die, bunker = false, targetOfficer = false} = {}) {
  integer(die, 'bombardment die', 1, 6);
  const effective = Math.min(targetOfficer ? 5 : 6, die - Number(Boolean(bunker)));
  return {pins: effective <= 1 ? 0 : effective <= 3 ? 1 : 2,
    automaticHits: Number(effective === 6), penetration: effective === 6 ? 3 : 0,
    indirect: effective === 6, facing: effective === 6 ? 'top' : null};
}
