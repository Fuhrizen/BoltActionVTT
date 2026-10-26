import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SCENARIOS, scenarioDuration, scenarioScore, objectiveControl, reserveEntry, preparatoryBombardment} from '../fvtt/scripts/rules/scenarios.mjs';

test('all twelve scenario catalogue rows match pure duration and scoring definitions', async () => {
  const rows = JSON.parse(await readFile(new URL('../fvtt/compendiums/scenarios.json', import.meta.url), 'utf8'));
  assert.deepEqual(rows.map(row => row.id), Array.from({length: 12}, (_, i) => i + 1));
  assert.equal(new Set(rows.map(row => row.slug)).size, 12);
  for (const row of rows) {
    const definition = SCENARIOS.find(entry => entry.id === row.id);
    assert.equal(row.slug, definition.slug);
    assert.ok(row.name);
    assert.equal(row.sourceEdition, 2);
    assert.ok(row.sourcePage >= 134 && row.sourcePage <= 148);
    for (const key of ['baseTurns', 'maxTurns', 'extensionMinimum']) assert.equal(row.duration[key], definition.duration[key]);
    assert.equal(row.scoring.rule, definition.scoring);
    assert.equal(row.reserves.orderTestModifier, -1);
    assert.equal(row.reserves.exitOnArrival, false);
  }
});

test('duration uses bounded extra turns, Manhunt seven turns, and explicit early end events', () => {
  assert.deepEqual(scenarioDuration({scenario: 1, turn: 5}), {ended: false, needsDie: false, nextTurn: 6});
  assert.equal(scenarioDuration({scenario: 1, turn: 6}).needsDie, true);
  assert.equal(scenarioDuration({scenario: 1, turn: 6, die: 3}).ended, true);
  assert.equal(scenarioDuration({scenario: 1, turn: 6, die: 4}).nextTurn, 7);
  assert.equal(scenarioDuration({scenario: 1, turn: 7, die: 6}).ended, true);
  for (const scenario of [4, 12]) {
    assert.equal(scenarioDuration({scenario, turn: 7, die: 4}).nextTurn, 8);
    assert.equal(scenarioDuration({scenario, turn: 8}).ended, true);
  }
  assert.equal(scenarioDuration({scenario: 8, turn: 6}).needsDie, false);
  assert.equal(scenarioDuration({scenario: 8, turn: 7, die: 4}).nextTurn, 8);
  assert.equal(scenarioDuration({scenario: 8, turn: 2, eventEnded: true}).ended, true);
  assert.equal(scenarioDuration({scenario: 6, turn: 2, eventEnded: true}).ended, true);
  assert.equal(scenarioDuration({scenario: 1, turn: 2, eventEnded: true}).ended, false);
  assert.throws(() => scenarioDuration({scenario: 1, turn: 6, die: 7}), /Invalid/);
});

test('standard kill, envelopment and sector scores require a two-point lead', () => {
  for (const scenario of [1, 2, 11]) {
    assert.deepEqual(scenarioScore({scenario, a: {destroyedEnemy: 4}, b: {destroyedEnemy: 3}}), {a: 4, b: 3, winner: 'draw'});
    assert.equal(scenarioScore({scenario, a: {destroyedEnemy: 5}, b: {destroyedEnemy: 3}}).winner, 'a');
  }
  assert.deepEqual(scenarioScore({scenario: 4, a: {destroyedEnemy: 1, unitsEnemyZone: 2, unitsExited: 1}, b: {unitsExited: 2}}), {a: 8, b: 6, winner: 'a'});
  assert.deepEqual(scenarioScore({scenario: 7, a: {unitsExited: 1}, b: {destroyedEnemy: 2}}), {a: 3, b: 4, winner: 'draw'});
  assert.deepEqual(scenarioScore({scenario: 12, a: {destroyedEnemy: 1, neutralQuarterUnits: 2, enemyQuarterUnits: 1}, b: {enemyQuarterUnits: 1}}), {a: 6, b: 3, winner: 'a'});
  assert.throws(() => scenarioScore({scenario: 1, a: {destroyedEnemy: -1}}), /Invalid/);
});

