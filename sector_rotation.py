"""Deterministic sector-rotation scoring, phase, and allocation rules."""

from __future__ import annotations

import math
import statistics
from copy import deepcopy
from typing import Iterable

from capital_flow import build_capital_flow_snapshot


DIMENSION_WEIGHTS = {
    "relativeMomentum": 30,
    "trendQuality": 25,
    "breadth": 15,
    "capitalFlow": 15,
    "riskEfficiency": 10,
    "macroFit": 5,
}

DIMENSION_LABELS = {
    "relativeMomentum": "相对动量",
    "trendQuality": "趋势质量",
    "breadth": "市场宽度",
    "capitalFlow": "资金确认",
    "riskEfficiency": "风险效率",
    "macroFit": "宏观适配",
}

MOMENTUM_WINDOWS = ((5, 0.10), (20, 0.35), (60, 0.35), (120, 0.20))


def _clamp(value: float, minimum: float = 0.0, maximum: float = 100.0) -> float:
    return max(minimum, min(maximum, float(value)))


def _mean(values: Iterable[float]) -> float:
    clean = [float(value) for value in values if math.isfinite(float(value))]
    return statistics.fmean(clean) if clean else 0.0


def _validated_series(points: Iterable[dict], name: str, minimum: int = 60) -> list[dict]:
    rows = []
    for point in points or []:
        try:
            close = float(point["close"])
            if not math.isfinite(close) or close <= 0:
                continue
            rows.append(
                {
                    "date": str(point["date"])[:10],
                    "high": max(float(point.get("high") or close), close),
                    "low": min(float(point.get("low") or close), close),
                    "close": close,
                    "volume": max(0.0, float(point.get("volume") or 0)),
                    "amount": max(0.0, float(point.get("amount") or 0)),
                }
            )
        except (KeyError, TypeError, ValueError):
            continue
    rows.sort(key=lambda item: item["date"])
    if len(rows) < minimum:
        raise ValueError(f"{name}至少需要{minimum}个有效交易日")
    return rows


def _period_return(points: list[dict], periods: int) -> float | None:
    if len(points) <= periods:
        return None
    return (points[-1]["close"] / points[-periods - 1]["close"] - 1) * 100


def _average(points: list[dict], periods: int, *, offset: int = 0) -> float:
    end = len(points) - offset
    start = max(0, end - periods)
    return _mean(point["close"] for point in points[start:end])


def _volatility(points: list[dict], periods: int = 60) -> float:
    selected = points[-(periods + 1):]
    returns = [
        current["close"] / previous["close"] - 1
        for previous, current in zip(selected, selected[1:])
        if previous["close"]
    ]
    return statistics.pstdev(returns) * math.sqrt(252) * 100 if len(returns) > 1 else 0.0


def _drawdown(points: list[dict], periods: int = 120) -> float:
    values = [point["close"] for point in points[-periods:]]
    peak = values[0]
    worst = 0.0
    for value in values:
        peak = max(peak, value)
        worst = min(worst, (value / peak - 1) * 100)
    return worst


def _percentiles(values: dict[str, float], *, higher_is_better: bool = True) -> dict[str, float]:
    ordered = sorted(values.items(), key=lambda item: (item[1], item[0]))
    count = max(1, len(ordered) - 1)
    result = {key: index / count * 100 for index, (key, _) in enumerate(ordered)}
    if not higher_is_better:
        result = {key: 100 - value for key, value in result.items()}
    return result


def _relative_momentum(points: list[dict], benchmark: list[dict]) -> tuple[float, list[str]]:
    components = []
    missing = []
    for periods, weight in MOMENTUM_WINDOWS:
        sector_return = _period_return(points, periods)
        benchmark_return = _period_return(benchmark, periods)
        if sector_return is None or benchmark_return is None:
            missing.append(f"缺少{periods}日动量")
            continue
        components.append((sector_return - benchmark_return, weight))
    if not components:
        return 0.0, missing
    weight_sum = sum(weight for _, weight in components)
    return sum(value * weight for value, weight in components) / weight_sum, missing


def _trend_score(points: list[dict]) -> tuple[float, float]:
    price = points[-1]["close"]
    ma20 = _average(points, 20)
    ma60 = _average(points, 60)
    ma120 = _average(points, 120)
    previous_ma20 = _average(points, 20, offset=min(10, len(points) - 20))
    previous_ma60 = _average(points, 60, offset=min(10, len(points) - 60))
    score = 0.0
    score += 25 if price > ma20 else 0
    score += 25 if price > ma60 else 0
    score += 20 if len(points) >= 120 and price > ma120 else 0
    score += 15 if ma20 > previous_ma20 else 0
    score += 15 if ma60 > previous_ma60 else 0
    extension = (price / ma20 - 1) * 100 if ma20 else 0.0
    return score, extension


