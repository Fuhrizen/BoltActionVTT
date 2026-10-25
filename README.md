# BoltActionVTT

An unofficial Bolt Action Second Edition system for Foundry VTT V14. Use Foundry’s Configure Ownership for an Army, choose its faction, and organise individual models into squads. Armies and squads are expandable actor groups in the sidebar with their own sheets and inherited ownership.

The GM prepares model and pre-made squad compendiums without creating sample armies. Drag a compendium model into a squad's drop area to import an independent copy. Infantry squads hold infantry models; vehicle/static squads hold vehicles and static weapons. Squads manage experience; individual sheets offer source profile weapon and equipment choices using Foundry's default theme. Source-based points aggregate from models through squads to armies; unresolved prices are identified. Army-list legality is not enforced. Drag squads or armies onto a scene to deploy their individual models. Hovering over a model lightly highlights its visible squadmates. Turn sequencing is outside this iteration.

Not affiliated with Warlord Games, Osprey Publishing or Foundry Gaming. Requires the original rules; no rulebook text or artwork is distributed. Live V14 validation remains pending.

Shooting opens a confirmation card before rolling; loader availability and situational modifiers remain player-confirmed. GM preparation adds a Macro tools compendium. Macros can use `game.boltaction.confirmShooting(actor)`, `shootingPlan(actor)`, and `calculateCost(actor)` (API version 1).
