from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_MODULES = {
    "blueprint.js",
    "capacity.js",
    "editor.js",
    "generator.js",
    "levels.js",
    "main.js",
    "physics.js",
    "renderer.js",
    "ui.js",
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
    assert 'id="live-status"' in index
    assert 'type="module"' in index
    assert "{%" not in index


def test_runtime_module_graph_is_complete_and_local():
    module_dir = ROOT / "static" / "game" / "js"
    assert {path.name for path in module_dir.glob("*.js")} == RUNTIME_MODULES

    source = "\n".join(path.read_text(encoding="utf-8") for path in module_dir.glob("*.js"))
    assert "fetch(" not in source
    assert "XMLHttpRequest" not in source
    assert "WebSocket" not in source


def test_current_gameplay_contracts_are_declared():
    generator = read("static/game/js/generator.js")
    physics = read("static/game/js/physics.js")
    capacity = read("static/game/js/capacity.js")

    assert "export const GENERATOR_VERSION" in generator
    assert "solverCertified" in generator
    assert "export const PHYSICS_VERSION" in physics
    assert "export const SIMULATION_DT = 1 / 120" in physics
    assert "export class CapacitySearch" in capacity


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
