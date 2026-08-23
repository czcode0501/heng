"""One-request bootstrap for every data-backed signal workspace."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from capital_flow_sources import build_capital_flow_dashboard
from investor_sentiment import build_sentiment_dashboard
from macro_data import get_macro_dashboard
from market_data_hub import warm_signal_market_data
from market_timing import apply_market_timing_range
from market_timing_sources import (
    CHINA_SERIES,
    US_SERIES,
    get_market_timing_dashboard,
    has_fresh_market_timing_dashboard,
)
from sector_rotation_sources import (
    CHINA_SECTORS,
    US_SECTORS,
    get_sector_rotation_dashboard,
    has_fresh_sector_rotation_dashboard,
)


SOURCE_GROUPS = [
    {
        "id": "china-macro",
        "provider": "Eastmoney Datacenter",
        "requestMode": "five-indicators-parallel",
        "cacheTtlSeconds": 21600,
        "workspaces": ["macro"],
    },
    {
        "id": "us-labor-prices",
        "provider": "U.S. Bureau of Labor Statistics",
        "requestMode": "multi-series-batch",
        "cacheTtlSeconds": 21600,
        "workspaces": ["macro"],
    },
    {
        "id": "us-rates",
        "provider": "Federal Reserve H.15",
        "requestMode": "single-csv-multi-series",
        "cacheTtlSeconds": 21600,
        "workspaces": ["macro"],
    },
    {
        "id": "china-market",
        "provider": "BaoStock + Yahoo Finance intraday overlay",
        "requestMode": "shared-symbol-union",
        "cacheTtlSeconds": 60,
        "workspaces": ["marketTiming", "sectorRotation", "investorSentiment", "capitalFlow"],
    },
    {
        "id": "us-market",
        "provider": "Yahoo Finance via yfinance",
        "requestMode": "multi-ticker-shared-symbol-union",
        "cacheTtlSeconds": 300,
        "workspaces": ["marketTiming", "sectorRotation", "investorSentiment", "capitalFlow"],
    },
    {
        "id": "derived-capital-flow",
        "provider": "Local model",
        "requestMode": "derived-no-external-request",
        "cacheTtlSeconds": 300,
        "workspaces": ["capitalFlow"],
    },
]


def warm_shared_market_sources() -> None:
    """Fetch each stale market provider once with the union used downstream."""
    timing_fresh = has_fresh_market_timing_dashboard()
    rotation_fresh = has_fresh_sector_rotation_dashboard()
    if timing_fresh and rotation_fresh:
        return

    baostock_symbols: list[str] = []
    yfinance_symbols: list[str] = []
    if not timing_fresh:
        baostock_symbols.extend(item["baostock"] for item in CHINA_SERIES.values())
        yfinance_symbols.extend(US_SERIES.values())
    if not rotation_fresh:
        baostock_symbols.append("sh.000300")
        baostock_symbols.extend(
            sector["symbol"] for sector in CHINA_SECTORS if sector["source"] == "baostock"
        )
        yfinance_symbols.extend(
            sector["symbol"] for sector in CHINA_SECTORS if sector["source"] == "yfinance"
        )
        yfinance_symbols.append("SPY")
        yfinance_symbols.extend(sector["symbol"] for sector in US_SECTORS)

    warm_signal_market_data(
        baostock_symbols=baostock_symbols,
        yfinance_symbols=yfinance_symbols,
        force=False,
    )


def _warm_without_blocking_fallback() -> None:
    try:
        warm_shared_market_sources()
    except Exception:
        # Dashboard adapters retain their last-known-good and per-provider fallbacks.
        pass


def get_signal_bootstrap() -> dict:
    """Build every data-backed signal view behind one frontend request."""
    with ThreadPoolExecutor(max_workers=2) as executor:
        macro_future = executor.submit(get_macro_dashboard, force=False)
        warm_future = executor.submit(_warm_without_blocking_fallback)
        macro = macro_future.result()
        warm_future.result()

    timing_base = get_market_timing_dashboard(force=False)
    timing = apply_market_timing_range(timing_base, "1m", None)
    sentiment = build_sentiment_dashboard(timing_base)
    rotation = get_sector_rotation_dashboard(force=False)
    capital = build_capital_flow_dashboard(rotation)
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "preloaded": True,
        "refreshPolicy": "manual-or-ttl",
        "sourceGroups": SOURCE_GROUPS,
        "workspaces": {
            "macro": macro,
            "marketTiming": timing,
            "sectorRotation": rotation,
            "investorSentiment": sentiment,
            "capitalFlow": capital,
        },
    }
