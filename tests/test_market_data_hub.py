import unittest
from unittest.mock import patch

from market_data_hub import (
    baostock_to_yahoo_symbol,
    get_yfinance_series,
    merge_latest_rows,
    reset_market_data_hub_cache,
    warm_signal_market_data,
)


def rows(symbol, count=260):
    return [
        {
            "date": f"2025-{(index // 28) + 1:02d}-{(index % 28) + 1:02d}",
            "open": 100,
            "high": 101,
            "low": 99,
            "close": 100 + index,
            "volume": 1_000_000,
            "amount": 0,
        }
        for index in range(count)
    ]


class MarketDataHubTests(unittest.TestCase):
    def setUp(self):
        reset_market_data_hub_cache()

    def test_overlapping_yfinance_consumers_only_fetch_missing_symbols(self):
        calls = []

        def fake_batch(symbols):
            calls.append(list(symbols))
            return {symbol: rows(symbol) for symbol in symbols}

        with patch("market_data_hub._fetch_yfinance_batch", side_effect=fake_batch):
            first = get_yfinance_series(["SPY", "QQQ"], minimum=220)
            second = get_yfinance_series(["QQQ", "XLE"], minimum=121)

        self.assertEqual(calls, [["SPY", "QQQ"], ["XLE"]])
        self.assertEqual(set(first), {"SPY", "QQQ"})
        self.assertEqual(set(second), {"QQQ", "XLE"})

    def test_signal_warmup_batches_each_provider_group_once(self):
        with (
            patch("market_data_hub.get_baostock_series", return_value={}) as baostock,
            patch("market_data_hub.get_yfinance_series", return_value={}) as yahoo,
        ):
            warm_signal_market_data(
                baostock_symbols=["sh.000300", "sh.000986", "sh.000300"],
                yfinance_symbols=["SPY", "XLE", "SPY"],
            )

        baostock.assert_called_once_with(["sh.000300", "sh.000986"], force=False, minimum=121)
        yahoo.assert_called_once_with(["SPY", "XLE"], force=False, minimum=121)

    def test_baostock_symbols_map_to_yahoo_for_intraday_overlay(self):
        self.assertEqual(baostock_to_yahoo_symbol("sh.000300"), "000300.SS")
        self.assertEqual(baostock_to_yahoo_symbol("sz.399006"), "399006.SZ")
        self.assertEqual(baostock_to_yahoo_symbol("bj.920002"), "920002.BJ")

    def test_current_trading_day_replaces_or_appends_to_eod_history(self):
        history = [
            {"date": "2026-08-14", "open": 100, "high": 102, "low": 99, "close": 101, "volume": 10, "amount": 1000},
        ]
        intraday = [
            {"date": "2026-08-17", "open": 103, "high": 105, "low": 102, "close": 104, "volume": 20, "amount": 0},
        ]

        merged = merge_latest_rows(history, intraday)

        self.assertEqual([row["date"] for row in merged], ["2026-08-14", "2026-08-17"])
        self.assertEqual(merged[-1]["close"], 104)


if __name__ == "__main__":
    unittest.main()
