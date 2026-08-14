"""Source-backed macroeconomic data pipeline for the Quant Desk."""

from __future__ import annotations

import csv
import io
import json
import math
import threading
import time
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen


CACHE_TTL_SECONDS = 6 * 60 * 60
ERROR_CACHE_TTL_SECONDS = 15 * 60
REQUEST_TIMEOUT_SECONDS = 10
EASTMONEY_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get"
BLS_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
H15_URL = (
    "https://www.federalreserve.gov/datadownload/Output.aspx?"
    "rel=H15&series=d7e27b7b09a3a7feae95b9c61781fcd8&lastobs=36&from=&to=&"
    "filetype=csv&label=include&layout=seriescolumn&type=package"
)
_CACHE_LOCK = threading.Lock()
_CACHE: dict[str, object] = {"expires": 0.0, "data": None}


def _point(date: str, value: object) -> dict[str, float | str] | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return {"date": date[:7], "value": round(number, 6)}


def _sorted_points(points: Iterable[dict]) -> list[dict]:
    deduplicated = {point["date"]: point for point in points if point}
    return [deduplicated[key] for key in sorted(deduplicated)]


def parse_eastmoney_series(payload: dict, field: str) -> list[dict]:
    if payload.get("success") is not True:
        raise ValueError(payload.get("message") or "东方财富宏观接口返回失败")
    rows = (payload.get("result") or {}).get("data") or []
    points = []
    for row in rows:
        date = str(row.get("REPORT_DATE") or "")
        if date:
            points.append(_point(date, row.get(field)))
    result = _sorted_points(points)
    if not result:
        raise ValueError(f"东方财富字段 {field} 没有有效数据")
    return result


def parse_bls_payload(payload: dict) -> dict[str, list[dict]]:
    if payload.get("status") != "REQUEST_SUCCEEDED":
        message = "; ".join(payload.get("message") or [])
        raise ValueError(message or "BLS 接口返回失败")
    parsed = {}
    for series in (payload.get("Results") or {}).get("series") or []:
        points = []
        for row in series.get("data") or []:
            period = str(row.get("period") or "")
            if not period.startswith("M") or period == "M13":
                continue
            date = f"{row.get('year')}-{period[1:]}"
            points.append(_point(date, row.get("value")))
        parsed[str(series.get("seriesID"))] = _sorted_points(points)
    return parsed


def parse_h15_csv(csv_text: str) -> dict[str, list[dict]]:
    rows = list(csv.reader(io.StringIO(csv_text)))
    header_index = next(
        (index for index, row in enumerate(rows) if row and row[0].strip() == "Time Period"),
        None,
    )
    if header_index is None:
        raise ValueError("美联储 H.15 CSV 缺少时间序列表头")
    headers = rows[header_index]
    parsed = {name: [] for name in headers[1:] if name}
    for row in rows[header_index + 1 :]:
        if not row or not row[0]:
            continue
        date = row[0].strip()[:7]
        for index, series_id in enumerate(headers[1:], start=1):
            value = row[index] if index < len(row) else None
            point = _point(date, value)
            if series_id and point:
                parsed[series_id].append(point)
    return {series_id: _sorted_points(points) for series_id, points in parsed.items()}


def year_over_year(points: list[dict], periods: int = 12) -> list[dict]:
    result = []
    for index in range(periods, len(points)):
        previous = float(points[index - periods]["value"])
        current = float(points[index]["value"])
        if previous:
            result.append({"date": points[index]["date"], "value": round((current / previous - 1) * 100, 6)})
    return result


def period_change(points: list[dict], periods: int = 1) -> list[dict]:
    return [
        {
            "date": points[index]["date"],
            "value": round(float(points[index]["value"]) - float(points[index - periods]["value"]), 6),
        }
        for index in range(periods, len(points))
    ]


def align_difference(left: list[dict], right: list[dict]) -> list[dict]:
    right_by_date = {point["date"]: float(point["value"]) for point in right}
    return [
        {"date": point["date"], "value": round(float(point["value"]) - right_by_date[point["date"]], 6)}
        for point in left
        if point["date"] in right_by_date
    ]


