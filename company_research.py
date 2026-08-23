"""Dynamic company facts and news for the Quant Desk stock-analysis workspace."""

from __future__ import annotations

import json
import os
import re
import threading
import time
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from news_credentials import get_news_api_key


SUPPORTED_MARKETS = {"china", "united-states"}
SYMBOL_PATTERN = re.compile(r"^[A-Za-z0-9.-]{1,20}$")
PROVIDER_SYMBOL_PATTERN = re.compile(r"^[A-Za-z0-9.^=-]{1,20}(?:\.(?:SS|SZ|BJ))?$")
REFRESH_SECONDS = 10 * 60
CHINA_MARKET_TIMEZONE = timezone(timedelta(hours=8))
_CACHE: dict[tuple[str, str, str], tuple[float, dict]] = {}
_CACHE_LOCK = threading.Lock()
_SEC_TICKERS: tuple[float, dict[str, dict]] | None = None
_SEC_SUBMISSIONS: dict[str, tuple[float, dict]] = {}
_CACHE_DIRECTORY = Path(__file__).resolve().parent / ".cache" / "company-research"
_SEC_HEADERS = {
    "User-Agent": os.environ.get("SEC_USER_AGENT", "HengceQuantDesk/0.1 research-contact=local-development@example.com"),
    "Accept-Encoding": "identity",
}


def validate_company_request(market: str, symbol: str, provider_symbol: str) -> tuple[str, str, str]:
    normalized_market = str(market or "").strip().lower()
    normalized_symbol = str(symbol or "").strip().upper()
    normalized_provider = str(provider_symbol or "").strip().upper()
    if normalized_market not in SUPPORTED_MARKETS:
        raise ValueError("公司研究仅支持A股和美股")
    if not SYMBOL_PATTERN.fullmatch(normalized_symbol) or not PROVIDER_SYMBOL_PATTERN.fullmatch(normalized_provider):
        raise ValueError("股票代码格式不正确")
    if normalized_market == "china" and not re.fullmatch(r"\d{6}", normalized_symbol):
        raise ValueError("A股代码必须为6位数字")
    return normalized_market, normalized_symbol, normalized_provider


def validate_company_name(value: object) -> str | None:
    name = str(value or "").strip()
    if not name:
        return None
    if len(name) > 120 or any(ord(character) < 32 for character in name):
        raise ValueError("公司名称格式不正确")
    return name


def build_refresh_meta(*, now: datetime | None = None, refresh_after_seconds: int = REFRESH_SECONDS, cache_state: str = "miss") -> dict:
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    refresh_after_seconds = max(30, int(refresh_after_seconds))
    return {
        "fetchedAt": current.isoformat(),
        "nextRefreshAt": (current + timedelta(seconds=refresh_after_seconds)).isoformat(),
        "refreshAfterSeconds": refresh_after_seconds,
        "dynamic": True,
        "cacheState": cache_state,
    }


def build_financial_evidence(fundamentals: dict) -> dict:
    latest = ((fundamentals or {}).get("periods") or [{}])[0]
    source = (fundamentals or {}).get("source") or {}
    provider = source.get("label") or "unknown"
    authority = "primary" if source.get("quality") == "primary" else "independent"
    return {
        field: {"sources": [{"provider": provider, "authority": authority, "value": latest[field]}]}
        for field in ("revenue", "netIncome", "freeCashFlow", "assets", "liabilities")
        if latest.get(field) is not None
    }


def _entries(company_facts: dict, tags: tuple[str, ...]) -> list[dict]:
    facts = company_facts.get("facts", {}).get("us-gaap", {})
    for tag in tags:
        units = facts.get(tag, {}).get("units", {})
        for unit_name in ("USD", "USD/shares"):
            values = units.get(unit_name)
            if isinstance(values, list) and values:
                return [dict(item, _unit=unit_name) for item in values if item.get("end") and item.get("val") is not None]
    return []


def _latest_by_period(entries: list[dict]) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for entry in entries:
        if entry.get("form") not in {"10-K", "10-Q", "20-F", "40-F"}:
            continue
        key = str(entry.get("end"))
        current = result.get(key)
        if current is None or str(entry.get("filed") or "") > str(current.get("filed") or ""):
            result[key] = entry
    return result


def normalize_sec_company_facts(company_facts: dict, *, limit: int = 8) -> dict:
    metrics = {
        "revenue": _latest_by_period(_entries(company_facts, ("RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"))),
        "netIncome": _latest_by_period(_entries(company_facts, ("NetIncomeLoss", "ProfitLoss"))),
        "operatingCashFlow": _latest_by_period(_entries(company_facts, ("NetCashProvidedByUsedInOperatingActivities",))),
        "capex": _latest_by_period(_entries(company_facts, ("PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsForAdditionsToPropertyPlantAndEquipment"))),
        "assets": _latest_by_period(_entries(company_facts, ("Assets",))),
        "liabilities": _latest_by_period(_entries(company_facts, ("Liabilities",))),
        "equity": _latest_by_period(_entries(company_facts, ("StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"))),
        "epsDiluted": _latest_by_period(_entries(company_facts, ("EarningsPerShareDiluted",))),
    }
    period_keys = sorted({key for values in metrics.values() for key in values}, reverse=True)[: max(1, int(limit))]
    periods = []
    for period_end in period_keys:
        source_entries = [values[period_end] for values in metrics.values() if period_end in values]
        if not source_entries:
            continue
        record = {
            "periodEnd": period_end,
            "filedAt": max(str(item.get("filed") or "") for item in source_entries),
            "form": next((item.get("form") for item in source_entries if item.get("form")), None),
            "accessionNumber": next((item.get("accn") for item in source_entries if item.get("accn")), None),
            "currency": "USD",
        }
        for name, values in metrics.items():
            record[name] = values.get(period_end, {}).get("val")
        if record["operatingCashFlow"] is not None and record["capex"] is not None:
            record["freeCashFlow"] = record["operatingCashFlow"] - abs(record["capex"])
        else:
            record["freeCashFlow"] = None
        periods.append(record)
    return {
        "companyName": company_facts.get("entityName"),
        "status": "live" if periods else "unavailable",
        "periods": periods,
        "source": {
            "label": "SEC EDGAR Companyfacts",
            "url": "https://www.sec.gov/edgar/search/",
            "quality": "primary",
        },
    }


