"""Shared, batched OHLCV provider cache for all market-signal workspaces."""

from __future__ import annotations

import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date, timedelta
from typing import Iterable


CACHE_TTL_SECONDS = 30 * 60
REQUEST_TIMEOUT_SECONDS = 20
_BAOSTOCK_LOCK = threading.Lock()
_YFINANCE_LOCK = threading.Lock()
_CACHE: dict[str, dict[str, dict]] = {"baostock": {}, "yfinance": {}}


def _unique(symbols: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(str(symbol) for symbol in symbols if symbol))


def _finite(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _yahoo_rows(frame, symbol: str, *, batch: bool) -> list[dict]:
    rows = []
    for index, row in frame.iterrows():
        def field(name: str) -> float | None:
            try:
                value = row[(name, symbol)] if batch else row[name]
            except (KeyError, TypeError):
                return None
            return _finite(value)

        close = field("Close")
        if close is None:
            continue
        rows.append(
            {
                "date": str(index)[:10],
                "open": field("Open") or close,
                "high": field("High") or close,
                "low": field("Low") or close,
                "close": close,
                "volume": field("Volume") or 0.0,
                "amount": 0.0,
            }
        )
    return rows


def _fetch_yfinance_batch(symbols: list[str]) -> dict[str, list[dict]]:
    import yfinance as yf

    frame = yf.download(
        symbols,
        period="2y",
        interval="1d",
        auto_adjust=True,
        progress=False,
        threads=True,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    bundle = {}
    for symbol in symbols:
        rows = _yahoo_rows(frame, symbol, batch=len(symbols) > 1) if not frame.empty else []
        if len(rows) < 60:
            history = yf.Ticker(symbol).history(
                period="2y", interval="1d", auto_adjust=True, timeout=REQUEST_TIMEOUT_SECONDS
            )
            rows = _yahoo_rows(history, symbol, batch=False)
        bundle[symbol] = rows
    return bundle


def _fetch_baostock_batch(symbols: list[str]) -> dict[str, list[dict]]:
    import baostock as bs

    start_date = (date.today() - timedelta(days=800)).isoformat()
    fields = "date,code,open,high,low,close,volume,amount"
    login = bs.login()
    if login.error_code != "0":
        raise RuntimeError(f"BaoStock 登录失败: {login.error_msg}")
    try:
        bundle = {}
        for symbol in symbols:
            result = bs.query_history_k_data_plus(
                symbol, fields, start_date=start_date, frequency="d", adjustflag="3"
            )
            rows = []
            while result.error_code == "0" and result.next():
                values = result.get_row_data()
                try:
                    rows.append(
                        {
                            "date": values[0],
                            "open": float(values[2]),
                            "high": float(values[3]),
                            "low": float(values[4]),
                            "close": float(values[5]),
                            "volume": float(values[6] or 0),
                            "amount": float(values[7] or 0),
                        }
                    )
                except (IndexError, TypeError, ValueError):
                    continue
            if result.error_code != "0":
                raise RuntimeError(f"BaoStock {symbol} 查询失败: {result.error_msg}")
            bundle[symbol] = rows
        return bundle
    finally:
        bs.logout()


def _get_series(
    provider: str,
    symbols: Iterable[str],
    *,
    force: bool,
    minimum: int,
    lock: threading.Lock,
    fetcher,
) -> dict[str, list[dict]]:
    requested = _unique(symbols)
    now = time.time()
    with lock:
        cache = _CACHE[provider]
        missing = [
            symbol
            for symbol in requested
            if force or symbol not in cache or now >= float(cache[symbol].get("expires") or 0)
        ]
        if missing:
            fetched = fetcher(missing)
            expires = time.time() + CACHE_TTL_SECONDS
            for symbol in missing:
                rows = fetched.get(symbol) or []
                if len(rows) < minimum:
                    raise RuntimeError(f"{provider} {symbol} 有效日线不足")
                cache[symbol] = {"expires": expires, "rows": rows}
        result = {}
        for symbol in requested:
            rows = (cache.get(symbol) or {}).get("rows") or []
            if len(rows) < minimum:
                raise RuntimeError(f"{provider} {symbol} 有效日线不足")
            result[symbol] = deepcopy(rows)
        return result


def get_yfinance_series(
    symbols: Iterable[str], *, force: bool = False, minimum: int = 60
) -> dict[str, list[dict]]:
    return _get_series(
        "yfinance",
        symbols,
        force=force,
        minimum=minimum,
        lock=_YFINANCE_LOCK,
        fetcher=_fetch_yfinance_batch,
    )


def get_baostock_series(
    symbols: Iterable[str], *, force: bool = False, minimum: int = 121
) -> dict[str, list[dict]]:
    return _get_series(
        "baostock",
        symbols,
        force=force,
        minimum=minimum,
        lock=_BAOSTOCK_LOCK,
        fetcher=_fetch_baostock_batch,
    )


def warm_signal_market_data(
    *, baostock_symbols: Iterable[str], yfinance_symbols: Iterable[str], force: bool = False
) -> None:
    """Warm each provider once with the union needed by all market workspaces."""
    baostock = _unique(baostock_symbols)
    yfinance = _unique(yfinance_symbols)
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = []
        if baostock:
            futures.append(executor.submit(get_baostock_series, baostock, force=force, minimum=121))
        if yfinance:
            futures.append(executor.submit(get_yfinance_series, yfinance, force=force, minimum=121))
        for future in futures:
            future.result()


def reset_market_data_hub_cache() -> None:
    """Clear process-local raw-series cache; intended for deterministic tests."""
    with _BAOSTOCK_LOCK, _YFINANCE_LOCK:
        _CACHE["baostock"].clear()
        _CACHE["yfinance"].clear()
