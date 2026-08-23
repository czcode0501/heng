"""Deterministic market-timing scores built from validated daily price series."""

from __future__ import annotations

import math
import statistics
from copy import deepcopy
from collections.abc import Iterable
from datetime import date, timedelta


DIMENSION_WEIGHTS = {
    "trend": 30,
    "breadth": 25,
    "liquidity": 15,
    "volatility": 15,
    "risk-appetite": 15,
}


def _clamp(value: float, minimum: float = 0.0, maximum: float = 100.0) -> float:
    return max(minimum, min(maximum, float(value)))


def _number(value: object) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("行情包含无效数值")
    return number


def _validated_series(points: Iterable[dict], name: str, minimum: int = 220) -> list[dict]:
    normalized = []
    for point in points:
        try:
            normalized.append(
                {
                    "date": str(point["date"])[:10],
                    "open": _number(point.get("open", point["close"])),
                    "high": _number(point.get("high", point["close"])),
                    "low": _number(point.get("low", point["close"])),
                    "close": _number(point["close"]),
                    "volume": _number(point.get("volume", 0)),
                    "amount": _number(point.get("amount", 0)),
                }
            )
        except (KeyError, TypeError, ValueError):
            continue
    deduplicated = {point["date"]: point for point in normalized if point["date"]}
    result = [deduplicated[date] for date in sorted(deduplicated)]
    if len(result) < minimum:
        raise ValueError(f"{name} 至少需要 {minimum} 个有效交易日，当前只有 {len(result)} 个")
    return result


def _mean(values: Iterable[float]) -> float:
    return statistics.fmean(list(values))


def _ma(points: list[dict], periods: int, offset: int = 0) -> float:
    end = len(points) - offset if offset else len(points)
    return _mean(point["close"] for point in points[end - periods : end])


def _return_pct(points: list[dict], periods: int) -> float:
    return (points[-1]["close"] / points[-periods - 1]["close"] - 1) * 100


def _relative_return(left: list[dict], right: list[dict], periods: int = 20) -> float:
    left_change = left[-1]["close"] / left[-periods - 1]["close"]
    right_change = right[-1]["close"] / right[-periods - 1]["close"]
    return (left_change / right_change - 1) * 100


def _annualized_volatility(points: list[dict], periods: int = 20) -> float:
    closes = [point["close"] for point in points[-periods - 1 :]]
    returns = [current / previous - 1 for previous, current in zip(closes, closes[1:]) if previous]
    return statistics.pstdev(returns) * math.sqrt(252) * 100


def _rolling_volatility_percentile(points: list[dict], periods: int = 20) -> float:
    observations = []
    for end in range(periods + 1, len(points) + 1):
        observations.append(_annualized_volatility(points[:end], periods))
    latest = observations[-1]
    return sum(value <= latest for value in observations) / len(observations) * 100


def _value_percentile(points: list[dict]) -> float:
    values = [point["close"] for point in points]
    return sum(value <= values[-1] for value in values) / len(values) * 100


def _drawdown(points: list[dict], periods: int = 60) -> float:
    recent = points[-periods:]
    return (recent[-1]["close"] / max(point["close"] for point in recent) - 1) * 100


def _liquidity_ratio(left: list[dict], right: list[dict]) -> tuple[float, str]:
    use_amount = any(point["amount"] > 0 for point in left[-20:] + right[-20:])
    field = "amount" if use_amount else "volume"
    totals = [a[field] + b[field] for a, b in zip(left[-20:], right[-20:])]
    return _mean(totals[-5:]) / _mean(totals), field


def _metric(metric_id: str, label: str, value: str, tone: str = "neutral") -> dict:
    return {"id": metric_id, "label": label, "value": value, "tone": tone}


def _tone(value: float, neutral: float = 0.0) -> str:
    if value > neutral:
        return "positive"
    if value < neutral:
        return "negative"
    return "neutral"


def _dimension(dimension_id: str, title: str, score: float, summary: str, metrics: list[dict]) -> dict:
    rounded = round(_clamp(score), 1)
    state = "积极" if rounded >= 65 else "中性" if rounded >= 45 else "承压"
    return {
        "id": dimension_id,
        "title": title,
        "weight": DIMENSION_WEIGHTS[dimension_id],
        "score": rounded,
        "state": state,
        "summary": summary,
        "metrics": metrics,
    }