def _stage(value: float, stage_type: str) -> str:
    if stage_type == "pmi":
        return "扩张区间" if value >= 50 else "收缩区间"
    if stage_type == "inflation":
        if value < 0:
            return "价格收缩"
        if value < 1:
            return "低通胀"
        if value <= 3:
            return "温和通胀"
        return "通胀偏高"
    if stage_type == "curve":
        return "曲线正常" if value >= 0 else "曲线倒挂"
    if stage_type == "growth":
        return "同比增长" if value >= 0 else "同比收缩"
    return "高于零轴" if value >= 0 else "低于零轴"


def summarize_series(points: list[dict], stage_type: str = "growth") -> dict:
    if not points:
        raise ValueError("时间序列不能为空")
    values = [float(point["value"]) for point in points]
    latest = values[-1]
    comparison_index = max(0, len(values) - 2)
    movement = latest - values[comparison_index]
    tolerance = max(0.01, (max(values) - min(values)) * 0.02)
    direction = "flat" if abs(movement) <= tolerance else ("up" if movement > 0 else "down")
    rank = sum(value <= latest for value in values)
    percentile = round(rank / len(values) * 100)
    previous = values[-2] if len(values) > 1 else None
    return {
        "date": points[-1]["date"],
        "value": round(latest, 4),
        "previous": round(previous, 4) if previous is not None else None,
        "change": round(latest - previous, 4) if previous is not None else None,
        "direction": direction,
        "percentile": percentile,
        "stage": _stage(latest, stage_type),
        "observations": len(points),
    }


CHINA_SOURCE = {
    "name": "东方财富数据中心",
    "original": "国家统计局 / 中国人民银行",
    "url": "https://data.eastmoney.com/cjsj/",
}
BLS_SOURCE = {
    "name": "美国劳工统计局 BLS",
    "original": "BLS Public Data API",
    "url": "https://www.bls.gov/developers/",
}
FED_SOURCE = {
    "name": "美国联邦储备委员会",
    "original": "H.15 Selected Interest Rates",
    "url": "https://www.federalreserve.gov/releases/h15/",
}


def _indicator(
    indicator_id: str,
    group: str,
    name: str,
    points: list[dict],
    *,
    unit: str,
    frequency: str,
    source: dict,
    stage_type: str,
    benchmark: float | None = 0,
) -> dict:
    if not points:
        raise ValueError(f"{name} 没有足够的有效数据")
    chart_points = points[-24:]
    return {
        "id": indicator_id,
        "group": group,
        "name": name,
        "unit": unit,
        "frequency": frequency,
        "benchmark": benchmark,
        "source": source,
        "summary": summarize_series(chart_points, stage_type=stage_type),
        "points": chart_points,
    }


def build_china_market(payloads: dict[str, dict]) -> dict:
    m1 = parse_eastmoney_series(payloads["money"], "CURRENCY_SAME")
    m2 = parse_eastmoney_series(payloads["money"], "BASIC_CURRENCY_SAME")
    pmi = parse_eastmoney_series(payloads["pmi"], "MAKE_INDEX")
    industrial = parse_eastmoney_series(payloads["industrial"], "BASE_SAME")
    cpi = parse_eastmoney_series(payloads["cpi"], "NATIONAL_SAME")
    ppi = parse_eastmoney_series(payloads["ppi"], "BASE_SAME")
    price_gap = align_difference(ppi, cpi)
    return {
        "id": "china",
        "code": "CN",
        "title": "中国宏观环境",
        "status": "live",
        "indicators": [
            _indicator("cn-m1-yoy", "货币与信用", "M1同比", m1, unit="%", frequency="月度", source=CHINA_SOURCE, stage_type="growth"),
            _indicator("cn-m2-yoy", "货币与信用", "M2同比", m2, unit="%", frequency="月度", source=CHINA_SOURCE, stage_type="growth"),
            _indicator("cn-pmi", "增长周期", "制造业PMI", pmi, unit="", frequency="月度", source=CHINA_SOURCE, stage_type="pmi", benchmark=50),
            _indicator("cn-industrial-yoy", "增长周期", "规模以上工业增加值同比", industrial, unit="%", frequency="月度", source=CHINA_SOURCE, stage_type="growth"),
            _indicator("cn-cpi-yoy", "通胀与盈利", "CPI同比", cpi, unit="%", frequency="月度", source=CHINA_SOURCE, stage_type="inflation"),
            _indicator("cn-ppi-yoy", "通胀与盈利", "PPI同比", ppi, unit="%", frequency="月度", source=CHINA_SOURCE, stage_type="inflation"),
            _indicator("cn-ppi-cpi-gap", "通胀与盈利", "PPI－CPI剪刀差", price_gap, unit="百分点", frequency="月度", source=CHINA_SOURCE, stage_type="growth"),
        ],
    }


