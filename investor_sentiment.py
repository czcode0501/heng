"""Investor-sentiment model derived from the shared China and US market cache."""

from __future__ import annotations

import math
import statistics
from copy import deepcopy
from datetime import datetime, timezone


WEIGHTS = {
    "fear-pressure": 25,
    "participation": 30,
    "positioning": 25,
    "speculation": 20,
}


def _clamp(value: float, minimum: float = 0.0, maximum: float = 100.0) -> float:
    return max(minimum, min(maximum, float(value)))


def _mean(values) -> float:
    items = [float(value) for value in values]
    return statistics.fmean(items) if items else 0.0


def _normalize_series(points: list[dict], name: str) -> list[dict]:
    rows = []
    for point in points or []:
        try:
            row = {
                "date": str(point["date"])[:10],
                "open": float(point.get("open", point["close"])),
                "high": float(point.get("high", point["close"])),
                "low": float(point.get("low", point["close"])),
                "close": float(point["close"]),
                "volume": float(point.get("volume") or 0),
                "amount": float(point.get("amount") or 0),
            }
        except (KeyError, TypeError, ValueError):
            continue
        if row["date"] and all(math.isfinite(row[key]) for key in ("close", "volume", "amount")):
            rows.append(row)
    deduplicated = {row["date"]: row for row in rows}
    normalized = [deduplicated[key] for key in sorted(deduplicated)]
    if len(normalized) < 80:
        raise ValueError(f"{name} 至少需要80个有效交易日")
    return normalized


def _return(points: list[dict], end: int, periods: int) -> float:
    start = max(0, end - periods)
    base = points[start]["close"]
    return (points[end]["close"] / base - 1) * 100 if base else 0.0


def _ma(points: list[dict], end: int, periods: int) -> float:
    start = max(0, end - periods + 1)
    return _mean(point["close"] for point in points[start : end + 1])


def _drawdown(points: list[dict], end: int, periods: int = 60) -> float:
    start = max(0, end - periods + 1)
    high = max(point["close"] for point in points[start : end + 1])
    return (points[end]["close"] / high - 1) * 100 if high else 0.0


def _annualized_volatility(points: list[dict], end: int, periods: int = 20) -> float:
    start = max(1, end - periods + 1)
    returns = []
    for index in range(start, end + 1):
        previous = points[index - 1]["close"]
        if previous:
            returns.append(points[index]["close"] / previous - 1)
    return statistics.pstdev(returns) * math.sqrt(252) * 100 if len(returns) >= 2 else 0.0


def _percentile(values: list[float], latest: float) -> float:
    return sum(value <= latest for value in values) / len(values) * 100 if values else 50.0


def _relative_return(left: list[dict], right: list[dict], end: int, periods: int = 20) -> float:
    left_change = 1 + _return(left, min(end, len(left) - 1), periods) / 100
    right_change = 1 + _return(right, min(end, len(right) - 1), periods) / 100
    return (left_change / right_change - 1) * 100 if right_change else 0.0


def _volume_ratio(series_list: list[list[dict]], end: int) -> float:
    field = "amount" if any(points[min(end, len(points) - 1)]["amount"] > 0 for points in series_list) else "volume"
    latest = sum(points[min(end, len(points) - 1)][field] for points in series_list)
    history = []
    for offset in range(1, 21):
        index = max(0, end - offset)
        history.append(sum(points[min(index, len(points) - 1)][field] for points in series_list))
    baseline = _mean(history)
    return latest / baseline if baseline else 1.0


def _tone(score: float) -> str:
    return "positive" if score >= 60 else "negative" if score <= 40 else "neutral"


def _metric(label: str, value: str, tone: str = "neutral") -> dict:
    return {"label": label, "value": value, "tone": tone}


