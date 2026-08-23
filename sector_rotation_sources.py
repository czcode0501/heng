"""Zero-configuration data adapters and cache for sector rotation."""

from __future__ import annotations

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

from market_data_hub import get_baostock_series, get_yfinance_series
from market_timing_sources import get_market_timing_dashboard
from sector_rotation import build_sector_market


CACHE_TTL_SECONDS = 5 * 60
ERROR_CACHE_TTL_SECONDS = 5 * 60
DEFAULT_CACHE_PATH = Path(__file__).resolve().parent / ".cache" / "sector-rotation.json"
CACHE_LOCK = threading.Lock()
MEMORY_CACHE: dict[str, object] = {"expires": 0.0, "data": None}

CHINA_SECTORS = [
    {"id": "energy", "title": "能源", "english": "ENERGY", "symbol": "sh.000986", "source": "baostock", "instrument": "中证全指能源指数"},
    {"id": "materials", "title": "原材料", "english": "MATERIALS", "symbol": "sh.000987", "source": "baostock", "instrument": "中证全指原材料指数"},
    {"id": "industrials", "title": "工业", "english": "INDUSTRIALS", "symbol": "516320.SS", "source": "yfinance", "instrument": "装备产业ETF代理"},
    {"id": "consumer-discretionary", "title": "可选消费", "english": "CONSUMER DISCRETIONARY", "symbol": "sh.000989", "source": "baostock", "instrument": "中证全指可选消费指数"},
    {"id": "consumer-staples", "title": "主要消费", "english": "CONSUMER STAPLES", "symbol": "sh.000990", "source": "baostock", "instrument": "中证全指主要消费指数"},
    {"id": "health-care", "title": "医药卫生", "english": "HEALTH CARE", "symbol": "sh.000991", "source": "baostock", "instrument": "中证全指医药卫生指数"},
    {"id": "financials", "title": "金融", "english": "FINANCIALS", "symbol": "sh.000974", "source": "baostock", "instrument": "中证800金融指数"},
    {"id": "information-technology", "title": "信息技术", "english": "INFORMATION TECHNOLOGY", "symbol": "sh.000993", "source": "baostock", "instrument": "中证全指信息技术指数"},
    {"id": "communication-services", "title": "通信服务", "english": "COMMUNICATION SERVICES", "symbol": "515880.SS", "source": "yfinance", "instrument": "通信ETF代理"},
    {"id": "utilities", "title": "公用事业", "english": "UTILITIES", "symbol": "159301.SZ", "source": "yfinance", "instrument": "公用事业ETF代理"},
    {"id": "real-estate", "title": "房地产", "english": "REAL ESTATE", "symbol": "sz.399965", "source": "baostock", "instrument": "中证800地产指数"},
]

US_SECTORS = [
    {"id": "energy", "title": "能源", "english": "ENERGY", "symbol": "XLE", "source": "yfinance", "instrument": "Energy Select Sector SPDR"},
    {"id": "materials", "title": "原材料", "english": "MATERIALS", "symbol": "XLB", "source": "yfinance", "instrument": "Materials Select Sector SPDR"},
    {"id": "industrials", "title": "工业", "english": "INDUSTRIALS", "symbol": "XLI", "source": "yfinance", "instrument": "Industrial Select Sector SPDR"},
    {"id": "consumer-discretionary", "title": "可选消费", "english": "CONSUMER DISCRETIONARY", "symbol": "XLY", "source": "yfinance", "instrument": "Consumer Discretionary SPDR"},
    {"id": "consumer-staples", "title": "主要消费", "english": "CONSUMER STAPLES", "symbol": "XLP", "source": "yfinance", "instrument": "Consumer Staples SPDR"},
    {"id": "health-care", "title": "医疗保健", "english": "HEALTH CARE", "symbol": "XLV", "source": "yfinance", "instrument": "Health Care Select Sector SPDR"},
    {"id": "financials", "title": "金融", "english": "FINANCIALS", "symbol": "XLF", "source": "yfinance", "instrument": "Financial Select Sector SPDR"},
    {"id": "information-technology", "title": "信息技术", "english": "INFORMATION TECHNOLOGY", "symbol": "XLK", "source": "yfinance", "instrument": "Technology Select Sector SPDR"},
    {"id": "communication-services", "title": "通信服务", "english": "COMMUNICATION SERVICES", "symbol": "XLC", "source": "yfinance", "instrument": "Communication Services SPDR"},
    {"id": "utilities", "title": "公用事业", "english": "UTILITIES", "symbol": "XLU", "source": "yfinance", "instrument": "Utilities Select Sector SPDR"},
    {"id": "real-estate", "title": "房地产", "english": "REAL ESTATE", "symbol": "XLRE", "source": "yfinance", "instrument": "Real Estate Select Sector SPDR"},
]


