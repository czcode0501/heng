import unittest

from investor_sentiment import build_market_sentiment, build_sentiment_dashboard, classify_sentiment_phase


def make_series(
    start,
    step,
    *,
    count=300,
    volume_start=1_000_000,
    volume_step=1_000,
):
    rows = []
    for index in range(count):
        close = start + step * index
        rows.append(
            {
                "date": f"2025-{(index // 28) + 1:02d}-{(index % 28) + 1:02d}",
                "open": close - step * 0.25,
                "high": close * 1.01,
                "low": close * 0.99,
                "close": close,
                "volume": volume_start + volume_step * index,
                "amount": (volume_start + volume_step * index) * close,
            }
        )
    return rows


def timing_market(market_id):
    rising = make_series(100, 0.25)
    stronger = make_series(80, 0.4)
    stable = make_series(20, -0.01)
    if market_id == "china":
        evidence = {
            "csi300": rising,
            "sse": rising,
            "szse": rising,
            "chinext": stronger,
            "csi1000": stronger,
        }
        title, scope, benchmark = "中国股票", "A股", "沪深300"
    else:
        evidence = {
            "sp500": rising,
            "spy": rising,
            "rsp": stronger,
            "iwm": stronger,
            "qqq": rising,
            "hyg": stronger,
            "lqd": rising,
            "vix": stable,
        }
        title, scope, benchmark = "美国股票", "美股", "S&P 500"
    return {
        "id": market_id,
        "title": title,
        "scope": scope,
        "status": "live",
        "asOf": rising[-1]["date"],
        "source": {"name": "共享免费行情", "mode": "zero-config"},
        "benchmark": {"name": benchmark},
        "_evidenceSeries": evidence,
    }


class InvestorSentimentTests(unittest.TestCase):
    def test_dashboard_separates_china_and_us_with_four_weighted_dimensions(self):
        timing = {
            "generatedAt": "2026-08-14T12:00:00+00:00",
            "refreshAfterSeconds": 1800,
            "markets": [timing_market("china"), timing_market("united-states")],
        }

        dashboard = build_sentiment_dashboard(timing)

        self.assertEqual([market["id"] for market in dashboard["markets"]], ["china", "united-states"])
        for market in dashboard["markets"]:
            self.assertEqual(
                [dimension["id"] for dimension in market["dimensions"]],
                ["fear-pressure", "participation", "positioning", "speculation"],
            )
            self.assertEqual(sum(dimension["weight"] for dimension in market["dimensions"]), 100)
            self.assertGreaterEqual(market["score"], 0)
            self.assertLessEqual(market["score"], 100)
            self.assertGreaterEqual(len(market["history"]), 200)
            self.assertEqual([item["id"] for item in market["legacyMethods"]], ["ground-volume", "crowding"])
            self.assertTrue(market["dataQuality"]["reusedSharedMarketCache"])

    def test_phase_classifier_uses_level_and_impulse_instead_of_level_alone(self):
        self.assertEqual(classify_sentiment_phase(18, -6)["id"], "panic-worsening")
        self.assertEqual(classify_sentiment_phase(18, 6)["id"], "panic-stabilizing")
        self.assertEqual(classify_sentiment_phase(82, 6)["id"], "euphoria-accelerating")
        self.assertEqual(classify_sentiment_phase(82, -6)["id"], "crowding-deteriorating")

    def test_old_ui_ground_volume_method_is_preserved_as_an_auditable_subsignal(self):
        market = timing_market("china")
        for series in market["_evidenceSeries"].values():
            series[-1]["volume"] = series[-2]["volume"] * 0.2
            series[-1]["amount"] = series[-2]["amount"] * 0.2
            series[-1]["close"] = series[-2]["close"] * 0.98

        sentiment = build_market_sentiment(market)
        ground_volume = sentiment["legacyMethods"][0]

        self.assertEqual(ground_volume["id"], "ground-volume")
        self.assertLess(ground_volume["volumeRatio"], 0.5)
        self.assertEqual(ground_volume["state"], "极度缩量")
        self.assertIn("不能单独确认底部", ground_volume["interpretation"])


if __name__ == "__main__":
    unittest.main()