def _regime(dimensions: list[dict]) -> dict:
    score = sum(item["score"] * item["weight"] for item in dimensions) / 100
    if score >= 70:
        label, tone, exposure = "进攻", "strong-positive", "80%–100%"
    elif score >= 58:
        label, tone, exposure = "偏多", "positive", "60%–80%"
    elif score >= 43:
        label, tone, exposure = "中性", "neutral", "40%–60%"
    elif score >= 30:
        label, tone, exposure = "防守", "negative", "20%–40%"
    else:
        label, tone, exposure = "风险规避", "strong-negative", "0%–20%"
    dispersion = statistics.pstdev(item["score"] for item in dimensions)
    confidence = "高" if dispersion <= 12 else "中" if dispersion <= 24 else "低"
    strongest = max(dimensions, key=lambda item: item["score"])
    weakest = min(dimensions, key=lambda item: item["score"])
    return {
        "score": round(score, 1),
        "label": label,
        "tone": tone,
        "confidence": confidence,
        "exposureBand": exposure,
        "summary": f"{strongest['title']}提供主要支撑，{weakest['title']}是当前主要约束。",
    }


def _benchmark(points: list[dict], symbol: str, name: str) -> dict:
    recent = points[-500:]
    return {
        "symbol": symbol,
        "name": name,
        "close": round(points[-1]["close"], 2),
        "changePercent": round(_return_pct(points, 1), 2),
        "availableFrom": recent[0]["date"],
        "history": [{"date": point["date"], "value": round(point["close"], 4)} for point in recent],
    }


def _compact_evidence(series: dict[str, list[dict]]) -> dict[str, list[dict]]:
    return {
        key: [
            {
                "date": point["date"],
                "close": point["close"],
                "volume": point["volume"],
                "amount": point["amount"],
            }
            for point in points[-500:]
        ]
        for key, points in series.items()
    }


def _market_payload(market_id: str, title: str, scope: str, source: dict, benchmark: dict, dimensions: list[dict], series_count: int) -> dict:
    return {
        "id": market_id,
        "title": title,
        "scope": scope,
        "status": "live",
        "asOf": benchmark["history"][-1]["date"],
        "updateMode": "automatic-intraday" if source.get("intraday") else "automatic-eod",
        "source": source,
        "benchmark": benchmark,
        "regime": _regime(dimensions),
        "dimensions": dimensions,
        "dataQuality": {
            "status": "live",
            "label": "数据通过",
            "availableSeries": series_count,
            "expectedSeries": series_count,
            "issues": [],
        },
    }


