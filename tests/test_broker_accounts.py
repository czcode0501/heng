import unittest
from unittest.mock import Mock

from broker_accounts import _pick_account_value, read_broker_quotes, read_broker_snapshot


class BrokerAccountContractTests(unittest.TestCase):
    def test_ibkr_market_quotes_disclose_live_or_delayed_type(self):
        reader = Mock(return_value=[{
            "providerSymbol": "AAPL",
            "price": 225.5,
            "previousClose": 223.0,
            "marketDataType": 1,
        }, {
            "providerSymbol": "MSFT",
            "price": 510.0,
            "previousClose": 508.0,
            "marketDataType": 3,
        }])

        result = read_broker_quotes(
            {"host": "127.0.0.1", "port": 7497, "clientId": 18},
            ["AAPL", "MSFT"],
            reader=reader,
        )

        self.assertEqual(result[0]["marketDataType"], "live")
        self.assertFalse(result[0]["delayed"])
        self.assertEqual(result[1]["marketDataType"], "delayed")
        self.assertTrue(result[1]["delayed"])
        self.assertEqual(result[0]["sourcePriority"], "ibkr-market-data")
        self.assertAlmostEqual(result[0]["changePercent"], (225.5 / 223.0 - 1) * 100, places=4)

    def test_ibkr_market_quotes_reject_non_loopback_and_invalid_symbols(self):
        with self.assertRaisesRegex(ValueError, "本机"):
            read_broker_quotes({"host": "example.com"}, ["AAPL"], reader=Mock())
        with self.assertRaisesRegex(ValueError, "美股"):
            read_broker_quotes({"host": "127.0.0.1"}, ["600519.SS"], reader=Mock())

    def test_ibkr_account_totals_prefer_base_currency_values(self):
        values = {
            "UnrealizedPnL": {"USD": "639.21", "BASE": "701.50"},
            "TotalCashValue": {"USD": "-1200", "CAD": "-1697.61"},
        }

        self.assertEqual(_pick_account_value(values, "UnrealizedPnL", "CAD"), "701.50")
        self.assertEqual(_pick_account_value(values, "TotalCashValue", "CAD"), "-1697.61")

    def test_ibkr_rejects_non_loopback_hosts(self):
        with self.assertRaisesRegex(ValueError, "本机"):
            read_broker_snapshot("ibkr", {"host": "example.com", "port": 7497})

    def test_ibkr_normalizes_a_read_only_position_snapshot(self):
        reader = Mock(return_value={
            "accountId": "U1234567",
            "currency": "USD",
            "positions": [{
                "symbol": "AAPL", "name": "Apple Inc.", "market": "NASDAQ",
                "currency": "USD", "quantity": 12, "averageCost": 181.5,
                "marketPrice": 190.0, "marketValue": 2280.0, "unrealizedPnl": 102.0,
                "realizedPnl": 14.5,
            }],
            "cash": 1000.0,
            "marketValue": 2280.0,
            "totalAsset": 3280.0,
            "unrealizedPnl": 140.0,
            "exchangeRates": {"USD": 1, "CAD": 0.72},
            "updatedAt": "15:01",
        })

        result = read_broker_snapshot(
            "ibkr",
            {"host": "127.0.0.1", "port": 7497, "clientId": 18},
            readers={"ibkr": reader},
        )

        self.assertEqual(result["sourceId"], "ibkr")
        self.assertTrue(result["readOnly"])
        self.assertEqual(result["account"]["maskedId"], "U1•••67")
        self.assertEqual(result["positions"][0]["symbol"], "AAPL")
        self.assertEqual(result["positions"][0]["marketPrice"], 190.0)
        self.assertEqual(result["positions"][0]["costBasis"], 2178.0)
        self.assertAlmostEqual(result["positions"][0]["unrealizedPnlPct"], 102.0 / 2178.0 * 100)
        self.assertEqual(result["positions"][0]["realizedPnl"], 14.5)
        self.assertEqual(result["account"]["marketValue"], 2280.0)
        self.assertEqual(result["account"]["unrealizedPnl"], 140.0)
        self.assertEqual(result["account"]["exchangeRates"]["CAD"], 0.72)
        self.assertEqual(result["account"]["updatedAt"], "15:01")
        self.assertEqual(result["meta"]["priceSource"], "IBKR TWS Account Window")
        self.assertEqual(result["meta"]["updateCadenceSeconds"], 180)
        self.assertNotIn("host", result)
        reader.assert_called_once()

    def test_qmt_requires_account_id_and_userdata_directory(self):
        with self.assertRaisesRegex(ValueError, "资金账号"):
            read_broker_snapshot("qmt", {"qmtPath": "D:/QMT/userdata_mini"})

    def test_qmt_snapshot_preserves_chinese_exchange_symbol(self):
        reader = Mock(return_value={
            "accountId": "12345678",
            "currency": "CNY",
            "cash": 50000,
            "totalAsset": 180000,
            "positions": [{
                "symbol": "000001.SZ", "name": "平安银行", "market": "深圳",
                "currency": "CNY", "quantity": 1000, "averageCost": 10.2,
                "marketValue": 11100,
            }],
        })

        result = read_broker_snapshot(
            "qmt",
            {"qmtPath": "D:/QMT/userdata_mini", "accountId": "12345678"},
            readers={"qmt": reader},
            path_validator=lambda _path: True,
        )

        self.assertEqual(result["positions"][0]["symbol"], "000001.SZ")
        self.assertEqual(result["account"]["maskedId"], "12•••78")
        self.assertEqual(result["account"]["totalAsset"], 180000)


if __name__ == "__main__":
    unittest.main()