def build_us_market(bls_payload: dict, h15_csv: str) -> dict:
    bls = parse_bls_payload(bls_payload)
    h15 = parse_h15_csv(h15_csv)
    cpi = year_over_year(bls["CUSR0000SA0"])
    core_cpi = year_over_year(bls["CUSR0000SA0L1E"])
    payroll_change = period_change(bls["CES0000000001"])
    unemployment = bls["LNS14000000"]
    fed_funds = h15["RIFSPFF_N.M"]
    real_yield = h15["RIFLGFCY10_XII_N.M"]
    curve = align_difference(h15["RIFLGFCY10_N.M"], h15["RIFLGFCY02_N.M"])
    return {
        "id": "united-states",
        "code": "US",
        "title": "美国宏观环境",
        "status": "live",
        "indicators": [
            _indicator("us-core-cpi-yoy", "通胀与美联储", "核心CPI同比", core_cpi, unit="%", frequency="月度", source=BLS_SOURCE, stage_type="inflation"),
            _indicator("us-cpi-yoy", "通胀与美联储", "CPI同比", cpi, unit="%", frequency="月度", source=BLS_SOURCE, stage_type="inflation"),
            _indicator("us-fed-funds", "通胀与美联储", "联邦基金有效利率", fed_funds, unit="%", frequency="月度均值", source=FED_SOURCE, stage_type="growth", benchmark=None),
            _indicator("us-payroll-change", "增长与就业", "非农就业月增量", payroll_change, unit="千人", frequency="月度", source=BLS_SOURCE, stage_type="growth"),
            _indicator("us-unemployment", "增长与就业", "失业率", unemployment, unit="%", frequency="月度", source=BLS_SOURCE, stage_type="growth", benchmark=None),
            _indicator("us-real-yield-10y", "金融条件", "美国10年期实际利率", real_yield, unit="%", frequency="月度均值", source=FED_SOURCE, stage_type="growth"),
            _indicator("us-curve-10y2y", "金融条件", "10年－2年期限利差", curve, unit="百分点", frequency="月度均值", source=FED_SOURCE, stage_type="curve"),
        ],
    }


def _request(url: str, *, body: bytes | None = None, content_type: str | None = None) -> bytes:
    headers = {"User-Agent": "QuantDesk/0.2 (+local macro dashboard)"}
    if content_type:
        headers["Content-Type"] = content_type
    request = Request(url, data=body, headers=headers, method="POST" if body else "GET")
    with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        if response.status != 200:
            raise RuntimeError(f"数据源返回 HTTP {response.status}")
        return response.read()


def _request_json(url: str, *, body: dict | None = None) -> dict:
    encoded = json.dumps(body).encode("utf-8") if body is not None else None
    raw = _request(url, body=encoded, content_type="application/json" if body is not None else None)
    return json.loads(raw.decode("utf-8"))