def classify_sentiment_phase(score: float, impulse: float) -> dict:
    """Classify a two-axis level/impulse state into one of six auditable phases."""
    score, impulse = float(score), float(impulse)
    if score <= 25:
        if impulse > 0:
            return {"id": "panic-stabilizing", "label": "恐慌企稳", "tone": "positive", "summary": "情绪仍在低位，但边际压力已经开始减轻。"}
        return {"id": "panic-worsening", "label": "恐慌恶化", "tone": "negative", "summary": "低位情绪继续走弱，尚未形成可靠的反向确认。"}
    if score >= 75:
        if impulse < 0:
            return {"id": "crowding-deteriorating", "label": "拥挤退潮", "tone": "negative", "summary": "情绪仍高，但动量转弱，需要警惕拥挤交易松动。"}
        return {"id": "euphoria-accelerating", "label": "狂热加速", "tone": "warning", "summary": "风险偏好处于高位并继续升温，趋势强但拥挤风险上升。"}
    if score < 60:
        if impulse > 0:
            return {"id": "neutral-recovery", "label": "情绪修复", "tone": "positive", "summary": "恐慌正在退潮，市场参与度和风险偏好逐步恢复。"}
        return {"id": "panic-worsening", "label": "谨慎降温", "tone": "negative", "summary": "情绪位于中低区间且继续转弱，优先观察修复证据。"}
    if impulse < -3:
        return {"id": "crowding-deteriorating", "label": "高位降温", "tone": "warning", "summary": "风险偏好仍在，但情绪动量已经转弱。"}
    return {"id": "healthy-risk-appetite", "label": "健康风险偏好", "tone": "positive", "summary": "情绪位于可持续区间，参与和风险承担保持协调。"}


def _dimension_history(market_id: str, series: dict[str, list[dict]]) -> tuple[list[dict], list[dict]]:
    if market_id == "china":
        benchmark_key = "csi300"
        participation_keys = ["csi300", "sse", "szse", "chinext", "csi1000"]
        positioning_pairs = [("csi1000", "csi300"), ("chinext", "csi300")]
        volume_keys = ["sse", "szse"]
    else:
        benchmark_key = "sp500"
        participation_keys = ["spy", "rsp", "iwm", "qqq"]
        positioning_pairs = [("iwm", "spy"), ("hyg", "lqd")]
        volume_keys = ["spy", "qqq"]

    benchmark = series[benchmark_key]
    usable = min(len(points) for points in series.values())
    start = max(60, usable - 260)
    histories = {dimension_id: [] for dimension_id in WEIGHTS}
    rolling_volatility = []

    for end in range(20, usable):
        rolling_volatility.append(_annualized_volatility(benchmark, end))
        if end < start:
            continue
        drawdown = _drawdown(benchmark, end)
        if market_id == "united-states":
            vix = series["vix"]
            vix_values = [point["close"] for point in vix[max(0, end - 252) : end + 1]]
            pressure_percentile = _percentile(vix_values, vix[end]["close"])
        else:
            pressure_percentile = _percentile(rolling_volatility[-252:], rolling_volatility[-1])
        fear_score = (100 - pressure_percentile) * 0.65 + (100 - _clamp(abs(drawdown) / 12 * 100)) * 0.35

        checks = []
        for key in participation_keys:
            points = series[key]
            checks.extend([points[end]["close"] >= _ma(points, end, 20), _return(points, end, 20) >= 0])
        participation_score = sum(checks) / len(checks) * 100

        relative = _mean(_relative_return(series[left], series[right], end) for left, right in positioning_pairs)
        positioning_score = _clamp(50 + relative * 8)

        volume_ratio = _volume_ratio([series[key] for key in volume_keys], end)
        momentum = _return(benchmark, end, 20)
        daily = _return(benchmark, end, 1)
        speculation_score = _clamp(50 + momentum * 3 + (volume_ratio - 1) * (12 if daily >= 0 else -12))
        if daily < 0 and volume_ratio < 0.5:
            speculation_score = min(speculation_score, 20)

        date = benchmark[end]["date"]
        values = {
            "fear-pressure": fear_score,
            "participation": participation_score,
            "positioning": positioning_score,
            "speculation": speculation_score,
        }
        for dimension_id, value in values.items():
            histories[dimension_id].append({"date": date, "value": round(_clamp(value), 2)})

    dimensions = []
    titles = {
        "fear-pressure": ("恐慌与避险", "波动、回撤与避险需求用于识别压力是否缓和。"),
        "participation": ("市场参与度", "宽基与风格资产的共同参与度用于判断行情是否扩散。"),
        "positioning": ("仓位与风险偏好", "风险资产相对防御资产的强弱作为市场仓位代理。"),
        "speculation": ("投机与拥挤", "保留旧版量比方法，识别地量衰竭、放量确认和放量滞涨。"),
    }
    last_index = usable - 1
    benchmark_return = _return(benchmark, last_index, 20)
    volume_ratio = _volume_ratio([series[key] for key in volume_keys], last_index)
    for dimension_id, weight in WEIGHTS.items():
        dimension_history = histories[dimension_id]
        score = dimension_history[-1]["value"]
        metrics = []
        if dimension_id == "fear-pressure":
            metrics = [
                _metric("距60日高点", f"{_drawdown(benchmark, last_index):+.2f}%", _tone(score)),
                _metric("压力状态", "缓和" if score >= 60 else "偏高" if score <= 40 else "中性", _tone(score)),
            ]
        elif dimension_id == "participation":
            metrics = [
                _metric("参与证据", f"{score:.0f}%", _tone(score)),
                _metric("基准20日", f"{benchmark_return:+.2f}%", _tone(50 + benchmark_return)),
            ]
        elif dimension_id == "positioning":
            metrics = [
                _metric("风险仓位代理", f"{score:.0f}/100", _tone(score)),
                _metric("解释", "风险资产相对强弱", "neutral"),
            ]
        else:
            metrics = [
                _metric("当前量比", f"{volume_ratio:.2f}×", _tone(50 + (volume_ratio - 1) * 20)),
                _metric("基准20日", f"{benchmark_return:+.2f}%", _tone(50 + benchmark_return)),
            ]
        title, summary = titles[dimension_id]
        dimensions.append(
            {
                "id": dimension_id,
                "title": title,
                "weight": weight,
                "score": round(score, 1),
                "state": "偏贪婪" if score >= 65 else "偏恐慌" if score <= 35 else "中性",
                "summary": summary,
                "metrics": metrics,
                "history": dimension_history,
            }
        )

    dates = [point["date"] for point in dimensions[0]["history"]]
    combined_history = []
    for index, date in enumerate(dates):
        combined = sum(item["history"][index]["value"] * item["weight"] for item in dimensions) / 100
        combined_history.append({"date": date, "value": round(combined, 2)})
    return dimensions, combined_history


