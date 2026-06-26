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
        self.assertContains(response, "?v=landscape2")

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
        }

        self.assertLessEqual(required_keys, data.keys())
        self.assertGreaterEqual(data["canvas"]["width"], 1100)
        self.assertGreaterEqual(data["canvas"]["height"], 650)
        self.assertGreaterEqual(len(data["anchors"]), 6)

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

    def test_terrain_uses_one_rock_material(self):
        data = generate_random_level("material-seed")
        colors = {terrain["color"] for terrain in data["terrain"]}

        self.assertEqual(colors, {"#303335"})

    def test_terrain_is_one_composite_valley_without_detached_rocks(self):
        data = generate_random_level("composite-seed")
        platform_kinds = {platform["kind"] for platform in data["anchorPlatforms"]}

        self.assertEqual(len(data["terrain"]), 1)
        self.assertGreaterEqual(len(data["terrain"][0]["points"]), 60)
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
