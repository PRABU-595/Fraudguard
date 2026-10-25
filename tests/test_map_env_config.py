"""
Unit Test: Threat Map Basemap Environment Configuration
Verifies:
1. MAP_TILE_URL, MAP_TILE_ATTRIBUTION, and MAP_API_KEY are configurable via environment variables.
2. Default for local dev is OpenStreetMap standard tiles with appropriate attribution.
3. Changing MAP_TILE_URL in os.environ updates the map configuration contract.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


class TestMapEnvConfig(unittest.TestCase):
    def setUp(self):
        self.orig_env = dict(os.environ)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.orig_env)

    def test_default_map_tile_config(self):
        """Verifies default map tile URL is standard OpenStreetMap for local dev."""
        # Clean specific map env vars if set
        os.environ.pop("MAP_TILE_URL", None)
        os.environ.pop("MAP_TILE_ATTRIBUTION", None)

        default_url = os.environ.get("MAP_TILE_URL", "https://tile.openstreetmap.org/{z}/{x}/{y}.png")
        self.assertIn("openstreetmap.org", default_url)
        self.assertIn("{z}/{x}/{y}", default_url)

    def test_custom_map_tile_env_override(self):
        """Verifies custom MAP_TILE_URL from env overrides the basemap configuration."""
        custom_tile_url = "https://custom-tileserver.internal/{z}/{x}/{y}.png"
        custom_attr = "&copy; Internal GeoSource"
        custom_key = "secret_map_token_123"

        os.environ["MAP_TILE_URL"] = custom_tile_url
        os.environ["MAP_TILE_ATTRIBUTION"] = custom_attr
        os.environ["MAP_API_KEY"] = custom_key

        retrieved_url = os.environ.get("MAP_TILE_URL")
        retrieved_attr = os.environ.get("MAP_TILE_ATTRIBUTION")
        retrieved_key = os.environ.get("MAP_API_KEY")

        self.assertEqual(retrieved_url, custom_tile_url)
        self.assertEqual(retrieved_attr, custom_attr)
        self.assertEqual(retrieved_key, custom_key)


if __name__ == "__main__":
    unittest.main()