def _fetch_yfinance_series(symbols: list[str], force: bool = False) -> dict[str, list[dict]]:
    return get_yfinance_series(symbols, force=force, minimum=121)


def _fetch_baostock_series(symbols: list[str], force: bool = False) -> dict[str, list[dict]]:
    return get_baostock_series(symbols, force=force, minimum=121)


def _timing_scores(force: bool = False) -> dict[str, float]:
    dashboard = get_market_timing_dashboard(force=force)
    return {
        market["id"]: float((market.get("regime") or {}).get("score") or 45)
        for market in dashboard.get("markets", [])
    }


def fetch_china_sector_market(timing_score: float = 45, force: bool = False) -> dict:
    baostock_symbols = ["sh.000300"] + [sector["symbol"] for sector in CHINA_SECTORS if sector["source"] == "baostock"]
    yahoo_symbols = [sector["symbol"] for sector in CHINA_SECTORS if sector["source"] == "yfinance"]
    with ThreadPoolExecutor(max_workers=2) as executor:
        baostock_future = executor.submit(_fetch_baostock_series, baostock_symbols, force)
        yahoo_future = executor.submit(_fetch_yfinance_series, yahoo_symbols, force)
        bundle = {**baostock_future.result(), **yahoo_future.result()}
    sectors = [{**sector, "points": bundle[sector["symbol"]]} for sector in CHINA_SECTORS]
    return build_sector_market(
        "china",
        "中国股票",
        bundle["sh.000300"],
        sectors,
        {
            "name": "BaoStock + Yahoo Finance",
            "mode": "zero-config",
            "access": "无需 API Key",
            "url": "http://www.baostock.com",
            "notes": "一级行业指数为主；工业、通信、公用事业使用公开ETF行情代理。",
        },
        timing_score=timing_score,
    )


def fetch_us_sector_market(timing_score: float = 45, force: bool = False) -> dict:
    symbols = ["SPY"] + [sector["symbol"] for sector in US_SECTORS]
    bundle = _fetch_yfinance_series(symbols, force=force)
    sectors = [{**sector, "points": bundle[sector["symbol"]]} for sector in US_SECTORS]
    return build_sector_market(
        "united-states",
        "美国股票",
        bundle["SPY"],
        sectors,
        {
            "name": "Yahoo Finance via yfinance",
            "mode": "zero-config",
            "access": "无需 API Key · 研究与个人使用",
            "url": "https://ranaroussi.github.io/yfinance",
            "notes": "使用11只Select Sector SPDR ETF作为GICS一级板块代理。",
        },
        timing_score=timing_score,
    )


def _read_cache(path: Path) -> dict | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) and isinstance(payload.get("markets"), list) else None


