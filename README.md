# Bridge Builder

A plain browser-based recreation of the old Bridge Builder style of game. Django serves the
page, static files, and level JSON; the actual bridge editor, simulation, rendering, gravity,
stress, breakage, and vehicle crossing run in the browser with vanilla JavaScript and HTML5
Canvas.

The visual reference screenshots are stored in `screenshots/`. Generated screenshots used to
inspect the current procedural regimes are stored in `screenshots/procedural/`.

The game creates every map from a seed. Fresh page loads generate a new random seed, and entering
the same seed in the seed field recreates the same bridge problem. The procedural generator picks
between riverlands, marsh flats, highlands, alpine gorges, split valleys, and canyons, then uses
2D Superformula-derived curves for cliff walls, basin floors, water bodies, backdrop ridges, and
cliff anchor shelves:
https://en.wikipedia.org/wiki/Superformula

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

- Left click: select/place nodes and create beams
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
`-- tests/
```
