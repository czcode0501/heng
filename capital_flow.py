"""Price-volume capital-flow proxies derived from daily OHLCV histories.

The model intentionally describes *estimated directional dollar volume*, not
measured institutional orders.  Absolute flow is displayed for magnitude but
is never used to rank sectors of different sizes.
"""

from __future__ import annotations

import math
import statistics
from typing import Iterable


PERIODS = (1, 5, 20)
PERIOD_WEIGHTS = {1: 0.20, 5: 0.35, 20: 0.45}
INDICATOR_IDS = (
    "priceChange",
    "cmf",
    "estimatedNetFlow",
    "flowRatio",
    "upDownVolumeRatio",
    "rvol",
    "closeLocation",
    "mfi",
    "obvChange",
)
COMPONENT_WEIGHTS = {
    "directionPressure": 0.35,
    "persistence": 0.20,
    "participation": 0.20,
    "priceLocationConfirmation": 0.15,
    "intensity": 0.10,
}


def _clamp(value: float, minimum: float = 0.0, maximum: float = 100.0) -> float:
    return max(minimum, min(maximum, float(value)))


def _mean(values: Iterable[float]) -> float | None:
    clean = [float(value) for value in values if value is not None and math.isfinite(float(value))]
    return statistics.fmean(clean) if clean else None


def _validated_points(points: Iterable[dict]) -> list[dict]:
    rows = []
    for point in points or []:
        try:
            high = float(point["high"])
            low = float(point["low"])
            close = float(point["close"])
            volume = max(0.0, float(point.get("volume") or 0))
            if not all(math.isfinite(value) for value in (high, low, close, volume)):
                continue
            if high <= 0 or low <= 0 or close <= 0 or high < low:
                continue
            rows.append(
                {
                    "date": str(point["date"])[:10],
                    "high": high,
                    "low": low,
                    "close": close,
                    "volume": volume,
                    "amount": max(0.0, float(point.get("amount") or 0)),
                }
            )
        except (KeyError, TypeError, ValueError):
            continue
    rows.sort(key=lambda item: item["date"])
    if len(rows) < 21:
        raise ValueError("资金流模型至少需要21个有效交易日")
    return rows


def _money_flow_multiplier(point: dict) -> float:
    span = point["high"] - point["low"]
    if not span:
        return 0.0
    return ((point["close"] - point["low"]) - (point["high"] - point["close"])) / span


def _period_return(points: list[dict], period: int) -> float | None:
    if len(points) <= period:
        return None
    return (points[-1]["close"] / points[-period - 1]["close"] - 1) * 100


def _cmf(points: list[dict], period: int) -> float | None:
    selected = points[-period:]
    volume = sum(point["volume"] for point in selected)
    if not volume:
        return None
    return sum(_money_flow_multiplier(point) * point["volume"] for point in selected) / volume * 100


def _estimated_flow(points: list[dict], period: int) -> tuple[float | None, float | None]:
    selected = points[-period:]
    dollar_volume = [
        point["amount"] or point["volume"] * (point["high"] + point["low"] + point["close"]) / 3
        for point in selected
    ]
    total = sum(dollar_volume)
    if not total:
        return None, None
    estimated = sum(_money_flow_multiplier(point) * value for point, value in zip(selected, dollar_volume))
    return estimated, estimated / total * 100


def _up_down_volume_ratio(points: list[dict], period: int) -> float | None:
    if period < 2 or len(points) <= period:
        return None
    selected = points[-(period + 1):]
    up = sum(current["volume"] for previous, current in zip(selected, selected[1:]) if current["close"] > previous["close"])
    down = sum(current["volume"] for previous, current in zip(selected, selected[1:]) if current["close"] < previous["close"])
    if not down:
        return 99.0 if up else 1.0
    return up / down


def _relative_volume(points: list[dict], period: int) -> float | None:
    if len(points) <= period:
        return None
    baseline = _mean(point["volume"] for point in points[-period - 1:-1])
    return points[-1]["volume"] / baseline if baseline else None


def _close_location(points: list[dict], period: int) -> float | None:
    locations = []
    for point in points[-period:]:
        span = point["high"] - point["low"]
        if span:
            locations.append((point["close"] - point["low"]) / span * 100)
    return _mean(locations)


def _mfi(points: list[dict], period: int) -> float | None:
    if period < 2 or len(points) <= period:
        return None
    selected = points[-(period + 1):]
    typical = [(point["high"] + point["low"] + point["close"]) / 3 for point in selected]
    positive = 0.0
    negative = 0.0
    for index in range(1, len(selected)):
        raw = typical[index] * selected[index]["volume"]
        if typical[index] > typical[index - 1]:
            positive += raw
        elif typical[index] < typical[index - 1]:
            negative += raw
    if not negative:
        return 100.0 if positive else 50.0
    ratio = positive / negative
    return 100 - 100 / (1 + ratio)


def _obv_change(points: list[dict], period: int) -> float | None:
    if len(points) <= period:
        return None
    obv = [0.0]
    for previous, current in zip(points, points[1:]):
        direction = 1 if current["close"] > previous["close"] else -1 if current["close"] < previous["close"] else 0
        obv.append(obv[-1] + direction * current["volume"])
    previous_value = obv[-period - 1]
    change = obv[-1] - previous_value
    denominator = abs(previous_value)
    if not denominator:
        denominator = sum(point["volume"] for point in points[-period:])
    return change / denominator * 100 if denominator else None


