import {pathToFileURL} from 'node:url';

export const phases = Object.freeze([
  {id: 'understanding', needs: [], tasks: ['Verify order, morale, shooting, movement and vehicle primitives against the owned rules'], checks: ['node --test tests/rules.test.mjs']},
  {id: 'transfer', needs: ['understanding'], tasks: ['Map shared state to units, individual losses to soldiers, and ambiguous rules to manual inputs'], checks: ['node --test tests/services.test.mjs']},
  {id: 'data-model', needs: ['transfer'], tasks: ['Validate actor and item schemas, reciprocal memberships and faction references'], checks: ['node --test tests/services.test.mjs tests/catalogue.test.mjs']},
  {id: 'design', needs: ['data-model'], tasks: ['Review pure rules, document state, service permissions and ApplicationV2 boundaries'], checks: ['npm run check']},
  {id: 'tooler', needs: ['design'], tasks: ['Maintain validators, scaffolder, dependency planner, repeatable imports and isolated packaging'], checks: ['node --test tests/integration.test.mjs']},
  {id: 'data-import', needs: ['data-model', 'tooler'], tasks: ['Validate profiles and references, import real compendiums, preserve customized existing entries'], checks: ['node tools/catalogue.mjs', 'node --test tests/catalogue.test.mjs']},
  {id: 'scaffolding', needs: ['design'], tasks: ['Boot the V14 manifest, data models, document classes, sheets and public API'], checks: ['node --test tests/services.test.mjs']},
  {id: 'automation', needs: ['scaffolding', 'tooler'], tasks: ['Check optional pins, orders, random bag, retained orders, movement and cohesion assistants'], checks: ['node --test tests/rules.test.mjs tests/services.test.mjs']},
  {id: 'interface', needs: ['scaffolding'], tasks: ['Review army, unit, soldier, item and battle-board flows, including manual adjudication'], checks: ['node --test tests/ui.test.mjs']},
  {id: 'production', needs: ['data-import', 'automation', 'interface'], tasks: ['Validate source, run behavioral tests, build code-only release ZIP'], checks: ['npm run check', 'npm test', 'npm run build']},
  {id: 'ui-rendering', needs: ['interface', 'tooler'], tasks: ['Render production templates separately, inspect at desktop and narrow widths, iterate'], checks: ['node tools/render-ui.mjs'], manual: true},
  {id: 'foundry-validation', needs: ['production', 'ui-rendering'], tasks: ['Install into licensed V14; test GM plus player, restart persistence, two complete rounds, transports and casualties'], checks: [], manual: true}
]);

// Explicit scope prevents a passing starter test suite from implying completeness.
export const requiredFeatures = Object.freeze({
  rules: Object.freeze(['orders', 'morale', 'rally', 'courage', 'fubar', 'direct-fire', 'exceptional-damage', 'assaults', 'movement', 'formation', 'terrain', 'buildings', 'artillery-he', 'indirect-fire', 'vehicle-armour', 'vehicle-damage', 'vehicle-pins', 'transports', 'special-rules', 'reserves', 'outflanking', 'preparatory-bombardment', 'objective-control', 'scenario-duration', 'scenario-scoring']),
  models: Object.freeze(['army-unit-model-hierarchy', 'reciprocal-membership', 'embedded-weapons', 'factions-traits-selectors', 'roster-validation', 'document-permissions', 'persistent-combat-state']),
  catalogue: Object.freeze(['weapon-chart', 'trait-profiles', 'faction-rules', 'army-list-options', 'force-selectors', 'twelve-scenarios', 'reference-integrity', 'idempotent-compendium-import']),
  automation: Object.freeze(['random-order-bag', 'activation-once', 'retained-orders', 'casualty-nco-state', 'shooting-once', 'standard-hit-pin-once', 'transport-rollback', 'reserve-entry', 'objective-updates', 'scenario-round-end']),
  interface: Object.freeze(['army-roster', 'unit-sheet', 'model-sheet', 'item-sheet', 'battle-board', 'attack-dialogs', 'scenario-controls', 'reserve-controls', 'faction-trait-display', 'manual-adjudication-notices', 'nonowner-visibility', 'responsive-rendering']),
  verification: Object.freeze(['source-validation', 'pure-rule-tests', 'mocked-v14-boot', 'service-workflow-tests', 'catalogue-tests', 'ui-context-tests', 'release-isolation', 'standalone-template-render', 'live-v14-gm-player', 'live-v14-restart', 'live-v14-two-rounds'])
});

export function completenessGate(completedFeatures = []) {
  const required = Object.values(requiredFeatures).flat();
  const done = new Set(completedFeatures);
  for (const feature of done) if (!required.includes(feature)) throw new Error(`Unknown completed feature: ${feature}`);
  const missing = Object.fromEntries(Object.entries(requiredFeatures).map(([category, features]) => [category, features.filter(feature => !done.has(feature))]));
  const remaining = Object.values(missing).reduce((total, features) => total + features.length, 0);
  return {complete: remaining === 0, completed: required.length - remaining, required: required.length, missing};
}

export function validateGraph(graph = phases) {
  const byId = new Map(graph.map(phase => [phase.id, phase]));
  if (byId.size !== graph.length) throw new Error('Duplicate phase ID');
  const visited = new Set(), active = new Set();
  function visit(id) {
    if (!byId.has(id)) throw new Error(`Unknown dependency: ${id}`);
    if (active.has(id)) throw new Error(`Dependency cycle at ${id}`);
    if (visited.has(id)) return;
    active.add(id);
    for (const dependency of byId.get(id).needs) visit(dependency);
    active.delete(id); visited.add(id);
  }
  for (const phase of graph) visit(phase.id);
  return byId;
}
export function nextTasks(completed = []) {
  const byId = validateGraph(), done = new Set(completed);
  for (const id of done) if (!byId.has(id)) throw new Error(`Unknown completed phase: ${id}`);
  return phases.filter(phase => !done.has(phase.id) && phase.needs.every(id => done.has(id)));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = process.argv.indexOf('--completed');
  const done = index >= 0 ? (process.argv[index + 1] ?? '').split(',').filter(Boolean) : [];
  const featureIndex = process.argv.indexOf('--features');
  const features = featureIndex >= 0 ? (process.argv[featureIndex + 1] ?? '').split(',').filter(Boolean) : [];
  const result = {completed: done, available: nextTasks(done), phases, completeness: completenessGate(features)};
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Feature completeness: ${result.completeness.completed}/${result.completeness.required}${result.completeness.complete ? '' : ' (remaining requirements below)'}\n`);
    for (const [category, missing] of Object.entries(result.completeness.missing)) if (missing.length) console.log(`${category}: ${missing.join(', ')}`);
    for (const phase of result.available) console.log(`${phase.id}${phase.manual ? ' [manual verification]' : ''}: ${phase.tasks.join('; ')}\n  ${phase.checks.join(' && ') || 'Live Foundry verification required'}`);
  }
}
