import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
UPDATER = ROOT / ".github" / "scripts" / "update-leaderboard.ps1"


def powershell():
    return shutil.which("pwsh") or shutil.which("powershell")


def run_updater(executable, output, fixture=None):
    command = [
        executable,
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(UPDATER),
        "-OutputPath",
        str(output),
        "-GeneratorPath",
        str(ROOT / "static" / "game" / "js" / "generator.js"),
        "-PhysicsPath",
        str(ROOT / "static" / "game" / "js" / "physics.js"),
    ]
    if fixture:
        command.extend(["-FixturePath", str(fixture)])
    return subprocess.run(command, check=False, capture_output=True, text=True)


@pytest.mark.skipif(not powershell(), reason="PowerShell is required for workflow fixture checks")
def test_workflow_aggregates_minimum_cost_incrementally_and_preserves_failures(tmp_path):
    executable = powershell()
    output = tmp_path / "leaderboard.json"
    paths = [
        {"id": 1, "path": "/", "title": "Home"},
        {
            "id": 2,
            "event": True,
            "path": "bridgebuilder-cost/v1/2.0.0/2.0.0/9000/seed-a/500",
        },
        {
            "id": 3,
            "event": True,
            "path": "bridgebuilder-cost/v1/2.0.0/2.0.0/9000/seed-a/400",
        },
        {
            "id": 4,
            "event": True,
            "path": "bridgebuilder-cost/v1/old/2.0.0/9000/old-version/1",
        },
        {"id": 5, "event": True, "path": "malformed"},
        {
            "id": 6,
            "event": True,
            "path": "bridgebuilder-cost/v1/2.0.0/2.0.0/9000/seed-b/not-a-cost",
        },
        {
            "id": 7,
            "event": True,
            "path": "bridgebuilder-cost/v1/2.0.0/2.0.0/9000/<bad-seed>/10",
        },
    ]
    for index in range(105):
        paths.append(
            {
                "id": 10 + index,
                "event": True,
                "path": (
                    "bridgebuilder-cost/v1/2.0.0/2.0.0/10000/"
                    f"seed-{index:03d}/{1000 + index}"
                ),
            }
        )
    paths.extend(
        [
            {
                "id": 450,
                "event": True,
                "path": "bridgebuilder-cost/v1/2.0.0/2.0.0/9000/tie-b/600",
            },
            {
                "id": 451,
                "event": True,
                "path": "bridgebuilder-cost/v1/2.0.0/2.0.0/9000/tie-a/600",
            },
        ]
    )
    paths.append({"id": 500, "path": "/unrelated", "title": "Unrelated"})
    first_fixture = tmp_path / "first.json"
    first_fixture.write_text(
        json.dumps(
            {
                "pages": [
                    {"paths": paths[:60], "more": True},
                    {"paths": paths[60:], "more": False},
                ]
            }
        )
    )

    completed = run_updater(executable, output, first_fixture)
    assert completed.returncode == 0, completed.stderr
    snapshot = json.loads(output.read_text(encoding="utf-8"))
    assert snapshot["lastPathId"] == 500
    assert len(snapshot["entries"]) == 100
    assert snapshot["entries"][0] == {
        "seed": "seed-a",
        "cost": 400,
        "requiredLoad": 9000,
    }
    assert snapshot["entries"] == sorted(
        snapshot["entries"], key=lambda entry: (entry["cost"], entry["seed"])
    )
    tied = [entry["seed"] for entry in snapshot["entries"] if entry["cost"] == 600]
    assert tied == ["tie-a", "tie-b"]

    second_fixture = tmp_path / "second.json"
    second_fixture.write_text(
        json.dumps(
            {
                "pages": [
                    {
                        "paths": [
                            {
                                "id": 501,
                                "event": True,
                                "path": (
                                    "bridgebuilder-cost/v1/2.0.0/2.0.0/10000/"
                                    "seed-104/50"
                                ),
                            },
                            {
                                "id": 502,
                                "event": True,
                                "path": (
                                    "bridgebuilder-cost/v1/2.0.0/2.0.0/9000/"
                                    "seed-a/450"
                                ),
                            },
                        ],
                        "more": False,
                    }
                ]
            }
        )
    )
    completed = run_updater(executable, output, second_fixture)
    assert completed.returncode == 0, completed.stderr
    snapshot = json.loads(output.read_text(encoding="utf-8"))
    assert snapshot["lastPathId"] == 502
    assert snapshot["entries"][0]["seed"] == "seed-104"
    assert snapshot["entries"][0]["cost"] == 50
    assert next(entry for entry in snapshot["entries"] if entry["seed"] == "seed-a")["cost"] == 400

    before_failure = output.read_bytes()
    completed = run_updater(executable, output)
    assert completed.returncode != 0
    assert output.read_bytes() == before_failure


@pytest.mark.skipif(not powershell(), reason="PowerShell is required for workflow fixture checks")
def test_workflow_resets_incompatible_version_state(tmp_path):
    executable = powershell()
    output = tmp_path / "leaderboard.json"
    output.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "generatedAt": "2026-07-26T02:23:00Z",
                "generatorVersion": "old",
                "physicsVersion": "2.0.0",
                "lastPathId": 999,
                "entries": [{"seed": "stale", "cost": 1, "requiredLoad": 1}],
            }
        )
    )
    fixture = tmp_path / "reset.json"
    fixture.write_text(
        json.dumps(
            {
                "pages": [
                    {
                        "paths": [
                            {
                                "id": 1,
                                "event": True,
                                "path": (
                                    "bridgebuilder-cost/v1/2.0.0/2.0.0/9000/"
                                    "current-seed/700"
                                ),
                            }
                        ],
                        "more": False,
                    }
                ]
            }
        )
    )

    completed = run_updater(executable, output, fixture)
    assert completed.returncode == 0, completed.stderr
    snapshot = json.loads(output.read_text(encoding="utf-8"))
    assert snapshot["lastPathId"] == 1
    assert snapshot["generatorVersion"] == "2.0.0"
    assert snapshot["physicsVersion"] == "2.0.0"
    assert snapshot["entries"] == [
        {"seed": "current-seed", "cost": 700, "requiredLoad": 9000}
    ]
