# Bridgebuilder Agent Guide

## Product and runtime

- This is a static browser game deployed from the repository root.
- Runtime code is `index.html`, `static/game/css/`, and browser ES modules in
  `static/game/js/`.
- Keep the implementation framework-free: vanilla JavaScript, DOM controls, and
  exactly one HTML5 Canvas.
- Do not add a backend, runtime Python, Node/npm, a bundler, a frontend framework,
  additional canvases, third-party game assets, or copied assets.
- Draw game visuals with Canvas primitives and keep the restrained dark-grid,
  terrain, water, node, and straight-member style.

## Gameplay contracts

- Challenge is the default scored mode; Sandbox is explicitly unranked.
- Physics advances deterministically at a fixed 1/120-second tick. Do not make
  outcomes depend on display refresh rate, wall-clock frame timing, or member
  insertion order.
- Train load comes from the simulation trial, not from mutable level or vehicle
  data.
- Capacity results must be replay-certified. Never trust a score embedded in a
  URL, draft, or imported blueprint.
- Keep mechanical and cosmetic random streams separate. Cosmetic changes must
  not alter geometry, rated load, budget, fingerprint, or score.
- Terrain, water, hazards, build exclusions, and navigation clearances must come
  from explicit shared geometry so rendering, editing, and collision agree.
- Preserve the four mechanical archetypes, seven biome regimes, budgeted
  reference designs, failure-first outcome ordering, and genuine-bracing checks.

## Versioning and persistence

- `GENERATOR_VERSION`, `PHYSICS_VERSION`, and `BLUEPRINT_VERSION` define scoring
  and persistence compatibility. Change them intentionally when a change makes
  old scores or blueprints non-comparable.
- Keep browser cache tags such as `?v=challenge2` coordinated when deployed
  module behavior changes.
- Drafts and records must remain isolated by generator version, physics version,
  seed fingerprint, and mode.
- Shared URLs serialize only validated movable nodes and members. Fixed anchors
  are regenerated from the seed.

## Development tooling

- Python is development tooling only; no Python code ships with the game.
- Use the `bridgebuilder` conda environment for the pytest/headless-Chrome
  harness, local static server, and Ruff.
- Run commands with `conda run -n bridgebuilder ...`; do not rely on shell
  activation.
- Chrome, Chromium, or Edge is required for browser tests. Set `CHROME_BIN` when
  it is not discoverable automatically.

## Required validation

Run these after gameplay, UI, generator, persistence, or documentation changes:

```text
conda run -n bridgebuilder pytest -q
conda run -n bridgebuilder ruff check --no-cache .
git diff --check
```

- Keep the browser-native suites in `tests/browser_runner.html` and
  `tests/app_runner.html`; pytest only serves and drives them.
- Add deterministic regression coverage for gameplay changes and real-app
  coverage for controls, persistence, focus, touch, or accessibility changes.
- Do not commit generated caches, temporary profiles, obsolete screenshots, or
  unreferenced artifacts.
