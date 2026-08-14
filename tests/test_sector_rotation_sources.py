import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from sector_rotation import build_sector_market
from sector_rotation_sources import (
    CHINA_SECTORS,
    US_SECTORS,
    get_sector_rotation_dashboard,
)


def make_series(start, step, *, count=260):
    return [
        {
            "date": f"2025-{(index // 28) + 1:02d}-{(index % 28) + 1:02d}",
            "open": start + step * index,
            "high": start + step * index + 1,
            "low": start + step * index - 1,
            "close": start + step * index,
            "volume": 1_000_000 + index * 1_000,
            "amount": 0,
        }
        for index in range(count)
    ]


def make_market(market_id, title):
    benchmark = make_series(3_000, 2)
    sectors = [
        {
            "id": f"sector-{index}",
            "title": f"板块{index}",
            "symbol": f"S{index}",
            "points": make_series(1_000, index + 1),
        }
        for index in range(11)
    ]
    return build_sector_market(
        market_id,
        title,
        benchmark,
        sectors,
        {"name": "测试源", "mode": "zero-config"},
        timing_score=60,
    )


class SectorRotationSourceTests(unittest.TestCase):
    def test_catalogs_define_aligned_independent_eleven_sector_markets(self):
        self.assertEqual(len(CHINA_SECTORS), 11)
        self.assertEqual(len(US_SECTORS), 11)
        self.assertEqual({sector["id"] for sector in CHINA_SECTORS}, {sector["id"] for sector in US_SECTORS})
        self.assertEqual(len({sector["symbol"] for sector in US_SECTORS}), 11)
        self.assertTrue(all(sector["source"] in {"baostock", "yfinance"} for sector in CHINA_SECTORS))

    def test_dashboard_returns_both_markets_and_zero_configuration_metadata(self):
        china = make_market("china", "中国股票")
        us = make_market("united-states", "美国股票")
        with TemporaryDirectory() as directory:
            dashboard = get_sector_rotation_dashboard(
                force=True,
                fetchers={"china": lambda: china, "united-states": lambda: us},
                cache_path=Path(directory) / "sector-rotation.json",
            )

        self.assertEqual([market["id"] for market in dashboard["markets"]], ["china", "united-states"])
        self.assertTrue(dashboard["autoRefresh"])
        self.assertEqual(dashboard["methodologyVersion"], "1.1.1")
        self.assertEqual(dashboard["dataQuality"]["liveMarkets"], 2)

    def test_dashboard_uses_last_successful_cache_when_sources_fail(self):
        china = make_market("china", "中国股票")
        us = make_market("united-states", "美国股票")
        with TemporaryDirectory() as directory:
            cache_path = Path(directory) / "sector-rotation.json"
            get_sector_rotation_dashboard(
                force=True,
                fetchers={"china": lambda: china, "united-states": lambda: us},
                cache_path=cache_path,
            )

            def unavailable():
                raise RuntimeError("provider unavailable")

            stale = get_sector_rotation_dashboard(
                force=True,
                fetchers={"china": unavailable, "united-states": unavailable},
                cache_path=cache_path,
            )

        self.assertTrue(all(market["status"] == "stale" for market in stale["markets"]))
        self.assertTrue(all(market["dataQuality"]["issues"] for market in stale["markets"]))


if __name__ == "__main__":
    unittest.main()
