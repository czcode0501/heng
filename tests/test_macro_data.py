import unittest

from macro_data import (
    align_difference,
    parse_bls_payload,
    parse_eastmoney_series,
    parse_h15_csv,
    period_change,
    summarize_series,
    year_over_year,
)


class MacroDataContractTests(unittest.TestCase):
    def test_eastmoney_series_is_normalized_oldest_to_newest(self):
        payload = {
            "success": True,
            "result": {
                "data": [
                    {"REPORT_DATE": "2026-07-01 00:00:00", "NATIONAL_SAME": 0.5},
                    {"REPORT_DATE": "2026-06-01 00:00:00", "NATIONAL_SAME": 0.1},
                ]
            },
        }

        self.assertEqual(
            parse_eastmoney_series(payload, "NATIONAL_SAME"),
            [{"date": "2026-06", "value": 0.1}, {"date": "2026-07", "value": 0.5}],
        )

    def test_bls_series_and_derived_changes_use_calendar_order(self):
        values = [100 + month for month in range(1, 25)]
        rows = []
        for index, value in enumerate(values):
            year = 2024 + index // 12
            month = index % 12 + 1
            rows.append({"year": str(year), "period": f"M{month:02d}", "value": str(value)})
        payload = {
            "status": "REQUEST_SUCCEEDED",
            "Results": {"series": [{"seriesID": "CPI", "data": list(reversed(rows))}]},
        }

        parsed = parse_bls_payload(payload)["CPI"]
        yoy = year_over_year(parsed)
        mom = period_change(parsed)

        self.assertEqual(parsed[0], {"date": "2024-01", "value": 101.0})
        self.assertAlmostEqual(yoy[-1]["value"], (124 / 112 - 1) * 100, places=4)
        self.assertEqual(mom[-1]["value"], 1.0)

    def test_h15_parser_exposes_official_series_and_curve_spread(self):
        csv_text = """\"Series Description\",\"Fed funds\",\"2 year\",\"10 year\",\"10 year real\"\n\"Unit:\",\"Percent\",\"Percent\",\"Percent\",\"Percent\"\n\"Multiplier:\",\"1\",\"1\",\"1\",\"1\"\n\"Currency:\",\"NA\",\"NA\",\"NA\",\"NA\"\n\"Unique Identifier: \",\"H15/H15/RIFSPFF_N.M\",\"H15/H15/RIFLGFCY02_N.M\",\"H15/H15/RIFLGFCY10_N.M\",\"H15/H15/RIFLGFCY10_XII_N.M\"\n\"Time Period\",\"RIFSPFF_N.M\",\"RIFLGFCY02_N.M\",\"RIFLGFCY10_N.M\",\"RIFLGFCY10_XII_N.M\"\n2026-06,3.63,4.11,4.47,2.18\n2026-07,3.63,4.22,4.60,2.35\n"""

        parsed = parse_h15_csv(csv_text)
        curve = align_difference(parsed["RIFLGFCY10_N.M"], parsed["RIFLGFCY02_N.M"])

        self.assertEqual(parsed["RIFSPFF_N.M"][-1]["value"], 3.63)
        self.assertAlmostEqual(curve[-1]["value"], 0.38, places=4)

    def test_summary_reports_freshness_momentum_percentile_and_stage(self):
        series = [
            {"date": "2026-04", "value": 49.0},
            {"date": "2026-05", "value": 49.7},
            {"date": "2026-06", "value": 50.3},
            {"date": "2026-07", "value": 49.2},
        ]

        summary = summarize_series(series, stage_type="pmi")

        self.assertEqual(summary["date"], "2026-07")
        self.assertEqual(summary["direction"], "down")
        self.assertEqual(summary["stage"], "收缩区间")
        self.assertEqual(summary["observations"], 4)
        self.assertGreaterEqual(summary["percentile"], 0)
        self.assertLessEqual(summary["percentile"], 100)


if __name__ == "__main__":
    unittest.main()
