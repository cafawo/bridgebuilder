# Bridge Builder

A plain browser-based bridge-building game inspired by classic Bridge Builder puzzles. Django
serves one page, static files, and seeded level JSON; vanilla JavaScript handles the editor,
renderer, physics simulation, stress, breakage, and vehicle crossing on a single HTML5 Canvas.

The current focus is procedural terrain: every level is generated from a seed, so the same seed
always recreates the same bridge problem while new seeds produce different spans, anchor shelves,
water bodies, ridgelines, and budgets.

## Procedural Biome Gallery

These screenshots are actual seeded canvas captures from the game. They were selected to show the
range of visual regimes the generator can produce while keeping the same restrained Bridge Builder
style: dark grid, rock silhouettes, water, anchor nodes, straight beams, and simple terrain.

<table>
  <tr>
    <th>Canyon</th>
    <th>Highlands</th>
    <th>Alpine Gorge</th>
  </tr>
  <tr>
    <td><img src="screenshots/procedural/showcase/canyon.png" alt="Knife Edge Canyon procedural bridge level" width="320"></td>
    <td><img src="screenshots/procedural/showcase/highlands.png" alt="Highland Cut procedural bridge level" width="320"></td>
    <td><img src="screenshots/procedural/showcase/alpine-gorge.png" alt="Alpine Gorge procedural bridge level" width="320"></td>
  </tr>
  <tr>
    <th>Split Valley</th>
    <th>Riverlands</th>
    <th>Marshland</th>
  </tr>
  <tr>
    <td><img src="screenshots/procedural/showcase/split-valley.png" alt="Forked River Gorge procedural bridge level" width="320"></td>
    <td><img src="screenshots/procedural/showcase/riverlands.png" alt="Wide River Bend procedural bridge level" width="320"></td>
    <td><img src="screenshots/procedural/showcase/marshland.png" alt="Marsh Causeway procedural bridge level" width="320"></td>
  </tr>
  <tr>
    <th>Swampland</th>
    <th></th>
    <th></th>
  </tr>
  <tr>
    <td><img src="screenshots/procedural/showcase/swampland.png" alt="Swamp Crossing procedural bridge level" width="320"></td>
    <td></td>
    <td></td>
  </tr>
</table>

The full-page captures used to make this gallery are kept in `screenshots/procedural/`.

## The Science Behind

### Procedural Generation

The generator lives in `game/views.py`. It uses deterministic randomness from a normalized seed:
the seed is hashed with SHA-256, the first eight digest bytes initialize Python's `random.Random`,
and every later choice comes from that seeded RNG. This makes generated levels reproducible without
storing level files.

The core shape source is the Superformula:

```text
r(phi) = (
  |cos(m * phi / 4) / a|^n2
  + |sin(m * phi / 4) / b|^n3
)^(-1 / n1)
```

In each level, the generator samples two independent Superformula parameter sets:

- `shore`: controls the left and right cliff profiles descending from road height to water.
- `river`: controls the riverbed or basin floor under the water.

The game does not draw complete polar Superformula flowers. Instead, `r(phi)` is used as an
organic signal that is remapped onto 2D terrain profiles:

1. Normalize the seed and choose a weighted visual regime: riverlands, marshland, swampland,
   highlands, alpine gorge, split valley, or canyon.
2. Sample regime-specific ranges for road height, bridge span, water drop, basin depth, shore run,
   roughness, shelf count, backdrop type, reed density, vehicle load, and budget multiplier.
3. Generate Superformula parameters for the shore and riverbed profiles. The `m`, `a`, `b`, `n1`,
   `n2`, and `n3` values determine how jagged, rounded, pinched, or broad the terrain features feel.
4. Build each shore by sampling from road level down to water level. Smoothstep handles the overall
   vertical descent, while Superformula radius and sine waves push the cliff horizontally to produce
   irregular ledges and slopes.
5. Insert optional cliff shelves during shore generation. These become secondary fixed anchor
   platforms, which makes some seeds play like a pure road-to-road span and others play like a
   multi-anchor truss problem.
6. Build the riverbed across the gap. The river Superformula radius perturbs the floor depth, while
   a bank falloff keeps the water edge readable. Split valley levels add Gaussian basin shaping to
   raise a central ridge and form two water cuts.
7. Clip water inside the bridge gap as an organic polygon with a waved top edge, curved banks, and
   a shaped bottom. The renderer draws it before terrain so cliffs mask the water naturally.
8. Add background ridge layers, rock strata, and reeds from the same regime parameters. These details
   are visual only, but they make each biome read differently without changing the editor rules.
9. Emit one level JSON payload containing terrain polygons, water bodies, road segments, fixed
   anchors, vehicle settings, physics constants, and budget.

The result is a small procedural system with a stable gameplay contract: every map is just JSON, and
the browser renderer/editor/physics stack treats generated and hand-authored levels the same way.

### Physics Simulation

The bridge simulation lives in `game/static/game/js/physics.js`. It is not a full finite-element
solver, but it borrows the useful bits for a browser game: point masses, distance constraints,
iterative relaxation, stress estimates, and deterministic failure thresholds. The point is to make
bridge shape matter without making the player wait for a heavyweight structural analysis pass.

