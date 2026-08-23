"""Full-market universe parsing and low-cost first-stage stock screening.

The scanner deliberately separates cheap, batched prescreening from the
existing VRVP/five-layer decision. Thousands of stocks pass through this
module; only a small ranked shortlist reaches the expensive decision layer.
"""

from __future__ import annotations

import csv
import io
import json
import math
import os
import re
import statistics
import urllib.request
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any


US_EXCHANGE_NAMES = {
    "Q": "NASDAQ",
    "G": "NASDAQ",
    "S": "NASDAQ",
    "A": "NYSE American",
    "N": "NYSE",
    "P": "NYSE Arca",
    "Z": "Cboe",
    "V": "IEX",
}
US_PRODUCT_PATTERNS = (
    r"\bwarrants?\b",
    r"\brights?\b",
    r"\bunits?\b",
    r"\bpreferred\b",
    r"\bpreference\b",
    r"\bdebt\b",
    r"\bnotes? due\b",
    r"\bbonds?\b",
    r"\bdebentures?\b",
    r"\bfund\b",
    r"\betf\b",
    r"\betn\b",
    r"\bindex\b",
)
CN_SECTOR_KEYWORDS = {
    "energy": ("石油", "煤炭", "油气", "能源", "天然气", "焦炭"),
    "materials": ("有色", "钢铁", "化工", "材料", "建材", "矿业", "造纸", "玻璃", "水泥"),
    "industrials": ("机械", "设备", "军工", "航空", "航天", "运输", "物流", "建筑", "电气", "工业"),
    "consumer-discretionary": ("汽车", "家电", "旅游", "酒店", "传媒", "服装", "零售", "休闲", "消费电子"),
    "consumer-staples": ("食品", "饮料", "白酒", "农业", "农林", "牧渔", "日用品", "乳业"),
    "health-care": ("医药", "医疗", "生物", "制药", "健康", "器械"),
    "financials": ("银行", "证券", "保险", "金融", "多元金融"),
    "information-technology": ("半导体", "计算机", "软件", "电子", "通信设备", "信息技术", "互联网服务"),
    "communication-services": ("电信", "通信服务", "广播电视", "出版", "广告"),
    "utilities": ("电力", "公用事业", "燃气", "水务", "环保"),
    "real-estate": ("房地产", "地产", "物业"),
}
CN_SECTOR_PREFIXES = {
    "A": "consumer-staples",
    "B": "materials",
    "C": "industrials",
    "D": "utilities",
    "E": "industrials",
    "F": "consumer-discretionary",
    "G": "industrials",
    "H": "consumer-discretionary",
    "I": "information-technology",
    "J": "financials",
    "K": "real-estate",
    "L": "industrials",
    "M": "information-technology",
    "N": "utilities",
    "O": "consumer-discretionary",
    "P": "consumer-discretionary",
    "Q": "health-care",
    "R": "communication-services",
}
SCANNER_SCHEMA_VERSION = 1
UNIVERSE_SCHEMA_VERSION = 2
NASDAQ_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"
NASDAQ_OTHER_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"


def _pipe_rows(text: str) -> list[dict[str, str]]:
    lines = [line for line in str(text or "").splitlines() if line and not line.startswith("File Creation Time")]
    if not lines:
        return []
    return [dict(row) for row in csv.DictReader(io.StringIO("\n".join(lines)), delimiter="|")]


def _normal_us_equity(name: str) -> bool:
    normalized = str(name or "").strip().lower()
    return bool(normalized) and not any(re.search(pattern, normalized) for pattern in US_PRODUCT_PATTERNS)


def _yahoo_us_symbol(symbol: str) -> str:
    return str(symbol or "").strip().upper().replace(".", "-")