def _breadth_proxy(points: list[dict]) -> float:
    selected = points[-61:]
    up_ratio = sum(current["close"] > previous["close"] for previous, current in zip(selected[-21:], selected[-20:])) / 20
    values = [point["close"] for point in selected]
    span = max(values) - min(values)
    range_position = (values[-1] - min(values)) / span if span else 0.5
    return _clamp((up_ratio * 0.55 + range_position * 0.45) * 100)


def _risk_efficiency(points: list[dict], benchmark: list[dict]) -> float:
    relative = (_period_return(points, 60) or 0.0) - (_period_return(benchmark, 60) or 0.0)
    volatility = max(_volatility(points), 1.0)
    return relative / volatility + _drawdown(points) / 100


def _confidence(points: list[dict], issues: list[str]) -> int:
    coverage = min(len(points) / 220, 1) * 55
    critical = 25 if len(points) >= 121 else 0
    freshness = 20
    return round(_clamp(coverage + critical + freshness - max(0, len(issues) - 1) * 5, 0, 96))


def classify_rotation_phase(score: float, score_change: float, trend: float, extension: float) -> dict:
    if score >= 75 and extension >= 2.5 and score_change <= 0:
        return {"id": "overheated", "label": "过热", "tone": "warning"}
    if score >= 70 and trend >= 60 and score_change >= 0:
        return {"id": "leading", "label": "领先", "tone": "positive"}
    if score >= 70:
        return {"id": "strong", "label": "强势延续", "tone": "positive"}
    if score < 40 and trend < 45:
        return {"id": "lagging", "label": "落后", "tone": "negative"}
    if score < 60 and score_change >= 2 and trend >= 45:
        return {"id": "repairing", "label": "修复", "tone": "neutral"}
    if score < 60 and score_change <= -2:
        return {"id": "weakening", "label": "转弱", "tone": "negative"}
    return {"id": "neutral", "label": "中性", "tone": "neutral"}


def _action_for(phase: dict, confidence: int) -> dict:
    if confidence < 70:
        return {"id": "watch", "label": "数据不足 · 观察"}
    actions = {
        "leading": ("increase", "增配"),
        "strong": ("hold", "持有"),
        "overheated": ("trim", "防追高 · 减配"),
        "weakening": ("reduce", "减配"),
        "lagging": ("exit", "退出/回避"),
        "repairing": ("watch", "进入观察"),
        "neutral": ("watch", "观察"),
    }
    action_id, label = actions[phase["id"]]
    return {"id": action_id, "label": label}


def _timing_overlay(score: float) -> dict:
    if score >= 70:
        return {"regime": "进攻", "maxExposure": 80}
    if score >= 58:
        return {"regime": "偏多", "maxExposure": 60}
    if score >= 45:
        return {"regime": "中性", "maxExposure": 40}
    if score >= 30:
        return {"regime": "偏空", "maxExposure": 20}
    return {"regime": "风险关闭", "maxExposure": 0}


def _snapshot(benchmark: list[dict], definitions: list[dict], offset: int = 0) -> list[dict]:
    benchmark_slice = benchmark[:-offset] if offset else benchmark
    raw = []
    for definition in definitions:
        points = definition["points"][:-offset] if offset else definition["points"]
        momentum, issues = _relative_momentum(points, benchmark_slice)
        trend, extension = _trend_score(points)
        capital_flow = build_capital_flow_snapshot(points, include_history=False)
        raw.append(
            {
                "id": definition["id"],
                "momentumRaw": momentum,
                "trendQuality": trend,
                "breadth": _breadth_proxy(points),
                "capitalFlow": capital_flow,
                "riskRaw": _risk_efficiency(points, benchmark_slice),
                "macroFit": float(definition.get("macroFit", 50)),
                "extension": extension,
                "issues": issues + list(definition.get("issues", [])),
                "confidence": _confidence(points, issues + list(definition.get("issues", []))),
            }
        )
    momentum_scores = _percentiles({item["id"]: item["momentumRaw"] for item in raw})
    risk_scores = _percentiles({item["id"]: item["riskRaw"] for item in raw})
    for item in raw:
        item["dimensions"] = {
            "relativeMomentum": round(momentum_scores[item["id"]], 1),
            "trendQuality": round(item["trendQuality"], 1),
            "breadth": round(item["breadth"], 1),
            "capitalFlow": round(item["capitalFlow"]["score"], 1),
            "riskEfficiency": round(risk_scores[item["id"]], 1),
            "macroFit": round(item["macroFit"], 1),
        }
        item["score"] = round(
            sum(item["dimensions"][key] * weight / 100 for key, weight in DIMENSION_WEIGHTS.items()),
            1,
        )
    return raw


def _normalized_history(points: list[dict], limit: int = 260) -> list[dict]:
    selected = points[-limit:]
    base = selected[0]["close"]
    return [{"date": point["date"], "value": round(point["close"] / base * 100, 4)} for point in selected]


