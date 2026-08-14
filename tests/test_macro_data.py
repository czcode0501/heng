import unittest

from macro_data import (
    align_difference,
    analyze_macro_market,
    build_china_market,
    build_us_market,
    parse_bls_payload,
    parse_eastmoney_series,
    parse_h15_csv,
    period_change,
    summarize_series,
    year_over_year,
)


class MacroDataContractTests(unittest.TestCase):
    @staticmethod
    def eastmoney_payload(field, values):
        rows = [
            {"REPORT_DATE": f"{2024 + index // 12}-{index % 12 + 1:02d}-01 00:00:00", field: value}
            for index, value in enumerate(values)
        ]
        return {"success": True, "result": {"data": list(reversed(rows))}}

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

    def test_stage_labels_are_specific_to_the_indicator_meaning(self):
        points = [{"date": "2026-06", "value": 4.2}, {"date": "2026-07", "value": 4.1}]

        self.assertEqual(summarize_series(points, stage_type="unemployment")["stage"], "就业总体平稳")
        self.assertEqual(summarize_series(points, stage_type="policy_rate")["stage"], "政策利率偏高")
        self.assertEqual(summarize_series(points, stage_type="real_yield")["stage"], "实际利率偏高")

    def test_market_builders_emit_source_backed_chart_contracts(self):
        china_payloads = {
            "money": self.eastmoney_payload("CURRENCY_SAME", [4 + index / 10 for index in range(15)]),
            "pmi": self.eastmoney_payload("MAKE_INDEX", [49 + (index % 4) / 2 for index in range(15)]),
            "industrial": self.eastmoney_payload("BASE_SAME", [4 + index / 10 for index in range(15)]),
            "cpi": self.eastmoney_payload("NATIONAL_SAME", [0.2 + index / 20 for index in range(15)]),
            "ppi": self.eastmoney_payload("BASE_SAME", [-1 + index / 5 for index in range(15)]),
        }
        for row, value in zip(china_payloads["money"]["result"]["data"], reversed([6 + index / 10 for index in range(15)])):
            row["BASIC_CURRENCY_SAME"] = value

        bls_rows = []
        for series_id, base in (("CUUR0000SA0", 300), ("CUUR0000SA0L1E", 310), ("CES0000000001", 157000), ("LNS14000000", 4)):
            data = []
            for index in range(15):
                data.append({"year": str(2024 + index // 12), "period": f"M{index % 12 + 1:02d}", "value": str(base + index)})
            bls_rows.append({"seriesID": series_id, "data": list(reversed(data))})
        bls_payload = {"status": "REQUEST_SUCCEEDED", "Results": {"series": bls_rows}}
        h15_csv = """\"Time Period\",\"RIFSPFF_N.M\",\"RIFLGFCY02_N.M\",\"RIFLGFCY10_N.M\",\"RIFLGFCY10_XII_N.M\"\n2025-01,4.5,4.1,4.4,2.0\n2025-02,4.4,4.0,4.5,2.1\n"""

        china = build_china_market(china_payloads)
        united_states = build_us_market(bls_payload, h15_csv)

        self.assertEqual(len(china["indicators"]), 7)
        self.assertEqual(len(united_states["indicators"]), 7)
        self.assertEqual(china["indicators"][0]["source"]["name"], "东方财富数据中心")
        self.assertEqual(united_states["indicators"][0]["source"]["name"], "美国劳工统计局 BLS")
        self.assertTrue(all(indicator["points"] for indicator in china["indicators"] + united_states["indicators"]))
        self.assertTrue(all(len(indicator["points"]) <= 60 for indicator in china["indicators"] + united_states["indicators"]))
        self.assertEqual(china["analysis"]["market"], "china")
        self.assertEqual(united_states["analysis"]["market"], "united-states")
        self.assertEqual(len(china["analysis"]["dimensions"]), 3)
        self.assertTrue(china["analysis"]["strategies"])

    def test_macro_analysis_explains_regime_scores_and_strategy_bias(self):
        market = {
            "id": "china",
            "indicators": [
                {"id": "cn-m1-yoy", "name": "M1同比", "unit": "%", "summary": {"value": 4.0, "date": "2026-07"}},
                {"id": "cn-m2-yoy", "name": "M2同比", "unit": "%", "summary": {"value": 7.7, "date": "2026-07"}},
                {"id": "cn-pmi", "name": "制造业PMI", "unit": "", "summary": {"value": 49.2, "date": "2026-07"}},
                {"id": "cn-industrial-yoy", "name": "工业增加值同比", "unit": "%", "summary": {"value": 5.3, "date": "2026-06"}},
                {"id": "cn-cpi-yoy", "name": "CPI同比", "unit": "%", "summary": {"value": 0.5, "date": "2026-07"}},
                {"id": "cn-ppi-yoy", "name": "PPI同比", "unit": "%", "summary": {"value": 3.5, "date": "2026-07"}},
                {"id": "cn-ppi-cpi-gap", "name": "PPI－CPI剪刀差", "unit": "百分点", "summary": {"value": 3.0, "date": "2026-07"}},
            ],
        }

        analysis = analyze_macro_market(market)

        self.assertEqual(analysis["regimeCode"], "uneven-recovery")
        self.assertEqual(analysis["regime"], "结构性修复")
        self.assertEqual(analysis["modelVersion"], "macro-regime-v1")
        self.assertGreaterEqual(analysis["confidence"], 0)
        self.assertLessEqual(analysis["confidence"], 100)
        self.assertEqual({item["id"] for item in analysis["dimensions"]}, {"growth", "inflation", "liquidity"})
        self.assertTrue(all(-100 <= item["score"] <= 100 for item in analysis["dimensions"]))
        self.assertTrue(any(driver["indicator"] == "制造业PMI" for driver in analysis["drivers"]))
        self.assertTrue(all(strategy["rationale"] and strategy["risk"] for strategy in analysis["strategies"]))

    def test_restrictive_us_conditions_do_not_produce_an_aggressive_stance(self):
        values = {
            "us-core-cpi-yoy": ("核心CPI同比", 2.67, "%"),
            "us-cpi-yoy": ("CPI同比", 3.52, "%"),
            "us-fed-funds": ("联邦基金有效利率", 3.63, "%"),
            "us-payroll-change": ("非农就业月增量", -23, "千人"),
            "us-unemployment": ("失业率", 4.1, "%"),
            "us-real-yield-10y": ("美国10年期实际利率", 2.35, "%"),
            "us-curve-10y2y": ("10年－2年期限利差", 0.38, "百分点"),
        }
        market = {
            "id": "united-states",
            "indicators": [
                {"id": indicator_id, "name": name, "unit": unit, "summary": {"value": value, "date": "2026-07"}}
                for indicator_id, (name, value, unit) in values.items()
            ],
        }

        analysis = analyze_macro_market(market)

        self.assertEqual(analysis["regimeCode"], "late-cycle-cooling")
        self.assertEqual(analysis["stance"], "中性偏防守")


if __name__ == "__main__":
    unittest.main()
