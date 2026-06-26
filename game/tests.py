import json

from django.conf import settings
from django.test import SimpleTestCase
from django.urls import reverse


class GameViewTests(SimpleTestCase):
    def test_home_page_loads(self):
        response = self.client.get(reverse("game:home"))

        self.assertEqual(response.status_code, 200)

    def test_home_page_includes_canvas(self):
        response = self.client.get(reverse("game:home"))

        self.assertContains(response, 'id="game-canvas"', html=False)
        self.assertContains(response, "game/js/main.js")

    def test_level_endpoint_loads_json(self):
        response = self.client.get(reverse("game:level-json", args=["level_01"]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/json")
        data = response.json()
        self.assertEqual(data["name"], "First Gorge")
        self.assertIn("anchors", data)


class LevelFileTests(SimpleTestCase):
    def test_level_file_has_required_schema_keys(self):
        level_path = settings.BASE_DIR / "levels" / "level_01.json"

        with level_path.open(encoding="utf-8") as level_file:
            data = json.load(level_file)

        required_keys = {
            "canvas",
            "terrain",
            "water",
            "anchors",
            "start",
            "goal",
            "budget",
            "vehicle",
        }
        self.assertLessEqual(required_keys, data.keys())
        self.assertGreater(data["canvas"]["width"], 0)
        self.assertGreater(data["canvas"]["height"], 0)
        self.assertGreaterEqual(len(data["anchors"]), 2)
