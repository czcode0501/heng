import unittest

from api_server import (
    baostock_code_to_yahoo,
    calculate_technical_snapshot,
    normalize_baostock_row,
    normalize_yahoo_quote,
    validate_market_timing_range,
    validate_search_query,
)


class SearchContractTests(unittest.TestCase):
    def test_000410_is_normalized_as_a_shenzhen_stock(self):
        result = normalize_baostock_row(
            ["sz.000410", "沈阳机床", "1996-07-18", "", "1", "1"]
        )

        self.assertEqual(result["symbol"], "000410")
        self.assertEqual(result["providerSymbol"], "000410.SZ")
        self.assertEqual(result["name"], "沈阳机床")
        self.assertEqual(result["market"], "A股 · 深圳")
        self.assertEqual(result["currency"], "CNY")

    def test_baostock_exchange_codes_map_to_yahoo_suffixes(self):
        self.assertEqual(baostock_code_to_yahoo("sh.600519"), "600519.SS")
        self.assertEqual(baostock_code_to_yahoo("sz.000410"), "000410.SZ")
        self.assertEqual(baostock_code_to_yahoo("bj.920002"), "920002.BJ")

    def test_yahoo_us_equity_uses_normalized_contract(self):
        result = normalize_yahoo_quote(
            {
                "symbol": "AAPL",
                "longname": "Apple Inc.",
                "exchange": "NMS",
                "exchDisp": "NASDAQ",
                "quoteType": "EQUITY",
            }
        )

        self.assertEqual(result["symbol"], "AAPL")
        self.assertEqual(result["providerSymbol"], "AAPL")
        self.assertEqual(result["market"], "美股 · NASDAQ")
        self.assertEqual(result["currency"], "USD")

    def test_empty_or_oversized_queries_are_rejected(self):
        with self.assertRaises(ValueError):
            validate_search_query("   ")
        with self.assertRaises(ValueError):
            validate_search_query("x" * 41)

    def test_market_timing_range_requires_a_valid_custom_start(self):
        self.assertEqual(validate_market_timing_range("1m", ""), ("1m", None))
        self.assertEqual(validate_market_timing_range("custom", "2026-01-05"), ("custom", "2026-01-05"))
        with self.assertRaises(ValueError):
            validate_market_timing_range("custom", "")
        with self.assertRaises(ValueError):
            validate_market_timing_range("2y", "")

    def test_technical_snapshot_reports_trend_and_indicators(self):
        closes = [float(value) for value in range(101, 171)]

        snapshot = calculate_technical_snapshot(closes)

        self.assertEqual(snapshot["trend"], "strong_up")
        self.assertEqual(snapshot["ma20"], 160.5)
        self.assertEqual(snapshot["ma60"], 140.5)
        self.assertEqual(snapshot["rsi14"], 100.0)
        self.assertEqual(snapshot["periodHigh"], 170.0)
        self.assertEqual(snapshot["periodLow"], 101.0)
        self.assertEqual(snapshot["rangePosition"], 100.0)

    def test_technical_snapshot_requires_enough_history(self):
        with self.assertRaises(ValueError):
            calculate_technical_snapshot([100.0] * 19)


if __name__ == "__main__":
    unittest.main()
