import unittest
from datetime import date, datetime, timezone

from micro_data import (
    MICRO_INSTRUMENTS,
    _request_end_date,
    aggregate_candles,
    build_volume_profile,
    combine_index_price_with_flow,
    estimate_order_flow,
)


def candle(time, open_, high, low, close, volume):
    buy, sell, delta = estimate_order_flow(open_, high, low, close, volume)
    return {
        "time": time,
        "date": time[:10],
        "open": open_,
        "high": high,
        "low": low,
        "close": close,
        "volume": volume,
        "amount": close * volume,
        "buyVolume": buy,
        "sellVolume": sell,
        "delta": delta,
    }


class EstimatedOrderFlowTests(unittest.TestCase):
    def test_request_end_date_includes_the_current_china_session_when_new_york_is_previous_day(self):
        now = datetime(2026, 8, 17, 2, 15, tzinfo=timezone.utc)

        self.assertEqual(_request_end_date(now), date(2026, 8, 18))

    def test_index_definitions_separate_point_price_from_etf_flow_proxy(self):
        china = MICRO_INSTRUMENTS["china"][0]
        united_states = MICRO_INSTRUMENTS["united-states"][0]

        self.assertEqual(china["priceSymbol"], "000300.SS")
        self.assertEqual(china["flowSymbol"], "510300.SS")
        self.assertEqual(united_states["priceSymbol"], "^GSPC")
        self.assertEqual(united_states["flowSymbol"], "SPY")
        self.assertEqual(united_states["unit"], "POINTS")

    def test_combined_candles_keep_index_points_and_take_only_flow_from_etf(self):
        index_rows = [
            candle("2026-08-14T09:35:00-04:00", 7775, 7792, 7768, 7785.76, 0),
        ]
        proxy_rows = [
            candle("2026-08-14T09:35:00-04:00", 775, 778, 774, 776.30, 12_000_000),
        ]

        result = combine_index_price_with_flow(index_rows, proxy_rows)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["open"], 7775)
        self.assertEqual(result[0]["close"], 7785.76)
        self.assertEqual(result[0]["volume"], 12_000_000)
        self.assertAlmostEqual(
            result[0]["buyVolume"] + result[0]["sellVolume"], 12_000_000
        )

    def test_bullish_close_assigns_more_volume_to_buyers(self):
        buy, sell, delta = estimate_order_flow(100, 106, 99, 105, 10_000)

        self.assertAlmostEqual(buy + sell, 10_000)
        self.assertGreater(buy, sell)
        self.assertGreater(delta, 0)

    def test_bearish_close_assigns_more_volume_to_sellers(self):
        buy, sell, delta = estimate_order_flow(105, 106, 99, 100, 10_000)

        self.assertAlmostEqual(buy + sell, 10_000)
        self.assertLess(buy, sell)
        self.assertLess(delta, 0)

    def test_aggregation_preserves_ohlc_and_total_flow(self):
        rows = [
            {**candle("2026-08-14T09:35:00+08:00", 10, 11, 9.5, 10.8, 1_000), "rsi14": 48, "macd": 0.1, "macdSignal": 0.08, "macdHistogram": 0.02, "vwap": 10.4},
            {**candle("2026-08-14T09:40:00+08:00", 10.8, 11.2, 10.4, 10.5, 2_000), "rsi14": 52, "macd": 0.2, "macdSignal": 0.12, "macdHistogram": 0.08, "vwap": 10.55},
        ]

        result = aggregate_candles(rows, maximum=1)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["open"], 10)
        self.assertEqual(result[0]["close"], 10.5)
        self.assertEqual(result[0]["high"], 11.2)
        self.assertEqual(result[0]["low"], 9.5)
        self.assertEqual(result[0]["volume"], 3_000)
        self.assertAlmostEqual(result[0]["buyVolume"] + result[0]["sellVolume"], 3_000)
        self.assertEqual(result[0]["rsi14"], 52)
        self.assertEqual(result[0]["macd"], 0.2)
        self.assertEqual(result[0]["vwap"], 10.55)

    def test_volume_profile_finds_poc_support_resistance_and_vacuum(self):
        rows = [
            candle("2026-08-11T10:00:00+08:00", 99, 101, 98, 100, 1_000),
            candle("2026-08-12T10:00:00+08:00", 99.5, 101, 99, 100.5, 12_000),
            candle("2026-08-13T10:00:00+08:00", 104, 106, 104, 105, 800),
            candle("2026-08-14T10:00:00+08:00", 109, 111, 109, 110, 10_000),
        ]

        profile = build_volume_profile(rows, current_price=105, bin_count=12)

        self.assertEqual(len(profile["bins"]), 12)
        self.assertLess(profile["support"], 105)
        self.assertGreater(profile["resistance"], 105)
        self.assertLessEqual(profile["valueAreaLow"], profile["poc"])
        self.assertGreaterEqual(profile["valueAreaHigh"], profile["poc"])
        self.assertTrue(profile["vacuumZones"])

    def test_volume_profile_exposes_ordered_near_and_far_price_zones(self):
        rows = [
            candle("2026-08-10T10:00:00+08:00", 90, 92, 89, 91, 8_000),
            candle("2026-08-11T10:00:00+08:00", 96, 98, 95, 97, 13_000),
            candle("2026-08-12T10:00:00+08:00", 103, 105, 102, 104, 900),
            candle("2026-08-13T10:00:00+08:00", 109, 111, 108, 110, 12_000),
            candle("2026-08-14T10:00:00+08:00", 116, 118, 115, 117, 7_000),
        ]

        profile = build_volume_profile(rows, current_price=104, bin_count=24)

        self.assertGreaterEqual(len(profile["supportLevels"]), 2)
        self.assertGreaterEqual(len(profile["resistanceLevels"]), 2)
        self.assertGreater(profile["supportLevels"][0]["midpoint"], profile["supportLevels"][1]["midpoint"])
        self.assertLess(profile["resistanceLevels"][0]["midpoint"], profile["resistanceLevels"][1]["midpoint"])
        self.assertLess(profile["supportLevels"][0]["high"], 104)
        self.assertGreater(profile["resistanceLevels"][0]["low"], 104)
        self.assertIn("source", profile["supportLevels"][0])


if __name__ == "__main__":
    unittest.main()