def build_china_market(bundle: dict[str, list[dict]], source: dict) -> dict:
    series = {key: _validated_series(value, key) for key, value in bundle.items()}
    required = {"csi300", "sse", "szse", "chinext", "csi1000"}
    missing = required.difference(series)
    if missing:
        raise ValueError(f"中国市场缺少序列: {', '.join(sorted(missing))}")

    csi300 = series["csi300"]
    price = csi300[-1]["close"]
    ma60 = _ma(csi300, 60)
    ma120 = _ma(csi300, 120)
    ma60_slope = (ma60 / _ma(csi300, 60, offset=20) - 1) * 100
    trend_score = 50 + (15 if price >= ma60 else -15) + (15 if ma60 >= ma120 else -15) + (20 if ma60_slope >= 0 else -20)
    trend = _dimension(
        "trend", "趋势", trend_score, "通过沪深300与中长期均线判断市场方向和持续性。",
        [
            _metric("priceVsMa60", "沪深300 / MA60", f"{(price / ma60 - 1) * 100:+.2f}%", _tone(price - ma60)),
            _metric("ma60Slope", "MA60斜率（20日）", f"{ma60_slope:+.2f}%", _tone(ma60_slope)),
        ],
    )

    breadth_universe = [series[key] for key in ["csi300", "sse", "szse", "chinext", "csi1000"]]
    positive_checks = sum(points[-1]["close"] >= _ma(points, 60) for points in breadth_universe)
    positive_checks += sum(_return_pct(points, 20) >= 0 for points in breadth_universe)
    participation = positive_checks / (len(breadth_universe) * 2) * 100
    breadth = _dimension(
        "breadth", "市场广度", participation, "以五个宽基指数的趋势参与度衡量行情是否广泛。",
        [
            _metric("benchmarkParticipation", "宽基参与度", f"{participation:.0f}%", _tone(participation - 50)),
            _metric("csi1000Momentum", "中证1000 20日", f"{_return_pct(series['csi1000'], 20):+.2f}%", _tone(_return_pct(series["csi1000"], 20))),
        ],
    )

    liquidity_ratio, liquidity_field = _liquidity_ratio(series["sse"], series["szse"])
    market_return = _return_pct(csi300, 20)
    confirmation = 1 if market_return >= 0 else -1
    liquidity_score = 50 + confirmation * (liquidity_ratio - 1) * 100 + (10 if market_return >= 0 else -10)
    liquidity = _dimension(
        "liquidity", "成交与流动性", liquidity_score, "成交扩张只有与价格方向一致时才作为趋势确认。",
        [
            _metric("turnoverRatio", "5日 / 20日成交", f"{liquidity_ratio:.2f}×", _tone((liquidity_ratio - 1) * confirmation)),
            _metric("liquidityBasis", "统计口径", "成交额" if liquidity_field == "amount" else "成交量", "neutral"),
        ],
    )

    volatility_value = _annualized_volatility(csi300)
    volatility_percentile = _rolling_volatility_percentile(csi300)
    drawdown = _drawdown(csi300)
    volatility_score = (100 - volatility_percentile) * 0.65 + (100 - _clamp(abs(drawdown) / 12 * 100)) * 0.35
    volatility = _dimension(
        "volatility", "波动与压力", volatility_score, "实际波动率和阶段回撤用于识别市场压力。",
        [
            _metric("realizedVolatility", "20日年化波动", f"{volatility_value:.1f}%", _tone(50 - volatility_percentile)),
            _metric("drawdown60", "距60日高点", f"{drawdown:.2f}%", _tone(drawdown + 3)),
        ],
    )

    small_relative = _relative_return(series["csi1000"], csi300)
    growth_relative = _relative_return(series["chinext"], csi300)
    appetite_score = 50 + _mean([small_relative, growth_relative]) * 7
    appetite = _dimension(
        "risk-appetite", "风险偏好", appetite_score, "小盘和成长指数相对大盘的强弱反映资金进攻意愿。",
        [
            _metric("smallCapRelative", "中证1000 / 沪深300", f"{small_relative:+.2f}%", _tone(small_relative)),
            _metric("growthRelative", "创业板 / 沪深300", f"{growth_relative:+.2f}%", _tone(growth_relative)),
        ],
    )

    dimensions = [trend, breadth, liquidity, volatility, appetite]
    market = _market_payload("china", "中国股票", "A股", source, _benchmark(csi300, "000300", "沪深300"), dimensions, len(required))
    market["_evidenceSeries"] = _compact_evidence(series)
    return market


