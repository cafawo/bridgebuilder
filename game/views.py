import hashlib
import math
import random
import re

from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_GET

CANVAS_WIDTH = 1100
CANVAS_HEIGHT = 650
ROCK_COLOR = "#303335"
WATER_COLOR = "#11106d"
SEED_PATTERN = re.compile(r"[^A-Za-z0-9_-]+")


@require_GET
def index(request):
    return render(request, "game/index.html")


@require_GET
def random_level_json(request, seed=None):
    seed = request.GET.get("seed") or seed or "bridge"
    return JsonResponse(generate_random_level(seed))


def generate_random_level(seed):
    normalized_seed = normalize_seed(seed)
    rng = random.Random(seed_to_int(normalized_seed))
    style = rng.choice(["Mountain Valley", "Alpine Gorge", "Glacial Basin", "Highland Cut"])
    road_y = snap(rng.randint(304, 372), 10)
    span = snap(rng.randint(740, 900), 10)
    center = snap(rng.randint(520, 580), 10)
    left_edge = max(96, center - span // 2)
    right_edge = min(CANVAS_WIDTH - 96, center + span // 2)
    bridge_span = right_edge - left_edge
    water_y = road_y + snap(rng.randint(54, 94), 2)
    floor_y = min(CANVAS_HEIGHT - 58, water_y + rng.randint(150, 226))
    load = rng.randint(1550, 2350)

    shore_shape = superformula_params(rng, m_choices=[3, 4, 5, 6, 7, 8])
    floor_shape = superformula_params(rng, m_choices=[2, 3, 4, 5, 6])
    left_profile = superformula_shore(left_edge, road_y, water_y, shore_shape, side=1, rng=rng)
    right_profile = superformula_shore(
        right_edge,
        road_y,
        water_y,
        shore_shape,
        side=-1,
        rng=rng,
    )
    left_shore = left_profile["points"]
    right_shore = right_profile["points"]
    left_water_x = left_shore[-1][0]
    right_water_x = right_shore[-1][0]
    riverbed = superformula_riverbed(left_water_x, right_water_x, floor_y, floor_shape)

    anchor_platforms = [
        {"x1": 0, "x2": left_edge, "y": road_y, "kind": "road"},
        {"x1": right_edge, "x2": CANVAS_WIDTH, "y": road_y, "kind": "road"},
        *left_profile["platforms"],
        *right_profile["platforms"],
    ]
    terrain = build_terrain(
        left_edge,
        right_edge,
        road_y,
        left_shore,
        right_shore,
        riverbed,
    )
    anchors = build_anchors(left_edge, right_edge, road_y, anchor_platforms, rng)
    cliff_platform_count = len(
        [platform for platform in anchor_platforms if platform["kind"] == "cliff"]
    )
    budget = int(
        bridge_span * rng.uniform(10.2, 12.0)
        + cliff_platform_count * 260
        + rng.randint(2200, 3100)
    )

    return {
        "name": style,
        "slug": f"seed-{normalized_seed}",
        "seed": normalized_seed,
        "procedural": True,
        "generator": {
            "name": "superformula",
            "shore": shore_shape,
            "river": floor_shape,
            "style": style,
        },
        "canvas": {"width": CANVAS_WIDTH, "height": CANVAS_HEIGHT},
        "grid": 20,
        "snap": 10,
        "roadY": road_y,
        "deckTolerance": 26,
        "maxDeckSlope": 0.34,
        "maxBeamLength": 155,
        "budget": budget,
        "costs": {"node": 90, "beamPerPixel": 1.0},
        "water": {
            "x": left_water_x,
            "y": water_y,
            "width": right_water_x - left_water_x,
            "height": max(34, floor_y - water_y + 18),
            "color": WATER_COLOR,
        },
        "terrain": terrain,
        "anchorPlatforms": anchor_platforms,
        "groundSegments": [
            {"x1": 0, "x2": left_edge, "y": road_y},
            {"x1": right_edge, "x2": CANVAS_WIDTH, "y": road_y},
        ],
        "anchors": anchors,
        "start": {"x": max(44, left_edge - 136), "y": road_y - 25},
        "goal": {"x": min(CANVAS_WIDTH - 44, right_edge + 136), "y": road_y},
        "vehicle": {
            "width": rng.choice([48, 50, 52]),
            "height": 18,
            "wheelRadius": 7,
            "speed": rng.randint(38, 44),
            "mass": 2.2,
            "load": load,
        },
        "physics": {
            "gravity": 900,
            "damping": 0.991,
            "constraintIterations": 14,
            "beamStiffness": 0.72,
            "beamBreakStress": rng.uniform(0.106, 0.122),
        },
    }


def build_terrain(left_edge, right_edge, road_y, left_shore, right_shore, riverbed):
    return [
        {
            "color": ROCK_COLOR,
            "points": [
                [0, road_y],
                [left_edge, road_y],
                *left_shore,
                *riverbed,
                *reversed(right_shore),
                [right_edge, road_y],
                [CANVAS_WIDTH, road_y],
                [CANVAS_WIDTH, CANVAS_HEIGHT],
                [0, CANVAS_HEIGHT],
            ],
        },
    ]


def build_anchors(left_edge, right_edge, road_y, platforms, rng):
    anchors = []
    anchors.extend(anchor_line(max(20, left_edge - 150), left_edge, road_y, count=4))
    anchors.extend(
        anchor_line(
            right_edge,
            min(CANVAS_WIDTH - 20, right_edge + 150),
            road_y,
            count=4,
        )
    )

    cliff_platforms = [platform for platform in platforms if platform["kind"] == "cliff"]
    for platform in cliff_platforms:
        center = snap((platform["x1"] + platform["x2"]) / 2, 10)
        anchors.append({"x": center, "y": platform["y"]})
        if platform["x2"] - platform["x1"] >= 58 and rng.random() < 0.55:
            side = rng.choice([-1, 1])
            anchors.append({"x": snap(center + side * 24, 10), "y": platform["y"]})

    return unique_anchors(anchors)


def superformula_params(rng, m_choices):
    return {
        "a": round(rng.uniform(0.74, 1.26), 4),
        "b": round(rng.uniform(0.74, 1.26), 4),
        "m": rng.choice(m_choices),
        "n1": round(rng.uniform(0.52, 2.05), 4),
        "n2": round(rng.uniform(0.52, 2.9), 4),
        "n3": round(rng.uniform(0.52, 2.9), 4),
    }


def superformula_radius(phi, params):
    a = params["a"]
    b = params["b"]
    m = params["m"]
    n1 = max(params["n1"], 0.001)
    n2 = params["n2"]
    n3 = params["n3"]
    term_1 = abs(math.cos(m * phi / 4) / a) ** n2
    term_2 = abs(math.sin(m * phi / 4) / b) ** n3
    value = term_1 + term_2
    if value <= 0:
        return 1
    return value ** (-1 / n1)


def superformula_shore(edge_x, road_y, water_y, params, side, rng):
    points = []
    platforms = []
    total_run = rng.randint(84, 112)
    shelf_count = rng.choices([1, 2], weights=[5, 2], k=1)[0]
    shelf_positions = sorted(rng.sample([0.34, 0.52, 0.68], shelf_count))
    next_shelf = 0
    last_run = 0
    last_y = road_y
    max_shore_y = water_y - 8

    def shaped_run(t):
        phi = -math.pi / 2 + t * math.pi
        radius = superformula_radius(phi, params)
        normalized = min(1.7, radius) / 1.7
        wave = math.sin(t * math.pi * 2 + params["m"]) * 10
        return 12 + t * total_run + normalized * 18 + wave

    def shaped_y(t):
        smooth = t * t * (3 - 2 * t)
        wave = math.sin(t * math.pi * 3 + params["a"] * math.pi) * 5
        return road_y + (water_y - road_y) * smooth + wave

    def append_point(run, y, allow_flat=False):
        nonlocal last_run, last_y
        run = max(run, last_run + 8)
        y = min(max_shore_y, max(road_y + 2, y))
        if points and not allow_flat:
            y = min(max_shore_y, max(y, last_y + 2))
        x = snap(edge_x + side * run, 2)
        y = snap(y, 2)
        points.append([x, y])
        last_run = run
        last_y = y

    def append_shelf(t):
        raw_run = shaped_run(t)
        shelf_y = snap(shaped_y(t), 10)
        shelf_y = min(max_shore_y, max(last_y + 4, shelf_y))
        shelf_length = rng.randint(28, 46)
        approach_run = max(raw_run - rng.randint(14, 24), last_run + 8)
        append_point(approach_run, shelf_y - rng.randint(10, 18))

        start_run = max(raw_run, last_run + 10)
        end_run = start_run + shelf_length
        start_x = snap(edge_x + side * start_run, 2)
        end_x = snap(edge_x + side * end_run, 2)
        append_point(start_run, shelf_y, allow_flat=True)
        append_point(end_run, shelf_y, allow_flat=True)
        platforms.append(
            {
                "x1": min(start_x, end_x),
                "x2": max(start_x, end_x),
                "y": shelf_y,
                "kind": "cliff",
                "side": "left" if side == 1 else "right",
            }
        )

    samples = 18
    for index in range(1, samples + 1):
        t = index / (samples + 1)
        while next_shelf < len(shelf_positions) and t >= shelf_positions[next_shelf]:
            append_shelf(shelf_positions[next_shelf])
            next_shelf += 1
        append_point(shaped_run(t), shaped_y(t))

    while next_shelf < len(shelf_positions):
        append_shelf(shelf_positions[next_shelf])
        next_shelf += 1

    water_run = max(total_run + rng.randint(18, 36), last_run + 18)
    points.append([snap(edge_x + side * water_run, 2), water_y])
    return {"points": points, "platforms": platforms}


def superformula_riverbed(left_edge, right_edge, floor_y, params):
    points = []
    samples = 17
    for index in range(samples):
        t = index / (samples - 1)
        phi = -math.pi + t * math.pi * 2
        radius = superformula_radius(phi, params)
        normalized = (min(1.75, radius) / 1.75) - 0.5
        x = left_edge + (right_edge - left_edge) * t
        y = floor_y + normalized * 44 + math.sin(t * math.pi * 4) * 8
        points.append([round(x), snap(y, 2)])
    return points


def anchor_line(start_x, end_x, y, count):
    if count <= 1:
        return [{"x": round(start_x), "y": y}]
    step = (end_x - start_x) / (count - 1)
    return [{"x": round(start_x + step * index), "y": y} for index in range(count)]


def unique_anchors(anchors):
    seen = set()
    unique = []
    for anchor in anchors:
        key = (anchor["x"], anchor["y"])
        if key not in seen:
            unique.append(anchor)
            seen.add(key)
    return unique


def normalize_seed(seed):
    seed = SEED_PATTERN.sub("-", seed).strip("-_")[:48]
    return seed or "bridge"


def seed_to_int(seed):
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big")


def snap(value, size):
    return round(value / size) * size
