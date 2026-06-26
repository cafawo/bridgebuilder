# Bridge Builder

A plain browser-based recreation of the old Bridge Builder style of game. Django serves the
page, static files, and level JSON; the actual bridge editor, simulation, rendering, gravity,
stress, breakage, and vehicle crossing run in the browser with vanilla JavaScript and HTML5
Canvas.

The visual reference screenshots are stored in `screenshots/`.

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
- Right click: delete the nearest node or beam
- Space: toggle build/test simulation mode
- R: reset the level
- Esc: pause/unpause while testing

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
|-- levels/level_01.json
|-- screenshots/
`-- tests/
```
