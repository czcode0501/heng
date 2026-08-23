import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from company_research import (
    _load_company_research,
    build_refresh_meta,
    build_financial_evidence,
    clear_company_research_cache,
    get_company_research,
    normalize_finnhub_news,
    normalize_gnews_articles,
    normalize_sec_company_facts,
    normalize_sec_company_profile,
    normalize_sec_submissions,
    normalize_tushare_announcements,
    normalize_tushare_financials,
    normalize_tushare_company_profile,
    normalize_tushare_media_news,
    validate_company_name,
    validate_company_request,
)


class CompanyResearchContractTests(unittest.TestCase):
    def test_company_request_accepts_supported_markets_and_rejects_unsafe_symbols(self):
        self.assertEqual(
            validate_company_request("united-states", "aapl", "AAPL"),
            ("united-states", "AAPL", "AAPL"),
        )
        self.assertEqual(
            validate_company_request("china", "600519", "600519.SS"),
            ("china", "600519", "600519.SS"),
        )
        with self.assertRaises(ValueError):
            validate_company_request("united-states", "../AAPL", "AAPL")
        with self.assertRaises(ValueError):
            validate_company_request("crypto", "BTC", "BTC-USD")

    def test_company_name_accepts_market_names_and_rejects_control_characters(self):
        self.assertEqual(validate_company_name(" 贵州茅台 "), "贵州茅台")
        self.assertEqual(validate_company_name("Apple Inc."), "Apple Inc.")
        self.assertIsNone(validate_company_name(""))
        with self.assertRaises(ValueError):
            validate_company_name("Apple\nInc.")
        with self.assertRaises(ValueError):
            validate_company_name("A" * 121)

    def test_refresh_metadata_is_derived_from_the_current_clock(self):
        now = datetime(2031, 4, 5, 12, 30, tzinfo=timezone.utc)
        meta = build_refresh_meta(now=now, refresh_after_seconds=600, cache_state="miss")

        self.assertEqual(meta["fetchedAt"], "2031-04-05T12:30:00+00:00")
        self.assertEqual(meta["nextRefreshAt"], "2031-04-05T12:40:00+00:00")
        self.assertEqual(meta["refreshAfterSeconds"], 600)
        self.assertTrue(meta["dynamic"])
        self.assertEqual(meta["cacheState"], "miss")

    def test_financial_evidence_preserves_single_source_without_claiming_dual_verification(self):
        evidence = build_financial_evidence({
            "periods": [{"revenue": 100, "netIncome": 12}],
            "source": {"label": "SEC EDGAR", "quality": "primary"},
        })

        self.assertEqual(evidence["revenue"]["sources"][0]["provider"], "SEC EDGAR")
        self.assertEqual(evidence["revenue"]["sources"][0]["authority"], "primary")
        self.assertEqual(len(evidence["revenue"]["sources"]), 1)

    def test_sec_company_facts_prefers_latest_filing_and_calculates_free_cash_flow(self):
        company_facts = {
            "entityName": "Example Inc.",
            "facts": {
                "us-gaap": {
                    "RevenueFromContractWithCustomerExcludingAssessedTax": {
                        "units": {"USD": [
                            {"start": "2030-01-01", "end": "2030-03-31", "val": 1000, "form": "10-Q", "fp": "Q1", "filed": "2030-04-20", "accn": "old", "frame": "CY2030Q1"},
                            {"start": "2030-01-01", "end": "2030-03-31", "val": 1100, "form": "10-Q", "fp": "Q1", "filed": "2030-04-25", "accn": "restated", "frame": "CY2030Q1"},
                        ]},
                    },
                    "NetIncomeLoss": {"units": {"USD": [
                        {"start": "2030-01-01", "end": "2030-03-31", "val": 160, "form": "10-Q", "fp": "Q1", "filed": "2030-04-25", "accn": "restated", "frame": "CY2030Q1"},
                    ]}},
                    "NetCashProvidedByUsedInOperatingActivities": {"units": {"USD": [
                        {"start": "2030-01-01", "end": "2030-03-31", "val": 240, "form": "10-Q", "fp": "Q1", "filed": "2030-04-25", "accn": "restated", "frame": "CY2030Q1"},
                    ]}},
                    "PaymentsToAcquirePropertyPlantAndEquipment": {"units": {"USD": [
                        {"start": "2030-01-01", "end": "2030-03-31", "val": 40, "form": "10-Q", "fp": "Q1", "filed": "2030-04-25", "accn": "restated", "frame": "CY2030Q1"},
                    ]}},
                    "Assets": {"units": {"USD": [
                        {"end": "2030-03-31", "val": 3000, "form": "10-Q", "fp": "Q1", "filed": "2030-04-25", "accn": "restated", "frame": "CY2030Q1I"},
                    ]}},
                }
            },
        }

        normalized = normalize_sec_company_facts(company_facts, limit=8)

        self.assertEqual(normalized["companyName"], "Example Inc.")
        self.assertEqual(len(normalized["periods"]), 1)
        latest = normalized["periods"][0]
        self.assertEqual(latest["revenue"], 1100)
        self.assertEqual(latest["netIncome"], 160)
        self.assertEqual(latest["freeCashFlow"], 200)
        self.assertEqual(latest["assets"], 3000)
        self.assertEqual(latest["filedAt"], "2030-04-25")
        self.assertEqual(latest["accessionNumber"], "restated")

    def test_tushare_financial_statements_are_joined_by_reporting_period(self):
        normalized = normalize_tushare_financials(
            income_rows=[
                {"end_date": "20301231", "ann_date": "20310320", "revenue": 1200, "n_income_attr_p": 180, "basic_eps": 1.8},
                {"end_date": "20291231", "ann_date": "20300318", "revenue": 1000, "n_income_attr_p": 140, "basic_eps": 1.4},
            ],
            balance_rows=[
                {"end_date": "20301231", "ann_date": "20310320", "total_assets": 3000, "total_liab": 1100, "total_hldr_eqy_exc_min_int": 1900},
            ],
            cashflow_rows=[
                {"end_date": "20301231", "ann_date": "20310320", "n_cashflow_act": 260, "c_pay_acq_const_fiolta": 60},
            ],
            company_name="示例公司",
        )

        self.assertEqual(normalized["status"], "live")
        self.assertEqual(normalized["source"]["label"], "Tushare Pro 财务报表")
        self.assertEqual(normalized["periods"][0]["periodEnd"], "2030-12-31")
        self.assertEqual(normalized["periods"][0]["revenue"], 1200)
        self.assertEqual(normalized["periods"][0]["freeCashFlow"], 200)
        self.assertEqual(normalized["periods"][0]["currency"], "CNY")

    def test_company_news_normalizers_preserve_source_and_dynamic_publish_time(self):
        finnhub = normalize_finnhub_news([{
            "headline": "Example raises guidance",
            "source": "Example Wire",
            "datetime": 1924992000,
            "summary": "Demand improved.",
            "url": "https://example.com/item",
            "category": "company",
        }])
        tushare = normalize_tushare_announcements([{
            "title": "示例公司年度报告",
            "name": "示例公司",
            "ann_date": "20310320",
            "rec_time": "2031-03-20 18:30:00",
            "url": "https://example.cn/report.pdf",
        }])

        self.assertEqual(finnhub[0]["publisher"], "Example Wire")
        self.assertTrue(finnhub[0]["publishedAt"].endswith("+00:00"))
        self.assertEqual(tushare[0]["publisher"], "Tushare Pro · 上市公司公告")
        self.assertEqual(tushare[0]["category"], "earnings")
        self.assertIn("2031-03-20", tushare[0]["publishedAt"])

        unsafe = normalize_finnhub_news([{"headline": "Unsafe", "datetime": 1924992000, "url": "javascript:alert(1)"}])
        self.assertIsNone(unsafe[0]["url"])

    def test_global_and_a_share_media_news_normalizers_keep_article_provenance(self):
        gnews = normalize_gnews_articles([{
            "title": "Apple expands services business",
            "description": "Apple Inc. announced a new services partnership.",
            "url": "https://example.com/apple-services",
            "publishedAt": "2031-08-22T10:30:00Z",
            "source": {"name": "Example Business", "url": "https://example.com"},
        }])
        tushare = normalize_tushare_media_news([{
            "title": "贵州茅台回应市场关切",
            "content": "贵州茅台在业绩说明会上回应渠道库存问题。",
            "datetime": "2031-08-22 18:30:00",
            "_sourceLabel": "东方财富",
        }], company_name="贵州茅台", symbol="600519")

        self.assertEqual(gnews[0]["sourceType"], "media-news")
        self.assertEqual(gnews[0]["providerId"], "gnews")
        self.assertEqual(gnews[0]["publisher"], "Example Business")
        self.assertEqual(tushare[0]["sourceType"], "media-news")
        self.assertEqual(tushare[0]["providerId"], "tushare-news")
        self.assertEqual(tushare[0]["publisher"], "东方财富")
        self.assertIn("2031-08-22", tushare[0]["publishedAt"])

    def test_media_news_chain_is_available_for_both_us_and_china_markets(self):
        media = [{
            "title": "Company media report", "publishedAt": "2031-08-22T10:00:00Z",
            "url": "https://example.com/report", "sourceType": "media-news", "providerId": "gnews",
        }]
        with patch.dict("os.environ", {"GNEWS_API_KEY": "test-key", "FINNHUB_API_KEY": "", "TUSHARE_TOKEN": ""}, clear=False):
            with patch("company_research._sec_fundamentals", return_value={"status": "live", "companyName": "Apple Inc.", "periods": []}), \
                 patch("company_research._sec_company_profile", return_value={"industry": "Technology"}), \
                 patch("company_research._sec_company_disclosures", return_value=[]), \
                 patch("company_research._gnews_company_news", return_value=media):
                us = _load_company_research("united-states", "AAPL", "AAPL", "Apple Inc.")
            with patch("company_research._gnews_company_news", return_value=media):
                china = _load_company_research("china", "600519", "600519.SS", "贵州茅台")

        self.assertEqual(us["mediaNews"][0]["providerId"], "gnews")
        self.assertEqual(china["mediaNews"][0]["providerId"], "gnews")
        self.assertEqual(us["newsStatus"], "live-media-only")
        self.assertEqual(china["newsStatus"], "live-media-only")
        self.assertTrue(any(provider["id"] == "gnews" and provider["status"] == "live" for provider in us["providers"]))
        self.assertTrue(any(provider["id"] == "gnews" and provider["status"] == "live" for provider in china["providers"]))

    def test_sec_submissions_become_official_company_disclosure_events(self):
        submissions = {
            "cik": "0000320193",
            "name": "Example Inc.",
            "filings": {
                "recent": {
                    "accessionNumber": ["0000320193-31-000101", "0000320193-31-000099", "0000320193-31-000098"],
                    "filingDate": ["2031-08-21", "2031-08-20", "2031-08-19"],
                    "reportDate": ["2031-08-21", "2031-06-30", "2031-08-19"],
                    "acceptanceDateTime": ["2031-08-21T16:04:12.000Z", "2031-08-20T17:30:00.000Z", "2031-08-19T12:00:00.000Z"],
                    "form": ["8-K", "10-Q", "4"],
                    "items": ["2.02,9.01", "", ""],
                    "primaryDocument": ["event.htm", "quarter.htm", "ownership.xml"],
                    "primaryDocDescription": ["Current report", "Quarterly report", "Statement of changes"],
                }
            },
        }

        events = normalize_sec_submissions(submissions, limit=12)

        self.assertEqual(len(events), 2)
        self.assertEqual(events[0]["sourceType"], "official-filing")
        self.assertEqual(events[0]["publisher"], "SEC EDGAR · 官方公司披露")
        self.assertIn("8-K", events[0]["title"])
        self.assertIn("2.02", events[0]["summary"])
        self.assertEqual(events[1]["category"], "earnings")
        self.assertEqual(
            events[0]["url"],
            "https://www.sec.gov/Archives/edgar/data/320193/000032019331000101/event.htm",
        )

    def test_company_profiles_preserve_products_management_and_source_provenance(self):
        sec = normalize_sec_company_profile({
            "name": "Example Inc.", "sic": "3571", "sicDescription": "Electronic Computers",
            "fiscalYearEnd": "0928", "stateOfIncorporationDescription": "California",
            "addresses": {"business": {"city": "Cupertino", "stateOrCountryDescription": "California"}},
            "formerNames": [{"name": "Example Computer Inc.", "from": "1980", "to": "2000"}],
        })
        tushare = normalize_tushare_company_profile({
            "chairman": "示例董事长", "manager": "示例总经理", "employees": 12000,
            "main_business": "研发、制造与销售高端设备", "business_scope": "设备与软件服务",
            "introduction": "服务全球工业客户。", "province": "广东", "city": "深圳市",
        })

        self.assertEqual(sec["industry"], "Electronic Computers")
        self.assertEqual(sec["source"]["authority"], "primary")
        self.assertEqual(tushare["products"][0]["statement"], "研发、制造与销售高端设备")
        self.assertEqual(tushare["management"][0]["role"], "董事长")
        self.assertEqual(tushare["employees"], 12000)
        self.assertEqual(tushare["source"]["authority"], "licensed-aggregator")

    def test_failed_forced_refresh_returns_last_successful_snapshot(self):
        clear_company_research_cache()
        successful = {
            "market": "united-states",
            "symbol": "AAPL",
            "providerSymbol": "AAPL",
            "companyName": "Apple Inc.",
            "fundamentals": {"status": "live", "periods": [{"periodEnd": "2030-12-31", "revenue": 1}]},
            "news": [],
            "providers": [],
            "meta": build_refresh_meta(),
        }
        with patch("company_research._load_company_research", return_value=successful):
            first = get_company_research("united-states", "AAPL", "AAPL")
        with patch("company_research._load_company_research", side_effect=TimeoutError("provider timeout")):
            fallback = get_company_research("united-states", "AAPL", "AAPL", force=True)

        self.assertEqual(first["companyName"], "Apple Inc.")
        self.assertEqual(fallback["companyName"], "Apple Inc.")
        self.assertEqual(fallback["meta"]["cacheState"], "stale-fallback")
        self.assertTrue(fallback["meta"]["stale"])
        self.assertEqual(fallback["meta"]["refreshError"], "TimeoutError")

    def test_one_failed_channel_reuses_only_its_last_successful_data(self):
        clear_company_research_cache()
        successful = {
            "market": "united-states", "symbol": "AAPL", "providerSymbol": "AAPL", "companyName": "Apple Inc.",
            "fundamentals": {"status": "live", "periods": [{"periodEnd": "2030-12-31", "revenue": 1}]},
            "news": [{"title": "Last good event", "url": "https://example.com/event"}],
            "newsStatus": "live",
            "providers": [{"id": "finnhub", "channel": "公司新闻", "status": "live", "detail": "live"}],
            "meta": build_refresh_meta(),
        }
        partial_failure = {
            **successful,
            "news": [],
            "newsStatus": "error",
            "providers": [{"id": "finnhub", "channel": "公司新闻", "status": "error", "detail": "failed"}],
            "meta": build_refresh_meta(),
        }
        with patch("company_research._load_company_research", return_value=successful):
            get_company_research("united-states", "AAPL", "AAPL")
        with patch("company_research._load_company_research", return_value=partial_failure):
            merged = get_company_research("united-states", "AAPL", "AAPL", force=True)

        self.assertEqual(merged["news"][0]["title"], "Last good event")
        self.assertEqual(merged["newsStatus"], "stale")
        self.assertTrue(merged["meta"]["partialStale"])
        self.assertEqual(merged["providers"][0]["status"], "stale")

    def test_failed_sec_disclosure_channel_keeps_its_last_snapshot_when_media_is_live(self):
        clear_company_research_cache()
        filing = {
            "title": "8-K · Current report", "publishedAt": "2031-08-21T16:00:00Z",
            "url": "https://www.sec.gov/Archives/example.htm", "sourceType": "official-filing",
        }
        media = {
            "title": "Current media report", "publishedAt": "2031-08-22T10:00:00Z",
            "url": "https://example.com/media", "sourceType": "media-news",
        }
        successful = {
            "market": "united-states", "symbol": "AAPL", "providerSymbol": "AAPL", "companyName": "Apple Inc.",
            "fundamentals": {"status": "live", "periods": [{"periodEnd": "2030-12-31", "revenue": 1}]},
            "filings": [filing], "news": [filing, media], "newsStatus": "live",
            "providers": [
                {"id": "sec-submissions", "channel": "官方公司披露", "status": "live", "detail": "live"},
                {"id": "finnhub", "channel": "媒体新闻", "status": "live", "detail": "live"},
            ],
            "meta": build_refresh_meta(),
        }
        partial_failure = {
            **successful,
            "filings": [], "news": [media], "newsStatus": "live-media-only",
            "providers": [
                {"id": "sec-submissions", "channel": "官方公司披露", "status": "error", "detail": "failed"},
                {"id": "finnhub", "channel": "媒体新闻", "status": "live", "detail": "live"},
            ],
            "meta": build_refresh_meta(),
        }
        with patch("company_research._load_company_research", return_value=successful):
            get_company_research("united-states", "AAPL", "AAPL")
        with patch("company_research._load_company_research", return_value=partial_failure):
            merged = get_company_research("united-states", "AAPL", "AAPL", force=True)

        self.assertEqual(merged["filings"][0]["title"], "8-K · Current report")
        self.assertEqual([item["title"] for item in merged["news"]], ["Current media report", "8-K · Current report"])
        self.assertEqual(merged["providers"][0]["status"], "stale")
        self.assertIn("official-filings", merged["meta"]["staleChannels"])


if __name__ == "__main__":
    unittest.main()
