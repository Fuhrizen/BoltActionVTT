const SID = 'boltaction';
export async function listScenarios() {
  const response = await fetch(`systems/${SID}/compendiums/scenarios.json`);
  if (!response.ok) throw new Error('Scenario catalogue could not be loaded.');
  return response.json();
}
export async function configureScenario({scenarioId, attackerSide = 'axis', defenderSide = 'allies'} = {}) {
  if (!game.user.isGM) throw new Error('The GM configures the scenario.');
  if (!canvas.scene) throw new Error('Open the battlefield Scene first.');
  const scenarios = await listScenarios();
  const scenario = scenarios.find(row => String(row.id) === String(scenarioId) || row.slug === scenarioId);
  if (!scenario) throw new Error('Choose a scenario from the rulebook catalogue.');
  if (!attackerSide || !defenderSide || attackerSide === defenderSide) throw new Error('Configure two different sides.');
  await canvas.scene.setFlag(SID, 'scenario', {scenarioId: scenario.id, slug: scenario.slug, attackerSide, defenderSide});
  ui.notifications.info(`Scenario configured: ${scenario.name}. Place objectives and apply deployment instructions before starting the round.`);
  return scenario;
}
export async function scenarioStatus() {
  const state = canvas.scene?.getFlag(SID, 'scenario');
  if (!state) return null;
  const scenario = (await listScenarios()).find(row => row.id === state.scenarioId || row.slug === state.slug);
  return scenario ? {...state, scenario, name: scenario.name} : null;
}
