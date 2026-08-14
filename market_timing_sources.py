"""Zero-configuration external data adapters for the market-timing model."""

from __future__ import annotations

import json
import re
import threading
import time
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from market_data_hub import get_baostock_series, get_yfinance_series
from market_timing import build_china_market, build_us_market


SINA_JSONP_PATTERN = re.compile(r"\(\s*(\[.*\])\s*\)\s*;?\s*$", re.DOTALL)
REQUEST_TIMEOUT_SECONDS = 15
MARKET_CACHE_TTL_SECONDS = 30 * 60
ERROR_CACHE_TTL_SECONDS = 5 * 60
DEFAULT_CACHE_PATH = Path(__file__).resolve().parent / ".cache" / "market-timing.json"
MARKET_CACHE_LOCK = threading.Lock()
MARKET_CACHE: dict[str, object] = {"expires": 0.0, "data": None}
CHINA_SERIES = {
    "csi300": {"baostock": "sh.000300", "sina": "sh000300"},
    "sse": {"baostock": "sh.000001", "sina": "sh000001"},
    "szse": {"baostock": "sz.399106", "sina": "sz399106"},
    "chinext": {"baostock": "sz.399006", "sina": "sz399006"},
    "csi1000": {"baostock": "sh.000852", "sina": "sh000852"},
}
US_SERIES = {
    "sp500": "^GSPC",
    "spy": "SPY",
    "rsp": "RSP",
    "iwm": "IWM",
    "qqq": "QQQ",
    "hyg": "HYG",
    "lqd": "LQD",
    "vix": "^VIX",
}


def parse_sina_jsonp(text: str) -> list[dict]:
    """Parse only the JSON array inside Sina's JSONP wrapper."""
    match = SINA_JSONP_PATTERN.search(text or "")
    if not match:
        raise ValueError("新浪行情备用源返回格式不正确")
    try:
        payload = json.loads(match.group(1))
    except json.JSONDecodeError as error:
        raise ValueError("新浪行情备用源不是有效 JSON") from error
    if not isinstance(payload, list):
        raise ValueError("新浪行情备用源缺少日线数组")
    rows = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        try:
            rows.append(
                {
                    "date": str(item["day"])[:10],
                    "open": float(item["open"]),
                    "high": float(item["high"]),
                    "low": float(item["low"]),
                    "close": float(item["close"]),
                    "volume": float(item.get("volume") or 0),
                    "amount": 0.0,
                }
            )
        except (KeyError, TypeError, ValueError):
            continue
    if not rows:
        raise ValueError("新浪行情备用源没有有效日线")
    return rows


def _fetch_china_baostock(force: bool = False) -> dict[str, list[dict]]:
    symbols = [definition["baostock"] for definition in CHINA_SERIES.values()]
    shared = get_baostock_series(symbols, force=force, minimum=220)
    return {key: shared[definition["baostock"]] for key, definition in CHINA_SERIES.items()}


def _fetch_sina_series(symbol: str) -> list[dict]:
    query = urlencode({"symbol": symbol, "scale": 240, "ma": "no", "datalen": 300})
    url = f"https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_data=/CN_MarketDataService.getKLineData?{query}"
    request = Request(
        url,
        headers={"User-Agent": "QuantDesk/0.1", "Referer": "https://finance.sina.com.cn/"},
    )
    with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        return parse_sina_jsonp(response.read().decode("utf-8", errors="replace"))


def _fetch_china_sina() -> dict[str, list[dict]]:
    bundle = {}
    with ThreadPoolExecutor(max_workers=len(CHINA_SERIES)) as executor:
        futures = {
            executor.submit(_fetch_sina_series, symbols["sina"]): key
            for key, symbols in CHINA_SERIES.items()
        }
        for future in as_completed(futures):
            bundle[futures[future]] = future.result()
    return bundle


def fetch_china_market(force: bool = False) -> dict:
    try:
        bundle = _fetch_china_baostock(force=force)
        source = {
            "name": "BaoStock",
            "provider": "baostock",
            "mode": "zero-config",
            "access": "无需 API Key",
            "url": "http://www.baostock.com",
            "isFallback": False,
        }
    except Exception as primary_error:
        bundle = _fetch_china_sina()
        source = {
            "name": "新浪财经日线（备用）",
            "provider": "sina",
            "mode": "zero-config",
            "access": "无需 API Key",
            "url": "https://finance.sina.com.cn",
            "isFallback": True,
            "fallbackReason": type(primary_error).__name__,
        }
    return build_china_market(bundle, source)


def _fetch_us_yfinance(force: bool = False) -> dict[str, list[dict]]:
    shared = get_yfinance_series(US_SERIES.values(), force=force, minimum=220)
    return {key: shared[symbol] for key, symbol in US_SERIES.items()}


def fetch_us_market(force: bool = False) -> dict:
    source = {
        "name": "Yahoo Finance via yfinance",
        "provider": "yfinance",
        "mode": "zero-config",
        "access": "无需 API Key · 研究与个人使用",
        "url": "https://ranaroussi.github.io/yfinance",
        "isFallback": False,
    }
    return build_us_market(_fetch_us_yfinance(force=force), source)


