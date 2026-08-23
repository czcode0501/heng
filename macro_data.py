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
    "rel=H15&series=d7e27b7b09a3a7feae95b9c61781fcd8&lastobs=60&from=&to=&"
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
    if stage_type == "money":
        return "货币同比扩张" if value >= 0 else "货币同比收缩"
    if stage_type == "industrial":
        return "工业扩张" if value >= 0 else "工业收缩"
    if stage_type == "price_gap":
        return "生产端价格更强" if value >= 0 else "消费端价格更强"
    if stage_type == "payroll":
        return "就业增加" if value >= 0 else "就业减少"
    if stage_type == "unemployment":
        if value < 4:
            return "就业市场偏紧"
        if value <= 5:
            return "就业总体平稳"
        return "就业走弱"
    if stage_type == "policy_rate":
        if value >= 4:
            return "政策利率偏高"
        if value >= 2:
            return "政策利率中性偏高"
        return "政策利率偏低"
    if stage_type == "real_yield":
        if value > 1:
            return "实际利率偏高"
        if value >= 0:
            return "实际利率为正"
        return "实际利率为负"
    if stage_type == "growth":
        return "正增长" if value >= 0 else "负增长"
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


CHINA_NBS_SOURCE = {
    "name": "东方财富数据中心",
    "original": "原始口径：国家统计局",
    "url": "https://data.eastmoney.com/cjsj/",
}
CHINA_PBOC_SOURCE = {
    "name": "东方财富数据中心",
    "original": "原始口径：中国人民银行",
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
    chart_points = points[-60:]
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


def _clamp(value: float, minimum: float = -100, maximum: float = 100) -> float:
    return max(minimum, min(maximum, value))


def _normalized_score(value: float, neutral: float, span: float, *, inverse: bool = False) -> float:
    score = ((float(value) - neutral) / span) * 50
    return _clamp(-score if inverse else score)


def _score_state(score: float, dimension: str) -> str:
    if dimension == "growth":
        return "扩张" if score >= 25 else "走弱" if score <= -25 else "分化"
    if dimension == "inflation":
        return "偏高" if score >= 25 else "偏低" if score <= -25 else "温和"
    return "偏宽松" if score >= 20 else "偏紧" if score <= -20 else "中性"


def _display_indicator(indicator: dict) -> str:
    value = float(indicator["summary"]["value"])
    rendered = f"{value:.2f}".rstrip("0").rstrip(".")
    return f"{rendered}{indicator.get('unit') or ''}"


def _strategy_set(market_id: str, growth: float, inflation: float, liquidity: float) -> list[dict]:
    defensive = growth <= -20 or liquidity <= -20
    inflationary = inflation >= 20
    if market_id == "china":
        return [
            {
                "asset": "A股风格",
                "stance": "防守优先" if defensive else "选择性进攻",
                "title": "重视现金流与盈利确定性" if defensive else "优先结构性成长与政策敏感方向",
                "rationale": "增长或流动性尚未形成全面共振。" if defensive else "修复存在但并不均衡，更适合自下而上筛选。",
                "risk": "若PMI与工业生产同步走弱，应进一步降低周期暴露。",
            },
            {
                "asset": "行业线索",
                "stance": "关注上游定价" if inflationary else "均衡配置",
                "title": "观察生产端价格向利润的传导" if inflationary else "等待价格与需求形成同向确认",
                "rationale": "PPI与CPI的相对变化决定利润更偏向上游还是消费端。",
                "risk": "价格信号若缺乏终端需求配合，可能只形成短期交易而非盈利周期。",
            },
            {
                "asset": "仓位纪律",
                "stance": "分批验证",
                "title": "保留现金并等待增长确认",
                "rationale": "模型处于宏观层，不替代个股估值、财务质量和交易止损。",
                "risk": "单月数据修订或政策预期变化会导致阶段判断快速切换。",
            },
        ]
    return [
        {
            "asset": "美股风格",
            "stance": "质量防守" if defensive else "适度进取",
            "title": "优先稳定现金流与定价能力" if defensive else "增长改善时提高风险资产权重",
            "rationale": "金融条件偏紧时，高质量盈利通常比远期叙事更有承受力。" if defensive else "增长和金融条件允许更高的风险偏好。",
            "risk": "就业快速恶化会把晚周期降温推向衰退交易。",
        },
        {
            "asset": "久期与利率",
            "stance": "控制长久期" if liquidity <= -20 else "中性久期",
            "title": "高实际利率下避免过度依赖估值扩张" if liquidity <= -20 else "等待利率方向确认",
            "rationale": "实际利率和政策利率共同决定长久期资产的折现压力。",
            "risk": "通胀快速回落或政策转向会令利率敏感资产出现反向行情。",
        },
        {
            "asset": "仓位纪律",
            "stance": "保留对冲",
            "title": "用数据确认替代单次押注",
            "rationale": "核心通胀、非农与收益率曲线需要连续数据共同确认。",
            "risk": "数据修订和市场提前交易预期可能使宏观信号滞后于价格。",
        },
    ]


def analyze_macro_market(market: dict) -> dict:
    indicators = {indicator["id"]: indicator for indicator in market.get("indicators", [])}
    market_id = market.get("id")

    def value(indicator_id: str) -> float:
        return float(indicators[indicator_id]["summary"]["value"])

    if market_id == "china":
        growth = (_normalized_score(value("cn-pmi"), 50, 2) + _normalized_score(value("cn-industrial-yoy"), 4, 4)) / 2
        inflation = (_normalized_score(value("cn-cpi-yoy"), 2, 2) + _normalized_score(value("cn-ppi-yoy"), 2, 4)) / 2
        liquidity = (_normalized_score(value("cn-m1-yoy"), 5, 4) + _normalized_score(value("cn-m2-yoy"), 8, 4)) / 2
        dimension_copy = {
            "growth": f"制造业PMI {_display_indicator(indicators['cn-pmi'])}，工业增加值同比 {_display_indicator(indicators['cn-industrial-yoy'])}。",
            "inflation": f"CPI同比 {_display_indicator(indicators['cn-cpi-yoy'])}，PPI同比 {_display_indicator(indicators['cn-ppi-yoy'])}。",
            "liquidity": f"M1同比 {_display_indicator(indicators['cn-m1-yoy'])}，M2同比 {_display_indicator(indicators['cn-m2-yoy'])}。",
        }
        drivers = [
            {"indicator": indicators["cn-pmi"]["name"], "value": _display_indicator(indicators["cn-pmi"]), "signal": "支撑" if value("cn-pmi") >= 50 else "拖累", "explanation": "50以上代表制造业扩张，以下代表收缩。"},
            {"indicator": indicators["cn-ppi-cpi-gap"]["name"], "value": _display_indicator(indicators["cn-ppi-cpi-gap"]), "signal": "上游占优" if value("cn-ppi-cpi-gap") >= 0 else "消费端占优", "explanation": "正值表示生产端价格强于消费端。"},
            {"indicator": indicators["cn-m2-yoy"]["name"], "value": _display_indicator(indicators["cn-m2-yoy"]), "signal": "流动性支撑" if value("cn-m2-yoy") >= 8 else "温和", "explanation": "货币扩张需要与实体需求共同验证。"},
        ]
    elif market_id == "united-states":
        growth = (
            _normalized_score(value("us-payroll-change"), 100, 200)
            + _normalized_score(value("us-unemployment"), 4, 2, inverse=True)
            + _normalized_score(value("us-curve-10y2y"), 0, 2)
        ) / 3
        inflation = (_normalized_score(value("us-cpi-yoy"), 2, 2) + _normalized_score(value("us-core-cpi-yoy"), 2, 2)) / 2
        liquidity = (
            _normalized_score(value("us-fed-funds"), 2.5, 2.5, inverse=True)
            + _normalized_score(value("us-real-yield-10y"), 1, 2, inverse=True)
        ) / 2
        dimension_copy = {
            "growth": f"非农月增量 {_display_indicator(indicators['us-payroll-change'])}，失业率 {_display_indicator(indicators['us-unemployment'])}。",
            "inflation": f"CPI同比 {_display_indicator(indicators['us-cpi-yoy'])}，核心CPI同比 {_display_indicator(indicators['us-core-cpi-yoy'])}。",
            "liquidity": f"联邦基金利率 {_display_indicator(indicators['us-fed-funds'])}，10年实际利率 {_display_indicator(indicators['us-real-yield-10y'])}。",
        }
        drivers = [
            {"indicator": indicators["us-core-cpi-yoy"]["name"], "value": _display_indicator(indicators["us-core-cpi-yoy"]), "signal": "通胀约束" if value("us-core-cpi-yoy") > 2.5 else "通胀缓和", "explanation": "核心通胀决定政策转向的空间。"},
            {"indicator": indicators["us-payroll-change"]["name"], "value": _display_indicator(indicators["us-payroll-change"]), "signal": "增长支撑" if value("us-payroll-change") > 0 else "增长拖累", "explanation": "就业增量转负意味着需求降温风险上升。"},
            {"indicator": indicators["us-real-yield-10y"]["name"], "value": _display_indicator(indicators["us-real-yield-10y"]), "signal": "估值约束" if value("us-real-yield-10y") > 1 else "估值支撑", "explanation": "实际利率越高，长久期资产折现压力越大。"},
        ]
    else:
        raise ValueError(f"不支持的宏观市场：{market_id}")

    scores = {"growth": round(_clamp(growth)), "inflation": round(_clamp(inflation)), "liquidity": round(_clamp(liquidity))}
    if scores["growth"] <= -30 and scores["inflation"] >= 20:
        regime_code, regime = "stagflation-risk", "滞胀风险"
    elif scores["growth"] <= -30:
        regime_code, regime = "contraction-pressure", "衰退压力"
    elif scores["growth"] >= 30 and scores["inflation"] >= 30:
        regime_code, regime = "overheating", "过热阶段"
    elif scores["growth"] >= 25 and scores["inflation"] < 30:
        regime_code, regime = "expansion", "扩张阶段"
    elif market_id == "united-states" and scores["inflation"] >= 20 and scores["liquidity"] <= -15:
        regime_code, regime = "late-cycle-cooling", "晚周期降温"
    elif scores["growth"] >= -15:
        regime_code, regime = "uneven-recovery", "结构性修复"
    else:
        regime_code, regime = "policy-transition", "政策过渡期"

    dimensions = [
        {"id": "growth", "name": "增长动能", "score": scores["growth"], "state": _score_state(scores["growth"], "growth"), "explanation": dimension_copy["growth"]},
        {"id": "inflation", "name": "通胀压力", "score": scores["inflation"], "state": _score_state(scores["inflation"], "inflation"), "explanation": dimension_copy["inflation"]},
        {"id": "liquidity", "name": "流动性" if market_id == "china" else "金融条件", "score": scores["liquidity"], "state": _score_state(scores["liquidity"], "liquidity"), "explanation": dimension_copy["liquidity"]},
    ]
    confidence = round(_clamp(75 + sum(abs(item["score"]) for item in dimensions) / 15, 0, 95))
    stance = "中性偏防守" if scores["growth"] <= -20 or scores["liquidity"] <= -20 else "偏进取" if scores["growth"] >= 25 and scores["liquidity"] >= -10 else "中性偏进取"
    summary = f"模型将当前环境识别为“{regime}”：增长{_score_state(scores['growth'], 'growth')}，通胀{_score_state(scores['inflation'], 'inflation')}，{'流动性' if market_id == 'china' else '金融条件'}{_score_state(scores['liquidity'], 'liquidity')}。"
    return {
        "modelVersion": "macro-regime-v1",
        "market": market_id,
        "asOf": max(indicator["summary"]["date"] for indicator in indicators.values()),
        "regimeCode": regime_code,
        "regime": regime,
        "stance": stance,
        "confidence": confidence,
        "summary": summary,
        "dimensions": dimensions,
        "drivers": drivers,
        "strategies": _strategy_set(market_id, scores["growth"], scores["inflation"], scores["liquidity"]),
        "disclaimer": "模型输出仅用于研究，不构成个股买卖或收益保证；请结合估值、基本面和风险承受能力独立决策。",
    }


def build_china_market(payloads: dict[str, dict]) -> dict:
    m1 = parse_eastmoney_series(payloads["money"], "CURRENCY_SAME")
    m2 = parse_eastmoney_series(payloads["money"], "BASIC_CURRENCY_SAME")
    pmi = parse_eastmoney_series(payloads["pmi"], "MAKE_INDEX")
    industrial = parse_eastmoney_series(payloads["industrial"], "BASE_SAME")
    cpi = parse_eastmoney_series(payloads["cpi"], "NATIONAL_SAME")
    ppi = parse_eastmoney_series(payloads["ppi"], "BASE_SAME")
    price_gap = align_difference(ppi, cpi)
    market = {
        "id": "china",
        "code": "CN",
        "title": "中国宏观环境",
        "status": "live",
        "indicators": [
            _indicator("cn-m1-yoy", "货币与信用", "M1同比", m1, unit="%", frequency="月度", source=CHINA_PBOC_SOURCE, stage_type="money"),
            _indicator("cn-m2-yoy", "货币与信用", "M2同比", m2, unit="%", frequency="月度", source=CHINA_PBOC_SOURCE, stage_type="money"),
            _indicator("cn-pmi", "增长周期", "制造业PMI", pmi, unit="", frequency="月度", source=CHINA_NBS_SOURCE, stage_type="pmi", benchmark=50),
            _indicator("cn-industrial-yoy", "增长周期", "规模以上工业增加值同比", industrial, unit="%", frequency="月度", source=CHINA_NBS_SOURCE, stage_type="industrial"),
            _indicator("cn-cpi-yoy", "通胀与盈利", "CPI同比", cpi, unit="%", frequency="月度", source=CHINA_NBS_SOURCE, stage_type="inflation"),
            _indicator("cn-ppi-yoy", "通胀与盈利", "PPI同比", ppi, unit="%", frequency="月度", source=CHINA_NBS_SOURCE, stage_type="inflation"),
            _indicator("cn-ppi-cpi-gap", "通胀与盈利", "PPI－CPI剪刀差", price_gap, unit="百分点", frequency="月度", source=CHINA_NBS_SOURCE, stage_type="price_gap"),
        ],
    }
    market["analysis"] = analyze_macro_market(market)
    return market


def build_us_market(bls_payload: dict, h15_csv: str) -> dict:
    bls = parse_bls_payload(bls_payload)
    h15 = parse_h15_csv(h15_csv)
    cpi = year_over_year(bls["CUUR0000SA0"])
    core_cpi = year_over_year(bls["CUUR0000SA0L1E"])
    payroll_change = period_change(bls["CES0000000001"])
    unemployment = bls["LNS14000000"]
    fed_funds = h15["RIFSPFF_N.M"]
    real_yield = h15["RIFLGFCY10_XII_N.M"]
    curve = align_difference(h15["RIFLGFCY10_N.M"], h15["RIFLGFCY02_N.M"])
    market = {
        "id": "united-states",
        "code": "US",
        "title": "美国宏观环境",
        "status": "live",
        "indicators": [
            _indicator("us-core-cpi-yoy", "通胀与美联储", "核心CPI同比", core_cpi, unit="%", frequency="月度", source=BLS_SOURCE, stage_type="inflation"),
            _indicator("us-cpi-yoy", "通胀与美联储", "CPI同比", cpi, unit="%", frequency="月度", source=BLS_SOURCE, stage_type="inflation"),
            _indicator("us-fed-funds", "通胀与美联储", "联邦基金有效利率", fed_funds, unit="%", frequency="月度均值", source=FED_SOURCE, stage_type="policy_rate", benchmark=None),
            _indicator("us-payroll-change", "增长与就业", "非农就业月增量", payroll_change, unit="千人", frequency="月度", source=BLS_SOURCE, stage_type="payroll"),
            _indicator("us-unemployment", "增长与就业", "失业率", unemployment, unit="%", frequency="月度", source=BLS_SOURCE, stage_type="unemployment", benchmark=None),
            _indicator("us-real-yield-10y", "金融条件", "美国10年期实际利率", real_yield, unit="%", frequency="月度均值", source=FED_SOURCE, stage_type="real_yield"),
            _indicator("us-curve-10y2y", "金融条件", "10年－2年期限利差", curve, unit="百分点", frequency="月度均值", source=FED_SOURCE, stage_type="curve"),
        ],
    }
    market["analysis"] = analyze_macro_market(market)
    return market


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
        "seriesid": ["CUUR0000SA0", "CUUR0000SA0L1E", "CES0000000001", "LNS14000000"],
        "startyear": str(current_year - 6),
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
            "autoRefresh": True,
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