def _legacy_methods(market_id: str, series: dict[str, list[dict]]) -> list[dict]:
    if market_id == "china":
        benchmark = series["csi300"]
        volume_series = [series["sse"], series["szse"]]
    else:
        benchmark = series["sp500"]
        volume_series = [series["spy"], series["qqq"]]
    end = min(len(points) for points in series.values()) - 1
    volume_ratio = round(_volume_ratio(volume_series, end), 2)
    five_day_return = round(_return(benchmark, end, 5), 2)

    if volume_ratio < 0.5:
        ground_state = "极度缩量"
    elif volume_ratio < 0.8:
        ground_state = "轻度缩量"
    elif volume_ratio <= 1.2:
        ground_state = "正常成交"
    else:
        ground_state = "成交放大"
    ground = {
        "id": "ground-volume",
        "title": "地量衰竭",
        "state": ground_state,
        "volumeRatio": volume_ratio,
        "threshold": "<0.50 为极度缩量",
        "interpretation": "缩量只表示交易意愿衰竭，必须等待价格和参与度确认，不能单独确认底部。",
    }

    if volume_ratio > 1.2 and abs(five_day_return) < 1:
        crowding_state = "放量滞涨"
    elif volume_ratio > 2:
        crowding_state = "异常放量"
    else:
        crowding_state = "未拥挤"
    crowding = {
        "id": "crowding",
        "title": "放量拥挤",
        "state": crowding_state,
        "volumeRatio": volume_ratio,
        "fiveDayReturn": five_day_return,
        "threshold": ">1.20 且5日涨跌接近零",
        "interpretation": "成交显著放大但价格缺少响应时视为拥挤警告，不再直接机械扣减固定仓位。",
    }
    return [ground, crowding]