def parse_nasdaq_universe(nasdaq_text: str, other_text: str) -> list[dict[str, str]]:
    """Parse Nasdaq Trader's two official symbol-directory files."""
    universe: dict[str, dict[str, str]] = {}
    for row in _pipe_rows(nasdaq_text):
        symbol = str(row.get("Symbol") or "").strip().upper()
        name = str(row.get("Security Name") or "").strip()
        status = str(row.get("Financial Status") or "N").strip().upper()
        if (
            not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,13}", symbol)
            or str(row.get("Test Issue") or "").upper() != "N"
            or str(row.get("ETF") or "").upper() == "Y"
            or status not in {"", "N"}
            or not _normal_us_equity(name)
        ):
            continue
        provider_symbol = _yahoo_us_symbol(symbol)
        category = str(row.get("Market Category") or "Q").upper()
        universe[provider_symbol] = {
            "symbol": symbol,
            "providerSymbol": provider_symbol,
            "name": name,
            "market": "united-states",
            "exchange": US_EXCHANGE_NAMES.get(category, "NASDAQ"),
            "currency": "USD",
            "source": "Nasdaq Trader Symbol Directory",
        }

    for row in _pipe_rows(other_text):
        symbol = str(row.get("ACT Symbol") or "").strip().upper()
        name = str(row.get("Security Name") or "").strip()
        exchange_code = str(row.get("Exchange") or "").strip().upper()
        if (
            not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,13}", symbol)
            or str(row.get("Test Issue") or "").upper() != "N"
            or str(row.get("ETF") or "").upper() == "Y"
            or exchange_code not in {"A", "N", "P", "Z", "V"}
            or not _normal_us_equity(name)
        ):
            continue
        provider_symbol = _yahoo_us_symbol(symbol)
        universe.setdefault(
            provider_symbol,
            {
                "symbol": symbol,
                "providerSymbol": provider_symbol,
                "name": name,
                "market": "united-states",
                "exchange": US_EXCHANGE_NAMES[exchange_code],
                "currency": "USD",
                "source": "Nasdaq Trader Symbol Directory",
            },
        )
    return sorted(universe.values(), key=lambda item: item["providerSymbol"])


def _download_text(url: str, *, timeout: float = 20.0) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "QuantDeskScanner/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def fetch_nasdaq_universe() -> list[dict[str, str]]:
    return parse_nasdaq_universe(
        _download_text(NASDAQ_LISTED_URL),
        _download_text(NASDAQ_OTHER_LISTED_URL),
    )


def classify_china_sector(industry: str) -> str | None:
    normalized = str(industry or "").strip()
    for sector_id, keywords in CN_SECTOR_KEYWORDS.items():
        if any(keyword in normalized for keyword in keywords):
            return sector_id
    prefix = re.match(r"^([A-S])\d{2}", normalized.upper())
    return CN_SECTOR_PREFIXES.get(prefix.group(1)) if prefix else None


def _baostock_to_yahoo(code: str) -> str:
    exchange, symbol = str(code or "").lower().split(".", 1)
    suffix = {"sh": "SS", "sz": "SZ", "bj": "BJ"}[exchange]
    return f"{symbol}.{suffix}"


def parse_baostock_universe(
    basic_rows: Iterable[list[str]], industry_rows: Iterable[list[str]] = ()
) -> list[dict[str, str | None]]:
    """Normalize BaoStock's complete security table into active A-share equities."""
    industries = {
        row[1]: row[3]
        for row in industry_rows
        if len(row) >= 4 and str(row[1]).startswith(("sh.", "sz.", "bj."))
    }
    universe = []
    for row in basic_rows:
        if len(row) < 6 or row[4] != "1" or row[5] != "1":
            continue
        code = str(row[0]).lower()
        if not re.fullmatch(r"(?:sh|sz|bj)\.\d{6}", code):
            continue
        provider_symbol = _baostock_to_yahoo(code)
        industry = industries.get(code, "")
        universe.append(
            {
                "symbol": code.split(".", 1)[1],
                "providerSymbol": provider_symbol,
                "baostockSymbol": code,
                "name": str(row[1]),
                "market": "china",
                "exchange": {"sh": "上海", "sz": "深圳", "bj": "北京"}[code[:2]],
                "currency": "CNY",
                "industry": industry or None,
                "sectorId": classify_china_sector(industry),
                "source": "BaoStock",
            }
        )
    return sorted(universe, key=lambda item: str(item["providerSymbol"]))