def _http_json(url: str, headers: dict | None = None, *, body: dict | None = None) -> dict | list:
    encoded = json.dumps(body).encode("utf-8") if body is not None else None
    request_headers = {"User-Agent": _SEC_HEADERS["User-Agent"], **(headers or {})}
    if body is not None:
        request_headers["Content-Type"] = "application/json"
    request = Request(url, data=encoded, headers=request_headers, method="POST" if body is not None else "GET")
    with urlopen(request, timeout=12) as response:
        return json.loads(response.read().decode("utf-8"))


def _sec_ticker_map() -> dict[str, dict]:
    global _SEC_TICKERS
    now = time.monotonic()
    if _SEC_TICKERS and now - _SEC_TICKERS[0] < 24 * 60 * 60:
        return _SEC_TICKERS[1]
    payload = _http_json("https://www.sec.gov/files/company_tickers.json", _SEC_HEADERS)
    mapping = {str(item.get("ticker") or "").upper(): item for item in payload.values() if item.get("ticker")}
    _SEC_TICKERS = (now, mapping)
    return mapping


def _sec_fundamentals(symbol: str) -> dict:
    listing = _sec_ticker_map().get(symbol)
    if not listing:
        return {"status": "unavailable", "periods": [], "reason": "SEC未找到该代码"}
    cik = str(listing["cik_str"]).zfill(10)
    payload = _http_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json", _SEC_HEADERS)
    result = normalize_sec_company_facts(payload)
    result["companyName"] = result.get("companyName") or listing.get("title")
    return result


_SEC_EVENT_FORMS = {"8-K", "10-Q", "10-K", "6-K", "20-F", "40-F", "DEF 14A"}
_SEC_EARNINGS_FORMS = {"10-Q", "10-K", "20-F", "40-F"}


def normalize_sec_submissions(submissions: dict, *, limit: int = 12) -> list[dict]:
    """Turn SEC's columnar submissions feed into user-facing official disclosures."""
    recent = submissions.get("filings", {}).get("recent", {})
    accessions = recent.get("accessionNumber") or []
    cik = re.sub(r"\D", "", str(submissions.get("cik") or "")).lstrip("0")
    events = []
    for index, accession in enumerate(accessions):
        def field(name: str) -> object:
            values = recent.get(name) or []
            return values[index] if index < len(values) else None

        form = str(field("form") or "").strip().upper()
        if form not in _SEC_EVENT_FORMS:
            continue
        accession_text = str(accession or "").strip()
        primary_document = str(field("primaryDocument") or "").strip()
        if (
            not cik
            or not re.fullmatch(r"[0-9-]+", accession_text)
            or not re.fullmatch(r"[A-Za-z0-9._-]+", primary_document)
            or primary_document in {".", ".."}
        ):
            filing_url = None
        else:
            filing_url = (
                "https://www.sec.gov/Archives/edgar/data/"
                f"{cik}/{accession_text.replace('-', '')}/{primary_document}"
            )
        description = str(field("primaryDocDescription") or "").strip()
        default_descriptions = {
            "8-K": "重大事项报告", "10-Q": "季度报告", "10-K": "年度报告",
            "6-K": "境外发行人报告", "20-F": "境外发行人年度报告",
            "40-F": "加拿大公司年度报告", "DEF 14A": "股东大会与委托投票材料",
        }
        display_description = default_descriptions.get(form, "公司官方披露") if description.upper() == form else description
        items = str(field("items") or "").strip()
        accepted_at = field("acceptanceDateTime") or field("filingDate")
        if form == "8-K":
            summary = "公司提交重大事项即时报告"
            if items:
                summary += f"；披露项目 {items}"
        elif form in _SEC_EARNINGS_FORMS:
            summary = f"公司提交 {form} 定期财务报告；请打开原文核验完整报表与管理层说明。"
        elif form == "DEF 14A":
            summary = "公司提交股东大会与委托投票材料，包含治理、薪酬或议案信息。"
        else:
            summary = f"公司提交 {form} 官方披露；请打开原文核验具体事项。"
        events.append({
            "title": f"{form} · {display_description or default_descriptions.get(form, '公司官方披露')}",
            "publisher": "SEC EDGAR · 官方公司披露",
            "publishedAt": accepted_at,
            "url": filing_url,
            "summary": summary,
            "category": "earnings" if form in _SEC_EARNINGS_FORMS else "company",
            "sourceType": "official-filing",
            "form": form,
            "accessionNumber": accession_text,
        })
        if len(events) >= max(1, int(limit)):
            break
    return events


