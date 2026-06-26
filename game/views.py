import json
import random

from django.conf import settings
from django.http import Http404, JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_GET

LEVEL_DIR = settings.BASE_DIR / "levels"
CANVAS_WIDTH = 900
CANVAS_HEIGHT = 560


@require_GET
def index(request):
    return render(request, "game/index.html")


@require_GET
def level_index(request):
    levels = []
    for path in sorted(LEVEL_DIR.glob("level_*.json")):
        with path.open(encoding="utf-8") as level_file:
            data = json.load(level_file)
        levels.append(
            {
                "slug": path.stem,
                "name": data["name"],
                "budget": data["budget"],
                "url": request.build_absolute_uri(f"/levels/{path.stem}.json"),
            }
        )

    return JsonResponse({"levels": levels})


@require_GET
def level_json(request, level_name):
    path = LEVEL_DIR / f"{level_name}.json"
    if not path.exists() or path.parent.resolve() != LEVEL_DIR.resolve():
        raise Http404("Level not found")

    with path.open(encoding="utf-8") as level_file:
        data = json.load(level_file)

    return JsonResponse(data)


@require_GET
def random_level_json(request, seed):
    return JsonResponse(generate_random_level(seed))


def generate_random_level(seed):
    rng = random.Random(seed)
    road_y = snap(rng.randint(286, 338), 10)
    left_edge = snap(rng.randint(150, 240), 10)
    right_edge = snap(rng.randint(660, 760), 10)
    water_y = road_y + snap(rng.randint(32, 58), 2)
    river_floor = min(CANVAS_HEIGHT - 62, water_y + rng.randint(150, 190))
    pier_count = rng.choice([0, 1, 2])
    bridge_span = right_edge - left_edge
    load = rng.randint(1420, 2100)

    left_anchors = anchor_line(left_edge - 120, left_edge, road_y)
    right_anchors = anchor_line(right_edge, right_edge + 120, road_y)
    anchors = left_anchors + right_anchors

    for index in range(pier_count):
        x = round(left_edge + bridge_span * ((index + 1) / (pier_count + 1)))
        y = water_y + rng.randint(86, 145)
        anchors.append({"x": snap(x, 10), "y": snap(y, 10)})
        anchors.append({"x": snap(x + rng.choice([-30, 30]), 10), "y": snap(y + rng.randint(0, 35), 10)})

    terrain = [
        {
            "color": "#303335",
            "points": [
                [0, road_y],
                [left_edge - 38, road_y],
                [left_edge - 22, water_y + rng.randint(8, 28)],
                [left_edge - rng.randint(8, 20), water_y + rng.randint(30, 55)],
                [left_edge, road_y],
                [left_edge, CANVAS_HEIGHT],
                [0, CANVAS_HEIGHT],
            ],
        },
        {
            "color": "#303335",
            "points": [
                [right_edge, road_y],
                [right_edge + rng.randint(12, 24), water_y + rng.randint(28, 58)],
                [right_edge + 44, water_y + rng.randint(8, 26)],
                [right_edge + 74, road_y],
                [CANVAS_WIDTH, road_y],
                [CANVAS_WIDTH, CANVAS_HEIGHT],
                [right_edge, CANVAS_HEIGHT],
            ],
        },
        {
            "color": "#202325",
            "points": riverbed_points(left_edge, right_edge, river_floor, rng),
        },
    ]

    budget = int(bridge_span * 9.2 + pier_count * 850 + 1800)

    return {
        "name": f"Generated {seed}",
        "slug": f"random-{seed}",
        "procedural": True,
        "canvas": {"width": CANVAS_WIDTH, "height": CANVAS_HEIGHT},
        "grid": 20,
        "snap": 10,
        "roadY": road_y,
        "deckTolerance": 26,
        "maxDeckSlope": 0.34,
        "maxBeamLength": 150,
        "budget": budget,
        "costs": {"node": 90, "beamPerPixel": 1.0},
        "water": {
            "x": 0,
            "y": water_y,
            "width": CANVAS_WIDTH,
            "height": river_floor - water_y,
            "color": "#11106d",
        },
        "terrain": terrain,
        "groundSegments": [
            {"x1": 0, "x2": left_edge, "y": road_y},
            {"x1": right_edge, "x2": CANVAS_WIDTH, "y": road_y},
        ],
        "anchors": anchors,
        "start": {"x": max(42, left_edge - 130), "y": road_y - 28},
        "goal": {"x": min(CANVAS_WIDTH - 42, right_edge + 132), "y": road_y},
        "vehicle": {
            "width": 48,
            "height": 18,
            "wheelRadius": 7,
            "speed": 42,
            "mass": 2.2,
            "load": load,
        },
        "physics": {
            "gravity": 900,
            "damping": 0.991,
            "constraintIterations": 14,
            "beamStiffness": 0.72,
            "beamBreakStress": 0.115,
        },
    }


def anchor_line(start_x, end_x, y):
    step = (end_x - start_x) / 2
    return [
        {"x": round(start_x), "y": y},
        {"x": round(start_x + step), "y": y},
        {"x": round(end_x), "y": y},
    ]


def riverbed_points(left_edge, right_edge, floor_y, rng):
    points = [[left_edge, floor_y]]
    samples = 5
    for index in range(1, samples):
        x = left_edge + (right_edge - left_edge) * index / samples
        y = floor_y + rng.randint(-14, 12)
        points.append([round(x), y])
    points.extend([[right_edge, floor_y], [right_edge, CANVAS_HEIGHT], [left_edge, CANVAS_HEIGHT]])
    return points


def snap(value, size):
    return round(value / size) * size
