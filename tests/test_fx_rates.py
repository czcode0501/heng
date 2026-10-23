import unittest

import fx_rates


def rows(*closes):
    return [{"date": f"2026-10-{20 + index:02d}", "close": close} for index, close in enumerate(closes)]


class UsdCnyRateTests(unittest.TestCase):
    def setUp(self):
        fx_rates.reset_fx_cache()

    def test_latest_valid_close_is_returned_with_source_and_date(self):
        rate = fx_rates.get_usd_cny_rate(fetch=lambda symbols, force=False: {"CNY=X": rows(6.68, 6.6606)})

        self.assertEqual(rate["rate"], 6.6606)
        self.assertEqual(rate["asOf"], "2026-10-21")
        self.assertFalse(rate["stale"])
        self.assertIn("CNY=X", rate["source"])

    def test_implausible_quotes_are_skipped(self):
        rate = fx_rates.get_usd_cny_rate(fetch=lambda symbols, force=False: {"CNY=X": rows(6.67, 66.7)})
        self.assertEqual(rate["rate"], 6.67)

    def test_failure_returns_last_good_rate_marked_stale(self):
        fx_rates.get_usd_cny_rate(fetch=lambda symbols, force=False: {"CNY=X": rows(6.6606)})

        def broken(symbols, force=False):
            raise RuntimeError("network down")

        rate = fx_rates.get_usd_cny_rate(fetch=broken)
        self.assertEqual(rate["rate"], 6.6606)
        self.assertTrue(rate["stale"])

    def test_never_fetched_rate_is_reported_unavailable_instead_of_a_hardcoded_number(self):
        with self.assertRaises(LookupError):
            fx_rates.get_usd_cny_rate(fetch=lambda symbols, force=False: {})


if __name__ == "__main__":
    unittest.main()
