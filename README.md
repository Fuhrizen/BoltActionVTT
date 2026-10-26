# BoltActionVTT

Unofficial Bolt Action Second Edition for Foundry VTT V14. Armies contain platoons and squads; squads retain individual model actors, native ownership and source-based equipment choices. The original rulebook is required. Not affiliated with Warlord Games, Osprey Publishing or Foundry Gaming.

The Army sheet opens the integrated builder. Composition and points checks are advisory. The squad play bar provides pins, order state and a manual dice roller with optional weapon-count assistance. Detailed orders and model configuration remain expandable. Drag an army or squad onto a scene to deploy its models.

A separate self-hostable builder lives in `web/`. Download `web-builder.zip` from the release, extract it onto a static HTTP(S) host and open its root URL. It keeps drafts locally and exports a versioned `.boltaction.json` file. In Foundry, use **Import army** on an Army sheet as GM to create a new army from the file; existing armies remain unchanged. Foundry can export the same format back to the web builder. Keep `web/`, `scripts/`, `compendiums/` and `assets/` together when hosting; opening HTML directly as a local file is unsupported.

`npm test`, `npm run check` and `npm run build` validate and package the Foundry system. `npm run build:web` packages the static builder. `npm run tokens` regenerates the checked-in SVG assets without LFS or image generation. Custom artwork is preserved.

This is an alpha. Specialist combat rules and source-specific conversions can require manual adjudication. Live Foundry verification is incomplete.
