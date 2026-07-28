import json
import struct
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_MODULES = {
    "blueprint.js",
    "capacity.js",
    "editor.js",
    "generator.js",
    "leaderboard.js",
    "levels.js",
    "main.js",
    "physics.js",
    "renderer.js",
    "ui.js",
}
SHOWCASE_IMAGES = {
    "alpine-gorge.png",
    "canyon.png",
    "highlands.png",
    "marshland.png",
    "riverlands.png",
    "split-valley.png",
    "swampland.png",
}


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def test_root_is_a_single_canvas_static_app():
    index = read("index.html")

    assert index.count("<canvas") == 1
    assert 'id="game-canvas"' in index
    assert 'class="game-toolbar"' in index
    assert 'id="mode-select"' in index
    assert 'id="capacity-button"' in index
    assert 'id="leaderboard-button"' in index
    assert 'id="leaderboard-panel"' in index
    assert 'id="live-status"' in index
    assert 'rel="canonical" href="https://cafawo.github.io/bridgebuilder/"' in index
    assert 'data-goatcounter="https://bridgebuilder.goatcounter.com/count"' in index
    assert 'src="//gc.zgo.at/count.js"' in index
    assert "async" in index
    assert 'type="module"' in index
    assert "{%" not in index


def test_runtime_module_graph_is_complete_and_local():
    module_dir = ROOT / "static" / "game" / "js"
    assert {path.name for path in module_dir.glob("*.js")} == RUNTIME_MODULES

    gameplay_source = "\n".join(
        path.read_text(encoding="utf-8")
        for path in module_dir.glob("*.js")
        if path.name != "leaderboard.js"
    )
    assert "fetch(" not in gameplay_source
    assert "XMLHttpRequest" not in gameplay_source
    assert "WebSocket" not in gameplay_source

    leaderboard = read("static/game/js/leaderboard.js")
    assert 'LEADERBOARD_URL = "static/data/leaderboard.json"' in leaderboard
    assert "fetchImpl" in leaderboard


def test_leaderboard_snapshot_and_workflow_are_static_and_secret_safe():
    snapshot = json.loads(read("static/data/leaderboard.json"))
    workflow = read(".github/workflows/update-leaderboard.yml")
    updater = read(".github/scripts/update-leaderboard.ps1")

    assert snapshot["schemaVersion"] == 1
    assert snapshot["generatorVersion"] == "2.0.0"
    assert snapshot["physicsVersion"] == "2.0.0"
    assert isinstance(snapshot["lastPathId"], int) and snapshot["lastPathId"] >= 0
    if snapshot["generatedAt"] is not None:
        datetime.fromisoformat(snapshot["generatedAt"].replace("Z", "+00:00"))
    assert len(snapshot["entries"]) <= 100
    assert len({entry["seed"] for entry in snapshot["entries"]}) == len(snapshot["entries"])
    assert snapshot["entries"] == sorted(
        snapshot["entries"], key=lambda entry: (entry["cost"], entry["seed"])
    )
    assert all(
        isinstance(entry["seed"], str)
        and isinstance(entry["cost"], int)
        and entry["cost"] >= 0
        and isinstance(entry["requiredLoad"], int)
        and entry["requiredLoad"] > 0
        for entry in snapshot["entries"]
    )
    assert 'cron: "23 2 * * *"' in workflow
    assert "workflow_dispatch:" in workflow
    assert "secrets.GOATCOUNTER_API_TOKEN" in workflow
    assert "pages/builds" in workflow
    assert "Move-Item" in updater
    assert "bridgebuilder-cost" in updater


def test_current_gameplay_contracts_are_declared():
    generator = read("static/game/js/generator.js")
    editor = read("static/game/js/editor.js")
    levels = read("static/game/js/levels.js")
    main = read("static/game/js/main.js")
    physics = read("static/game/js/physics.js")
    capacity = read("static/game/js/capacity.js")
    renderer = read("static/game/js/renderer.js")

    assert "export const GENERATOR_VERSION" in generator
    assert "solverCertified" in generator
    assert "export const PHYSICS_VERSION" in physics
    assert "export const SIMULATION_DT = 1 / 120" in physics
    assert "export class CapacitySearch" in capacity
    assert "targetDelta(" in editor
    assert "overTargetAmount(" in editor
    assert "setBudgetEnforced" not in editor
    assert "OVER BUDGET" not in main
    assert "navigationClearances" not in generator + editor + levels + renderer
    assert "KEEP CLEAR" not in renderer
    assert "rockEdge" not in generator + levels + renderer
    assert "edgeColor" not in generator + levels + renderer
    assert renderer.index("this.drawWater(ctx, now)") < renderer.index("this.drawTerrain(ctx)")


def test_python_is_test_tooling_only():
    assert not list(ROOT.glob("*.py"))
    assert not list((ROOT / "static").rglob("*.py"))
    assert "Python is development tooling only" in read("AGENTS.md")
    assert "no Python runtime" in read("README.md")


def test_no_node_or_bundler_metadata_is_present():
    for path in [
        "package.json",
        "package-lock.json",
        "vite.config.js",
        "webpack.config.js",
    ]:
        assert not (ROOT / path).exists()


def test_documented_screenshot_gallery_is_complete():
    gallery = ROOT / "screenshots" / "procedural" / "showcase"
    images = {path.name: path for path in gallery.glob("*.png")}
    readme = read("README.md")

    assert set(images) == SHOWCASE_IMAGES
    for name, path in images.items():
        header = path.read_bytes()[:24]
        assert header[:8] == b"\x89PNG\r\n\x1a\n"
        assert struct.unpack(">II", header[16:24]) == (1320, 900)
        assert f"screenshots/procedural/showcase/{name}" in readme

    for reference in [
        "screenshots/bbg2-2.gif",
        "screenshots/bridgebuilder-screenshot.avif",
        "screenshots/bridgebuilder.jpg",
    ]:
        assert (ROOT / reference).is_file()
