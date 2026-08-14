import unittest
from unittest.mock import patch

from sector_constituents import SECTOR_CONSTITUENTS, build_sector_constituents


def rows(base=100.0):
    return [
        {
            "date": f"2026-07-{index + 1:02d}",
            "open": base + index,
            "high": base + index + 2,
            "low": base + index - 1,
            "close": base + index + 1,
            "volume": 1_000_000 + index * 10_000,
            "amount": 0,
        }
        for index in range(25)
    ]


class SectorConstituentTests(unittest.TestCase):
    def test_catalog_covers_both_markets_and_original_xlk_core_names(self):
        self.assertEqual(set(SECTOR_CONSTITUENTS), {"china", "united-states"})
        self.assertEqual(len(SECTOR_CONSTITUENTS["china"]), 11)
        self.assertEqual(len(SECTOR_CONSTITUENTS["united-states"]), 11)
        technology = SECTOR_CONSTITUENTS["united-states"]["information-technology"]
        self.assertTrue({"NVDA", "MSFT", "AAPL"}.issubset({item["symbol"] for item in technology}))

    @patch("sector_constituents.get_yfinance_series")
    def test_builder_returns_click_through_stock_groups_without_an_api_key(self, fetch):
        fetch.side_effect = lambda symbols, **_: {symbol: rows(100 + index) for index, symbol in enumerate(symbols)}
        data = build_sector_constituents("united-states", "information-technology", range_id="1m")
        self.assertEqual(data["marketId"], "united-states")
        self.assertEqual(data["sectorId"], "information-technology")
        self.assertGreaterEqual(len(data["stocks"]), 10)
        self.assertTrue(data["groups"]["core"])
        self.assertTrue(data["groups"]["strongestInflow"])
        self.assertTrue(data["groups"]["strongestOutflow"])
        self.assertTrue(data["groups"]["movers"])
        self.assertEqual(data["range"]["id"], "1m")

    def test_builder_rejects_unknown_market_sector_and_range(self):
        with self.assertRaises(ValueError):
            build_sector_constituents("mars", "energy")
        with self.assertRaises(ValueError):
            build_sector_constituents("china", "not-a-sector")
        with self.assertRaises(ValueError):
            build_sector_constituents("china", "energy", range_id="2y")


if __name__ == "__main__":
    unittest.main()