def has_fresh_market_timing_dashboard(cache_path: Path | None = None) -> bool:
    """Report cache readiness without triggering an external request."""
    now = time.time()
    if MARKET_CACHE["data"] is not None and now < float(MARKET_CACHE["expires"] or 0):
        return True
    return _fresh_disk_cache(cache_path or DEFAULT_CACHE_PATH) is not None


def _read_disk_cache(path: Path) -> dict | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or not isinstance(payload.get("markets"), list):
        return None
    return payload


def _fresh_disk_cache(path: Path) -> dict | None:
    payload = _read_disk_cache(path)
    if not payload:
        return None
    try:
        generated_at = datetime.fromisoformat(str(payload["generatedAt"]).replace("Z", "+00:00"))
        if generated_at.tzinfo is None:
            generated_at = generated_at.replace(tzinfo=timezone.utc)
    except (KeyError, TypeError, ValueError):
        return None
    age = (datetime.now(timezone.utc) - generated_at).total_seconds()
    return payload if 0 <= age < MARKET_CACHE_TTL_SECONDS else None


def _write_disk_cache(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def _stale_market(market: dict, issue: str) -> dict:
    result = deepcopy(market)
    result["status"] = "stale"
    result["dataQuality"]["status"] = "stale"
    result["dataQuality"]["label"] = "使用上次成功数据"
    result["dataQuality"]["issues"] = [issue]
    return result


def _error_market(market_id: str, issue: str) -> dict:
    definitions = {
        "china": ("中国股票", "A股"),
        "united-states": ("美国股票", "美股"),
    }
    title, scope = definitions[market_id]
    return {
        "id": market_id,
        "title": title,
        "scope": scope,
        "status": "error",
        "asOf": None,
        "updateMode": "automatic-eod",
        "source": {"name": "默认免费源", "mode": "zero-config"},
        "benchmark": None,
        "regime": None,
        "dimensions": [],
        "dataQuality": {
            "status": "error",
            "label": "数据源暂不可用",
            "availableSeries": 0,
            "expectedSeries": 5 if market_id == "china" else 8,
            "issues": [issue],
        },
    }


def get_market_timing_dashboard(
    force: bool = False,
    *,
    fetchers: dict[str, object] | None = None,
    cache_path: Path | None = None,
) -> dict:
    """Return two independently refreshed markets with last-known-good fallback."""
    now = time.time()
    path = cache_path or DEFAULT_CACHE_PATH
    default_fetchers = fetchers is None
    active_fetchers = fetchers or {
        "china": lambda: fetch_china_market(force=force),
        "united-states": lambda: fetch_us_market(force=force),
    }
    if default_fetchers and not force and MARKET_CACHE["data"] is not None and now < float(MARKET_CACHE["expires"] or 0):
        return deepcopy(MARKET_CACHE["data"])
    if default_fetchers and not force:
        disk_cached = _fresh_disk_cache(path)
        if disk_cached is not None:
            MARKET_CACHE["data"] = deepcopy(disk_cached)
            MARKET_CACHE["expires"] = now + MARKET_CACHE_TTL_SECONDS
            return disk_cached

    with MARKET_CACHE_LOCK:
        if default_fetchers and not force and MARKET_CACHE["data"] is not None and now < float(MARKET_CACHE["expires"] or 0):
            return deepcopy(MARKET_CACHE["data"])
        if default_fetchers and not force:
            disk_cached = _fresh_disk_cache(path)
            if disk_cached is not None:
                MARKET_CACHE["data"] = deepcopy(disk_cached)
                MARKET_CACHE["expires"] = now + MARKET_CACHE_TTL_SECONDS
                return disk_cached
        previous = _read_disk_cache(path)
        previous_markets = {market.get("id"): market for market in (previous or {}).get("markets", [])}
        completed, errors = {}, {}
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = {executor.submit(fetcher): market_id for market_id, fetcher in active_fetchers.items()}
            for future in as_completed(futures):
                market_id = futures[future]
                try:
                    completed[market_id] = future.result()
                except Exception as error:
                    errors[market_id] = f"{type(error).__name__}: 默认数据源暂时不可用"

        markets = []
        for market_id in ["china", "united-states"]:
            if market_id in completed:
                markets.append(completed[market_id])
            elif market_id in previous_markets:
                markets.append(_stale_market(previous_markets[market_id], errors.get(market_id, "数据更新失败")))
            else:
                markets.append(_error_market(market_id, errors.get(market_id, "数据更新失败")))

        live_count = sum(market["status"] == "live" for market in markets)
        dashboard = {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "refreshAfterSeconds": MARKET_CACHE_TTL_SECONDS if live_count else ERROR_CACHE_TTL_SECONDS,
            "autoRefresh": True,
            "methodologyVersion": "1.0.0",
            "markets": markets,
            "dataQuality": {
                "status": "live" if live_count == 2 else "partial" if live_count else "stale-or-error",
                "liveMarkets": live_count,
                "totalMarkets": 2,
            },
        }
        if live_count:
            _write_disk_cache(path, dashboard)
        if default_fetchers:
            MARKET_CACHE["data"] = deepcopy(dashboard)
            MARKET_CACHE["expires"] = now + (MARKET_CACHE_TTL_SECONDS if live_count else ERROR_CACHE_TTL_SECONDS)
        return dashboard
