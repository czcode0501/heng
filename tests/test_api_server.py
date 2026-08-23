import unittest
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import patch

from api_server import (
    _with_stock_analysis_cache,
    baostock_code_to_yahoo,
    build_quote_from_rows,
    build_stock_analysis_from_rows,
    calculate_technical_snapshot,
    normalize_baostock_row,
    normalize_sector_id,
    normalize_yahoo_quote,
    parse_quote_symbols,
    search_instruments,
    search_yahoo,
    validate_market_timing_range,
    validate_search_query,
)


class SearchContractTests(unittest.TestCase):
    def test_batch_quote_contract_uses_latest_session_and_previous_close(self):
        quote = build_quote_from_rows(
            "600519.SS",
            [
                {"date": "2026-08-14", "close": 100.0},
                {"date": "2026-08-17", "close": 110.0},
            ],
        )

        self.assertEqual(quote["price"], 110.0)
        self.assertEqual(quote["previousClose"], 100.0)
        self.assertEqual(quote["changePercent"], 10.0)
        self.assertEqual(quote["marketDate"], "2026-08-17")

    def test_batch_quote_symbols_are_deduplicated_and_bounded(self):
        self.assertEqual(parse_quote_symbols("600519.SS,AAPL,600519.SS"), ["600519.SS", "AAPL"])
        with self.assertRaises(ValueError):
            parse_quote_symbols(",".join(f"TEST{index}" for index in range(51)))

    def test_stock_analysis_cache_reuses_hot_results_and_expires_by_ttl(self):
        calls = []

        def loader():
            calls.append(len(calls) + 1)
            return {"sequence": calls[-1]}

        first = _with_stock_analysis_cache(("CACHE-TEST", "3m", ""), loader, now=100.0, ttl=10.0)
        hot = _with_stock_analysis_cache(("CACHE-TEST", "3m", ""), loader, now=105.0, ttl=10.0)
        expired = _with_stock_analysis_cache(("CACHE-TEST", "3m", ""), loader, now=111.0, ttl=10.0)

        self.assertEqual(first, {"sequence": 1})
        self.assertIs(hot, first)
        self.assertEqual(expired, {"sequence": 2})
        self.assertEqual(calls, [1, 2])

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
                "sector": "Technology",
                "industry": "Consumer Electronics",
            }
        )

        self.assertEqual(result["symbol"], "AAPL")
        self.assertEqual(result["providerSymbol"], "AAPL")
        self.assertEqual(result["market"], "美股 · NASDAQ")
        self.assertEqual(result["currency"], "USD")
        self.assertEqual(result["sectorId"], "information-technology")
        self.assertEqual(result["sector"], "Technology")
        self.assertEqual(result["industry"], "Consumer Electronics")

    def test_yahoo_sector_names_map_to_the_rotation_catalog(self):
        self.assertEqual(normalize_sector_id("Technology"), "information-technology")
        self.assertEqual(normalize_sector_id("Consumer Cyclical"), "consumer-discretionary")
        self.assertEqual(normalize_sector_id("Financial Services"), "financials")
        self.assertEqual(normalize_sector_id("Industrials"), "industrials")
        self.assertIsNone(normalize_sector_id(""))

    def test_exact_us_symbol_is_recovered_when_search_suggestions_omit_it(self):
        class FakeSearch:
            def __init__(self, *_args, **_kwargs):
                self.quotes = [
                    {"symbol": "AAPB", "longname": "GraniteShares 2x Long AAPL Daily ETF", "exchange": "NMS", "exchDisp": "NASDAQ", "quoteType": "ETF"},
                    {"symbol": "AAPD", "longname": "Direxion Daily AAPL Bear 1X Shares", "exchange": "NMS", "exchDisp": "NASDAQ", "quoteType": "ETF"},
                ]

        class FakeTicker:
            def __init__(self, symbol):
                self.symbol = symbol

            def get_info(self):
                return {
                    "symbol": self.symbol,
                    "longName": "Apple Inc.",
                    "exchange": "NMS",
                    "fullExchangeName": "NasdaqGS",
                    "quoteType": "EQUITY",
                }

        fake_yfinance = SimpleNamespace(Search=FakeSearch, Ticker=FakeTicker)
        with patch.dict("sys.modules", {"yfinance": fake_yfinance}):
            results = search_yahoo("AAPL")

        self.assertEqual(results[0]["symbol"], "AAPL")
        self.assertEqual(results[0]["name"], "Apple Inc.")
        self.assertEqual([item["symbol"] for item in results].count("AAPL"), 1)

    def test_exact_a_share_code_returns_baostock_result_without_waiting_for_yahoo_search(self):
        baostock_result = {
            "symbol": "603986",
            "providerSymbol": "603986.SS",
            "name": "兆易创新",
            "market": "A股 · 上海",
            "currency": "CNY",
            "assetType": "EQUITY",
            "source": "BaoStock",
        }
        with (
            patch("api_server.search_baostock", return_value=[baostock_result]),
            patch("api_server.search_yahoo") as yahoo_search,
        ):
            results = search_instruments("603986")

        yahoo_search.assert_not_called()
        self.assertEqual(results[0]["providerSymbol"], "603986.SS")
        self.assertEqual(results[0]["sectorId"], "information-technology")

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

    def test_stock_analysis_contains_chart_indicators_profile_and_estimated_order_flow(self):
        rows = []
        for index in range(90):
            close = 100 + index * 0.25
            day = date(2026, 5, 1) + timedelta(days=index)
            rows.append(
                {
                    "time": f"{day.isoformat()}T16:00:00-04:00",
                    "date": day.isoformat(),
                    "open": close - 0.1,
                    "high": close + 0.5,
                    "low": close - 0.5,
                    "close": close,
                    "volume": 1_000 + index * 10,
                }
            )

        payload = build_stock_analysis_from_rows(
            "AAPL",
            rows,
            currency="USD",
            range_id="3m",
            interval_label="日线",
        )

        latest = payload["chart"]["candles"][-1]
        self.assertIsNotNone(latest["rsi14"])
        self.assertIn("macd", latest)
        self.assertIn("macdSignal", latest)
        self.assertIn("macdHistogram", latest)
        self.assertIn("vwap", latest)
        self.assertGreater(latest["buyVolume"] + latest["sellVolume"], 0)
        self.assertIn("poc", payload["chart"]["profile"])
        self.assertIn("supportLevels", payload["chart"]["profile"])
        self.assertIn("resistanceLevels", payload["chart"]["profile"])
        self.assertGreater(payload["analysis"]["atr14"], 0)
        self.assertEqual(payload["chart"]["indicatorConfig"]["macd"], [12, 26, 9])
        self.assertTrue(payload["chart"]["orderFlowEstimated"])


if __name__ == "__main__":
    unittest.main()
