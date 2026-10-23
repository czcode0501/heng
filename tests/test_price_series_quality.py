import unittest

from price_series_quality import describe_correction, repair_price_series


def rows(closes, start_day=1):
    return [
        {"date": f"2026-01-{start_day + index:02d}", "high": close, "low": close, "close": close, "volume": 1000.0}
        for index, close in enumerate(closes)
    ]


class PriceSeriesQualityTests(unittest.TestCase):
    def test_clean_series_is_unchanged(self):
        series = rows([1.00, 1.02, 0.99, 1.05])
        cleaned, corrections = repair_price_series(series)
        self.assertEqual(cleaned, series)
        self.assertEqual(corrections, [])

    def test_unrecorded_one_to_three_split_rescales_earlier_history(self):
        # 515880.SS 实测：3.16 → 1.084 → 1.051（Yahoo 未记录拆分）
        cleaned, corrections = repair_price_series(rows([3.10, 3.16, 1.084, 1.051]))
        self.assertEqual([item["type"] for item in corrections], ["split-adjusted"])
        self.assertEqual(corrections[0]["ratio"], 3)
        self.assertAlmostEqual(cleaned[1]["close"], 3.16 / 3)
        self.assertAlmostEqual(cleaned[0]["volume"], 3000.0)
        self.assertAlmostEqual(cleaned[2]["close"], 1.084)
        # 拆分日只剩真实的当日涨跌（约 +2.9%），不再是 -66%
        self.assertLess(abs(cleaned[2]["close"] / cleaned[1]["close"] - 1), 0.05)

    def test_one_day_bad_print_that_reverts_is_removed(self):
        # 515880.SS 实测：0.788 → 1.579 → 0.757
        cleaned, corrections = repair_price_series(rows([0.79, 0.788, 1.579, 0.757, 0.761]))
        self.assertEqual([item["type"] for item in corrections], ["spike-removed"])
        self.assertEqual(corrections[0]["date"], "2026-01-03")
        self.assertEqual([row["close"] for row in cleaned], [0.79, 0.788, 0.757, 0.761])

    def test_spike_and_two_splits_from_the_real_series_all_resolve(self):
        closes = [3.10, 3.16, 1.084, 1.051, 1.20, 1.35, 1.50, 1.62, 1.757, 0.858, 0.898, 0.788, 1.579, 0.757, 0.761]
        cleaned, corrections = repair_price_series(rows(closes))
        self.assertEqual(sorted(item["type"] for item in corrections), ["spike-removed", "split-adjusted", "split-adjusted"])
        moves = [abs(b["close"] / a["close"] - 1) for a, b in zip(cleaned, cleaned[1:])]
        self.assertLess(max(moves), 0.2)

    def test_unexplained_jump_is_kept_and_flagged(self):
        cleaned, corrections = repair_price_series(rows([100, 100, 70, 71]))
        self.assertEqual(corrections[0]["type"], "unresolved-jump")
        self.assertEqual([row["close"] for row in cleaned], [100, 100, 70, 71])
        self.assertIn("无法识别", describe_correction(corrections[0]))

    def test_threshold_allows_large_but_plausible_moves(self):
        _, corrections = repair_price_series(rows([100, 75, 76]), max_daily_move=0.3)
        self.assertEqual(corrections, [])


if __name__ == "__main__":
    unittest.main()
