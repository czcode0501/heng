import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from market_scanner import (
    calculate_prescreen_snapshot,
    parse_baostock_universe,
    parse_nasdaq_universe,
    load_scan_checkpoint,
    save_scan_checkpoint,
    scan_prescreen_batches,
)


def price_rows(*, start=100.0, step=0.5, count=100, volume=100_000, amount=None):
    rows = []
    for index in range(count):
        close = start + index * step
        rows.append(
            {
                "date": f"2026-01-{index + 1:02d}",
                "open": close - 0.2,
                "high": close + 0.8,
                "low": close - 0.8,
                "close": close,
                "volume": volume,
                "amount": close * volume if amount is None else amount,
            }
        )
    return rows


class MarketUniverseTests(unittest.TestCase):
    def test_nasdaq_directories_keep_normal_common_equities_and_filter_products(self):
        nasdaq = "\n".join(
            [
                "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares",
                "AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N",
                "UNH|UnitedHealth Group Incorporated Common Stock|Q|N|N|100|N|N",
                "TEST|Test Security - Common Stock|Q|Y|N|100|N|N",
                "QQQ|Invesco QQQ Trust|Q|N|N|100|Y|N",
                "BAD|Bad Filing Corp - Common Stock|Q|N|D|100|N|N",
                "WXYZW|Example Corp - Warrant|S|N|N|100|N|N",
                "File Creation Time: 0815202621:00|||||||",
            ]
        )
        other = "\n".join(
            [
                "ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol",
                "IBM|International Business Machines Corporation Common Stock|N|IBM|N|100|N|IBM",
                "SPY|SPDR S&P 500 ETF Trust|P|SPY|Y|100|N|SPY",
                "UNIT|Example Acquisition Corp Unit|N|UNIT|N|100|N|UNIT",
                "File Creation Time: 0815202621:00|||||||",
            ]
        )

        universe = parse_nasdaq_universe(nasdaq, other)

        self.assertEqual([item["symbol"] for item in universe], ["AAPL", "IBM", "UNH"])
        self.assertEqual(universe[0]["market"], "united-states")
        self.assertEqual(universe[1]["exchange"], "NYSE")

    def test_baostock_universe_keeps_only_active_a_share_equities_and_maps_industry(self):
        basic_rows = [
            ["sh.603986", "兆易创新", "2016-08-18", "", "1", "1"],
            ["sz.000001", "平安银行", "1991-04-03", "", "1", "1"],
            ["sh.000001", "上证指数", "1991-07-15", "", "2", "1"],
            ["sz.000002", "退市示例", "1991-01-01", "2026-01-01", "1", "0"],
        ]
        industry_rows = [
            ["2026-08-01", "sh.603986", "兆易创新", "半导体", "申万一级行业"],
            ["2026-08-01", "sz.000001", "平安银行", "银行", "申万一级行业"],
        ]

        universe = parse_baostock_universe(basic_rows, industry_rows)

        self.assertEqual([item["providerSymbol"] for item in universe], ["000001.SZ", "603986.SS"])
        self.assertEqual(universe[0]["sectorId"], "financials")
        self.assertEqual(universe[1]["sectorId"], "information-technology")

    def test_china_industry_prefix_fills_the_shared_sector_when_keywords_do_not(self):
        from market_scanner import classify_china_sector

        self.assertEqual(classify_china_sector("C23印刷和记录媒介复制业"), "industrials")


class PrescreenTests(unittest.TestCase):
    def test_prescreen_rewards_liquid_uptrend_and_rejects_thin_or_short_history(self):
        liquid = calculate_prescreen_snapshot(price_rows(), market="united-states")
        thin = calculate_prescreen_snapshot(price_rows(volume=100), market="united-states")
        short = calculate_prescreen_snapshot(price_rows(count=40), market="united-states")

        self.assertTrue(liquid["eligible"])
        self.assertGreaterEqual(liquid["score"], 60)
        self.assertFalse(thin["eligible"])
        self.assertEqual(thin["rejection"], "liquidity")
        self.assertFalse(short["eligible"])
        self.assertEqual(short["rejection"], "history")

    def test_batch_scanner_uses_checkpoint_results_and_keeps_single_symbol_failures(self):
        universe = [
            {"symbol": symbol, "providerSymbol": symbol, "market": "united-states"}
            for symbol in ["A", "B", "C", "D", "E"]
        ]
        calls = []

        def provider(symbols):
            calls.append(list(symbols))
            return {
                symbol: ([] if symbol == "D" else price_rows(start=90 + index * 5))
                for index, symbol in enumerate(symbols)
            }

        report = scan_prescreen_batches(
            universe,
            provider,
            market="united-states",
            batch_size=2,
            top_n=3,
            previous={"A": {"symbol": "A", "eligible": True, "score": 99}},
        )

        self.assertEqual(calls, [["B", "C"], ["D", "E"]])
        self.assertEqual(report["counts"]["universe"], 5)
        self.assertEqual(report["counts"]["processed"], 5)
        self.assertEqual(report["counts"]["failed"], 1)
        self.assertEqual(report["candidates"][0]["symbol"], "A")
        self.assertLessEqual(len(report["candidates"]), 3)

    def test_checkpoint_is_reused_only_for_the_same_market_and_scan_date(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.json"
            save_scan_checkpoint(
                path,
                market="china",
                scan_date="2026-08-15",
                results={"603986.SS": {"symbol": "603986", "score": 72}},
            )

            restored = load_scan_checkpoint(path, market="china", scan_date="2026-08-15")
            stale = load_scan_checkpoint(path, market="china", scan_date="2026-08-16")
            wrong_market = load_scan_checkpoint(path, market="united-states", scan_date="2026-08-15")

        self.assertEqual(restored["603986.SS"]["score"], 72)
        self.assertEqual(stale, {})
        self.assertEqual(wrong_market, {})


if __name__ == "__main__":
    unittest.main()