def build_us_market(bundle: dict[str, list[dict]], source: dict) -> dict:
    series = {key: _validated_series(value, key) for key, value in bundle.items()}
    required = {"sp500", "spy", "rsp", "iwm", "qqq", "hyg", "lqd", "vix"}
    missing = required.difference(series)
    if missing:
        raise ValueError(f"美国市场缺少序列: {', '.join(sorted(missing))}")

    sp500 = series["sp500"]
    price = sp500[-1]["close"]
    ma50 = _ma(sp500, 50)
    ma200 = _ma(sp500, 200)
    ma50_slope = (ma50 / _ma(sp500, 50, offset=20) - 1) * 100
    trend_score = 50 + (15 if price >= ma50 else -15) + (15 if ma50 >= ma200 else -15) + (20 if ma50_slope >= 0 else -20)
    trend = _dimension(
        "trend", "趋势", trend_score, "通过S&P 500与MA50、MA200判断美股中长期方向。",
        [
            _metric("priceVsMa50", "S&P 500 / MA50", f"{(price / ma50 - 1) * 100:+.2f}%", _tone(price - ma50)),
            _metric("ma50Slope", "MA50斜率（20日）", f"{ma50_slope:+.2f}%", _tone(ma50_slope)),
        ],
    )

    equal_weight_relative = _relative_return(series["rsp"], series["spy"])
    rsp_above_ma = series["rsp"][-1]["close"] >= _ma(series["rsp"], 50)
    qqq_positive = _return_pct(series["qqq"], 20) >= 0
    breadth_score = 50 + equal_weight_relative * 8 + (12 if rsp_above_ma else -12) + (8 if qqq_positive else -8)
    breadth = _dimension(
        "breadth", "市场广度", breadth_score, "等权重指数相对市值权重指数的表现用于识别上涨是否过度集中。",
        [
            _metric("equalWeightRelative", "RSP / SPY（20日）", f"{equal_weight_relative:+.2f}%", _tone(equal_weight_relative)),
            _metric("rspTrend", "等权指数 / MA50", "上方" if rsp_above_ma else "下方", "positive" if rsp_above_ma else "negative"),
        ],
    )

    liquidity_ratio, _ = _liquidity_ratio(series["spy"], series["qqq"])
    market_return = _return_pct(sp500, 20)
    confirmation = 1 if market_return >= 0 else -1
    liquidity_score = 50 + confirmation * (liquidity_ratio - 1) * 100 + (10 if market_return >= 0 else -10)
    liquidity = _dimension(
        "liquidity", "成交与流动性", liquidity_score, "SPY和QQQ的成交变化用于确认价格趋势的参与强度。",
        [
            _metric("volumeRatio", "5日 / 20日成交量", f"{liquidity_ratio:.2f}×", _tone((liquidity_ratio - 1) * confirmation)),
            _metric("sp500Momentum", "S&P 500 20日", f"{market_return:+.2f}%", _tone(market_return)),
        ],
    )

    vix_value = series["vix"][-1]["close"]
    vix_percentile = _value_percentile(series["vix"])
    vix_change = _return_pct(series["vix"], 20)
    drawdown = _drawdown(sp500)
    volatility_score = (100 - vix_percentile) * 0.65 + (100 - _clamp(abs(drawdown) / 12 * 100)) * 0.35
    volatility = _dimension(
        "volatility", "波动与压力", volatility_score, "VIX预期波动和S&P 500阶段回撤共同衡量市场压力。",
        [
            _metric("vixPercentile", "VIX一年百分位", f"{vix_percentile:.0f}%", _tone(50 - vix_percentile)),
            _metric("vixLevel", "VIX / 20日变化", f"{vix_value:.2f} / {vix_change:+.1f}%", _tone(-vix_change)),
        ],
    )

    small_relative = _relative_return(series["iwm"], series["spy"])
    credit_relative = _relative_return(series["hyg"], series["lqd"])
    appetite_score = 50 + _mean([small_relative, credit_relative]) * 8
    appetite = _dimension(
        "risk-appetite", "风险偏好", appetite_score, "小盘股和高收益债的相对强弱反映资金承担风险的意愿。",
        [
            _metric("smallCapRelative", "IWM / SPY（20日）", f"{small_relative:+.2f}%", _tone(small_relative)),
            _metric("creditRiskRelative", "HYG / LQD（20日）", f"{credit_relative:+.2f}%", _tone(credit_relative)),
        ],
    )

    dimensions = [trend, breadth, liquidity, volatility, appetite]
    market = _market_payload("united-states", "美国股票", "美股", source, _benchmark(sp500, "^GSPC", "S&P 500"), dimensions, len(required))
    market["_evidenceSeries"] = _compact_evidence(series)
    return market


def _period_return(points: list[dict]) -> float:
    return (points[-1]["close"] / points[0]["close"] - 1) * 100 if len(points) >= 2 and points[0]["close"] else 0.0


def _normalized_period_return(points: list[dict]) -> float:
    sessions = max(1, len(points) - 1)
    return _period_return(points) / math.sqrt(sessions / 20)


def _period_relative(left: list[dict], right: list[dict]) -> float:
    if len(left) < 2 or len(right) < 2 or not left[0]["close"] or not right[0]["close"]:
        return 0.0
    return ((left[-1]["close"] / left[0]["close"]) / (right[-1]["close"] / right[0]["close"]) - 1) * 100


def _up_session_ratio(points: list[dict]) -> float:
    changes = [current["close"] >= previous["close"] for previous, current in zip(points, points[1:]) if previous["close"]]
    return sum(changes) / len(changes) * 100 if changes else 50.0


