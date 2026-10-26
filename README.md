# BoltActionVTT

Unofficial Bolt Action Second Edition for Foundry VTT V14. Requires the original rulebook. Not affiliated with Warlord Games, Osprey Publishing or Foundry Gaming.

`fvtt/` contains the installable Foundry system: import an army JSON as GM, then manage squads, individual models, pins, casualties and manual rolls. Army construction lives in `web/`; Foundry has no integrated army builder. Imported armies receive independent actors and native ownership. Custom artwork is preserved.

For quick self-hosting, run `docker compose up --build -d` from the repository root and open **http://localhost:8080**. Set `WEB_PORT` to change the port. The stateless web service saves drafts in each browser; export JSON to retain or transfer an army. Use **Import army** in Foundry to create a new army without changing existing ones.

Alternatively, extract the release's `web-builder.zip` onto a static HTTP(S) host and open its root URL. Keep its `web/` and `fvtt/` directories together. Opening HTML directly as a local file is unsupported.

`npm test`, `npm run check` and `npm run build` validate and package Foundry; its release ZIP has `system.json` at the ZIP root. `npm run build:web` packages the static builder. `npm run tokens` regenerates checked-in SVGs without LFS or image generation.

This is an alpha. Composition checks are advisory; complex vehicle conversions and specialist combat rules can require manual review. Live Foundry verification remains incomplete.
