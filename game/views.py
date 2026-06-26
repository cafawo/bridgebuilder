import hashlib
import math
import random
import re

from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_GET

CANVAS_WIDTH = 1240
CANVAS_HEIGHT = 700
ROCK_COLOR = "#303335"
WATER_COLOR = "#11106d"
SEED_PATTERN = re.compile(r"[^A-Za-z0-9_-]+")

REGIMES = [
    {
        "id": "riverlands",
        "label": "Riverlands",
        "names": ["Riverland Crossing", "Lowland River", "Wide River Bend"],
        "weight": 17,
        "span": (760, 960),
        "road_y": (340, 390),
        "water_drop": (34, 58),
        "floor_depth": (92, 150),
        "shore_run": (130, 190),
        "shore_bulge": 20,
        "shore_rough": 0.45,
        "floor_rough": 30,
        "shelves": [0, 1],
        "shelf_weights": [3, 4],
        "shelf_lengths": (30, 58),
        "basins": 1,
        "backdrop": "hills",
        "backdrop_layers": 2,
        "reeds": (4, 12),
        "budget_factor": (9.8, 11.2),
    },
    {
        "id": "marshland",
        "label": "Marshland",
        "names": ["Marsh Causeway", "Reed Flats", "Fenland Cut"],
        "weight": 13,
        "span": (820, 1060),
        "road_y": (350, 398),
        "water_drop": (22, 44),
        "floor_depth": (68, 122),
        "shore_run": (160, 230),
        "shore_bulge": 12,
        "shore_rough": 0.22,
        "floor_rough": 18,
        "shelves": [0, 1],
        "shelf_weights": [5, 2],
        "shelf_lengths": (34, 64),
        "basins": 1,
        "backdrop": "flats",
        "backdrop_layers": 1,
        "reeds": (16, 34),
        "budget_factor": (9.2, 10.5),
    },
    {
        "id": "swampland",
        "label": "Swampland",
        "names": ["Swamp Crossing", "Blackwater Swamp", "Sinking Flats"],
        "weight": 10,
        "span": (780, 1040),
        "road_y": (348, 402),
        "water_drop": (28, 54),
        "floor_depth": (82, 148),
        "shore_run": (150, 240),
        "shore_bulge": 16,
        "shore_rough": 0.35,
        "floor_rough": 26,
        "shelves": [0, 1, 2],
        "shelf_weights": [4, 3, 1],
        "shelf_lengths": (30, 58),
        "basins": 1,
        "backdrop": "flats",
        "backdrop_layers": 2,
        "reeds": (26, 48),
        "budget_factor": (9.4, 10.8),
    },
    {
        "id": "highlands",
        "label": "Highlands",
        "names": ["Highland Cut", "Mountain Valley", "Broken Uplands"],
        "weight": 19,
        "span": (760, 940),
        "road_y": (308, 368),
        "water_drop": (54, 84),
        "floor_depth": (130, 205),
        "shore_run": (110, 174),
        "shore_bulge": 26,
        "shore_rough": 0.72,
        "floor_rough": 42,
        "shelves": [1, 2],
        "shelf_weights": [4, 3],
        "shelf_lengths": (34, 62),
        "basins": 1,
        "backdrop": "mountains",
        "backdrop_layers": 2,
        "reeds": (0, 6),
        "budget_factor": (10.4, 12.2),
    },
    {
        "id": "alpine_gorge",
        "label": "Alpine Gorge",
        "names": ["Alpine Gorge", "Deep Mountain Pass", "Blackwater Gorge"],
        "weight": 16,
        "span": (820, 1040),
        "road_y": (278, 344),
        "water_drop": (76, 116),
        "floor_depth": (180, 278),
        "shore_run": (72, 132),
        "shore_bulge": 34,
        "shore_rough": 1.0,
        "floor_rough": 60,
        "shelves": [1, 2, 3],
        "shelf_weights": [3, 4, 2],
        "shelf_lengths": (30, 54),
        "basins": 1,
        "backdrop": "peaks",
        "backdrop_layers": 3,
        "reeds": (0, 2),
        "budget_factor": (11.2, 13.0),
    },
    {
        "id": "split_valley",
        "label": "Split Valley",
        "names": ["Twin Valley", "Double Basin", "Forked River Gorge"],
        "weight": 15,
        "span": (850, 1080),
        "road_y": (300, 374),
        "water_drop": (48, 86),
        "floor_depth": (130, 220),
        "shore_run": (112, 190),
        "shore_bulge": 24,
        "shore_rough": 0.65,
        "floor_rough": 38,
        "shelves": [1, 2],
        "shelf_weights": [3, 3],
        "shelf_lengths": (32, 58),
        "basins": 2,
        "backdrop": "mountains",
        "backdrop_layers": 2,
        "reeds": (2, 8),
        "budget_factor": (10.8, 12.6),
    },
    {
        "id": "canyon",
        "label": "Canyon",
        "names": ["Knife Edge Canyon", "Dry Canyon River", "Sawtooth Ravine"],
        "weight": 12,
        "span": (700, 900),
        "road_y": (270, 336),
        "water_drop": (86, 128),
        "floor_depth": (190, 285),
        "shore_run": (62, 116),
        "shore_bulge": 40,
        "shore_rough": 1.15,
        "floor_rough": 52,
        "shelves": [1, 2, 3],
        "shelf_weights": [2, 4, 2],
        "shelf_lengths": (26, 48),
        "basins": 1,
        "backdrop": "ridges",
        "backdrop_layers": 3,
        "reeds": (0, 1),
        "budget_factor": (11.0, 12.8),
    },
]


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
    regime = choose_regime(rng)
    style = rng.choice(regime["names"])
    road_y = snap(rng.randint(*regime["road_y"]), 10)
    span = snap(rng.randint(*regime["span"]), 10)
    center = snap(rng.randint(CANVAS_WIDTH // 2 - 70, CANVAS_WIDTH // 2 + 70), 10)
    left_edge = max(72, center - span // 2)
    right_edge = min(CANVAS_WIDTH - 72, center + span // 2)
    bridge_span = right_edge - left_edge
    water_y = road_y + snap(rng.randint(*regime["water_drop"]), 2)
    floor_y = min(
        CANVAS_HEIGHT - 54,
        water_y + rng.randint(*regime["floor_depth"]),
    )
    load = rng.randint(1550, 2450)

    shore_shape = superformula_params(rng, m_choices=[3, 4, 5, 6, 7, 8])
    floor_shape = superformula_params(rng, m_choices=[2, 3, 4, 5, 6, 7])
    left_profile = superformula_shore(
        left_edge,
        road_y,
        water_y,
        shore_shape,
        side=1,
        rng=rng,
        regime=regime,
    )
    right_profile = superformula_shore(
        right_edge,
        road_y,
        water_y,
        shore_shape,
        side=-1,
        rng=rng,
        regime=regime,
    )
    left_shore = left_profile["points"]
    right_shore = right_profile["points"]
    left_water_x = left_shore[-1][0]
    right_water_x = right_shore[-1][0]
    floor_profile = superformula_riverbed(
        left_water_x,
        right_water_x,
        water_y,
        floor_y,
        floor_shape,
        regime,
        rng,
    )
    riverbed = floor_profile["points"]
    water_bodies = build_water_bodies(
        regime,
        left_edge,
        right_edge,
        left_water_x,
        right_water_x,
        water_y,
        floor_y,
        rng,
    )
    water = water_bounds(water_bodies)

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
        bridge_span * rng.uniform(*regime["budget_factor"])
        + cliff_platform_count * 250
        + rng.randint(2400, 3400)
    )

    return {
        "name": style,
        "slug": f"seed-{normalized_seed}",
        "seed": normalized_seed,
        "procedural": True,
        "generator": {
            "name": "superformula",
            "regime": regime["id"],
            "regimeLabel": regime["label"],
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
        "water": water,
        "waterBodies": water_bodies,
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
            "speed": rng.randint(38, 45),
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
        "backdrop": build_backdrop(regime, road_y, rng),
        "details": build_details(regime, road_y, water_bodies, rng),
    }


def choose_regime(rng):
    return rng.choices(
        REGIMES,
        weights=[regime["weight"] for regime in REGIMES],
        k=1,
    )[0]


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
        if platform["x2"] - platform["x1"] >= 54 and rng.random() < 0.5:
            side = rng.choice([-1, 1])
            anchors.append({"x": snap(center + side * 22, 10), "y": platform["y"]})

    return unique_anchors(anchors)


def superformula_params(rng, m_choices):
    return {
        "a": round(rng.uniform(0.7, 1.3), 4),
        "b": round(rng.uniform(0.7, 1.3), 4),
        "m": rng.choice(m_choices),
        "n1": round(rng.uniform(0.46, 2.25), 4),
        "n2": round(rng.uniform(0.48, 3.1), 4),
        "n3": round(rng.uniform(0.48, 3.1), 4),
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


def superformula_shore(edge_x, road_y, water_y, params, side, rng, regime):
    points = []
    platforms = []
    total_run = rng.randint(*regime["shore_run"])
    shelf_count = rng.choices(
        regime["shelves"],
        weights=regime["shelf_weights"],
        k=1,
    )[0]
    shelf_positions = sorted(
        rng.sample([0.28, 0.38, 0.5, 0.62, 0.74], min(3, shelf_count))
    )
    next_shelf = 0
    last_run = 0
    last_y = road_y
    max_shore_y = water_y - 6

    def shaped_run(t):
        phi = -math.pi / 2 + t * math.pi
        radius = superformula_radius(phi, params)
        normalized = min(1.8, radius) / 1.8
        rough = regime["shore_rough"]
        wave = math.sin(t * math.pi * 2 + params["m"]) * 9 * rough
        wave += math.sin(t * math.pi * 5 + params["a"] * 4) * 5 * rough
        return 14 + t * total_run + normalized * regime["shore_bulge"] + wave

    def shaped_y(t):
        smooth = t * t * (3 - 2 * t)
        rough = regime["shore_rough"]
        wave = math.sin(t * math.pi * 3 + params["a"] * math.pi) * 5 * rough
        wave += math.sin(t * math.pi * 7 + params["b"]) * 3 * rough
        return road_y + (water_y - road_y) * smooth + wave

    def append_point(run, y, allow_flat=False):
        nonlocal last_run, last_y
        run = max(run, last_run + 7)
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
        shelf_length = rng.randint(*regime["shelf_lengths"])
        approach_run = max(raw_run - rng.randint(14, 26), last_run + 8)
        append_point(approach_run, shelf_y - rng.randint(8, 18))

        start_run = max(raw_run, last_run + 9)
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

    samples = 22
    for index in range(1, samples + 1):
        t = index / (samples + 1)
        while next_shelf < len(shelf_positions) and t >= shelf_positions[next_shelf]:
            append_shelf(shelf_positions[next_shelf])
            next_shelf += 1
        append_point(shaped_run(t), shaped_y(t))

    while next_shelf < len(shelf_positions):
        append_shelf(shelf_positions[next_shelf])
        next_shelf += 1

    water_run = max(total_run + rng.randint(18, 38), last_run + 18)
    points.append([snap(edge_x + side * water_run, 2), water_y])
    return {"points": points, "platforms": platforms}


def superformula_riverbed(left_edge, right_edge, water_y, floor_y, params, regime, rng):
    points = []
    samples = 29 if regime["basins"] == 2 else 23
    width = max(1, right_edge - left_edge)
    bank_fraction = 0.2 if regime["id"] in {"riverlands", "marshland", "swampland"} else 0.14
    bank_inset = min(width * 0.12, 58)
    for index in range(samples):
        t = index / (samples - 1)
        phi = -math.pi + t * math.pi * 2
        radius = superformula_radius(phi, params)
        normalized = (min(1.8, radius) / 1.8) - 0.5
        x = left_edge + bank_inset + (width - bank_inset * 2) * t
        deep_t = smoothstep(min(1, min(t, 1 - t) / bank_fraction))
        floor_target = floor_y + normalized * regime["floor_rough"]
        y = water_y + 12 + (floor_target - water_y - 12) * deep_t
        y += math.sin(t * math.pi * 4 + params["m"]) * regime["floor_rough"] * 0.18
        y += math.sin(t * math.pi * 9 + params["a"] * 4) * regime["floor_rough"] * 0.08

        if regime["basins"] == 2:
            ridge = gaussian(t, 0.5, 0.18) * (floor_y - water_y + 34)
            left_basin = gaussian(t, 0.28, 0.16) * 22
            right_basin = gaussian(t, 0.72, 0.16) * 22
            y = y - ridge + left_basin + right_basin
            y = max(water_y - 8, y)
        else:
            y = max(water_y + 10, y)

        points.append([round(x), snap(y, 2)])
    return {"points": points}


def build_water_bodies(regime, left_edge, right_edge, left_x, right_x, water_y, floor_y, rng):
    overlap = 84 if regime["id"] in {"marshland", "riverlands", "swampland"} else 56
    draw_left = max(left_edge, left_x - overlap)
    draw_right = min(right_edge, right_x + overlap)
    height = max(36, floor_y - water_y + 24)
    wave = 2 if regime["id"] in {"marshland", "swampland"} else 4
    return [water_body(draw_left, draw_right, water_y, height, rng, wave=wave)]


def water_body(x1, x2, y, height, rng, wave):
    x1 = snap(x1, 2)
    x2 = snap(x2, 2)
    width = max(1, x2 - x1)
    side_inset = min(width * 0.2, rng.randint(26, 72))
    bottom_left = snap(x1 + side_inset, 2)
    bottom_right = snap(x2 - side_inset, 2)
    top = []
    samples = max(4, min(14, round(width / 56)))
    phase = rng.random() * math.pi
    for index in range(samples + 1):
        t = index / samples
        x = x1 + (x2 - x1) * t
        top_y = y + math.sin(t * math.pi * 2 + phase) * wave
        top.append([round(x), snap(top_y, 2)])

    right_bank = []
    left_bank = []
    side_samples = 4
    for index in range(1, side_samples + 1):
        t = index / side_samples
        curve = smoothstep(t)
        bank_wave = math.sin(t * math.pi + phase) * wave * 0.8
        right_bank.append(
            [
                snap(x2 - side_inset * curve + bank_wave, 2),
                snap(y + height * curve, 2),
            ]
        )
        left_bank.append(
            [
                snap(x1 + side_inset * curve - bank_wave, 2),
                snap(y + height * curve, 2),
            ]
        )

    bottom = []
    bottom_samples = max(4, min(12, round((bottom_right - bottom_left) / 64)))
    bottom_phase = rng.random() * math.pi * 2
    for index in range(bottom_samples + 1):
        t = index / bottom_samples
        x = bottom_right - (bottom_right - bottom_left) * t
        bottom_y = y + height + math.sin(t * math.pi * 3 + bottom_phase) * wave * 2.2
        bottom.append([round(x), snap(bottom_y, 2)])

    return {
        "color": WATER_COLOR,
        "points": [*top, *right_bank, *bottom, *reversed(left_bank)],
    }


def water_bounds(bodies):
    all_points = [point for body in bodies for point in body["points"]]
    min_x = min(point[0] for point in all_points)
    max_x = max(point[0] for point in all_points)
    min_y = min(point[1] for point in all_points)
    max_y = max(point[1] for point in all_points)
    return {
        "x": min_x,
        "y": min_y,
        "width": max_x - min_x,
        "height": max_y - min_y,
        "color": WATER_COLOR,
    }


def build_backdrop(regime, road_y, rng):
    layers = []
    for layer in range(regime["backdrop_layers"]):
        if regime["backdrop"] == "flats":
            base = road_y - 54 - layer * 24
            amplitude = 14 + layer * 8
        elif regime["backdrop"] == "hills":
            base = road_y - 84 - layer * 36
            amplitude = 32 + layer * 16
        elif regime["backdrop"] == "peaks":
            base = road_y - 112 - layer * 46
            amplitude = 86 + layer * 28
        else:
            base = road_y - 100 - layer * 42
            amplitude = 58 + layer * 22

        points = []
        step = 72
        phase = rng.random() * math.pi * 2
        for x in range(-step, CANVAS_WIDTH + step + 1, step):
            t = x / CANVAS_WIDTH
            ridge = math.sin(t * math.pi * (3 + layer) + phase) * amplitude * 0.45
            jag = math.sin(t * math.pi * (11 + layer * 2) + phase * 0.7) * amplitude * 0.22
            peak = abs(math.sin(t * math.pi * (5 + layer) + phase * 1.3)) * amplitude
            if regime["backdrop"] in {"peaks", "ridges"}:
                y = base - peak + jag
            else:
                y = base + ridge + jag
            points.append([x, max(34, round(y))])

        opacity = 0.24 + layer * 0.08
        layers.append(
            {
                "points": points,
                "color": f"rgba(66, 73, 74, {opacity:.2f})",
            }
        )
    return {"layers": layers}


def build_details(regime, road_y, water_bodies, rng):
    strata = []
    count = 7 if regime["id"] in {"alpine_gorge", "canyon"} else 5
    for index in range(count):
        y = road_y + 64 + index * rng.randint(24, 36)
        points = []
        phase = rng.random() * math.pi * 2
        for x in range(0, CANVAS_WIDTH + 1, 72):
            offset = math.sin(x / 95 + phase) * 5 + math.sin(x / 37 + phase) * 2
            points.append([x, snap(y + offset, 2)])
        strata.append(
            {
                "points": points,
                "color": "rgba(20, 22, 23, 0.28)",
                "width": 1,
            }
        )

    reeds = []
    reed_min, reed_max = regime["reeds"]
    for _index in range(rng.randint(reed_min, reed_max)):
        body = rng.choice(water_bodies)
        xs = [point[0] for point in body["points"][:-2]]
        ys = [point[1] for point in body["points"][:-2]]
        left = min(xs)
        right = max(xs)
        y = min(ys) + rng.randint(0, 8)
        if rng.random() < 0.5:
            x = left + rng.randint(0, 34)
        else:
            x = right - rng.randint(0, 34)
        reeds.append(
            {
                "x": round(x),
                "y": round(y),
                "height": rng.randint(10, 24),
                "color": "rgba(138, 142, 77, 0.76)",
            }
        )

    return {"strata": strata, "reeds": reeds}


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


def gaussian(value, center, width):
    return math.exp(-((value - center) ** 2) / (2 * width**2))


def smoothstep(value):
    value = max(0, min(1, value))
    return value * value * (3 - 2 * value)
