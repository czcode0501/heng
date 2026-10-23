import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

import ibkr_market_data
from ibkr_market_data import (
    IbkrUnavailable,
    duration_for_start,
    fetch_ibkr_bars,
    fetch_with_fallback,
    ibkr_contract_spec,
    normalize_bars,
)


def bar(day, close, volume=1000):
    return SimpleNamespace(date=day, open=close - 1, high=close + 1, low=close - 2, close=close, volume=volume)


class FakeSession:
    def __init__(self, bars=None, error=None):
        self.bars = bars or []
        self.error = error
        self.calls = []

    def historical_bars(self, spec, *, duration, bar_size, what_to_show):
        self.calls.append({"spec": spec, "duration": duration, "bar_size": bar_size, "what_to_show": what_to_show})
        if self.error:
            raise IbkrUnavailable(self.error)
        return self.bars


class ContractMappingTests(unittest.TestCase):
    def test_us_stocks_etfs_and_share_classes_map_to_smart_routing(self):
        self.assertEqual(ibkr_contract_spec("aapl"), {"symbol": "AAPL", "secType": "STK", "exchange": "SMART", "currency": "USD"})
        self.assertEqual(ibkr_contract_spec("BRK-B")["symbol"], "BRK B")

    def test_supported_indices_map_to_index_contracts(self):
        self.assertEqual(ibkr_contract_spec("^GSPC"), {"symbol": "SPX", "secType": "IND", "exchange": "CBOE", "currency": "USD"})
        self.assertEqual(ibkr_contract_spec("^VIX")["secType"], "IND")

    def test_a_shares_and_unsupported_symbols_stay_on_free_sources(self):
        for symbol in ("600519.SS", "159301.SZ", "^HSI", "EURUSD=X", "", "BAD SYMBOL"):
            self.assertIsNone(ibkr_contract_spec(symbol), symbol)


class BarNormalizationTests(unittest.TestCase):
    def test_duration_uses_days_up_to_a_year_then_whole_years(self):
        today = date(2026, 10, 23)
        self.assertEqual(duration_for_start(date(2026, 10, 13), today), "10 D")
        self.assertEqual(duration_for_start(date(2025, 10, 23), today), "365 D")
        self.assertEqual(duration_for_start(date(2024, 10, 23), today), "2 Y")

    def test_daily_and_intraday_bars_become_hub_rows(self):
        daily = normalize_bars([bar("20261023", 760.5, 15_000_000), bar("20261024", 0)], "1d")
        self.assertEqual(len(daily), 1)
        self.assertEqual(daily[0]["date"], "2026-10-23")
        self.assertEqual(daily[0]["volume"], 15_000_000)

        intraday = normalize_bars([bar("1792762200", 346.7)], "5m")  # 2026-10-23 13:30 UTC
        self.assertEqual(intraday[0]["time"], "2026-10-23T09:30:00-04:00")
        self.assertEqual(intraday[0]["date"], "2026-10-23")


