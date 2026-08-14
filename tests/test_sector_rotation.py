import unittest

from sector_rotation import (
    DIMENSION_WEIGHTS,
    build_sector_market,
    classify_rotation_phase,
)


def make_series(start, step, *, count=260, volume_step=1_000):
    rows = []
    for index in range(count):
        close = start + step * index
        rows.append(
            {
                "date": f"2025-{(index // 28) + 1:02d}-{(index % 28) + 1:02d}",
                "open": close - step * 0.2,
                "high": close * 1.01,
                "low": close * 0.99,
                "close": close,
                "volume": 1_000_000 + volume_step * index,
                "amount": (1_000_000 + volume_step * index) * close,
            }
        )
    return rows


class SectorRotationModelTests(unittest.TestCase):
    def test_market_ranks_sectors_and_exposes_six_weighted_dimensions(self):
        benchmark = make_series(3_000, 2)
        definitions = [
            {
                "id": f"sector-{index}",
                "title": f"板块{index}",
                "symbol": f"S{index}",
                "points": make_series(1_000, index + 1),
            }
            for index in range(11)
        ]

        market = build_sector_market(
            "china",
            "中国股票",
            benchmark,
            definitions,
            {"name": "测试数据", "mode": "zero-config"},
            timing_score=65,
        )

        self.assertEqual(len(market["sectors"]), 11)
        self.assertEqual([sector["rank"] for sector in market["sectors"]], list(range(1, 12)))
        self.assertEqual(set(market["sectors"][0]["dimensions"]), set(DIMENSION_WEIGHTS))
        self.assertEqual(sum(DIMENSION_WEIGHTS.values()), 100)
        self.assertGreater(market["sectors"][0]["score"], market["sectors"][-1]["score"])
        self.assertEqual(market["timing"]["maxExposure"], 60)

    def test_position_weights_respect_market_and_single_sector_caps(self):
        benchmark = make_series(3_000, 1)
        definitions = [
            {
                "id": f"sector-{index}",
                "title": f"板块{index}",
                "symbol": f"S{index}",
                "points": make_series(900, index + 2),
            }
            for index in range(11)
        ]

        market = build_sector_market(
            "united-states",
            "美国股票",
            benchmark,
            definitions,
            {"name": "测试数据", "mode": "zero-config"},
            timing_score=75,
        )

        weights = [sector["targetWeight"] for sector in market["sectors"]]
        self.assertLessEqual(sum(weights), 80)
        self.assertLessEqual(max(weights), 30)
        self.assertLessEqual(sum(weight > 0 for weight in weights), 3)

    def test_risk_off_market_produces_no_sector_allocation(self):
        benchmark = make_series(3_000, -1)
        definitions = [
            {
                "id": f"sector-{index}",
                "title": f"板块{index}",
                "symbol": f"S{index}",
                "points": make_series(900, index + 1),
            }
            for index in range(11)
        ]

        market = build_sector_market(
            "china",
            "中国股票",
            benchmark,
            definitions,
            {"name": "测试数据", "mode": "zero-config"},
            timing_score=20,
        )

        self.assertEqual(market["timing"]["maxExposure"], 0)
        self.assertEqual(sum(sector["targetWeight"] for sector in market["sectors"]), 0)

    def test_rotation_phase_distinguishes_leading_overheated_repair_and_lagging(self):
        self.assertEqual(classify_rotation_phase(76, 4, 68, 0.8)["id"], "leading")
        self.assertEqual(classify_rotation_phase(82, -3, 75, 3.1)["id"], "overheated")
        self.assertEqual(classify_rotation_phase(55, 4, 58, 0.4)["id"], "repairing")
        self.assertEqual(classify_rotation_phase(35, -4, 30, -1.0)["id"], "lagging")

    def test_short_history_is_disclosed_and_cannot_generate_an_increase_action(self):
        benchmark = make_series(3_000, 2)
        definitions = [
            {
                "id": f"sector-{index}",
                "title": f"板块{index}",
                "symbol": f"S{index}",
                "points": make_series(900, index + 1, count=80 if index == 10 else 260),
            }
            for index in range(11)
        ]

        market = build_sector_market(
            "china",
            "中国股票",
            benchmark,
            definitions,
            {"name": "测试数据", "mode": "zero-config"},
            timing_score=75,
        )
        short = next(sector for sector in market["sectors"] if sector["id"] == "sector-10")

        self.assertLess(short["confidence"], 70)
        self.assertEqual(short["action"]["id"], "watch")
        self.assertEqual(short["targetWeight"], 0)
        self.assertTrue(short["dataQuality"]["issues"])


if __name__ == "__main__":
    unittest.main()
