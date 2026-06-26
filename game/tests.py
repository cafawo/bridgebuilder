from pathlib import Path

from django.test import SimpleTestCase
from django.urls import reverse

from game.views import generate_random_level


class GameViewTests(SimpleTestCase):
    def test_home_page_loads(self):
        response = self.client.get(reverse("game:home"))

        self.assertEqual(response.status_code, 200)

    def test_home_page_includes_canvas(self):
        response = self.client.get(reverse("game:home"))

        self.assertContains(response, 'id="game-canvas"', html=False)
        self.assertContains(response, 'id="seed-input"', html=False)
        self.assertContains(response, "data-random-level-url", html=False)
        self.assertContains(response, "game/js/main.js")
        self.assertContains(response, "?v=landscape9")

    def test_seeded_level_endpoint_generates_superformula_level(self):
        response = self.client.get(reverse("game:random-level"), {"seed": "test-seed"})

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["procedural"])
        self.assertEqual(data["seed"], "test-seed")
        self.assertEqual(data["generator"]["name"], "superformula")
        self.assertGreaterEqual(len(data["anchors"]), 6)

    def test_legacy_seed_path_still_generates_level(self):
        response = self.client.get(reverse("game:random-level-legacy", args=["legacy-seed"]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["seed"], "legacy-seed")


class ProceduralLevelTests(SimpleTestCase):
    def test_generated_level_has_required_schema_keys(self):
        data = generate_random_level("schema-seed")
        required_keys = {
            "canvas",
            "terrain",
            "water",
            "anchors",
            "start",
            "goal",
            "budget",
            "vehicle",
            "seed",
            "generator",
            "anchorPlatforms",
            "waterBodies",
            "backdrop",
            "details",
        }

        self.assertLessEqual(required_keys, data.keys())
        self.assertGreaterEqual(data["canvas"]["width"], 1240)
        self.assertGreaterEqual(data["canvas"]["height"], 700)
        self.assertGreaterEqual(len(data["anchors"]), 6)
        self.assertGreaterEqual(len(data["waterBodies"]), 1)
        self.assertGreaterEqual(len(data["backdrop"]["layers"]), 1)
        self.assertGreaterEqual(len(data["details"]["strata"]), 4)
        self.assertNotIn("maxBeamLength", data)

    def test_generated_level_is_deterministic_for_same_seed(self):
        self.assertEqual(generate_random_level("same-seed"), generate_random_level("same-seed"))

    def test_generated_level_changes_for_different_seed(self):
        first = generate_random_level("first-seed")
        second = generate_random_level("second-seed")

        self.assertNotEqual(first["terrain"], second["terrain"])

    def test_water_is_clipped_inside_gap_and_below_road(self):
        data = generate_random_level("water-seed")
        water = data["water"]
        left_ground, right_ground = data["groundSegments"]

        self.assertGreaterEqual(water["x"], left_ground["x2"])
        self.assertLessEqual(water["x"] + water["width"], right_ground["x1"])
        self.assertGreater(water["y"], data["roadY"])

        for body in data["waterBodies"]:
            xs = [point[0] for point in body["points"]]
            ys = [point[1] for point in body["points"]]
            self.assertGreaterEqual(min(xs), left_ground["x2"])
            self.assertLessEqual(max(xs), right_ground["x1"])
            self.assertGreater(min(ys), data["roadY"])

    def test_water_bodies_use_organic_non_vertical_banks(self):
        data = generate_random_level("organic-water-seed")

        for body in data["waterBodies"]:
            with self.subTest(body=body):
                points = body["points"]
                ys = [point[1] for point in points]
                height = max(ys) - min(ys)

                self.assertGreaterEqual(len(points), 16)
                self.assertFalse(has_long_vertical_segment(points, max(28, height * 0.28)))

    def test_terrain_uses_one_rock_material(self):
        data = generate_random_level("material-seed")
        colors = {terrain["color"] for terrain in data["terrain"]}

        self.assertEqual(colors, {"#303335"})

    def test_terrain_is_one_composite_valley_without_detached_rocks(self):
        data = generate_random_level("composite-seed")
        platform_kinds = {platform["kind"] for platform in data["anchorPlatforms"]}

        self.assertEqual(len(data["terrain"]), 1)
        self.assertGreaterEqual(len(data["terrain"][0]["points"]), 75)
        self.assertLessEqual(platform_kinds, {"road", "cliff"})
        self.assertIn("cliff", platform_kinds)
        self.assertNotIn("edgeColor", data["terrain"][0])

    def test_all_anchors_touch_declared_platforms(self):
        data = generate_random_level("anchors-seed")
        platforms = data["anchorPlatforms"]

        for anchor in data["anchors"]:
            with self.subTest(anchor=anchor):
                self.assertTrue(
                    any(
                        platform["x1"] <= anchor["x"] <= platform["x2"]
                        and anchor["y"] == platform["y"]
                        for platform in platforms
                    )
                )

    def test_multiple_seeds_produce_varied_anchor_layouts(self):
        layouts = {
            tuple(
                (anchor["x"], anchor["y"])
                for anchor in generate_random_level(f"layout-{i}")["anchors"]
            )
            for i in range(5)
        }

        self.assertGreaterEqual(len(layouts), 4)

    def test_many_seeds_cover_multiple_visual_regimes(self):
        regimes = {
            generate_random_level(f"regime-{index}")["generator"]["regime"]
            for index in range(80)
        }

        self.assertGreaterEqual(len(regimes), 7)
        self.assertIn("swampland", regimes)

    def test_random_seeds_have_strong_visual_variation(self):
        signatures = set()
        for index in range(18):
            data = generate_random_level(f"variation-{index}")
            water_width = round(data["water"]["width"] / 40) * 40
            anchor_heights = tuple(sorted({anchor["y"] for anchor in data["anchors"]}))
            signatures.add(
                (
                    data["generator"]["regime"],
                    len(data["waterBodies"]),
                    len(data["backdrop"]["layers"]),
                    water_width,
                    anchor_heights,
                )
            )

        self.assertGreaterEqual(len(signatures), 12)

    def test_split_valley_regime_can_raise_a_central_basin_ridge(self):
        examples = [
            generate_random_level(f"split-example-{index}")
            for index in range(40)
        ]
        split_examples = [
            data for data in examples if data["generator"]["regime"] == "split_valley"
        ]

        self.assertTrue(split_examples)
        self.assertTrue(
            any(has_central_ridge_above_water(data) for data in split_examples)
        )

    def test_editor_allows_long_beams_and_can_split_existing_beams(self):
        source = Path("game/static/game/js/editor.js").read_text(encoding="utf-8")

        self.assertNotIn("maxBeamLength", source)
        self.assertNotIn("Beam too long", source)
        self.assertIn("splitBeam", source)
        self.assertIn("applyBeamPathPlan", source)
        self.assertIn("splitBeamsContainingNode", source)
        self.assertIn("segmentIntersection", source)
        self.assertIn("closestPointOnSegment", source)
        self.assertIn("splitPoints", source)

    def test_renderer_marks_beam_snap_points_like_anchor_nodes(self):
        source = Path("game/static/game/js/renderer.js").read_text(encoding="utf-8")

        self.assertIn("drawSnapNode", source)
        self.assertIn("#a5a247", source)

    def test_javascript_module_imports_are_cache_busted(self):
        main_source = Path("game/static/game/js/main.js").read_text(encoding="utf-8")
        editor_source = Path("game/static/game/js/editor.js").read_text(encoding="utf-8")
        renderer_source = Path("game/static/game/js/renderer.js").read_text(encoding="utf-8")

        self.assertIn("./editor.js?v=landscape9", main_source)
        self.assertIn("./renderer.js?v=landscape9", main_source)
        self.assertIn("./ui.js?v=landscape9", editor_source)
        self.assertIn("./ui.js?v=landscape9", renderer_source)


def has_central_ridge_above_water(data):
    midpoint = data["water"]["x"] + data["water"]["width"] / 2
    central_points = [
        point
        for point in data["terrain"][0]["points"]
        if abs(point[0] - midpoint) <= 70
    ]

    return bool(central_points) and (
        min(point[1] for point in central_points) <= data["water"]["y"] + 18
    )


def has_long_vertical_segment(points, max_vertical):
    wrapped = [*points, points[0]]
    for first, second in zip(wrapped, wrapped[1:], strict=False):
        dx = abs(first[0] - second[0])
        dy = abs(first[1] - second[1])
        if dx <= 2 and dy > max_vertical:
            return True
    return False
