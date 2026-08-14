import unittest
from unittest.mock import patch

from capital_flow_sources import build_capital_flow_dashboard, get_capital_flow_dashboard


def make_sector(index, score):
    state_id = "confirmed-inflow" if score >= 60 else "confirmed-outflow" if score <= 40 else "mixed"
    return {
        "id": f"sector-{index}",
        "title": f"板块{index}",
        "symbol": f"S{index}",
        "instrument": "测试代理",
        "capitalFlow": {
            "score": score,
            "confidence": 92,
            "state": {"id": state_id, "label": state_id, "tone": "positive"},
            "components": {"directionPressure": score},
            "metrics": {"flowRatio": {"1d": 1, "5d": 2, "20d": 3}},
            "history": [{"date": "2026-08-13", "value": score - 1}, {"date": "2026-08-14", "value": score}],
            "methodologyNote": "估算资金压力",
        },
    }


def make_rotation_dashboard():
    markets = []
    for market_id, title in (("china", "中国股票"), ("united-states", "美国股票")):
        markets.append(
            {
                "id": market_id,
                "title": title,
                "status": "live",
                "asOf": "2026-08-14",
                "source": {"name": "测试源", "mode": "zero-config"},
                "sectors": [make_sector(index, 30 + index * 5) for index in range(11)],
                "dataQuality": {"status": "live", "availableSectors": 11, "expectedSectors": 11},
            }
        )
    return {
        "generatedAt": "2026-08-14T12:00:00+00:00",
        "refreshAfterSeconds": 1800,
        "autoRefresh": True,
        "methodologyVersion": "1.1.0",
        "markets": markets,
        "dataQuality": {"status": "live", "liveMarkets": 2, "totalMarkets": 2},
    }


class CapitalFlowSourceTests(unittest.TestCase):
    def test_dashboard_ranks_each_market_by_flow_without_copying_rotation_rank(self):
        dashboard = build_capital_flow_dashboard(make_rotation_dashboard())

        self.assertEqual(dashboard["methodologyVersion"], "1.0.0")
        self.assertEqual(len(dashboard["markets"]), 2)
        for market in dashboard["markets"]:
            self.assertEqual(market["sectors"][0]["capitalFlow"]["score"], 80)
            self.assertEqual([sector["flowRank"] for sector in market["sectors"]], list(range(1, 12)))
            self.assertEqual(market["summary"]["strongest"], "板块10")
            self.assertIn("estimated", dashboard["methodology"]["absoluteFlowField"])

    def test_get_dashboard_reuses_sector_rotation_data_and_forwards_force(self):
        with patch("capital_flow_sources.get_sector_rotation_dashboard", return_value=make_rotation_dashboard()) as source:
            dashboard = get_capital_flow_dashboard(force=True)

        source.assert_called_once_with(force=True)
        self.assertEqual(dashboard["dataQuality"]["liveMarkets"], 2)


if __name__ == "__main__":
    unittest.main()