def compute_capital_flow_metrics(points: Iterable[dict]) -> dict[str, dict[str, float | None]]:
    """Return the nine legacy indicators over 1D, 5D, and 20D windows."""
    rows = _validated_points(points)
    metrics = {indicator: {} for indicator in INDICATOR_IDS}
    for period in PERIODS:
        key = f"{period}d"
        estimated, ratio = _estimated_flow(rows, period)
        metrics["priceChange"][key] = _round(_period_return(rows, period))
        metrics["cmf"][key] = _round(_cmf(rows, period))
        metrics["estimatedNetFlow"][key] = _round(estimated, 2)
        metrics["flowRatio"][key] = _round(ratio)
        metrics["upDownVolumeRatio"][key] = _round(_up_down_volume_ratio(rows, period))
        metrics["rvol"][key] = _round(_relative_volume(rows, period))
        metrics["closeLocation"][key] = _round(_close_location(rows, period))
        metrics["mfi"][key] = _round(_mfi(rows, period))
        metrics["obvChange"][key] = _round(_obv_change(rows, period))
    return metrics


def _round(value: float | None, digits: int = 4) -> float | None:
    if value is None or not math.isfinite(float(value)):
        return None
    return round(float(value), digits)


def _weighted_period(values: dict[str, float | None]) -> float | None:
    available = [(values.get(f"{period}d"), PERIOD_WEIGHTS[period]) for period in PERIODS]
    available = [(float(value), weight) for value, weight in available if value is not None and math.isfinite(float(value))]
    if not available:
        return None
    total = sum(weight for _, weight in available)
    return sum(value * weight for value, weight in available) / total


def _direction_raw(metrics: dict) -> float:
    pressure = {}
    for period in PERIODS:
        key = f"{period}d"
        pressure[key] = _mean((metrics["cmf"][key], metrics["flowRatio"][key]))
    return _clamp(_weighted_period(pressure) or 0.0, -100, 100)


def _score_components(metrics: dict) -> dict[str, float]:
    direction_raw = _direction_raw(metrics)
    direction = _clamp(50 + direction_raw / 2)

    signs = {}
    for period in PERIODS:
        key = f"{period}d"
        value = _mean((metrics["cmf"][key], metrics["flowRatio"][key]))
        signs[key] = None if value is None else 100.0 if value > 2 else 0.0 if value < -2 else 50.0
    persistence = _weighted_period(signs) or 50.0

    ratio = _weighted_period(metrics["upDownVolumeRatio"])
    ratio_score = 50.0 if ratio is None else _clamp(ratio / (1 + ratio) * 100)
    obv = _weighted_period(metrics["obvChange"])
    obv_score = 50.0 if obv is None else _clamp(50 + _clamp(obv, -100, 100) / 2)
    participation = _mean((ratio_score, obv_score)) or 50.0

    location = _weighted_period(metrics["closeLocation"])
    mfi = _weighted_period(metrics["mfi"])
    confirmation = _mean((location, mfi)) or 50.0

    rvol = _weighted_period(metrics["rvol"])
    intensity_factor = _clamp((rvol or 1.0) / 2, 0, 1)
    intensity = _clamp(50 + direction_raw / 2 * intensity_factor)

    return {
        "directionPressure": round(direction, 1),
        "persistence": round(persistence, 1),
        "participation": round(participation, 1),
        "priceLocationConfirmation": round(confirmation, 1),
        "intensity": round(intensity, 1),
    }


def classify_price_flow_state(price_change: float, flow_score: float) -> dict:
    """Classify price/flow confirmation and divergence using explicit neutral bands."""
    if flow_score >= 60 and price_change >= 1:
        return {"id": "confirmed-inflow", "label": "上涨获资金确认", "tone": "positive"}
    if flow_score >= 60 and price_change <= 0:
        return {"id": "accumulation", "label": "价格偏弱 · 资金吸筹", "tone": "positive"}
    if flow_score <= 40 and price_change >= 1:
        return {"id": "distribution", "label": "价格上涨 · 资金背离", "tone": "warning"}
    if flow_score <= 40 and price_change <= -1:
        return {"id": "confirmed-outflow", "label": "下跌获流出确认", "tone": "negative"}
    return {"id": "mixed", "label": "价格与资金混合", "tone": "neutral"}


def _flow_history(points: list[dict], limit: int = 260) -> list[dict]:
    start = max(20, len(points) - limit)
    history = []
    for end in range(start, len(points)):
        window = points[: end + 1]
        metrics = compute_capital_flow_metrics(window)
        history.append({"date": window[-1]["date"], "value": round(50 + _direction_raw(metrics) / 2, 2)})
    return history


def build_capital_flow_snapshot(points: Iterable[dict], *, include_history: bool = True) -> dict:
    rows = _validated_points(points)
    metrics = compute_capital_flow_metrics(rows)
    components = _score_components(metrics)
    score = round(sum(components[key] * weight for key, weight in COMPONENT_WEIGHTS.items()), 1)
    valid_cells = sum(value is not None for indicator in metrics.values() for value in indicator.values())
    confidence = round(_clamp(valid_cells / 25 * 70 + min(len(rows) / 220, 1) * 30, 0, 96))
    price_change = metrics["priceChange"]["20d"] or 0.0
    return {
        "score": score,
        "confidence": confidence,
        "state": classify_price_flow_state(price_change, score),
        "components": components,
        "metrics": metrics,
        "history": _flow_history(rows) if include_history else [],
        "methodologyNote": "基于日线价格位置与成交量估算方向性资金压力，不代表真实机构订单净流入。",
    }