def _fresh_cache(path: Path) -> dict | None:
    payload = _read_cache(path)
    if not payload or payload.get("methodologyVersion") != "1.1.1":
        return None
    try:
        generated_at = datetime.fromisoformat(str(payload["generatedAt"]).replace("Z", "+00:00"))
        if generated_at.tzinfo is None:
            generated_at = generated_at.replace(tzinfo=timezone.utc)
    except (KeyError, TypeError, ValueError):
        return None
    age = (datetime.now(timezone.utc) - generated_at).total_seconds()
    return payload if 0 <= age < CACHE_TTL_SECONDS else None


def has_fresh_sector_rotation_dashboard(cache_path: Path | None = None) -> bool:
    """Report cache readiness without triggering an external request."""
    now = time.time()
    if MEMORY_CACHE["data"] is not None and now < float(MEMORY_CACHE["expires"] or 0):
        return True
    return _fresh_cache(cache_path or DEFAULT_CACHE_PATH) is not None


def _write_cache(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def _stale_market(market: dict, issue: str) -> dict:
    result = deepcopy(market)
    result["status"] = "stale"
    result["dataQuality"]["status"] = "stale"
    result["dataQuality"]["issues"] = [issue]
    return result


def _error_market(market_id: str, issue: str) -> dict:
    title = "中国股票" if market_id == "china" else "美国股票"
    return {
        "id": market_id,
        "title": title,
        "status": "error",
        "asOf": None,
        "source": {"name": "默认免费数据源", "mode": "zero-config"},
        "benchmark": None,
        "timing": None,
        "summary": None,
        "sectors": [],
        "dataQuality": {"status": "error", "availableSectors": 0, "expectedSectors": 11, "issues": [issue]},
    }


def get_sector_rotation_dashboard(
    force: bool = False,
    *,
    fetchers: dict[str, object] | None = None,
    cache_path: Path | None = None,
) -> dict:
    """Refresh the two markets independently and preserve last-known-good data."""
    now = time.time()
    path = cache_path or DEFAULT_CACHE_PATH
    default_fetchers = fetchers is None
    if default_fetchers and not force and MEMORY_CACHE["data"] is not None and now < float(MEMORY_CACHE["expires"] or 0):
        return deepcopy(MEMORY_CACHE["data"])
    if default_fetchers and not force:
        cached = _fresh_cache(path)
        if cached:
            MEMORY_CACHE.update({"data": deepcopy(cached), "expires": now + CACHE_TTL_SECONDS})
            return cached

    with CACHE_LOCK:
        previous = _read_cache(path)
        previous_markets = {market.get("id"): market for market in (previous or {}).get("markets", [])}
        if default_fetchers:
            scores = _timing_scores(force=False)
            active_fetchers = {
                "china": lambda: fetch_china_sector_market(scores.get("china", 45), force=force),
                "united-states": lambda: fetch_us_sector_market(scores.get("united-states", 45), force=force),
            }
        else:
            active_fetchers = fetchers or {}
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
        for market_id in ("china", "united-states"):
            if market_id in completed:
                markets.append(completed[market_id])
            elif market_id in previous_markets:
                markets.append(_stale_market(previous_markets[market_id], errors.get(market_id, "数据更新失败")))
            else:
                markets.append(_error_market(market_id, errors.get(market_id, "数据更新失败")))
        live_count = sum(market["status"] == "live" for market in markets)
        dashboard = {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "refreshAfterSeconds": CACHE_TTL_SECONDS if live_count else ERROR_CACHE_TTL_SECONDS,
            "autoRefresh": True,
            "methodologyVersion": "1.1.1",
            "profile": "balanced",
            "markets": markets,
            "dataQuality": {
                "status": "live" if live_count == 2 else "partial" if live_count else "stale-or-error",
                "liveMarkets": live_count,
                "totalMarkets": 2,
            },
        }
        if live_count:
            _write_cache(path, dashboard)
        if default_fetchers:
            ttl = CACHE_TTL_SECONDS if live_count else ERROR_CACHE_TTL_SECONDS
            MEMORY_CACHE.update({"data": deepcopy(dashboard), "expires": now + ttl})
        return dashboard
