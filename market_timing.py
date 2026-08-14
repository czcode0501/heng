"""Deterministic market-timing scores built from validated daily price series."""

from __future__ import annotations

import math
import statistics
from collections.abc import Iterable


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


def _market_payload(market_id: str, title: str, scope: str, source: dict, benchmark: dict, dimensions: list[dict], series_count: int) -> dict:
    return {
        "id": market_id,
        "title": title,
        "scope": scope,
        "status": "live",
        "asOf": benchmark["history"][-1]["date"],
        "updateMode": "automatic-eod",
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
    return _market_payload("china", "中国股票", "A股", source, _benchmark(csi300, "000300", "沪深300"), dimensions, len(required))


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
    return _market_payload("united-states", "美国股票", "美股", source, _benchmark(sp500, "^GSPC", "S&P 500"), dimensions, len(required))
