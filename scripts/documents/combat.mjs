export class BoltCombat extends foundry.documents.Combat {
  async startCombat() { await game.boltaction.nextRound(); return this; }
  async nextTurn() { await game.boltaction.drawDie(); return this; }
  async nextRound() { await game.boltaction.nextRound(); return this; }
  async previousTurn() { throw new Error("Use the Battle Board; random order draws cannot be reversed through initiative."); }
  async previousRound() { throw new Error("Use the Battle Board to start the next round."); }
  async rollInitiative() { ui.notifications.info("Use Draw die on the Battle Board to determine the next side."); return this; }
}