def _assign_weights(sectors: list[dict], max_exposure: int) -> None:
    eligible = [
        sector for sector in sectors
        if sector["score"] >= 60 and sector["confidence"] >= 70 and sector["action"]["id"] in {"increase", "hold"}
    ][:3]
    strength_sum = sum(max(sector["score"] - 50, 0) for sector in eligible)
    for sector in sectors:
        sector["targetWeight"] = 0.0
    if strength_sum and max_exposure:
        remaining = float(max_exposure)
        for sector in eligible:
            proposed = max_exposure * max(sector["score"] - 50, 0) / strength_sum
            sector["targetWeight"] = round(min(30.0, proposed, remaining), 1)
            remaining -= sector["targetWeight"]

    for sector in sectors:
        if sector["targetWeight"] == 0 and sector["action"]["id"] in {"increase", "hold"}:
            sector["action"] = (
                {"id": "watch", "label": "风险关闭"}
                if not max_exposure
                else {"id": "watch", "label": "候补观察"}
            )


def build_sector_market(
    market_id: str,
    title: str,
    benchmark_points: Iterable[dict],
    sector_definitions: list[dict],
    source: dict,
    *,
    timing_score: float = 50,
) -> dict:
    """Build one independently ranked market from source-backed daily histories."""
    benchmark = _validated_series(benchmark_points, f"{title}基准", minimum=121)
    definitions = []
    for definition in sector_definitions:
        item = deepcopy(definition)
        item["points"] = _validated_series(item.get("points", []), item.get("title", "板块"))
        definitions.append(item)
    if len(definitions) != 11:
        raise ValueError(f"{title}需要11个一级板块，当前为{len(definitions)}个")

    current = _snapshot(benchmark, definitions)
    previous = _snapshot(benchmark, definitions, offset=5)
    previous_ranks = {
        item["id"]: rank for rank, item in enumerate(sorted(previous, key=lambda row: row["score"], reverse=True), 1)
    }
    previous_scores = {item["id"]: item["score"] for item in previous}
    current_by_id = {item["id"]: item for item in current}
    sectors = []
    for definition in definitions:
        score = current_by_id[definition["id"]]
        capital_flow = build_capital_flow_snapshot(definition["points"])
        score_change = round(score["score"] - previous_scores[definition["id"]], 1)
        phase = classify_rotation_phase(score["score"], score_change, score["trendQuality"], score["extension"])
        sectors.append(
            {
                "id": definition["id"],
                "title": definition["title"],
                "english": definition.get("english", ""),
                "symbol": definition.get("symbol", ""),
                "instrument": definition.get("instrument", "指数/ETF代理"),
                "score": score["score"],
                "scoreChange": score_change,
                "confidence": score["confidence"],
                "dimensions": score["dimensions"],
                "capitalFlow": capital_flow,
                "phase": phase,
                "action": _action_for(phase, score["confidence"]),
                "returns": {
                    f"{period}d": round(_period_return(definition["points"], period) or 0.0, 2)
                    for period in (5, 20, 60, 120)
                },
                "history": _normalized_history(definition["points"]),
                "dataQuality": {
                    "status": "live" if score["confidence"] >= 70 else "partial",
                    "issues": score["issues"],
                    "observations": len(definition["points"]),
                },
            }
        )
    sectors.sort(key=lambda sector: (-sector["score"], sector["id"]))
    for rank, sector in enumerate(sectors, 1):
        sector["rank"] = rank
        sector["rankChange"] = previous_ranks[sector["id"]] - rank

    timing = {"score": round(float(timing_score), 1), **_timing_overlay(float(timing_score))}
    _assign_weights(sectors, timing["maxExposure"])
    leaders = [sector for sector in sectors if sector["phase"]["id"] in {"leading", "strong"}]
    repairing = [sector for sector in sectors if sector["phase"]["id"] == "repairing"]
    weakening = [sector for sector in sectors if sector["phase"]["id"] in {"weakening", "lagging"}]
    allocated = round(sum(sector["targetWeight"] for sector in sectors), 1)
    return {
        "id": market_id,
        "title": title,
        "status": "live",
        "asOf": max(definition["points"][-1]["date"] for definition in definitions),
        "source": source,
        "benchmark": {
            "name": "沪深300" if market_id == "china" else "标普500 ETF",
            "history": _normalized_history(benchmark),
        },
        "timing": timing,
        "summary": {
            "stance": "进攻" if allocated >= 50 else "均衡" if allocated >= 30 else "谨慎" if allocated else "防守",
            "allocated": allocated,
            "cash": round(100 - allocated, 1),
            "leader": leaders[0]["title"] if leaders else sectors[0]["title"],
            "repairing": repairing[0]["title"] if repairing else "暂无",
            "weakening": weakening[0]["title"] if weakening else "暂无",
            "message": f"{sectors[0]['title']}当前排名第1；模型允许板块仓位最高{timing['maxExposure']}%。",
        },
        "sectors": sectors,
        "dataQuality": {
            "status": "live" if all(sector["confidence"] >= 70 for sector in sectors) else "partial",
            "availableSectors": len(sectors),
            "expectedSectors": 11,
        },
    }