def normalize_sec_company_profile(submissions: dict) -> dict:
    """Keep only SEC identity and industry facts; do not infer products or a moat from SIC."""
    business_address = (submissions.get("addresses") or {}).get("business") or {}
    location = ", ".join(filter(None, [
        business_address.get("city"),
        business_address.get("stateOrCountryDescription") or business_address.get("stateOrCountry"),
    ])) or None
    return {
        "companyName": submissions.get("name"),
        "industryCode": submissions.get("sic"),
        "industry": submissions.get("sicDescription"),
        "fiscalYearEnd": submissions.get("fiscalYearEnd"),
        "incorporation": submissions.get("stateOfIncorporationDescription") or submissions.get("stateOfIncorporation"),
        "headquarters": location,
        "formerNames": submissions.get("formerNames") or [],
        "products": [],
        "management": [],
        "source": {
            "label": "SEC EDGAR Submissions",
            "url": "https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
            "authority": "primary",
        },
    }


def _sec_submissions(symbol: str) -> dict:
    cached = _SEC_SUBMISSIONS.get(symbol)
    now = time.monotonic()
    if cached and now - cached[0] <= REFRESH_SECONDS:
        return cached[1]
    listing = _sec_ticker_map().get(symbol)
    if not listing:
        return {}
    cik = str(listing["cik_str"]).zfill(10)
    payload = _http_json(f"https://data.sec.gov/submissions/CIK{cik}.json", _SEC_HEADERS)
    _SEC_SUBMISSIONS[symbol] = (now, payload)
    return payload


def _sec_company_disclosures(symbol: str) -> list[dict]:
    return normalize_sec_submissions(_sec_submissions(symbol))


def _sec_company_profile(symbol: str) -> dict:
    return normalize_sec_company_profile(_sec_submissions(symbol))


def _iso_date(value: object) -> str | None:
    text = str(value or "").strip()
    if re.fullmatch(r"\d{8}", text):
        return f"{text[:4]}-{text[4:6]}-{text[6:8]}"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return text
    return None


def _safe_http_url(value: object) -> str | None:
    text = str(value or "").strip()
    try:
        parsed = urlparse(text)
    except ValueError:
        return None
    return text if parsed.scheme in {"https", "http"} and parsed.netloc else None


def _latest_rows_by_period(rows: list[dict]) -> dict[str, dict]:
    latest: dict[str, dict] = {}
    for row in rows or []:
        period = str(row.get("end_date") or "")
        if not re.fullmatch(r"\d{8}", period):
            continue
        current = latest.get(period)
        filed = str(row.get("f_ann_date") or row.get("ann_date") or "")
        current_filed = str((current or {}).get("f_ann_date") or (current or {}).get("ann_date") or "")
        if current is None or filed >= current_filed:
            latest[period] = row
    return latest


def _first_number(*values: object) -> int | float | None:
    for value in values:
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return value
    return None


def normalize_tushare_financials(
    *,
    income_rows: list[dict],
    balance_rows: list[dict],
    cashflow_rows: list[dict],
    company_name: str | None = None,
    limit: int = 8,
) -> dict:
    """Join Tushare's three audited statement tables without inventing missing fields."""
    income = _latest_rows_by_period(income_rows)
    balance = _latest_rows_by_period(balance_rows)
    cashflow = _latest_rows_by_period(cashflow_rows)
    periods = []
    for end_date in sorted(set(income) | set(balance) | set(cashflow), reverse=True)[: max(1, int(limit))]:
        income_row = income.get(end_date, {})
        balance_row = balance.get(end_date, {})
        cashflow_row = cashflow.get(end_date, {})
        operating_cash_flow = _first_number(cashflow_row.get("n_cashflow_act"))
        capex = _first_number(cashflow_row.get("c_pay_acq_const_fiolta"))
        filed_candidates = [
            str(row.get("f_ann_date") or row.get("ann_date") or "")
            for row in (income_row, balance_row, cashflow_row)
            if row
        ]
        periods.append({
            "periodEnd": _iso_date(end_date),
            "filedAt": _iso_date(max(filed_candidates)) if filed_candidates else None,
            "form": "A股定期报告",
            "currency": "CNY",
            "revenue": _first_number(income_row.get("revenue"), income_row.get("total_revenue")),
            "netIncome": _first_number(income_row.get("n_income_attr_p"), income_row.get("n_income")),
            "operatingCashFlow": operating_cash_flow,
            "capex": capex,
            "freeCashFlow": operating_cash_flow - abs(capex) if operating_cash_flow is not None and capex is not None else None,
            "assets": _first_number(balance_row.get("total_assets")),
            "liabilities": _first_number(balance_row.get("total_liab")),
            "equity": _first_number(balance_row.get("total_hldr_eqy_exc_min_int"), balance_row.get("total_hldr_eqy_inc_min_int")),
            "epsDiluted": _first_number(income_row.get("diluted_eps"), income_row.get("basic_eps")),
        })
    return {
        "companyName": company_name,
        "status": "live" if periods else "unavailable",
        "periods": periods,
        "source": {
            "label": "Tushare Pro 财务报表",
            "url": "https://tushare.pro/document/1?doc_id=108",
            "quality": "licensed-aggregator",
        },
    }


