import unittest

from capital_flow import (
    INDICATOR_IDS,
    build_capital_flow_snapshot,
    classify_price_flow_state,
    compute_capital_flow_metrics,
)


def make_flow_series(*, accumulating=True, count=260):
    rows = []
    for index in range(count):
        base = 100 + index * (0.16 if accumulating else -0.08)
        low = base - 1.2
        high = base + 1.2
        close = high - 0.12 if accumulating else low + 0.12
        rows.append(
            {
                "date": f"2025-{(index // 28) + 1:02d}-{(index % 28) + 1:02d}",
                "open": base,
                "high": high,
                "low": low,
                "close": close,
                "volume": 1_000_000 + index * 2_500,
            }
        )
    return rows


class CapitalFlowModelTests(unittest.TestCase):
    def test_metrics_expose_original_nine_indicators_for_three_windows(self):
        metrics = compute_capital_flow_metrics(make_flow_series())

        self.assertEqual(set(metrics), set(INDICATOR_IDS))
        for values in metrics.values():
            self.assertEqual(set(values), {"1d", "5d", "20d"})
        self.assertIsNone(metrics["upDownVolumeRatio"]["1d"])
        self.assertIsNone(metrics["mfi"]["1d"])
        self.assertGreater(metrics["cmf"]["20d"], 0)
        self.assertGreater(metrics["estimatedNetFlow"]["20d"], 0)

    def test_accumulation_scores_above_distribution(self):
        accumulation = build_capital_flow_snapshot(make_flow_series(accumulating=True))
        distribution = build_capital_flow_snapshot(make_flow_series(accumulating=False))

        self.assertGreater(accumulation["score"], 60)
        self.assertLess(distribution["score"], 40)
        self.assertGreater(accumulation["score"], distribution["score"])
        self.assertEqual(accumulation["state"]["id"], "confirmed-inflow")
        self.assertEqual(distribution["state"]["id"], "confirmed-outflow")
        self.assertGreaterEqual(accumulation["confidence"], 90)

    def test_price_and_flow_are_classified_as_confirmation_or_divergence(self):
        self.assertEqual(classify_price_flow_state(4, 70)["id"], "confirmed-inflow")
        self.assertEqual(classify_price_flow_state(-1, 70)["id"], "accumulation")
        self.assertEqual(classify_price_flow_state(4, 30)["id"], "distribution")
        self.assertEqual(classify_price_flow_state(-4, 30)["id"], "confirmed-outflow")
        self.assertEqual(classify_price_flow_state(0.2, 51)["id"], "mixed")

    def test_snapshot_discloses_proxy_nature_and_keeps_absolute_flow_out_of_score_groups(self):
        snapshot = build_capital_flow_snapshot(make_flow_series())

        self.assertIn("估算", snapshot["methodologyNote"])
        self.assertEqual(
            set(snapshot["components"]),
            {"directionPressure", "persistence", "participation", "priceLocationConfirmation", "intensity"},
        )
        self.assertNotIn("estimatedNetFlow", snapshot["components"])
        self.assertGreater(len(snapshot["history"]), 100)


if __name__ == "__main__":
    unittest.main()