def _period_liquidity(left: list[dict], right: list[dict]) -> tuple[float, str]:
    field = "amount" if any(point["amount"] > 0 for point in left + right) else "volume"
    totals = [a[field] + b[field] for a, b in zip(left, right)]
    sample = max(1, min(5, len(totals) // 2))
    opening = _mean(totals[:sample])
    return (_mean(totals[-sample:]) / opening if opening else 1.0), field


def _period_volatility(points: list[dict]) -> tuple[float, float]:
    returns = [current["close"] / previous["close"] - 1 for previous, current in zip(points, points[1:]) if previous["close"]]
    if not returns:
        annualized = 0.0
    elif len(returns) == 1:
        annualized = abs(returns[0]) * math.sqrt(252) * 100
    else:
        annualized = statistics.pstdev(returns) * math.sqrt(252) * 100
    peak = points[0]["close"]
    maximum_drawdown = 0.0
    for point in points:
        peak = max(peak, point["close"])
        maximum_drawdown = min(maximum_drawdown, (point["close"] / peak - 1) * 100 if peak else 0.0)
    return annualized, maximum_drawdown


def _period_trend(points: list[dict], benchmark_name: str) -> dict:
    period_return = _period_return(points)
    normalized_return = _normalized_period_return(points)
    up_ratio = _up_session_ratio(points)
    score = 50 + normalized_return * 3 + (up_ratio - 50) * 0.4
    return _dimension(
        "trend", "趋势", score, "按所选区间的累计方向与上涨持续性衡量趋势。",
        [
            _metric("periodReturn", f"{benchmark_name}区间涨跌", f"{period_return:+.2f}%", _tone(period_return)),
            _metric("upSessionRatio", "上涨交易日占比", f"{up_ratio:.0f}%", _tone(up_ratio - 50)),
        ],
    )


def _period_breadth(series: dict[str, list[dict]], keys: list[str], secondary_label: str) -> dict:
    returns = [_period_return(series[key]) for key in keys]
    participation = sum(value >= 0 for value in returns) / len(returns) * 100
    median_return = statistics.median(returns)
    return _dimension(
        "breadth", "市场广度", participation, "按所选区间内宽基指数同步上涨的比例衡量参与广度。",
        [
            _metric("periodParticipation", "区间上涨参与度", f"{participation:.0f}%", _tone(participation - 50)),
            _metric("medianIndexReturn", secondary_label, f"{median_return:+.2f}%", _tone(median_return)),
        ],
    )


def _period_liquidity_dimension(benchmark: list[dict], left: list[dict], right: list[dict]) -> dict:
    ratio, field = _period_liquidity(left, right)
    market_return = _period_return(benchmark)
    confirmation = 1 if market_return >= 0 else -1
    score = 50 + confirmation * (ratio - 1) * 100 + confirmation * 10
    return _dimension(
        "liquidity", "成交与流动性", score, "比较所选区间起止阶段的成交变化，并由价格方向确认。",
        [
            _metric("periodLiquidityRatio", "期末 / 期初成交", f"{ratio:.2f}×", _tone((ratio - 1) * confirmation)),
            _metric("liquidityBasis", "统计口径", "成交额" if field == "amount" else "成交量"),
        ],
    )


def _period_volatility_dimension(points: list[dict], vix: list[dict] | None = None) -> dict:
    annualized, drawdown = _period_volatility(points)
    score = (100 - _clamp(annualized / 40 * 100)) * 0.6 + (100 - _clamp(abs(drawdown) / 15 * 100)) * 0.4
    metrics = [
        _metric("periodVolatility", "区间年化波动", f"{annualized:.1f}%", _tone(20 - annualized)),
        _metric("periodDrawdown", "区间最大回撤", f"{drawdown:.2f}%", _tone(drawdown + 3)),
    ]
    if vix:
        vix_change = _period_return(vix)
        score = score * 0.75 + _clamp(50 - vix_change * 3) * 0.25
        metrics[1] = _metric("periodVixChange", "VIX区间变化", f"{vix_change:+.2f}%", _tone(-vix_change))
    return _dimension("volatility", "波动与压力", score, "按所选区间的实际波动、回撤和压力代理衡量风险。", metrics)


def _period_appetite(left: list[dict], right: list[dict], left_two: list[dict], right_two: list[dict], labels: tuple[str, str]) -> dict:
    first = _period_relative(left, right)
    second = _period_relative(left_two, right_two)
    sessions = max(1, min(len(left), len(right)) - 1)
    normalized = _mean([first, second]) / math.sqrt(sessions / 20)
    return _dimension(
        "risk-appetite", "风险偏好", 50 + normalized * 7, "按所选区间风险资产相对基准的强弱衡量进攻意愿。",
        [
            _metric("periodRelativeOne", labels[0], f"{first:+.2f}%", _tone(first)),
            _metric("periodRelativeTwo", labels[1], f"{second:+.2f}%", _tone(second)),
        ],
    )


def _shift_months(value: date, months: int) -> date:
    month_index = value.year * 12 + value.month - 1 - months
    year, month_zero = divmod(month_index, 12)
    month = month_zero + 1
    next_month = date(year + (month == 12), 1 if month == 12 else month + 1, 1)
    last_day = (next_month - timedelta(days=1)).day
    return date(year, month, min(value.day, last_day))


def _requested_start(history: list[dict], range_id: str, custom_start: str | None) -> str:
    if range_id == "custom":
        if not custom_start:
            raise ValueError("自定义市场择时范围需要起始日期")
        return date.fromisoformat(custom_start).isoformat()
    if range_id not in {"1d", "1w", "1m", "3m", "1y"}:
        raise ValueError("市场择时时间范围不受支持")
    if range_id == "1d":
        return history[-2]["date"] if len(history) >= 2 else history[-1]["date"]
    latest = date.fromisoformat(history[-1]["date"])
    if range_id == "1w":
        return (latest - timedelta(days=7)).isoformat()
    if range_id == "1m":
        return _shift_months(latest, 1).isoformat()
    if range_id == "3m":
        return _shift_months(latest, 3).isoformat()
    return _shift_months(latest, 12).isoformat()


def _slice_since(points: list[dict], start_date: str) -> list[dict]:
    selected = [point for point in points if point["date"] >= start_date]
    return selected if len(selected) >= 2 else points[-2:]


def _range_dimensions(market_id: str, series: dict[str, list[dict]]) -> list[dict]:
    if market_id == "china":
        benchmark = series["csi300"]
        return [
            _period_trend(benchmark, "沪深300"),
            _period_breadth(series, ["csi300", "sse", "szse", "chinext", "csi1000"], "宽基收益中位数"),
            _period_liquidity_dimension(benchmark, series["sse"], series["szse"]),
            _period_volatility_dimension(benchmark),
            _period_appetite(series["csi1000"], benchmark, series["chinext"], benchmark, ("中证1000 / 沪深300", "创业板 / 沪深300")),
        ]
    benchmark = series["sp500"]
    return [
        _period_trend(benchmark, "S&P 500"),
        _period_breadth(series, ["spy", "rsp", "iwm", "qqq"], "主要指数收益中位数"),
        _period_liquidity_dimension(benchmark, series["spy"], series["qqq"]),
        _period_volatility_dimension(benchmark, series["vix"]),
        _period_appetite(series["iwm"], series["spy"], series["hyg"], series["lqd"], ("IWM / SPY", "HYG / LQD")),
    ]


def apply_market_timing_range(dashboard: dict, range_id: str = "1m", custom_start: str | None = None) -> dict:
    """Return a public dashboard whose five dimensions are recalculated for one selected window."""
    result = deepcopy(dashboard)
    result["methodologyVersion"] = "1.1.0-period-aware"
    for market in result.get("markets", []):
        evidence = market.pop("_evidenceSeries", None)
        history = market.get("benchmark", {}).get("history", []) if market.get("benchmark") else []
        if not evidence or len(history) < 2:
            market["analysisWindow"] = {"range": range_id, "isRangeAware": False}
            continue
        requested_start = _requested_start(history, range_id, custom_start)
        selected = {key: _slice_since(points, requested_start) for key, points in evidence.items()}
        benchmark_key = "csi300" if market["id"] == "china" else "sp500"
        benchmark = selected[benchmark_key]
        dimensions = _range_dimensions(market["id"], selected)
        market["dimensions"] = dimensions
        market["regime"] = _regime(dimensions)
        market["analysisWindow"] = {
            "range": range_id,
            "requestedStart": requested_start,
            "start": benchmark[0]["date"],
            "end": benchmark[-1]["date"],
            "observations": len(benchmark),
            "isRangeAware": True,
        }
    return result
