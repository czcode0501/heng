import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from data_sources import check_data_source, get_data_source_center
from news_credentials import (
    get_news_api_key,
    get_news_credential_status,
    save_news_credential,
)


class DataSourceCenterContractTests(unittest.TestCase):
    def test_catalog_exposes_free_and_four_optional_connector_types(self):
        center = get_data_source_center()

        self.assertEqual(
            [source["id"] for source in center["sources"]],
            ["free", "ibkr", "qmt", "ifind", "databento", "custom"],
        )
        self.assertEqual(center["routing"], {"china": "free", "united-states": "free"})
        self.assertTrue(center["fallbackToFree"])
        self.assertEqual(center["service"]["state"], "online")
        self.assertTrue(center["service"]["continuousRefresh"])
        self.assertIn("checkedAt", center["service"])
        self.assertEqual(center["routingStatus"]["china"]["state"], "ready")
        self.assertEqual(center["routingStatus"]["united-states"]["sourceId"], "free")

    def test_free_mode_is_ready_without_credentials(self):
        result = check_data_source("free", {})

        self.assertEqual(result["state"], "ready")
        self.assertTrue(result["readyForActivation"])
        self.assertFalse(result["credentialStored"])
        self.assertEqual(result["freshness"]["policy"], "latest-available-session")
        self.assertTrue(result["freshness"]["staleWhileRevalidate"])

    def test_databento_key_is_never_returned_or_serialized(self):
        secret = "db-secret-value-1234567890"
        result = check_data_source("databento", {"apiKey": secret})

        self.assertEqual(result["state"], "credential_ready")
        self.assertFalse(result["readyForActivation"])
        self.assertNotIn(secret, json.dumps(result))
        self.assertNotIn("apiKey", result.get("config", {}))
        self.assertFalse(result["credentialStored"])

    def test_ibkr_probe_is_limited_to_loopback_hosts(self):
        with self.assertRaises(ValueError):
            check_data_source("ibkr", {"host": "example.com", "port": 7497})

        with patch("data_sources._probe_tcp", return_value=True) as probe:
            result = check_data_source(
                "ibkr", {"host": "127.0.0.1", "port": 7497, "clientId": 18}
            )

        probe.assert_called_once_with("127.0.0.1", 7497)
        self.assertEqual(result["state"], "gateway_reachable")
        self.assertFalse(result["readyForActivation"])
        self.assertEqual(result["config"]["clientId"], 18)

    def test_custom_exchange_never_fetches_a_user_supplied_endpoint(self):
        result = check_data_source(
            "custom",
            {
                "exchangeName": "Example Exchange",
                "adapterId": "example_fix",
                "protocol": "FIX",
                "endpoint": "http://169.254.169.254/latest/meta-data",
            },
        )

        self.assertEqual(result["state"], "adapter_required")
        self.assertFalse(result["readyForActivation"])
        self.assertNotIn("endpoint", result["config"])

    def test_news_credentials_report_configuration_without_returning_secrets(self):
        secret = "finnhub-secret-value-123456"
        with TemporaryDirectory() as directory:
            status = get_news_credential_status(
                config_path=Path(directory) / "credentials.json",
                environ={"FINNHUB_API_KEY": secret, "GNEWS_API_KEY": ""},
            )

        serialized = json.dumps(status)
        self.assertTrue(status["finnhub"]["configured"])
        self.assertEqual(status["finnhub"]["source"], "environment")
        self.assertFalse(status["gnews"]["configured"])
        self.assertNotIn(secret, serialized)
        self.assertNotIn("apiKey", serialized)

    def test_news_credentials_are_saved_in_user_config_and_can_be_read_locally(self):
        secret = "gnews-secret-value-1234567890"
        checked = []
        with TemporaryDirectory() as directory:
            config_path = Path(directory) / "credentials.json"
            result = save_news_credential(
                "gnews",
                secret,
                config_path=config_path,
                environ={},
                validator=lambda provider, key: checked.append((provider, key)),
            )

            self.assertEqual(get_news_api_key("gnews", config_path=config_path, environ={}), secret)
            stored = config_path.read_text(encoding="utf-8")

        self.assertEqual(checked, [("gnews", secret)])
        self.assertTrue(result["configured"])
        self.assertEqual(result["source"], "local-user-config")
        self.assertNotIn(secret, json.dumps(result))
        self.assertIn(secret, stored)

    def test_news_credential_rejects_unknown_provider_and_malformed_key(self):
        with TemporaryDirectory() as directory:
            config_path = Path(directory) / "credentials.json"
            with self.assertRaises(ValueError):
                save_news_credential("unknown", "long-enough-secret", config_path=config_path)
            with self.assertRaises(ValueError):
                save_news_credential("finnhub", "bad key", config_path=config_path)

    def test_data_source_center_exposes_news_configuration_status_only(self):
        secret = "finnhub-secret-value-123456"
        with patch.dict(os.environ, {"FINNHUB_API_KEY": secret, "GNEWS_API_KEY": ""}, clear=False):
            center = get_data_source_center()

        self.assertTrue(center["newsCredentials"]["finnhub"]["configured"])
        self.assertNotIn(secret, json.dumps(center))


if __name__ == "__main__":
    unittest.main()
