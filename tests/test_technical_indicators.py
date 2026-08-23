import unittest

from technical_indicators import calculate_technical_indicators


def bar(date_text, close, volume=100, high=None, low=None):
    return {
        "time": f"{date_text}T10:00:00+08:00",
        "date": date_text,
        "open": close,
        "high": close if high is None else high,
        "low": close if low is None else low,
        "close": close,
        "volume": volume,
    }


class TechnicalIndicatorSeriesTests(unittest.TestCase):
    def test_rsi_uses_fourteen_bars_and_reaches_one_hundred_for_only_gains(self):
        rows = [bar(f"2026-07-{day:02d}", float(day)) for day in range(1, 21)]

        result = calculate_technical_indicators(rows)

        self.assertIsNone(result[13]["rsi14"])
        self.assertEqual(result[14]["rsi14"], 100.0)
        self.assertEqual(result[-1]["rsi14"], 100.0)

    def test_macd_is_zero_for_a_flat_price_series(self):
        rows = [bar(f"2026-07-{day:02d}", 100.0) for day in range(1, 31)]

        result = calculate_technical_indicators(rows)

        self.assertEqual(result[-1]["macd"], 0.0)
        self.assertEqual(result[-1]["macdSignal"], 0.0)
        self.assertEqual(result[-1]["macdHistogram"], 0.0)

    def test_range_vwap_weights_typical_price_by_volume(self):
        rows = [
            bar("2026-08-14", 10, volume=100, high=11, low=9),
            bar("2026-08-14", 20, volume=300, high=21, low=19),
        ]

        result = calculate_technical_indicators(rows, vwap_mode="range")

        self.assertEqual(result[0]["vwap"], 10.0)
        self.assertEqual(result[1]["vwap"], 17.5)

    def test_session_vwap_resets_when_the_trading_date_changes(self):
        rows = [
            bar("2026-08-13", 10, volume=100),
            bar("2026-08-14", 20, volume=300),
        ]

        result = calculate_technical_indicators(rows, vwap_mode="session")

        self.assertEqual(result[0]["vwap"], 10.0)
        self.assertEqual(result[1]["vwap"], 20.0)

    def test_range_vwap_can_start_after_hidden_indicator_warmup_rows(self):
        rows = [
            bar("2026-08-12", 5, volume=100),
            bar("2026-08-13", 10, volume=100),
            bar("2026-08-14", 20, volume=300),
        ]

        result = calculate_technical_indicators(
            rows,
            vwap_mode="range",
            vwap_start="2026-08-13T10:00:00+08:00",
        )

        self.assertIsNone(result[0]["vwap"])
        self.assertEqual(result[1]["vwap"], 10.0)
        self.assertEqual(result[2]["vwap"], 17.5)

    def test_existing_fields_are_preserved_in_new_row_objects(self):
        rows = [{**bar("2026-08-14", 10), "buyVolume": 70, "sellVolume": 30}]

        result = calculate_technical_indicators(rows)

        self.assertEqual(result[0]["buyVolume"], 70)
        self.assertEqual(result[0]["sellVolume"], 30)
        self.assertIsNot(result[0], rows[0])


if __name__ == "__main__":
    unittest.main()