def _baostock_rows(result) -> list[list[str]]:
    rows = []
    while result.error_code == "0" and result.next():
        rows.append(result.get_row_data())
    if result.error_code != "0":
        raise RuntimeError(result.error_msg or "BaoStock query failed")
    return rows


def fetch_baostock_universe() -> list[dict[str, str | None]]:
    import baostock as bs

    login = bs.login()
    if login.error_code != "0":
        raise RuntimeError(f"BaoStock 登录失败: {login.error_msg}")
    try:
        basic_rows = _baostock_rows(bs.query_stock_basic())
        industry_rows = _baostock_rows(bs.query_stock_industry())
        return parse_baostock_universe(basic_rows, industry_rows)
    finally:
        bs.logout()


def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def calculate_prescreen_snapshot(rows: Iterable[dict], *, market: str) -> dict[str, Any]:
    """Calculate cheap signals used before expensive VRVP/five-layer analysis."""
    valid = []
    for row in rows:
        close = _finite(row.get("close"))
        if close is None or close <= 0:
            continue
        volume = max(0.0, _finite(row.get("volume")) or 0.0)
        amount = max(0.0, _finite(row.get("amount")) or 0.0)
        valid.append({**row, "close": close, "volume": volume, "amount": amount})
    if len(valid) < 80:
        return {"eligible": False, "score": 0.0, "rejection": "history", "observations": len(valid)}

    closes = [row["close"] for row in valid]
    latest = closes[-1]
    ma20 = _mean(closes[-20:])
    ma60 = _mean(closes[-60:])
    return20 = (latest / closes[-21] - 1) * 100 if closes[-21] else 0.0
    return60 = (latest / closes[-61] - 1) * 100 if closes[-61] else 0.0
    turnovers = [row["amount"] or row["close"] * row["volume"] for row in valid[-20:]]
    median_turnover = statistics.median(turnovers)
    min_turnover = 20_000_000 if market == "china" else 5_000_000
    min_price = 1.0 if market == "china" else 2.0
    if latest < min_price or median_turnover < min_turnover:
        return {
            "eligible": False,
            "score": 0.0,
            "rejection": "liquidity",
            "observations": len(valid),
            "price": round(latest, 4),
            "medianTurnover20d": round(median_turnover, 2),
        }

    recent_volume = _mean([row["volume"] for row in valid[-20:]])
    prior_volume = _mean([row["volume"] for row in valid[-40:-20]])
    volume_ratio = recent_volume / prior_volume if prior_volume > 0 else 1.0
    high60 = max(closes[-60:])
    drawdown60 = (latest / high60 - 1) * 100 if high60 else 0.0

    trend_score = (12 if latest >= ma20 else 0) + (12 if latest >= ma60 else 0) + (6 if ma20 >= ma60 else 0)
    momentum_score = _clamp((return20 + 5) / 25 * 24, 0, 24) + (6 if return60 > 0 else 0)
    volume_score = _clamp(10 + (volume_ratio - 1) * 10, 0, 20)
    pullback = abs(drawdown60)
    pullback_score = 15 if 2 <= pullback <= 15 else 10 if pullback < 2 else 5 if pullback <= 25 else 0
    score = _clamp(trend_score + momentum_score + volume_score + pullback_score)
    return {
        "eligible": True,
        "score": round(score, 1),
        "rejection": None,
        "observations": len(valid),
        "price": round(latest, 4),
        "ma20": round(ma20, 4),
        "ma60": round(ma60, 4),
        "return20d": round(return20, 2),
        "return60d": round(return60, 2),
        "volumeRatio20d": round(volume_ratio, 2),
        "drawdownFrom60dHigh": round(drawdown60, 2),
        "medianTurnover20d": round(median_turnover, 2),
    }