def normalize_tushare_company_profile(row: dict) -> dict:
    source = {
        "label": "Tushare Pro 上市公司基本信息",
        "url": "https://tushare.pro/document/2?doc_id=112",
        "authority": "licensed-aggregator",
    }
    products = []
    main_business = str(row.get("main_business") or "").strip()
    business_scope = str(row.get("business_scope") or "").strip()
    if main_business:
        products.append({"statement": main_business, "source": source})
    management = []
    if row.get("chairman"):
        management.append({"name": row["chairman"], "role": "董事长", "source": source})
    if row.get("manager"):
        management.append({"name": row["manager"], "role": "总经理", "source": source})
    location = " ".join(filter(None, [str(row.get("province") or "").strip(), str(row.get("city") or "").strip()])) or None
    return {
        "description": str(row.get("introduction") or "").strip() or None,
        "products": products,
        "businessScope": [{"statement": business_scope, "source": source}] if business_scope else [],
        "management": management,
        "employees": row.get("employees"),
        "headquarters": location,
        "website": _safe_http_url(row.get("website")),
        "source": source,
    }


def normalize_finnhub_news(items: list[dict], *, limit: int = 12) -> list[dict]:
    normalized = []
    for item in items or []:
        title = str(item.get("headline") or "").strip()
        if not title:
            continue
        timestamp = item.get("datetime")
        published_at = datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat() if isinstance(timestamp, (int, float)) else timestamp
        normalized.append({
            "title": title,
            "publisher": item.get("source") or "Finnhub",
            "publishedAt": published_at,
            "url": _safe_http_url(item.get("url")),
            "summary": item.get("summary") or "",
            "category": "earnings" if re.search(r"earnings|results|guidance|财报|业绩", title, re.I) else "company",
            "sourceType": "media-news",
            "providerId": "finnhub",
        })
    return normalized[: max(1, int(limit))]


