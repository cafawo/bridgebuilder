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

## Procedural Terrain Technology

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
