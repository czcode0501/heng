import unittest
from unittest.mock import patch

from signal_bootstrap import get_signal_bootstrap


def dashboard(name):
    return {
        "generatedAt": f"2026-08-14T12:00:0{name}+00:00",
        "markets": [{"id": "china", "status": "live"}, {"id": "united-states", "status": "live"}],
    }


class SignalBootstrapTests(unittest.TestCase):
    def test_bootstrap_groups_all_ready_workspaces_and_derives_capital_flow_from_rotation(self):
        macro = dashboard("1")
        timing = dashboard("2")
        rotation = dashboard("3")
        capital = dashboard("4")
        sentiment = dashboard("5")

        with (
            patch("signal_bootstrap.get_macro_dashboard", return_value=macro) as macro_source,
            patch("signal_bootstrap.get_market_timing_dashboard", return_value=timing) as timing_source,
            patch("signal_bootstrap.apply_market_timing_range", return_value={**timing, "selectedRange": "1m"}) as apply_range,
            patch("signal_bootstrap.get_sector_rotation_dashboard", return_value=rotation) as rotation_source,
            patch("signal_bootstrap.build_capital_flow_dashboard", return_value=capital) as capital_builder,
            patch("signal_bootstrap.build_sentiment_dashboard", return_value=sentiment) as sentiment_builder,
            patch("signal_bootstrap.warm_shared_market_sources") as warm_sources,
        ):
            payload = get_signal_bootstrap()

        self.assertEqual(
            set(payload["workspaces"]),
            {"macro", "marketTiming", "sectorRotation", "investorSentiment", "capitalFlow"},
        )
        self.assertEqual(payload["workspaces"]["capitalFlow"], capital)
        self.assertEqual(payload["workspaces"]["marketTiming"]["selectedRange"], "1m")
        self.assertTrue(payload["preloaded"])
        self.assertEqual(payload["refreshPolicy"], "manual-or-ttl")
        self.assertGreaterEqual(len(payload["sourceGroups"]), 5)
        macro_source.assert_called_once_with(force=False)
        timing_source.assert_called_once_with(force=False)
        apply_range.assert_called_once_with(timing, "1m", None)
        rotation_source.assert_called_once_with(force=False)
        capital_builder.assert_called_once_with(rotation)
        sentiment_builder.assert_called_once_with(timing)
        warm_sources.assert_called_once_with()

    def test_source_map_declares_shared_market_data_and_no_duplicate_capital_fetch(self):
        with (
            patch("signal_bootstrap.get_macro_dashboard", return_value=dashboard("1")),
            patch("signal_bootstrap.get_market_timing_dashboard", return_value=dashboard("2")),
            patch("signal_bootstrap.apply_market_timing_range", return_value=dashboard("2")),
            patch("signal_bootstrap.get_sector_rotation_dashboard", return_value=dashboard("3")),
            patch("signal_bootstrap.build_capital_flow_dashboard", return_value=dashboard("4")),
            patch("signal_bootstrap.build_sentiment_dashboard", return_value=dashboard("5")),
            patch("signal_bootstrap.warm_shared_market_sources"),
        ):
            payload = get_signal_bootstrap()

        groups = {group["id"]: group for group in payload["sourceGroups"]}
        self.assertEqual(
            groups["china-market"]["workspaces"],
            ["marketTiming", "sectorRotation", "investorSentiment", "capitalFlow"],
        )
        self.assertEqual(
            groups["us-market"]["workspaces"],
            ["marketTiming", "sectorRotation", "investorSentiment", "capitalFlow"],
        )
        self.assertEqual(groups["derived-capital-flow"]["requestMode"], "derived-no-external-request")


if __name__ == "__main__":
    unittest.main()