def normalize_tushare_announcements(items: list[dict], *, limit: int = 12) -> list[dict]:
    normalized = []
    for item in items or []:
        title = str(item.get("title") or "").strip()
        if not title:
            continue
        published_at = item.get("rec_time") or _iso_date(item.get("ann_date"))
        if isinstance(published_at, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", published_at):
            published_at = published_at.replace(" ", "T") + "+08:00"
        normalized.append({
            "title": title,
            "publisher": "Tushare Pro · 上市公司公告",
            "publishedAt": published_at,
            "url": _safe_http_url(item.get("url")),
            "summary": f"{item.get('name') or '上市公司'}公告原文；请打开 PDF 核验完整内容。",
            "category": "earnings" if re.search(r"年报|季报|半年报|业绩|盈利|财务|报告", title, re.I) else "company",
            "sourceType": "official-announcement",
        })
    return normalized[: max(1, int(limit))]


def normalize_gnews_articles(items: list[dict], *, limit: int = 12) -> list[dict]:
    normalized = []
    for item in items or []:
        title = str(item.get("title") or "").strip()
        if not title:
            continue
        source = item.get("source") if isinstance(item.get("source"), dict) else {}
        description = str(item.get("description") or "").strip()
        normalized.append({
            "title": title,
            "publisher": source.get("name") or "GNews 媒体来源",
            "publishedAt": item.get("publishedAt"),
            "url": _safe_http_url(item.get("url")),
            "summary": description or "媒体来源未提供摘要，请打开原文核验。",
            "category": "earnings" if re.search(r"earnings|results|guidance|revenue|财报|业绩|营收|利润", f"{title} {description}", re.I) else "company",
            "sourceType": "media-news",
            "providerId": "gnews",
        })
    return normalized[: max(1, int(limit))]


def normalize_tushare_media_news(
    items: list[dict], *, company_name: str, symbol: str, limit: int = 12
) -> list[dict]:
    name = str(company_name or "").strip()
    code = str(symbol or "").strip()
    normalized = []
    for item in items or []:
        title = str(item.get("title") or "").strip()
        content = str(item.get("content") or "").strip()
        haystack = f"{title} {content}"
        if not title or not ((name and name in haystack) or (code and code in haystack)):
            continue
        published_at = str(item.get("datetime") or "").strip() or None
        if published_at and re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", published_at):
            published_at = published_at.replace(" ", "T") + "+08:00"
        normalized.append({
            "title": title,
            "publisher": item.get("_sourceLabel") or "Tushare Pro 财经快讯",
            "publishedAt": published_at,
            "url": None,
            "summary": content[:500] or "财经快讯未提供正文摘要。",
            "category": "earnings" if re.search(r"财报|业绩|营收|利润|盈利|指引", haystack, re.I) else "company",
            "sourceType": "media-news",
            "providerId": "tushare-news",
        })
    return normalized[: max(1, int(limit))]


def _tushare_rows(api_name: str, *, token: str, params: dict, fields: str) -> list[dict]:
    payload = _http_json(
        "https://api.tushare.pro",
        body={"api_name": api_name, "token": token, "params": params, "fields": fields},
    )
    if not isinstance(payload, dict) or payload.get("code") != 0:
        message = payload.get("msg") if isinstance(payload, dict) else "invalid response"
        raise RuntimeError(f"Tushare {api_name} failed: {message}")
    data = payload.get("data") or {}
    names = data.get("fields") or []
    return [dict(zip(names, values)) for values in (data.get("items") or [])]


def _tushare_symbol(provider_symbol: str) -> str:
    return provider_symbol.replace(".SS", ".SH")


def _tushare_fundamentals(provider_symbol: str, token: str) -> dict:
    ts_code = _tushare_symbol(provider_symbol)
    company_rows = _tushare_rows("stock_basic", token=token, params={"ts_code": ts_code}, fields="ts_code,name,fullname")
    company_name = (company_rows[0].get("name") or company_rows[0].get("fullname")) if company_rows else None
    income_rows = _tushare_rows(
        "income", token=token, params={"ts_code": ts_code},
        fields="ts_code,ann_date,f_ann_date,end_date,report_type,revenue,total_revenue,n_income,n_income_attr_p,basic_eps,diluted_eps",
    )
    balance_rows = _tushare_rows(
        "balancesheet", token=token, params={"ts_code": ts_code},
        fields="ts_code,ann_date,f_ann_date,end_date,report_type,total_assets,total_liab,total_hldr_eqy_exc_min_int,total_hldr_eqy_inc_min_int",
    )
    cashflow_rows = _tushare_rows(
        "cashflow", token=token, params={"ts_code": ts_code},
        fields="ts_code,ann_date,f_ann_date,end_date,report_type,n_cashflow_act,c_pay_acq_const_fiolta",
    )
    return normalize_tushare_financials(
        income_rows=income_rows,
        balance_rows=balance_rows,
        cashflow_rows=cashflow_rows,
        company_name=company_name,
    )


def _tushare_company_profile(provider_symbol: str, token: str) -> dict:
    ts_code = _tushare_symbol(provider_symbol)
    rows = _tushare_rows(
        "stock_company", token=token, params={"ts_code": ts_code},
        fields="ts_code,chairman,manager,province,city,website,employees,main_business,business_scope,introduction",
    )
    return normalize_tushare_company_profile(rows[0]) if rows else {}


def _tushare_company_announcements(provider_symbol: str, token: str) -> list[dict]:
    ts_code = _tushare_symbol(provider_symbol)
    today = datetime.now(timezone.utc).date()
    announcements = _tushare_rows(
        "anns_d", token=token,
        params={"ts_code": ts_code, "start_date": (today - timedelta(days=180)).strftime("%Y%m%d"), "end_date": today.strftime("%Y%m%d")},
        fields="ann_date,ts_code,name,title,url,rec_time",
    )
    return normalize_tushare_announcements(announcements)


def _tushare_company_media_news(company_name: str, symbol: str, token: str) -> list[dict]:
    # Tushare's news endpoint expects the source market's local wall-clock time.
    now = datetime.now(CHINA_MARKET_TIMEZONE)
    start = now - timedelta(days=3)
    rows = _tushare_rows(
        "news", token=token,
        params={
            "src": "eastmoney",
            "start_date": start.strftime("%Y-%m-%d %H:%M:%S"),
            "end_date": now.strftime("%Y-%m-%d %H:%M:%S"),
        },
        fields="datetime,content,title,channels",
    )
    labeled = [{**row, "_sourceLabel": "东方财富 · Tushare Pro"} for row in rows]
    return normalize_tushare_media_news(labeled, company_name=company_name, symbol=symbol)


def _finnhub_company_news(symbol: str, api_key: str) -> list[dict]:
    today = datetime.now(timezone.utc).date()
    query = urlencode({
        "symbol": symbol,
        "from": (today - timedelta(days=45)).isoformat(),
        "to": today.isoformat(),
    })
    payload = _http_json(
        f"https://finnhub.io/api/v1/company-news?{query}",
        headers={"X-Finnhub-Token": api_key},
    )
    if not isinstance(payload, list):
        raise RuntimeError("Finnhub company-news returned an invalid response")
    return normalize_finnhub_news(payload)


def _gnews_company_news(company_name: str, symbol: str, market: str, api_key: str) -> list[dict]:
    query_name = str(company_name or "").strip()
    query = f'"{query_name}"' if query_name and query_name.upper() != symbol.upper() else symbol
    params = {
        "q": query,
        "lang": "zh" if market == "china" else "en",
        "country": "cn" if market == "china" else "us",
        "max": 10,
        "in": "title,description",
        "apikey": api_key,
    }
    payload = _http_json(f"https://gnews.io/api/v4/search?{urlencode(params)}")
    if not isinstance(payload, dict) or not isinstance(payload.get("articles"), list):
        raise RuntimeError("GNews search returned an invalid response")
    return normalize_gnews_articles(payload["articles"])


def _merge_company_events(*groups: list[dict], limit: int = 24) -> list[dict]:
    merged = {}
    for group in groups:
        for event in group or []:
            identity = (
                event.get("sourceType"),
                event.get("accessionNumber") or event.get("url") or event.get("title"),
                event.get("publishedAt"),
            )
            merged[identity] = deepcopy(event)
    return sorted(
        merged.values(), key=lambda item: str(item.get("publishedAt") or ""), reverse=True
    )[: max(1, int(limit))]


def _provider_status(provider_id: str, label: str, channel: str, status: str, detail: str, *, url: str, update_mode: str) -> dict:
    return {
        "id": provider_id,
        "label": label,
        "channel": channel,
        "status": status,
        "detail": detail,
        "url": url,
        "updateMode": update_mode,
    }


def _gnews_channel(company_name: str, symbol: str, market: str) -> tuple[list[dict], dict, str | None]:
    api_key = get_news_api_key("gnews")
    if not api_key:
        return [], _provider_status(
            "gnews", "GNews", "媒体新闻", "not-configured",
            "设置 GNEWS_API_KEY 后补充两市场媒体报道；生产发布需使用 GNews 商业方案。",
            url="https://docs.gnews.io/endpoints/search-endpoint",
            update_mode="requires-api-key",
        ), None
    try:
        articles = _gnews_company_news(company_name, symbol, market, api_key)
        status = "live" if articles else "empty"
        detail = "全球媒体搜索已连接，按公司名称读取最新报道并每 10 分钟刷新。"
        error = None
    except Exception as exc:
        articles = []
        status = "error"
        detail = f"全球媒体搜索本次失败（{type(exc).__name__}）；系统会保留上次成功快照并重试。"
        error = type(exc).__name__
    return articles, _provider_status(
        "gnews", "GNews", "媒体新闻", status, detail,
        url="https://docs.gnews.io/endpoints/search-endpoint",
        update_mode="scheduled-10m",
    ), error


def _combined_news_status(official_events: list[dict], media_news: list[dict], providers: list[dict]) -> str:
    if official_events and media_news:
        return "live"
    if official_events:
        return "live-official-only"
    if media_news:
        return "live-media-only"
    news_providers = [provider for provider in providers if re.search(r"新闻|公告|披露", str(provider.get("channel") or ""))]
    if any(provider.get("status") == "error" for provider in news_providers):
        return "error"
    if news_providers and all(provider.get("status") == "not-configured" for provider in news_providers):
        return "not-configured"
    return "empty"


def _load_company_research(market: str, symbol: str, provider_symbol: str, company_name: str | None = None) -> dict:
    providers = []
    filings = []
    official_events = []
    media_news = []
    news_errors = []
    company_profile = {}
    if market == "united-states":
        fundamentals = _sec_fundamentals(symbol)
        resolved_company_name = fundamentals.get("companyName") or company_name or symbol
        providers.append(_provider_status(
            "sec", "SEC EDGAR", "财报与增长", fundamentals.get("status", "unavailable"),
            "官方 XBRL 披露，无需 API Key；随申报更新。",
            url="https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
            update_mode="filing-driven",
        ))
        try:
            company_profile = _sec_company_profile(symbol)
            profile_status = "live" if company_profile else "empty"
            profile_detail = "SEC 公司身份、行业与申报资料已连接；产品、市场份额与护城河仍需从原始年报及行业来源单独取证。"
        except Exception as error:
            profile_status = "error"
            profile_detail = f"SEC 公司画像本次读取失败（{type(error).__name__}）；财报链路不受影响。"
        providers.append(_provider_status(
            "sec-profile", "SEC EDGAR", "公司画像", profile_status, profile_detail,
            url="https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
            update_mode="filing-driven",
        ))
        try:
            filings = _sec_company_disclosures(symbol)
            official_events = filings
            disclosure_status = "live" if filings else "empty"
            disclosure_detail = "官方公司申报无需 API Key；随 EDGAR 申报实时更新，作为基础事件源。"
        except Exception as error:
            filings = []
            disclosure_status = "error"
            disclosure_detail = f"官方申报本次读取失败（{type(error).__name__}）；系统会在下一周期重试。"
        providers.append(_provider_status(
            "sec-submissions", "SEC EDGAR", "官方公司披露", disclosure_status,
            disclosure_detail,
            url="https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
            update_mode="filing-driven",
        ))
        finnhub_key = get_news_api_key("finnhub")
        if finnhub_key:
            try:
                finnhub_news = _finnhub_company_news(symbol, finnhub_key)
                media_news = _merge_company_events(media_news, finnhub_news, limit=18)
                media_status = "live" if finnhub_news else "empty"
                detail = "公司级新闻接口已连接；当前窗口内没有结果时不会解释为没有事件。"
            except Exception as error:
                media_status = "error"
                news_errors.append(type(error).__name__)
                detail = "公司新闻供应商本次检查失败；财报仍可使用，系统会在下一周期重试。"
            providers.append(_provider_status(
                "finnhub", "Finnhub", "媒体新闻", media_status,
                detail,
                url="https://www.finnhub.io/docs/api/company-news",
                update_mode="scheduled-10m",
            ))
        else:
            providers.append(_provider_status(
                "finnhub", "Finnhub", "媒体新闻", "not-configured",
                "设置 FINNHUB_API_KEY 后补充媒体报道；未配置不影响 SEC 官方公司披露持续更新。",
                url="https://www.finnhub.io/docs/api/company-news",
                update_mode="requires-api-key",
            ))
        gnews_articles, gnews_provider, gnews_error = _gnews_channel(resolved_company_name, symbol, market)
        media_news = _merge_company_events(media_news, gnews_articles, limit=18)
        providers.append(gnews_provider)
        if gnews_error:
            news_errors.append(gnews_error)
    else:
        tushare_token = os.environ.get("TUSHARE_TOKEN", "").strip()
        if tushare_token:
            try:
                fundamentals = _tushare_fundamentals(provider_symbol, tushare_token)
                fundamentals_status = fundamentals.get("status", "unavailable")
                fundamentals_detail = "利润表、资产负债表与现金流量表按报告期合并；随财报更新。"
            except Exception as error:
                fundamentals = {"status": "error", "periods": [], "reason": "Tushare 财务接口本次检查失败，系统会自动重试。"}
                fundamentals_status = "error"
                fundamentals_detail = f"财务接口检查失败（{type(error).__name__}）；公告链路不受影响。"
            resolved_company_name = fundamentals.get("companyName") or company_name or symbol
            try:
                company_profile = _tushare_company_profile(provider_symbol, tushare_token)
                profile_status = "live" if company_profile else "empty"
                profile_detail = "公司介绍、主营业务、经营范围、员工与主要管理者随上市公司基本资料更新。"
            except Exception as error:
                company_profile = {}
                profile_status = "error"
                profile_detail = f"公司画像接口检查失败（{type(error).__name__}）；财报与公告链路不受影响。"
            try:
                official_events = _tushare_company_announcements(provider_symbol, tushare_token)
                announcements_status = "live" if official_events else "empty"
                announcements_detail = "按股票代码读取上市公司公告与 PDF 原文链接。"
            except Exception as error:
                official_events = []
                announcements_status = "error"
                news_errors.append(type(error).__name__)
                announcements_detail = f"公告接口检查失败（{type(error).__name__}）；财务链路不受影响。"
            try:
                tushare_media = _tushare_company_media_news(resolved_company_name, symbol, tushare_token)
                media_news = _merge_company_events(media_news, tushare_media, limit=18)
                tushare_media_status = "live" if tushare_media else "empty"
                tushare_media_detail = "东方财富财经快讯已连接，并按公司名称或股票代码过滤相关报道。"
            except Exception as error:
                tushare_media_status = "error"
                news_errors.append(type(error).__name__)
                tushare_media_detail = f"财经快讯读取失败（{type(error).__name__}）；该接口需要单独新闻权限。"
            providers.extend([
                _provider_status(
                    "tushare-financials", "Tushare Pro", "财报与增长", fundamentals_status,
                    fundamentals_detail,
                    url="https://tushare.pro/document/1?doc_id=108",
                    update_mode="filing-driven",
                ),
                _provider_status(
                    "tushare-profile", "Tushare Pro", "公司画像", profile_status,
                    profile_detail,
                    url="https://tushare.pro/document/2?doc_id=112",
                    update_mode="filing-driven",
                ),
                _provider_status(
                    "tushare-announcements", "Tushare Pro", "官方公司披露", announcements_status,
                    announcements_detail,
                    url="https://tushare.pro/document/2?doc_id=176",
                    update_mode="scheduled-10m",
                ),
                _provider_status(
                    "tushare-news", "Tushare Pro", "媒体新闻", tushare_media_status,
                    tushare_media_detail,
                    url="https://tushare.pro/document/2?doc_id=143",
                    update_mode="scheduled-10m",
                ),
            ])
        else:
            fundamentals = {
                "status": "not-configured",
                "periods": [],
                "reason": "尚未配置 TUSHARE_TOKEN。配置并开通财务报表权限后，系统会按报告期持续刷新；当前不填入推测值。",
                "source": {"label": "Tushare Pro（待配置）", "url": "https://tushare.pro/document/1?doc_id=108", "quality": "licensed-aggregator"},
            }
            resolved_company_name = company_name or symbol
            company_profile = {}
            providers.extend([
                _provider_status(
                    "tushare-financials", "Tushare Pro", "财报与增长", "not-configured",
                    "设置 TUSHARE_TOKEN 并开通 income、balancesheet、cashflow 权限后启用。",
                    url="https://tushare.pro/document/1?doc_id=108",
                    update_mode="requires-token",
                ),
                _provider_status(
                    "tushare-profile", "Tushare Pro", "公司画像", "not-configured",
                    "设置 TUSHARE_TOKEN 并开通 stock_company 权限后读取主营业务、经营范围和管理层。",
                    url="https://tushare.pro/document/2?doc_id=112",
                    update_mode="requires-token",
                ),
                _provider_status(
                    "tushare-announcements", "Tushare Pro", "官方公司披露", "not-configured",
                    "设置 TUSHARE_TOKEN 并开通 anns_d 权限后启用。",
                    url="https://tushare.pro/document/2?doc_id=176",
                    update_mode="requires-token",
                ),
                _provider_status(
                    "tushare-news", "Tushare Pro", "媒体新闻", "not-configured",
                    "设置 TUSHARE_TOKEN 并单独开通 news 权限后读取主流财经媒体快讯。",
                    url="https://tushare.pro/document/2?doc_id=143",
                    update_mode="requires-token",
                ),
            ])
        gnews_articles, gnews_provider, gnews_error = _gnews_channel(resolved_company_name, symbol, market)
        media_news = _merge_company_events(media_news, gnews_articles, limit=18)
        providers.append(gnews_provider)
        if gnews_error:
            news_errors.append(gnews_error)
    news = _merge_company_events(media_news, official_events, limit=24)
    news_status = _combined_news_status(official_events, media_news, providers)
    return {
        "market": market,
        "symbol": symbol,
        "providerSymbol": provider_symbol,
        "companyName": resolved_company_name,
        "fundamentals": fundamentals,
        "financialEvidence": build_financial_evidence(fundamentals),
        "companyProfile": company_profile,
        "news": news,
        "mediaNews": media_news,
        "officialEvents": official_events,
        "filings": filings,
        "providers": providers,
        "newsStatus": news_status,
        "newsError": ", ".join(news_errors) or None,
        "meta": build_refresh_meta(),
    }


def _cache_file(key: tuple[str, str, str]) -> Path:
    market, symbol, provider_symbol = key
    safe_provider = re.sub(r"[^A-Za-z0-9.-]", "_", provider_symbol)
    return _CACHE_DIRECTORY / f"{market}-{symbol}-{safe_provider}.json"


def _read_disk_snapshot(key: tuple[str, str, str]) -> dict | None:
    try:
        payload = json.loads(_cache_file(key).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) and isinstance(payload.get("meta"), dict) else None


def _write_disk_snapshot(key: tuple[str, str, str], payload: dict) -> None:
    path = _cache_file(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def clear_company_research_cache() -> None:
    """Clear process memory between tests or explicit diagnostic runs."""
    with _CACHE_LOCK:
        _CACHE.clear()
    _SEC_SUBMISSIONS.clear()


def _reuse_failed_channels(current: dict, previous: dict | None) -> dict:
    if not previous:
        return current
    result = deepcopy(current)
    stale_channels = []

    profile_providers = [provider for provider in result.get("providers", []) if provider.get("channel") == "公司画像"]
    if not result.get("companyProfile") and previous.get("companyProfile") and any(provider.get("status") == "error" for provider in profile_providers):
        result["companyProfile"] = deepcopy(previous["companyProfile"])
        for provider in profile_providers:
            if provider.get("status") == "error":
                provider["status"] = "stale"
                provider["detail"] = "本次刷新失败，继续使用上次成功公司画像快照。"
        stale_channels.append("company-profile")

    if result.get("fundamentals", {}).get("status") == "error" and previous.get("fundamentals", {}).get("periods"):
        result["fundamentals"] = deepcopy(previous["fundamentals"])
        stale_channels.append("fundamentals")
        for provider in result.get("providers", []):
            if provider.get("channel") == "财报与增长":
                provider["status"] = "stale"
                provider["detail"] = "本次刷新失败，继续使用上次成功财报快照。"

    official_providers = [
        provider for provider in result.get("providers", [])
        if provider.get("id") in {"sec-submissions", "tushare-announcements"}
    ]
    previous_official = previous.get("officialEvents") or [
        event for event in previous.get("news", [])
        if event.get("sourceType") in {"official-filing", "official-announcement"}
    ]
    failed_official = [provider for provider in official_providers if provider.get("status") == "error"]
    if failed_official and previous_official:
        result["officialEvents"] = deepcopy(previous_official)
        if any(event.get("sourceType") == "official-filing" for event in previous_official):
            result["filings"] = [deepcopy(event) for event in previous_official if event.get("sourceType") == "official-filing"]
        current_media = result.get("mediaNews") or [event for event in result.get("news", []) if event.get("sourceType") == "media-news"]
        result["news"] = _merge_company_events(current_media, result["officialEvents"])
        result["newsStatus"] = "stale-partial"
        for provider in failed_official:
            provider["status"] = "stale"
            provider["detail"] = "本次刷新失败，继续使用上次成功的官方披露快照。"
        stale_channels.append("official-filings" if any(provider.get("id") == "sec-submissions" for provider in failed_official) else "official-events")

    media_providers = [provider for provider in result.get("providers", []) if provider.get("channel") == "媒体新闻"]
    current_media = result.get("mediaNews") or [event for event in result.get("news", []) if event.get("sourceType") == "media-news"]
    previous_media = previous.get("mediaNews") or [event for event in previous.get("news", []) if event.get("sourceType") == "media-news"]
    failed_media = [provider for provider in media_providers if provider.get("status") == "error"]
    if failed_media and not current_media and previous_media:
        result["mediaNews"] = deepcopy(previous_media)
        current_official = result.get("officialEvents") or [
            event for event in result.get("news", [])
            if event.get("sourceType") in {"official-filing", "official-announcement"}
        ]
        result["news"] = _merge_company_events(result["mediaNews"], current_official)
        result["newsStatus"] = "stale-partial"
        for provider in failed_media:
            provider["status"] = "stale"
            provider["detail"] = "本次刷新失败，继续使用上次成功的媒体新闻快照。"
        stale_channels.append("media-news")

    if result.get("newsStatus") == "error" and previous.get("news") and not {"official-filings", "media-news"}.intersection(stale_channels):
        result["news"] = deepcopy(previous["news"])
        result["mediaNews"] = deepcopy(previous.get("mediaNews", [event for event in previous["news"] if event.get("sourceType") == "media-news"]))
        result["officialEvents"] = deepcopy(previous.get("officialEvents", [event for event in previous["news"] if event.get("sourceType") != "media-news"]))
        result["filings"] = deepcopy(previous.get("filings", result.get("filings", [])))
        result["newsStatus"] = "stale"
        stale_channels.append("news")
        for provider in result.get("providers", []):
            if re.search(r"新闻|公告", str(provider.get("channel") or "")):
                provider["status"] = "stale"
                provider["detail"] = "本次刷新失败，继续使用上次成功公司事件快照。"
    if stale_channels:
        result["meta"] = {**result["meta"], "partialStale": True, "staleChannels": stale_channels}
    return result


def get_company_research(
    market: str, symbol: str, provider_symbol: str, *, company_name: str | None = None, force: bool = False
) -> dict:
    key = validate_company_request(market, symbol, provider_symbol)
    normalized_company_name = validate_company_name(company_name)
    now = time.monotonic()
    if not force:
        with _CACHE_LOCK:
            cached = _CACHE.get(key)
            if cached and now - cached[0] <= REFRESH_SECONDS:
                return {**cached[1], "meta": {**cached[1]["meta"], "cacheState": "hit"}}
    try:
        value = _load_company_research(*key, normalized_company_name)
    except Exception as error:
        with _CACHE_LOCK:
            cached = _CACHE.get(key)
        fallback = cached[1] if cached else _read_disk_snapshot(key)
        if fallback:
            return {
                **fallback,
                "meta": {
                    **fallback["meta"],
                    "cacheState": "stale-fallback",
                    "stale": True,
                    "refreshError": type(error).__name__,
                    "nextRefreshAt": (datetime.now(timezone.utc) + timedelta(seconds=60)).isoformat(),
                    "refreshAfterSeconds": 60,
                },
            }
        raise
    with _CACHE_LOCK:
        cached = _CACHE.get(key)
    previous = cached[1] if cached else _read_disk_snapshot(key)
    value = _reuse_failed_channels(value, previous)
    with _CACHE_LOCK:
        _CACHE[key] = (now, value)
    try:
        _write_disk_snapshot(key, value)
    except OSError:
        pass
    return value