class FetchTests(unittest.TestCase):
    def test_stocks_request_adjusted_daily_bars_and_indices_use_trades(self):
        session = FakeSession([bar("20261022", 100), bar("20261023", 101)])
        fetch_ibkr_bars("SPY", interval="1d", start=date(2024, 10, 23), adjusted=True, session=session)
        fetch_ibkr_bars("^GSPC", interval="1d", start=date(2024, 10, 23), adjusted=True, session=session)
        fetch_ibkr_bars("AAPL", interval="5m", start=date(2026, 10, 13), session=session)

        self.assertEqual(session.calls[0]["what_to_show"], "ADJUSTED_LAST")
        self.assertEqual(session.calls[1]["what_to_show"], "TRADES")
        self.assertEqual(session.calls[2]["bar_size"], "5 mins")

    def test_non_us_symbols_and_empty_responses_raise_unavailable(self):
        with self.assertRaises(IbkrUnavailable):
            fetch_ibkr_bars("600519.SS", interval="1d", start=date(2026, 1, 1), session=FakeSession())
        with self.assertRaises(IbkrUnavailable):
            fetch_ibkr_bars("SPY", interval="1d", start=date(2026, 1, 1), session=FakeSession([]))

    def test_fallback_receives_a_shares_and_failed_us_symbols_in_one_batch(self):
        fallback_calls = []

        def ibkr_fetch(symbol):
            if symbol == "XLE":
                raise IbkrUnavailable("no data")
            return [{"date": "2026-10-23", "close": 1.0}] * 3

        def fallback_fetch(symbols):
            fallback_calls.append(list(symbols))
            return {symbol: [{"date": "2026-10-23", "close": 2.0}] * 3 for symbol in symbols}

        rows, sources = fetch_with_fallback(["SPY", "XLE", "515880.SS"], ibkr_fetch, fallback_fetch, minimum=2)

        self.assertEqual(fallback_calls, [["XLE", "515880.SS"]])
        self.assertEqual(sources, {"SPY": "ibkr", "XLE": "fallback", "515880.SS": "fallback"})
        self.assertEqual(rows["SPY"][0]["close"], 1.0)
        self.assertEqual(rows["XLE"][0]["close"], 2.0)

    def test_short_ibkr_history_falls_back_instead_of_failing_the_minimum(self):
        rows, sources = fetch_with_fallback(
            ["SPY"], lambda symbol: [{"close": 1.0}], lambda symbols: {"SPY": [{"close": 2.0}] * 5}, minimum=3
        )
        self.assertEqual(sources["SPY"], "fallback")
        self.assertEqual(len(rows["SPY"]), 5)


class SessionTests(unittest.TestCase):
    def test_failed_connection_is_not_retried_within_backoff_window(self):
        session = ibkr_market_data._Session()
        with patch.object(session, "_connect", side_effect=IbkrUnavailable("TWS not running")) as connect:
            for _ in range(3):
                with self.assertRaises(IbkrUnavailable):
                    session.client()
        self.assertEqual(connect.call_count, 1)
        self.assertFalse(session.status()["connected"])
        self.assertIn("TWS not running", session.status()["lastError"])

    def test_connection_threads_are_daemons_so_they_never_block_exit(self):
        import threading

        created = []

        class FakeClient:
            def connect(self, host, port, clientId):
                reader = threading.Thread(target=lambda: None)
                created.append(reader.daemon)

        ibkr_market_data._connect_as_daemon(FakeClient(), "127.0.0.1", 7497, 77)
        self.assertEqual(created, [True])

    def test_client_id_in_use_retries_the_next_id(self):
        import sys
        import types

        attempts = []

        class FakeEClient:
            def __init__(self, wrapper):
                self.wrapper = wrapper
                self.connected = False

            def connect(self, host, port, clientId):
                attempts.append((port, clientId))
                self.connected = port == 7497
                self.client_id = clientId

            def isConnected(self):
                return self.connected

            def run(self):
                if self.client_id == 77:
                    self.wrapper.error(-1, 0, 326, "client id is already in use")
                else:
                    self.wrapper.nextValidId(1)

            def disconnect(self):
                self.connected = False

        fake_client = types.ModuleType("ibapi.client")
        fake_client.EClient = FakeEClient
        fake_wrapper = types.ModuleType("ibapi.wrapper")
        fake_wrapper.EWrapper = type("EWrapper", (), {})
        session = ibkr_market_data._Session()
        with (
            patch.dict(sys.modules, {"ibapi": types.ModuleType("ibapi"), "ibapi.client": fake_client, "ibapi.wrapper": fake_wrapper}),
            patch.dict("os.environ", {"IBKR_PORT": "7497", "IBKR_MARKET_DATA_CLIENT_ID": "77"}),
        ):
            session.client()

        self.assertEqual(attempts, [(7497, 77), (7497, 78)])
        self.assertEqual(session.status()["clientId"], 78)

    def test_remote_hosts_are_rejected(self):
        session = ibkr_market_data._Session()
        with patch.dict("os.environ", {"IBKR_HOST": "203.0.113.5"}):
            with self.assertRaises(IbkrUnavailable) as context:
                session._connect()
        self.assertIn("本机", str(context.exception))


if __name__ == "__main__":
    unittest.main()
