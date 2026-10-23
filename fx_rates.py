"""USD/CNY reference rate for converting US holdings into the CNY portfolio base.

仅用于研究折算，不等于券商实际换汇价格。读取失败时返回上次成功的汇率并标记 stale；
从未成功过则抛出错误，由前端明确显示“汇率不可用”，不再静默使用写死的数字。
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone

from market_data_hub import get_yfinance_latest_series

USD_CNY_SYMBOL = "CNY=X"
SOURCE_NAME = "Yahoo Finance（CNY=X）"
_LOCK = threading.Lock()
_LAST_GOOD: dict | None = None


def _latest_rate(rows: list[dict]) -> tuple[float, str] | None:
    for row in reversed(rows or []):
        try:
            rate = float(row.get("close"))
        except (TypeError, ValueError):
            continue
        # 合理区间保护：防止错误报价把美股资产折算放大或缩小数倍。
        if 4 < rate < 12:
            return rate, str(row.get("date") or "")[:10]
    return None


def get_usd_cny_rate(*, force: bool = False, fetch=get_yfinance_latest_series) -> dict:
    global _LAST_GOOD
    fetched_at = datetime.now(timezone.utc).isoformat()
    try:
        latest = _latest_rate(fetch([USD_CNY_SYMBOL], force=force).get(USD_CNY_SYMBOL, []))
    except Exception:
        latest = None
    with _LOCK:
        if latest:
            rate, as_of = latest
            _LAST_GOOD = {
                "pair": "USD/CNY",
                "rate": round(rate, 6),
                "asOf": as_of,
                "source": SOURCE_NAME,
                "fetchedAt": fetched_at,
                "stale": False,
            }
            return dict(_LAST_GOOD)
        if _LAST_GOOD:
            return {**_LAST_GOOD, "stale": True}
    raise LookupError("USD/CNY 汇率暂时不可用")


def reset_fx_cache() -> None:
    global _LAST_GOOD
    with _LOCK:
        _LAST_GOOD = None
