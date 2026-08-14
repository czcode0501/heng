import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from market_timing import (
    build_china_market,
    build_us_market,
)
from market_timing_sources import MARKET_CACHE, fetch_china_market, get_market_timing_dashboard, parse_sina_jsonp


def make_series(start, step, *, count=260, volume_start=1_000_000, volume_step=1_000):
    rows = []
    for index in range(count):
        close = start + step * index
        rows.append(
            {
                "date": f"2026-{(index // 28) + 1:02d}-{(index % 28) + 1:02d}",
                "open": close - step * 0.25,
                "high": close * 1.01,
                "low": close * 0.99,
                "close": close,
                "volume": volume_start + volume_step * index,
                "amount": (volume_start + volume_step * index) * close,
            }
        )
    return rows


class MarketTimingContractTests(unittest.TestCase):
    def test_china_market_exposes_five_distinct_scoring_dimensions(self):
        rising = make_series(3_000, 4)
        faster = make_series(4_000, 7)
        market = build_china_market(
            {
                "csi300": rising,
                "sse": rising,
                "szse": rising,
                "chinext": faster,
                "csi1000": faster,
            },
            source={"name": "BaoStock", "mode": "zero-config"},
        )

        self.assertEqual(market["id"], "china")
        self.assertEqual(
            [dimension["id"] for dimension in market["dimensions"]],
            ["trend", "breadth", "liquidity", "volatility", "risk-appetite"],
        )
        self.assertEqual(sum(dimension["weight"] for dimension in market["dimensions"]), 100)
        self.assertGreater(market["regime"]["score"], 60)
        self.assertEqual(market["dataQuality"]["status"], "live")
        self.assertEqual(market["source"]["mode"], "zero-config")

    def test_us_market_uses_vix_equal_weight_and_credit_risk_proxies(self):
        rising = make_series(400, 1.2)
        stronger = make_series(100, 0.5)
        stable_vix = make_series(20, -0.01)
        market = build_us_market(
            {
                "sp500": rising,
                "spy": rising,
                "rsp": stronger,
                "iwm": stronger,
                "qqq": rising,
                "hyg": stronger,
                "lqd": make_series(100, 0.1),
                "vix": stable_vix,
            },
            source={"name": "Yahoo Finance via yfinance", "mode": "zero-config"},
        )

        metrics = {
            metric["id"]
            for dimension in market["dimensions"]
            for metric in dimension["metrics"]
        }
        self.assertIn("equalWeightRelative", metrics)
        self.assertIn("vixPercentile", metrics)
        self.assertIn("creditRiskRelative", metrics)
        self.assertEqual(market["benchmark"]["symbol"], "^GSPC")
        self.assertEqual(market["updateMode"], "automatic-eod")

    def test_sina_fallback_parser_rejects_markup_and_normalizes_rows(self):
        text = "/*guard*/\nvar _data=([{\"day\":\"2026-08-14\",\"open\":\"10\",\"high\":\"11\",\"low\":\"9\",\"close\":\"10.5\",\"volume\":\"1234\"}]);"

        rows = parse_sina_jsonp(text)

        self.assertEqual(rows[0]["date"], "2026-08-14")
        self.assertEqual(rows[0]["close"], 10.5)
        self.assertEqual(rows[0]["volume"], 1234.0)
        with self.assertRaises(ValueError):
            parse_sina_jsonp("<html>unexpected response</html>")

    @patch("market_timing_sources._fetch_china_sina")
    @patch("market_timing_sources._fetch_china_baostock", side_effect=RuntimeError("primary unavailable"))
    def test_china_source_falls_back_without_requiring_user_configuration(self, _primary, fallback):
        rising = make_series(3_000, 4)
        fallback.return_value = {
            "csi300": rising,
            "sse": rising,
            "szse": rising,
            "chinext": rising,
            "csi1000": rising,
        }

        market = fetch_china_market()

        self.assertEqual(market["source"]["mode"], "zero-config")
        self.assertTrue(market["source"]["isFallback"])
        self.assertEqual(market["dataQuality"]["status"], "live")

    def test_dashboard_uses_last_successful_cache_when_all_sources_fail(self):
        rising = make_series(3_000, 4)
        china = build_china_market(
            {key: rising for key in ["csi300", "sse", "szse", "chinext", "csi1000"]},
            source={"name": "BaoStock", "mode": "zero-config"},
        )
        us = build_us_market(
            {key: rising for key in ["sp500", "spy", "rsp", "iwm", "qqq", "hyg", "lqd", "vix"]},
            source={"name": "Yahoo Finance via yfinance", "mode": "zero-config"},
        )

        with TemporaryDirectory() as directory:
            cache_path = Path(directory) / "market-timing.json"
            dashboard = get_market_timing_dashboard(
                force=True,
                fetchers={"china": lambda: china, "united-states": lambda: us},
                cache_path=cache_path,
            )
            self.assertTrue(dashboard["autoRefresh"])
            self.assertTrue(cache_path.exists())

            def unavailable():
                raise RuntimeError("provider unavailable")

            stale = get_market_timing_dashboard(
                force=True,
                fetchers={"china": unavailable, "united-states": unavailable},
                cache_path=cache_path,
            )
            self.assertTrue(all(market["status"] == "stale" for market in stale["markets"]))
            self.assertTrue(all(market["dataQuality"]["status"] == "stale" for market in stale["markets"]))

    def test_fresh_disk_cache_makes_restart_zero_configuration_and_fast(self):
        rising = make_series(3_000, 4)
        china = build_china_market(
            {key: rising for key in ["csi300", "sse", "szse", "chinext", "csi1000"]},
            source={"name": "BaoStock", "mode": "zero-config"},
        )
        us = build_us_market(
            {key: rising for key in ["sp500", "spy", "rsp", "iwm", "qqq", "hyg", "lqd", "vix"]},
            source={"name": "Yahoo Finance via yfinance", "mode": "zero-config"},
        )
        with TemporaryDirectory() as directory:
            cache_path = Path(directory) / "market-timing.json"
            get_market_timing_dashboard(
                force=True,
                fetchers={"china": lambda: china, "united-states": lambda: us},
                cache_path=cache_path,
            )
            MARKET_CACHE.update({"expires": 0.0, "data": None})
            with patch("market_timing_sources.fetch_china_market") as china_fetch, patch("market_timing_sources.fetch_us_market") as us_fetch:
                dashboard = get_market_timing_dashboard(force=False, cache_path=cache_path)

            self.assertEqual(dashboard["dataQuality"]["status"], "live")
            china_fetch.assert_not_called()
            us_fetch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
