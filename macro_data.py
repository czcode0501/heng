"""Source-backed macroeconomic data pipeline for the Quant Desk."""

from __future__ import annotations

import csv
import io
import math
from collections.abc import Iterable


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