def fetch_yfinance_prescreen(symbols: list[str]) -> dict[str, list[dict]]:
    """One bulk Yahoo request per batch; intentionally no per-symbol retry loop."""
    import yfinance as yf
    from market_data_hub import REQUEST_TIMEOUT_SECONDS, _yahoo_rows

    frame = yf.download(
        symbols,
        period="6mo",
        interval="1d",
        auto_adjust=True,
        progress=False,
        threads=True,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    return {
        symbol: (_yahoo_rows(frame, symbol, batch=len(symbols) > 1) if not frame.empty else [])
        for symbol in symbols
    }


def fetch_baostock_prescreen(symbols: list[str]) -> dict[str, list[dict]]:
    """Reuse a single BaoStock session for every symbol in a bounded batch."""
    import baostock as bs
    from datetime import date, timedelta

    start_date = (date.today() - timedelta(days=240)).isoformat()
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
            if result.error_code != "0":
                bundle[symbol] = []
                continue
            rows = []
            while result.next():
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
            bundle[symbol] = rows
        return bundle
    finally:
        bs.logout()


def evenly_limit_universe(universe: list[dict], maximum: int) -> list[dict]:
    if maximum <= 0 or maximum >= len(universe):
        return list(universe)
    return [universe[min(len(universe) - 1, int(index * len(universe) / maximum))] for index in range(maximum)]


def scan_prescreen_batches(
    universe: list[dict],
    provider: Callable[[list[str]], dict[str, list[dict]]],
    *,
    market: str,
    batch_size: int = 50,
    top_n: int = 80,
    previous: dict[str, dict] | None = None,
    on_batch: Callable[[dict[str, dict]], None] | None = None,
) -> dict[str, Any]:
    """Process a market in bounded batches and resume from symbol-keyed results."""
    if batch_size < 1 or top_n < 1:
        raise ValueError("batch_size and top_n must be positive")
    results = dict(previous or {})
    metadata = {str(item["providerSymbol"]): item for item in universe}
    pending = [symbol for symbol in metadata if symbol not in results]
    for offset in range(0, len(pending), batch_size):
        symbols = pending[offset : offset + batch_size]
        try:
            bundle = provider(symbols)
        except Exception as error:
            for symbol in symbols:
                results[symbol] = {**metadata[symbol], "eligible": False, "score": 0.0, "error": str(error)}
        else:
            for symbol in symbols:
                rows = bundle.get(symbol) or []
                if not rows:
                    results[symbol] = {
                        **metadata[symbol],
                        "eligible": False,
                        "score": 0.0,
                        "error": "no_daily_history",
                    }
                    continue
                results[symbol] = {
                    **metadata[symbol],
                    **calculate_prescreen_snapshot(rows, market=market),
                }
        if on_batch:
            on_batch(results)

    eligible = sorted(
        (row for row in results.values() if row.get("eligible") and not row.get("error")),
        key=lambda row: (-float(row.get("score") or 0), str(row.get("providerSymbol") or row.get("symbol") or "")),
    )
    return {
        "market": market,
        "counts": {
            "universe": len(universe),
            "processed": len(results),
            "eligible": len(eligible),
            "failed": sum(1 for row in results.values() if row.get("error")),
        },
        "candidates": eligible[:top_n],
        "results": results,
    }


def save_scan_checkpoint(
    path: str | Path, *, market: str, scan_date: str, results: dict[str, dict]
) -> None:
    """Atomically persist symbol-level progress so interrupted scans can resume."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(f"{target.suffix}.tmp")
    payload = {
        "schemaVersion": SCANNER_SCHEMA_VERSION,
        "market": market,
        "scanDate": scan_date,
        "results": results,
    }
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, target)


def write_json_atomic(path: str | Path, payload: Any) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(f"{target.suffix}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, target)


def load_scan_checkpoint(
    path: str | Path, *, market: str, scan_date: str
) -> dict[str, dict]:
    target = Path(path)
    if not target.exists():
        return {}
    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {}
    if (
        payload.get("schemaVersion") != SCANNER_SCHEMA_VERSION
        or payload.get("market") != market
        or payload.get("scanDate") != scan_date
        or not isinstance(payload.get("results"), dict)
    ):
        return {}
    return payload["results"]
