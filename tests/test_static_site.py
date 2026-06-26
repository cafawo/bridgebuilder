from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def test_root_index_is_github_pages_entrypoint():
    index = read("index.html")

    assert "{%" not in index
    assert 'id="game-canvas"' in index
    assert 'id="seed-input"' in index
    assert "data-random" + "-level-url" not in index
    assert 'href="static/game/css/style.css?v=landscape10"' in index
    assert 'src="static/game/js/main.js?v=landscape10"' in index


def test_javascript_generates_levels_without_fetching_json():
    levels = read("static/game/js/levels.js")
    main = read("static/game/js/main.js")

    assert 'from "./generator.js?v=landscape10"' in levels
    assert "generateRandomLevel" in levels
    assert "fe" + "tch(" not in levels
    assert "randomLevelUrl" not in main
    assert "levelUrl(" not in main
    assert "updateSeedInLocation" in main


def test_generator_exports_static_procedural_level_schema():
    generator = read("static/game/js/generator.js")

    assert "export function generateRandomLevel" in generator
    assert "export function normalizeSeed" in generator
    assert 'name: "superformula"' in generator
    for key in [
        "canvas",
        "terrain",
        "waterBodies",
        "anchorPlatforms",
        "groundSegments",
        "vehicle",
        "physics",
        "backdrop",
        "details",
    ]:
        assert key in generator


def test_legacy_runtime_files_are_removed():
    removed_paths = [
        "manage" + ".py",
        "bridgebuilder" + "_site",
        "game",
    ]

    for path in removed_paths:
        assert not (ROOT / path).exists()


def test_docs_and_tooling_are_static_site_focused():
    docs = "\n".join(
        [
            read("README.md"),
            read("AGENTS.md"),
            read("environment.yml"),
            read("pyproject.toml"),
            read(".gitignore"),
        ]
    )

    for stale_text in [
        "Djan" + "go",
        "run" + "server",
        "pytest-" + "djan" + "go",
        "db.sql" + "ite3",
        "levels" + "/random",
        "game" + "/static",
    ]:
        assert stale_text not in docs


def test_no_node_or_bundler_metadata_is_added():
    assert not (ROOT / "package.json").exists()
    assert not (ROOT / "package-lock.json").exists()
    assert not (ROOT / "vite.config.js").exists()
