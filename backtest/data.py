"""Long daily histories for replay, cached under .cache/backtest/ (git-ignored)."""

from __future__ import annotations

import json
import subprocess
import sys
import time
import warnings
from pathlib import Path

CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache" / "backtest"
CACHE_MAX_AGE_SECONDS = 24 * 60 * 60

US_TIMING_SYMBOLS = {"sp500": "^GSPC", "spy": "SPY", "rsp": "RSP", "iwm": "IWM", "qqq": "QQQ", "hyg": "HYG", "lqd": "LQD", "vix": "^VIX"}
CN_TIMING_SYMBOLS = {"csi300": "sh.000300", "sse": "sh.000001", "szse": "sz.399106", "chinext": "sz.399006", "csi1000": "sh.000852"}

# 个股回放样本：当前美股大盘股（存在幸存者偏差，报告中会注明）。sectorId 为 GICS 一级行业。
STOCK_UNIVERSE = {
    "AAPL": "information-technology", "MSFT": "information-technology", "NVDA": "information-technology",
    "AMD": "information-technology", "INTC": "information-technology",
    "MA": "financials", "V": "financials", "JPM": "financials", "GS": "financials",
    "AMZN": "consumer-discretionary", "TSLA": "consumer-discretionary", "HD": "consumer-discretionary", "NKE": "consumer-discretionary",
    "GOOGL": "communication-services", "META": "communication-services", "NFLX": "communication-services", "DIS": "communication-services",
    "XOM": "energy", "CVX": "energy",
    "JNJ": "health-care", "UNH": "health-care", "PFE": "health-care", "MRK": "health-care",
    "PG": "consumer-staples", "KO": "consumer-staples", "WMT": "consumer-staples", "COST": "consumer-staples", "PEP": "consumer-staples",
    "CAT": "industrials", "BA": "industrials",
}


def _yahoo_rows(frame) -> list[dict]:
    rows = []
    for timestamp, row in frame.iterrows():
        close = float(row["Close"])
        if close != close:  # NaN
            continue
        rows.append({
            "date": str(timestamp)[:10],
            "open": float(row["Open"]), "high": float(row["High"]), "low": float(row["Low"]), "close": close,
            "volume": float(row.get("Volume") or 0), "amount": 0.0,
        })
    return rows


def _fetch_us(symbols: list[str], start: str) -> dict[str, list[dict]]:
    warnings.filterwarnings("ignore")
    import yfinance as yf

    # 与应用的日线口径一致：复权价（auto_adjust）。
    return {symbol: _yahoo_rows(yf.Ticker(symbol).history(start=start, auto_adjust=True)) for symbol in symbols}


def _fetch_cn(codes: list[str], start: str) -> dict[str, list[dict]]:
    import baostock as bs

    bs.login()
    try:
        result = {}
        for code in codes:
            query = bs.query_history_k_data_plus(code, "date,open,high,low,close,volume,amount", start_date=start, frequency="d")
            rows = []
            while query.error_code == "0" and query.next():
                day, open_, high, low, close, volume, amount = query.get_row_data()
                if close:
                    rows.append({"date": day, "open": float(open_), "high": float(high), "low": float(low),
                                 "close": float(close), "volume": float(volume or 0), "amount": float(amount or 0)})
            if query.error_code != "0":
                raise RuntimeError(f"BaoStock {code}: {query.error_msg}")
            result[code] = rows
        return result
    finally:
        bs.logout()


def _cached(name: str, fetch, refresh: bool) -> dict[str, list[dict]]:
    path = CACHE_DIR / f"{name}.json"
    if not refresh and path.exists() and time.time() - path.stat().st_mtime < CACHE_MAX_AGE_SECONDS:
        return json.loads(path.read_text(encoding="utf-8"))
    data = fetch()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")
    return data


def load_us(refresh: bool = False) -> dict[str, list[dict]]:
    from sector_rotation_sources import US_SECTORS

    symbols = sorted(set(US_TIMING_SYMBOLS.values()) | {sector["symbol"] for sector in US_SECTORS} | set(STOCK_UNIVERSE))
    return _cached("us_daily", lambda: _fetch_us(symbols, "2008-01-01"), refresh)


def _fetch_cn_isolated(codes: list[str], start: str, *, attempts: int = 3, timeout: int = 180) -> dict[str, list[dict]]:
    """Run the BaoStock download in a child process with a timeout and retries.

    BaoStock 的套接字没有超时；与其他进程（例如正在运行的数据服务）同时登录时，会话可能被挤掉，
    查询会一直挂起。放在子进程里可以超时终止并重试，而不是让回测无限等待。
    """
    script = (
        "import json, sys; sys.path.insert(0, sys.argv[1]); from backtest.data import _fetch_cn; "
        "print(json.dumps(_fetch_cn(json.loads(sys.argv[2]), sys.argv[3])))"
    )
    root = str(Path(__file__).resolve().parent.parent)
    last_error = ""
    for attempt in range(1, attempts + 1):
        try:
            completed = subprocess.run(
                [sys.executable, "-X", "utf8", "-c", script, root, json.dumps(codes), start],
                capture_output=True, text=True, encoding="utf-8", timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            last_error = f"第 {attempt} 次超时（{timeout} 秒）"
            continue
        if completed.returncode == 0:
            payload = next((line for line in reversed(completed.stdout.splitlines()) if line.startswith("{")), "")
            if payload:
                return json.loads(payload)
        last_error = (completed.stderr or completed.stdout).strip().splitlines()[-1:] or ["未知错误"]
        last_error = f"第 {attempt} 次失败：{last_error[0]}"
    raise RuntimeError(f"BaoStock 下载失败：{last_error}")


def load_cn(refresh: bool = False) -> dict[str, list[dict]]:
    return _cached("cn_daily", lambda: _fetch_cn_isolated(list(CN_TIMING_SYMBOLS.values()), "2012-01-01"), refresh)
