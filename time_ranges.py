"""Shared validation and date selection for every signal workspace."""

from __future__ import annotations

from datetime import date, timedelta


VALID_SIGNAL_RANGES = {"1d", "1w", "1m", "3m", "1y", "custom"}


def validate_signal_range(range_id: str, custom_start: str = "") -> tuple[str, str | None]:
    selected = (range_id or "1m").strip().lower()
    if selected not in VALID_SIGNAL_RANGES:
        raise ValueError("时间范围不受支持")
    if selected != "custom":
        return selected, None
    if not custom_start:
        raise ValueError("自定义时间范围需要起始日期")
    parsed = date.fromisoformat(custom_start)
    if parsed > date.today():
        raise ValueError("自定义起始日期不能晚于今天")
    return selected, parsed.isoformat()


def _subtract_months(value: date, months: int) -> date:
    month_index = value.year * 12 + value.month - 1 - months
    year, month_zero = divmod(month_index, 12)
    month = month_zero + 1
    day = min(value.day, (date(year + (month == 12), month % 12 + 1, 1) - timedelta(days=1)).day)
    return date(year, month, day)


def select_signal_rows(rows: list[dict], range_id: str = "1m", custom_start: str | None = None) -> list[dict]:
    clean = sorted(
        (row for row in rows if isinstance(row, dict) and str(row.get("date", ""))[:10]),
        key=lambda row: str(row["date"])[:10],
    )
    if not clean:
        return []
    selected, custom = validate_signal_range(range_id, custom_start or "")
    if selected == "1d":
        return clean[-2:]
    latest = date.fromisoformat(str(clean[-1]["date"])[:10])
    if selected == "custom":
        target = date.fromisoformat(custom)
    elif selected == "1w":
        target = latest - timedelta(days=7)
    elif selected == "1m":
        target = _subtract_months(latest, 1)
    elif selected == "3m":
        target = _subtract_months(latest, 3)
    else:
        target = date(latest.year - 1, latest.month, min(latest.day, 28) if latest.month == 2 else latest.day)
    result = [row for row in clean if str(row["date"])[:10] >= target.isoformat()]
    return result if len(result) >= 2 else clean[-2:]