def build_market_sentiment(market: dict) -> dict:
    market_id = market.get("id")
    expected = {
        "china": {"csi300", "sse", "szse", "chinext", "csi1000"},
        "united-states": {"sp500", "spy", "rsp", "iwm", "qqq", "hyg", "lqd", "vix"},
    }.get(market_id)
    if not expected:
        raise ValueError("不支持的情绪市场")
    raw = market.get("_evidenceSeries") or {}
    missing = expected.difference(raw)
    if missing:
        raise ValueError(f"情绪模型缺少共享行情: {', '.join(sorted(missing))}")
    series = {key: _normalize_series(raw[key], key) for key in expected}
    usable = min(len(points) for points in series.values())
    series = {key: points[-usable:] for key, points in series.items()}
    dimensions, history = _dimension_history(market_id, series)
    score = history[-1]["value"]
    impulse = round(score - history[max(0, len(history) - 21)]["value"], 2)
    phase = classify_sentiment_phase(score, impulse)
    dimension_dispersion = statistics.pstdev(item["score"] for item in dimensions)
    confidence = round(_clamp(100 - dimension_dispersion * 1.4), 0)
    return {
        "id": market_id,
        "title": market.get("title"),
        "scope": market.get("scope"),
        "status": market.get("status", "live"),
        "asOf": history[-1]["date"],
        "source": deepcopy(market.get("source") or {"name": "共享免费行情", "mode": "zero-config"}),
        "score": round(score, 1),
        "impulse20d": impulse,
        "confidence": confidence,
        "phase": phase,
        "history": history,
        "dimensions": dimensions,
        "legacyMethods": _legacy_methods(market_id, series),
        "dataQuality": {
            "status": "live" if market.get("status") == "live" else "stale",
            "label": "数据通过" if market.get("status") == "live" else "使用共享缓存",
            "coverage": 100,
            "availableSeries": len(expected),
            "expectedSeries": len(expected),
            "reusedSharedMarketCache": True,
            "issues": deepcopy((market.get("dataQuality") or {}).get("issues") or []),
        },
    }


def _error_market(market: dict, error: Exception) -> dict:
    return {
        "id": market.get("id"),
        "title": market.get("title"),
        "scope": market.get("scope"),
        "status": "error",
        "asOf": market.get("asOf"),
        "source": deepcopy(market.get("source") or {"name": "共享免费行情"}),
        "score": None,
        "confidence": 0,
        "phase": None,
        "history": [],
        "dimensions": [],
        "legacyMethods": [],
        "dataQuality": {
            "status": "error",
            "label": "数据暂不可用",
            "coverage": 0,
            "reusedSharedMarketCache": True,
            "issues": [str(error)],
        },
    }


def build_sentiment_dashboard(timing_dashboard: dict) -> dict:
    """Build sentiment without issuing new external requests."""
    markets = []
    for market in timing_dashboard.get("markets") or []:
        try:
            markets.append(build_market_sentiment(market))
        except Exception as error:
            markets.append(_error_market(market, error))
    live_count = sum(market["status"] == "live" for market in markets)
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "refreshAfterSeconds": int(timing_dashboard.get("refreshAfterSeconds") or 1800),
        "autoRefresh": True,
        "methodologyVersion": "1.0.0",
        "markets": markets,
        "dataQuality": {
            "status": "live" if live_count == len(markets) and markets else "partial" if live_count else "error",
            "liveMarkets": live_count,
            "totalMarkets": len(markets),
        },
        "methodology": {
            "levelScale": "0=极度恐慌，100=极度贪婪",
            "impulse": "所选起点与最新情绪分数之差",
            "disclaimer": "情绪是多代理变量合成结果，只用于识别市场阶段，不构成单独买卖依据。",
        },
    }
