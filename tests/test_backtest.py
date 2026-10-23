import math
import unittest

from backtest import report, timing
from backtest.data import US_TIMING_SYMBOLS
from backtest.metrics import SeriesIndex, performance, simulate_plan, spearman
from backtest.stocks import decision_context


def make_rows(count, start=100.0, drift=0.0005, wave=0.02, phase=0.0):
    rows = []
    for index in range(count):
        close = start * (1 + drift) ** index * (1 + wave * math.sin(index / 9 + phase))
        year, day = 2015 + index // 252, index % 252
        rows.append({
            "date": f"{year}-{day // 21 + 1:02d}-{day % 21 + 1:02d}",
            "open": close * 0.998, "high": close * 1.01, "low": close * 0.99, "close": close,
            "volume": 1_000_000 + (index % 17) * 10_000, "amount": 0.0,
        })
    return rows


class ReplayHelperTests(unittest.TestCase):
    def test_upto_never_returns_rows_after_the_replay_date(self):
        index = SeriesIndex({"X": make_rows(300)})
        date = index.dates["X"][150]

        window = index.upto("X", date, 100)

        self.assertEqual(window[-1]["date"], date)
        self.assertEqual(len(window), 100)
        self.assertTrue(all(row["date"] <= date for row in window))

    def test_forward_metrics_use_only_the_following_rows(self):
        rows = [{"date": f"2020-01-{d:02d}", "close": c, "high": c, "low": c} for d, c in enumerate([100, 110, 99, 121], start=1)]
        index = SeriesIndex({"X": rows})

        self.assertAlmostEqual(index.forward_return("X", "2020-01-01", 3), 0.21)
        self.assertAlmostEqual(index.forward_drawdown("X", "2020-01-01", 3), 99 / 110 - 1)
        self.assertIsNone(index.forward_return("X", "2020-01-03", 3))

    def test_spearman_handles_ties_and_missing_values(self):
        self.assertAlmostEqual(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1.0)
        self.assertAlmostEqual(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1.0)
        self.assertAlmostEqual(spearman([1, 1, 2, None], [5, 5, 9, 1]), 1.0)
        self.assertIsNone(spearman([1, 2], [1, 2]))

    def test_performance_reports_cagr_drawdown_and_sharpe(self):
        daily = [0.01, -0.02, 0.015] * 84  # 252 天
        result = performance(daily)
        equity = (1.01 * 0.98 * 1.015) ** 84

        self.assertAlmostEqual(result["cagr"], equity - 1)
        self.assertLess(result["maxDrawdown"], 0)
        self.assertGreater(result["volatility"], 0)

    def test_plan_simulation_exits_on_stop_before_target_on_the_same_day(self):
        path = [{"low": 95, "high": 120, "close": 100}]
        self.assertEqual(simulate_plan(100, 96, 110, path)["outcome"], "stop")
        self.assertEqual(simulate_plan(100, 90, 110, [{"low": 99, "high": 111, "close": 105}])["outcome"], "target")
        timed = simulate_plan(100, 90, 130, [{"low": 99, "high": 101, "close": 104}])
        self.assertEqual((timed["outcome"], round(timed["r"], 2)), ("time", 0.4))


class TimingReplayTests(unittest.TestCase):
    def test_replay_scores_do_not_change_when_future_data_changes(self):
        series = {symbol: make_rows(700, phase=k) for k, symbol in enumerate(US_TIMING_SYMBOLS.values())}
        cutoff = series["^GSPC"][520]["date"]
        original = {row["date"]: row["score"] for row in timing.replay("us", series, 40)}

        altered = {}
        for symbol, rows in series.items():
            altered[symbol] = [dict(row) if row["date"] <= cutoff else {**row, "close": row["close"] * 3, "high": row["high"] * 3, "low": row["low"] * 3}
                               for row in rows]
        replayed = {row["date"]: row["score"] for row in timing.replay("us", altered, 40)}

        past_dates = [d for d in original if d <= cutoff]
        self.assertTrue(past_dates)
        self.assertEqual({d: original[d] for d in past_dates}, {d: replayed[d] for d in past_dates})


class BaselineGateTests(unittest.TestCase):
    def test_compare_flags_regressions_beyond_tolerance_only(self):
        baseline = {"timing.us.sharpe": 0.66, "rotation.us.ic_f20": 0.0, "stocks.buy_share": 0.01, "stocks.composite_spearman_f63": -0.06}
        current = {"timing.us.sharpe": 0.60, "rotation.us.ic_f20": 0.005, "stocks.buy_share": 0.2, "stocks.composite_spearman_f63": 0.05, "new.metric": 1.0}

        status = {row["key"]: row["status"] for row in report.compare(current, baseline)}

        self.assertEqual(status["timing.us.sharpe"], "regressed")
        self.assertEqual(status["rotation.us.ic_f20"], "unchanged")
        self.assertEqual(status["stocks.buy_share"], "info")
        self.assertEqual(status["stocks.composite_spearman_f63"], "improved")
        self.assertEqual(status["new.metric"], "new")

    def test_more_negative_volatility_correlation_counts_as_improvement(self):
        rows = report.compare({"timing.us.spearman_volatility20": -0.50}, {"timing.us.spearman_volatility20": -0.44})
        self.assertEqual(rows[0]["status"], "improved")


class StockContextTests(unittest.TestCase):
    def test_context_mirrors_the_app_including_known_fallbacks(self):
        sector = {"id": "energy", "title": "能源", "score": 70.0, "rank": 1, "confidence": 90, "flowScore": 61.0, "flowState": "流入"}
        context = decision_context("energy", {"score": 40.0, "label": "防守", "exposureBand": "20%–40%", "confidence": "高"},
                                   {"score": 37.8, "phase": {"label": "谨慎降温", "tone": "negative"}}, sector)

        self.assertEqual(context["timing"]["score"], 40.0)
        self.assertEqual(context["sector"]["phase"], "领先")  # D20：按分数退化，而非轮动页的阶段
        self.assertEqual(context["sentiment"]["phase"], "谨慎降温")
        self.assertIsNone(context["macro"])


if __name__ == "__main__":
    unittest.main()