test('objective, extraction, base and officer scenarios have their distinct victory conditions', () => {
  assert.equal(scenarioScore({scenario: 3, a: {controlledObjectives: 2}, b: {controlledObjectives: 1}}).winner, 'a');
  assert.equal(scenarioScore({scenario: 5, b: {objectiveExited: true}}).winner, 'b');
  assert.equal(scenarioScore({scenario: 6, a: {enemyBaseDestroyed: true}, b: {enemyBaseDestroyed: true}}).winner, 'draw');
  assert.equal(scenarioScore({scenario: 6, a: {enemyBaseDestroyed: true}}).winner, 'a');
  for (const [state, expected] of [['alive', 'b'], ['captured', 'a'], ['killed', 'draw']]) assert.equal(scenarioScore({scenario: 8, b: {officerState: state}}).winner, expected);
  for (const [objectives, expected] of [[0, 'b'], [1, 'draw'], [2, 'a'], [3, 'a']]) assert.equal(scenarioScore({scenario: 9, a: {controlledObjectives: objectives}}).winner, expected);
  assert.equal(scenarioScore({scenario: 10, a: {controlsObjective: true}}).winner, 'a');
});

test('objective control requires eligible troops and any active enemy contests, while sticky ownership persists', () => {
  const unit = (side, kind, distance, extra = {}) => ({side, kind, distance, ...extra});
  assert.equal(objectiveControl({nearby: [unit('a', 'infantry', 3)]}), 'a');
  assert.equal(objectiveControl({nearby: [unit('a', 'vehicle', 1)]}), null);
  assert.equal(objectiveControl({nearby: [unit('a', 'vehicle', 1, {embarkedKind: 'artillery'})]}), 'a');
  const contested = [unit('a', 'infantry', 1), unit('b', 'vehicle', 3)];
  assert.equal(objectiveControl({nearby: contested}), null);
  assert.equal(objectiveControl({nearby: contested, sticky: true, previous: 'b'}), 'b');
  assert.equal(objectiveControl({nearby: [unit('a', 'artillery', 1), unit('b', 'vehicle', 1, {destroyed: true})]}), 'a');
});

test('reserves respect opening delay, outflank depth, scenario bans and confused-fight edges', () => {
  assert.equal(reserveEntry({scenario: 1, turn: 1}).eligible, false);
  assert.equal(reserveEntry({scenario: 1, turn: 2}).eligible, true);
  assert.equal(reserveEntry({scenario: 5, turn: 1}).eligible, true);
  assert.equal(reserveEntry({scenario: 1, turn: 2, outflank: true}).eligible, false);
  assert.equal(reserveEntry({scenario: 1, turn: 3, outflank: true, distanceFromOwnEdge: 24}).eligible, true);
  assert.equal(reserveEntry({scenario: 1, turn: 3, outflank: true, distanceFromOwnEdge: 25}).eligible, false);
  assert.equal(reserveEntry({scenario: 1, turn: 4, outflank: true}).maxSideEdgeDistance, 36);
  for (const scenario of [4, 7, 12]) assert.equal(reserveEntry({scenario, turn: 4, outflank: true}).eligible, false);
  assert.equal(reserveEntry({scenario: 8, turn: 2, edge: 'north', lastEnemyEdge: 'north'}).eligible, false);
  const entering = reserveEntry({scenario: 11, turn: 2, edge: 'south', lastEnemyEdge: 'north'});
  assert.equal(entering.eligible, true);
  assert.equal(entering.orderTestModifier, -1);
  assert.equal(entering.canAssault, false);
  assert.equal(entering.canExit, false);
});

test('preparatory bombardment preserves bunker protection and Manhunt officer cap', () => {
  assert.equal(preparatoryBombardment({die: 1}).pins, 0);
  assert.equal(preparatoryBombardment({die: 3}).pins, 1);
  assert.equal(preparatoryBombardment({die: 4}).pins, 2);
  assert.deepEqual(preparatoryBombardment({die: 6}), {pins: 2, automaticHits: 1, penetration: 3, indirect: true, facing: 'top'});
  assert.equal(preparatoryBombardment({die: 6, bunker: true}).automaticHits, 0);
  assert.equal(preparatoryBombardment({die: 2, bunker: true}).pins, 0);
  assert.equal(preparatoryBombardment({die: 6, targetOfficer: true}).automaticHits, 0);
});
