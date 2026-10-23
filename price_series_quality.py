"""Detect and correct impossible daily jumps in index/ETF proxy price series.

免费行情源偶尔漏记 ETF 份额拆分，或出现单日错误报价。对于有涨跌幅限制的指数/ETF，
超过合理上限的单日变动只能是数据问题：
- 单日尖峰：当日跳变、次日回到原水平 → 剔除该报价；
- 份额拆分/合并：新价位持续，且比例接近整数拆分比例 → 按拆分比例调整此前历史；
- 无法识别：保留原数据，标记为异常，由调用方降低可信度。
"""

from __future__ import annotations

SPLIT_RATIOS = (2, 3, 4, 5, 10)
PRICE_FIELDS = ("open", "high", "low", "close")


def _move(current: float, previous: float) -> float:
    return current / previous - 1


def _remove_spikes(rows: list[dict], max_daily_move: float) -> tuple[list[dict], list[dict]]:
    kept: list[dict] = []
    corrections = []
    index = 0
    while index < len(rows):
        row = rows[index]
        if kept and index + 1 < len(rows):
            previous, following = kept[-1]["close"], rows[index + 1]["close"]
            into, out_of = _move(row["close"], previous), _move(following, row["close"])
            reverted = abs(_move(following, previous)) <= max_daily_move
            if abs(into) > max_daily_move and abs(out_of) > max_daily_move and into * out_of < 0 and reverted:
                corrections.append({"date": row["date"], "type": "spike-removed", "move": round(into * 100, 1)})
                index += 1
                continue
        kept.append(row)
        index += 1
    return kept, corrections


def _split_factor(ratio: float, tolerance: float) -> float | None:
    """Return the price multiplier for earlier rows, or None when no split ratio fits."""
    best = None
    for split in SPLIT_RATIOS:
        for factor in (1 / split, float(split)):
            residual = abs(ratio / factor - 1)
            if residual <= tolerance and (best is None or residual < best[0]):
                best = (residual, factor)
    return best[1] if best else None


def repair_price_series(
    points: list[dict],
    *,
    max_daily_move: float = 0.2,
    split_tolerance: float = 0.1,
) -> tuple[list[dict], list[dict]]:
    """Return (cleaned rows, corrections). Input rows must be sorted by date with positive closes."""
    rows = [dict(point) for point in points]
    rows, corrections = _remove_spikes(rows, max_daily_move)
    for index in range(1, len(rows)):
        ratio = rows[index]["close"] / rows[index - 1]["close"]
        if abs(ratio - 1) <= max_daily_move:
            continue
        factor = _split_factor(ratio, split_tolerance)
        if factor is None:
            corrections.append({"date": rows[index]["date"], "type": "unresolved-jump", "move": round((ratio - 1) * 100, 1)})
            continue
        for earlier in rows[:index]:
            for field in PRICE_FIELDS:
                if earlier.get(field) is not None:
                    earlier[field] = earlier[field] * factor
            if earlier.get("volume") is not None:
                earlier["volume"] = earlier["volume"] / factor
        split = round(1 / factor) if factor < 1 else round(factor)
        corrections.append(
            {
                "date": rows[index]["date"],
                "type": "split-adjusted" if factor < 1 else "reverse-split-adjusted",
                "ratio": split,
                "move": round((ratio - 1) * 100, 1),
            }
        )
    corrections.sort(key=lambda item: item["date"])
    return rows, corrections


def describe_correction(correction: dict) -> str:
    date = correction["date"]
    if correction["type"] == "spike-removed":
        return f"{date} 单日异常报价（{correction['move']:+.1f}%，次日回落）已剔除"
    if correction["type"] == "split-adjusted":
        return f"{date} 疑似份额拆分 1:{correction['ratio']}，此前价格已按比例复权"
    if correction["type"] == "reverse-split-adjusted":
        return f"{date} 疑似份额合并 {correction['ratio']}:1，此前价格已按比例复权"
    return f"{date} 单日变动 {correction['move']:+.1f}% 超出合理范围且无法识别原因，请谨慎参考"