def _eastmoney_report(report_name: str) -> dict:
    query = urlencode(
        {
            "reportName": report_name,
            "columns": "ALL",
            "sortColumns": "REPORT_DATE",
            "sortTypes": "-1",
            "pageNumber": "1",
            "pageSize": "60",
            "source": "WEB",
            "client": "WEB",
        }
    )
    return _request_json(f"{EASTMONEY_URL}?{query}")


def fetch_china_market() -> dict:
    reports = {
        "money": "RPT_ECONOMY_CURRENCY_SUPPLY",
        "pmi": "RPT_ECONOMY_PMI",
        "industrial": "RPT_ECONOMY_INDUS_GROW",
        "cpi": "RPT_ECONOMY_CPI",
        "ppi": "RPT_ECONOMY_PPI",
    }
    payloads = {}
    with ThreadPoolExecutor(max_workers=len(reports)) as executor:
        futures = {executor.submit(_eastmoney_report, report): key for key, report in reports.items()}
        for future in as_completed(futures):
            payloads[futures[future]] = future.result()
    return build_china_market(payloads)


def fetch_us_market() -> dict:
    current_year = datetime.now(timezone.utc).year
    bls_body = {
        "seriesid": ["CUSR0000SA0", "CUSR0000SA0L1E", "CES0000000001", "LNS14000000"],
        "startyear": str(current_year - 3),
        "endyear": str(current_year),
    }
    with ThreadPoolExecutor(max_workers=2) as executor:
        bls_future = executor.submit(_request_json, BLS_URL, body=bls_body)
        h15_future = executor.submit(_request, H15_URL)
        bls_payload = bls_future.result()
        h15_csv = h15_future.result().decode("utf-8-sig")
    return build_us_market(bls_payload, h15_csv)


def _error_market(market_id: str, message: str) -> dict:
    is_china = market_id == "china"
    return {
        "id": market_id,
        "code": "CN" if is_china else "US",
        "title": "中国宏观环境" if is_china else "美国宏观环境",
        "status": "error",
        "error": message,
        "indicators": [],
    }


def get_macro_dashboard(force: bool = False) -> dict:
    now = time.time()
    cached = _CACHE.get("data")
    if not force and cached is not None and now < float(_CACHE.get("expires") or 0):
        return cached

    with _CACHE_LOCK:
        now = time.time()
        cached = _CACHE.get("data")
        if not force and cached is not None and now < float(_CACHE.get("expires") or 0):
            return cached

        fetchers = {"china": fetch_china_market, "united-states": fetch_us_market}
        markets_by_id = {}
        failures = []
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = {executor.submit(fetcher): market_id for market_id, fetcher in fetchers.items()}
            for future in as_completed(futures):
                market_id = futures[future]
                try:
                    markets_by_id[market_id] = future.result()
                except Exception as error:
                    stale_market = next(
                        (market for market in (cached or {}).get("markets", []) if market.get("id") == market_id),
                        None,
                    )
                    if stale_market:
                        stale_market = dict(stale_market)
                        stale_market["status"] = "stale"
                        stale_market["error"] = "数据源暂时不可用，正在显示上次成功数据"
                        markets_by_id[market_id] = stale_market
                    else:
                        markets_by_id[market_id] = _error_market(market_id, "数据源暂时不可用")
                    failures.append({"market": market_id, "type": type(error).__name__})

        generated_at = datetime.now(timezone.utc).isoformat()
        markets = [markets_by_id["china"], markets_by_id["united-states"]]
        live_count = sum(market["status"] == "live" for market in markets)
        ttl = CACHE_TTL_SECONDS if live_count == 2 else ERROR_CACHE_TTL_SECONDS
        dashboard = {
            "generatedAt": generated_at,
            "refreshAfterSeconds": CACHE_TTL_SECONDS,
            "markets": markets,
            "quality": {
                "status": "passed" if live_count == 2 else "partial",
                "liveMarkets": live_count,
                "failures": failures,
            },
        }
        _CACHE["data"] = dashboard
        _CACHE["expires"] = now + ttl
        return dashboard