Each editor node becomes a simulated particle:

```text
node = {
  position: (x, y),
  previousPosition: (previousX, previousY),
  fixed: true | false,
  force: (forceX, forceY)
}
```

The integrator is Verlet-style. Instead of storing velocity directly, each free node compares its
current position with its previous position:

```text
velocity = (position - previousPosition) * damping
nextPosition = position + velocity + force * dt^2
```

That gives cheap inertia and damping with very little state. Fixed anchor nodes skip this update,
which is why anchor shelves behave like immovable rock sockets while player-created nodes sag,
swing, and collapse under load.

Beams are distance constraints. When a beam is created, the simulation records its `restLength`.
On every frame, it repeatedly walks all unbroken beams and tries to push their endpoints back toward
that length:

```text
delta = currentLength - restLength
correction = (delta / currentLength) * beamStiffness
```

The correction is split between endpoints unless one endpoint is fixed. Running several constraint
iterations per frame makes trusses feel stiff enough to drive over, while still allowing bad designs
to visibly bend before they fail.

Stress is a compact gameplay model built from three signals:

- `selfStress`: long beams start with more stress because their own weight scales with `length^2`.
- `loadStress`: vehicle wheels add downward force to contacted deck beams and estimate bending load.
- `axialStress`: stretched or compressed beams accumulate stress from constraint error.

The current formulas are intentionally readable:

```text
selfStress = (length^2 * deckFactor) / beamSelfWeightCapacity
bendingStress = (load * restLength * t * (1 - t) * deckFactor) / beamBendingCapacity
axialStress = abs(currentLength - restLength) / restLength
```

The `t * (1 - t)` term is the simple beam-bending trick: load near the middle is more punishing than
load near an endpoint. Deck beams use different factors than support beams because the gameplay
needs decks to carry wheels while supports should be better as triangulation members.

Beam capacity also changes with role and length:

```text
capacity = beamBreakStress * roleFactor * lengthFactor
lengthFactor = max(0.58, 1 - max(0, restLength - 140) * longBeamWeakening)
```

This keeps long beams legal, but not free. A long straight span might be buildable, yet it starts
closer to failure and needs support if the vehicle load concentrates near its center.

The vehicle is deliberately simple. It moves horizontally at the level's configured speed, samples
two wheel contact points, and looks for either ground segments or driveable deck beams under each
wheel. Contacted beams receive proportional wheel force at their endpoints:

```text
leftNode.forceY += wheelLoad * (1 - t)
rightNode.forceY += wheelLoad * t
```

If both wheels find a surface, the vehicle eases toward that surface and rotates to match its slope.
If no contact is found, gravity takes over and the vehicle falls. A run ends when the vehicle reaches
the flag, drops out of the world, enters the water, or enough beams have broken that the bridge is
considered failed.

## Setup

Create the conda environment:

```bash
conda env create -f environment.yml
```

If the environment already exists, update it:

```bash
conda env update -n bridgebuilder -f environment.yml --prune
```

All Python, Django, test, and lint commands should run through:

```bash
conda run -n bridgebuilder ...
```

## Run

Start the Django development server:

```bash
conda run -n bridgebuilder python manage.py runserver
```

Open:

```text
http://127.0.0.1:8000/
```

## Controls

- Left click: select/place nodes, create beams, or split an existing beam by clicking it
- Right click: cancel active beam building; when nothing is selected, delete the nearest node or beam
- Delete/Backspace: cancel active beam building; otherwise delete the hovered node or beam
- Z or Ctrl+Z: undo the last build/delete action
- Space: toggle build/test simulation mode
- R: reset the level
- Esc: cancel active beam building; pause/unpause while testing
- G: generate and load a new random seed
- Seed field: enter a seed and press Load to recreate that map

Only beams close to the road height become driveable deck beams. Lower or steep beams act as
support truss members, so the vehicle needs a real supported deck to cross.
Beams are not hard length-capped; long beams are allowed, but they still cost material and can
fail under the simulation load. Clicking an existing beam inserts a node on that beam and turns it
into two separate beams, which makes adding supports to a long span less fiddly. New beams also
connect through existing nodes and split crossed beams automatically, so visual intersections are
real physics joints.
The canvas HUD shows the currently available actions for the active selection or hovered part.

## Tests and Lint

```bash
conda run -n bridgebuilder python manage.py test
conda run -n bridgebuilder pytest
conda run -n bridgebuilder ruff check .
```

## Structure

```text
.
|-- AGENTS.md
|-- README.md
|-- environment.yml
|-- pyproject.toml
|-- manage.py
|-- bridgebuilder_site/
|-- game/
|   |-- templates/game/index.html
|   `-- static/game/
|       |-- css/style.css
|       `-- js/
|           |-- main.js
|           |-- physics.js
|           |-- renderer.js
|           |-- editor.js
|           |-- levels.js
|           `-- ui.js
|-- screenshots/
|   `-- procedural/
|       `-- showcase/
`-- tests/
```
