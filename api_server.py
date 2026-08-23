"""Local market-data API for the Quant Desk development preview."""

from __future__ import annotations

import json
import math
import re
import statistics
import threading
import time
from pathlib import Path
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from capital_flow_sources import get_capital_flow_dashboard
from company_research import get_company_research
from broker_accounts import read_broker_quotes, read_broker_snapshot
from data_sources import check_data_source, get_data_source_center
from investor_sentiment import build_sentiment_dashboard
from sector_constituents import SECTOR_CONSTITUENTS, SECTOR_TITLES, build_sector_constituents
from macro_data import get_macro_dashboard
from market_timing import apply_market_timing_range
from market_timing_sources import get_market_timing_dashboard
from market_data_hub import get_yfinance_latest_series
from micro_data import (
    aggregate_candles,
    build_volume_profile,
    estimate_order_flow,
    get_micro_market_dashboard,
    get_technical_range_config,
    select_technical_range,
)
from news_credentials import save_news_credential
from sector_rotation_sources import get_sector_rotation_dashboard
from signal_bootstrap import get_signal_bootstrap
from technical_indicators import calculate_technical_indicators
from time_ranges import validate_signal_range


SEARCH_LIMIT = 10
SCANNER_RESULT_PATH = Path(__file__).resolve().parent / "output" / "scanner" / "decisions-latest.json"
BAOSTOCK_LOCK = threading.Lock()
STOCK_ANALYSIS_CACHE_TTL_SECONDS = 5 * 60
STOCK_ANALYSIS_CACHE_MAX_ENTRIES = 150
_STOCK_ANALYSIS_CACHE: dict[tuple[str, str, str], tuple[float, dict]] = {}
_STOCK_ANALYSIS_CACHE_LOCK = threading.Lock()
YAHOO_SYMBOL_PATTERN = re.compile(r"^[A-Za-z0-9.^=-]{1,20}(?:\.(?:SS|SZ|BJ))?$")
US_EXACT_SYMBOL_PATTERN = re.compile(r"^[A-Za-z]{1,5}(?:[.-][A-Za-z]{1,2})?$")
SUPPORTED_US_EXCHANGES = {"NMS", "NYQ", "NGM", "NCM", "ASE", "BTS", "PCX", "PNK", "OQX", "OEM"}
SECTOR_ID_ALIASES = {
    "energy": "energy",
    "basic materials": "materials",
    "materials": "materials",
    "industrials": "industrials",
    "consumer cyclical": "consumer-discretionary",
    "consumer discretionary": "consumer-discretionary",
    "consumer defensive": "consumer-staples",
    "consumer staples": "consumer-staples",
    "healthcare": "health-care",
    "health care": "health-care",
    "financial services": "financials",
    "financial": "financials",
    "financials": "financials",
    "technology": "information-technology",
    "information technology": "information-technology",
    "communication services": "communication-services",
    "utilities": "utilities",
    "real estate": "real-estate",
}
CN_SECTOR_BY_SYMBOL = {
    item["symbol"]: {"sectorId": sector_id, "sector": SECTOR_TITLES[sector_id]}
    for sector_id, items in SECTOR_CONSTITUENTS["china"].items()
    for item in items
}


def validate_search_query(value: str) -> str:
    query = (value or "").strip()
    if not query:
        raise ValueError("请输入股票代码或名称")
    if len(query) > 40:
        raise ValueError("搜索内容不能超过40个字符")
    return query


def validate_market_timing_range(range_id: str, custom_start: str) -> tuple[str, str | None]:
    return validate_signal_range(range_id, custom_start)


def normalize_sector_id(value: str | None) -> str | None:
    """Map Yahoo's company sector labels onto the shared 11-sector rotation catalog."""
    normalized = re.sub(r"\s+", " ", str(value or "").strip().lower())
    return SECTOR_ID_ALIASES.get(normalized)


def baostock_code_to_yahoo(code: str) -> str:
    exchange, symbol = code.lower().split(".", 1)
    suffixes = {"sh": "SS", "sz": "SZ", "bj": "BJ"}
    if exchange not in suffixes:
        raise ValueError(f"不支持的A股交易所代码: {exchange}")
    return f"{symbol}.{suffixes[exchange]}"


def infer_baostock_code(symbol: str) -> str:
    if not re.fullmatch(r"\d{6}", symbol):
        raise ValueError("A股代码必须为6位数字")
    if symbol.startswith(("4", "8", "9")):
        exchange = "bj"
    elif symbol.startswith(("5", "6")):
        exchange = "sh"
    else:
        exchange = "sz"
    return f"{exchange}.{symbol}"


def normalize_baostock_row(row: list[str]) -> dict[str, str]:
    code, name = row[0], row[1]
    exchange = code.split(".", 1)[0].lower()
    market_names = {"sh": "A股 · 上海", "sz": "A股 · 深圳", "bj": "A股 · 北京"}
    return {
        "symbol": code.split(".", 1)[1],
        "providerSymbol": baostock_code_to_yahoo(code),
        "name": name,
        "market": market_names.get(exchange, "A股"),
        "currency": "CNY",
        "assetType": "ETF" if len(row) > 4 and row[4] == "5" else "EQUITY",
        "source": "BaoStock",
    }


def normalize_yahoo_quote(quote: dict) -> dict[str, str]:
    provider_symbol = str(quote.get("symbol", "")).upper()
    exchange = str(quote.get("exchange", "")).upper()
    exchange_display = quote.get("exchDisp") or exchange or "US"
    is_a_share = provider_symbol.endswith((".SS", ".SZ", ".BJ"))
    if is_a_share:
        suffix = provider_symbol.rsplit(".", 1)[1]
        market = {"SS": "A股 · 上海", "SZ": "A股 · 深圳", "BJ": "A股 · 北京"}[suffix]
        symbol = provider_symbol.rsplit(".", 1)[0]
        currency = "CNY"
    else:
        market = f"美股 · {exchange_display}"
        symbol = provider_symbol
        currency = "USD"
    sector = quote.get("sectorDisp") or quote.get("sector")
    industry = quote.get("industryDisp") or quote.get("industry")
    result = {
        "symbol": symbol,
        "providerSymbol": provider_symbol,
        "name": quote.get("longname") or quote.get("shortname") or symbol,
        "market": market,
        "currency": currency,
        "assetType": quote.get("quoteType") or "EQUITY",
        "source": "Yahoo Finance",
    }
    if sector:
        result["sector"] = str(sector)
    if industry:
        result["industry"] = str(industry)
    sector_id = normalize_sector_id(sector)
    if sector_id:
        result["sectorId"] = sector_id
    return result


def enrich_a_share_sector(result: dict[str, str]) -> dict[str, str]:
    """Attach the local 11-sector classification without another network request."""
    if result.get("currency") != "CNY" or result.get("sectorId"):
        return result
    sector = CN_SECTOR_BY_SYMBOL.get(str(result.get("symbol") or ""))
    return {**result, **sector} if sector else result


def search_baostock(query: str) -> list[dict[str, str]]:
    import baostock as bs

    with BAOSTOCK_LOCK:
        login = bs.login()
        if login.error_code != "0":
            raise RuntimeError(f"BaoStock登录失败: {login.error_msg}")
        try:
            if re.fullmatch(r"\d{6}", query):
                result = bs.query_stock_basic(code=infer_baostock_code(query))
            else:
                result = bs.query_stock_basic(code_name=query)
            rows = []
            while result.error_code == "0" and result.next() and len(rows) < SEARCH_LIMIT:
                row = result.get_row_data()
                if len(row) >= 6 and row[5] == "1":
                    rows.append(normalize_baostock_row(row))
            if result.error_code != "0":
                raise RuntimeError(f"BaoStock查询失败: {result.error_msg}")
            return rows
        finally:
            bs.logout()


def search_yahoo(query: str) -> list[dict[str, str]]:
    import yfinance as yf

    quotes = yf.Search(query, max_results=SEARCH_LIMIT, news_count=0).quotes
    accepted = []
    for quote in quotes:
        provider_symbol = str(quote.get("symbol", "")).upper()
        quote_type = str(quote.get("quoteType", "")).upper()
        exchange = str(quote.get("exchange", "")).upper()
        is_a_share = provider_symbol.endswith((".SS", ".SZ", ".BJ"))
        is_us_listing = exchange in SUPPORTED_US_EXCHANGES
        if quote_type in {"EQUITY", "ETF"} and (is_a_share or is_us_listing):
            accepted.append(normalize_yahoo_quote(quote))

    exact_symbol = query.strip().upper()
    exact_index = next(
        (index for index, item in enumerate(accepted) if item["providerSymbol"] == exact_symbol),
        None,
    )
    if exact_index is not None:
        accepted.insert(0, accepted.pop(exact_index))
    elif US_EXACT_SYMBOL_PATTERN.fullmatch(exact_symbol):
        try:
            info = yf.Ticker(exact_symbol).get_info() or {}
            exact_quote = {
                "symbol": str(info.get("symbol") or exact_symbol).upper(),
                "longname": info.get("longName"),
                "shortname": info.get("shortName"),
                "exchange": info.get("exchange"),
                "exchDisp": info.get("fullExchangeName") or info.get("exchange"),
                "quoteType": info.get("quoteType"),
                "sector": info.get("sector"),
                "industry": info.get("industry"),
            }
            exchange = str(exact_quote.get("exchange") or "").upper()
            quote_type = str(exact_quote.get("quoteType") or "").upper()
            if exact_quote["symbol"] == exact_symbol and exchange in SUPPORTED_US_EXCHANGES and quote_type in {"EQUITY", "ETF"}:
                accepted.insert(0, normalize_yahoo_quote(exact_quote))
        except Exception:
            pass

    deduplicated = {}
    for item in accepted:
        deduplicated.setdefault(item["providerSymbol"], item)
    return list(deduplicated.values())[:SEARCH_LIMIT]


def search_instruments(query: str) -> list[dict[str, str]]:
    query = validate_search_query(query)
    results = []
    exact_a_share_code = bool(re.fullmatch(r"\d{6}", query))
    if exact_a_share_code or re.search(r"[\u3400-\u9fff]", query):
        results.extend(search_baostock(query))
    if not exact_a_share_code and (not results or not re.search(r"[\u3400-\u9fff]", query)):
        results.extend(search_yahoo(query))

    results = [enrich_a_share_sector(result) for result in results]

    deduplicated = {}
    for result in results:
        key = result["providerSymbol"]
        if key not in deduplicated:
            deduplicated[key] = result
            continue
        existing = deduplicated[key]
        if result["source"] == "BaoStock":
            result = {**result, **{field: existing[field] for field in ("sector", "sectorId", "industry") if existing.get(field)}}
            deduplicated[key] = result
        elif existing["source"] == "BaoStock":
            for field in ("sector", "sectorId", "industry"):
                if result.get(field):
                    existing[field] = result[field]
    return list(deduplicated.values())[:SEARCH_LIMIT]


def get_quote(provider_symbol: str) -> dict:
    import yfinance as yf

    symbol = (provider_symbol or "").strip().upper()
    if not YAHOO_SYMBOL_PATTERN.fullmatch(symbol):
        raise ValueError("股票代码格式不正确")
    ticker = yf.Ticker(symbol)
    fast_info = dict(ticker.fast_info)
    price = fast_info.get("lastPrice")
    previous_close = fast_info.get("regularMarketPreviousClose") or fast_info.get("previousClose")
    if price is None:
        history = ticker.history(period="5d", interval="1d", auto_adjust=False)
        if history.empty:
            raise LookupError("没有找到该股票的行情数据")
        price = float(history["Close"].iloc[-1])
        if len(history) > 1:
            previous_close = float(history["Close"].iloc[-2])
    change_percent = None
    if previous_close:
        change_percent = (float(price) / float(previous_close) - 1) * 100
    return {
        "providerSymbol": symbol,
        "price": round(float(price), 4),
        "previousClose": round(float(previous_close), 4) if previous_close else None,
        "changePercent": round(change_percent, 4) if change_percent is not None else None,
        "currency": fast_info.get("currency") or ("CNY" if symbol.endswith((".SS", ".SZ", ".BJ")) else "USD"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": "Yahoo Finance",
    }


def parse_quote_symbols(value: str) -> list[str]:
    symbols = list(dict.fromkeys(part.strip().upper() for part in str(value or "").split(",") if part.strip()))
    if not symbols:
        raise ValueError("至少需要一个股票代码")
    if len(symbols) > 50:
        raise ValueError("单次最多读取50个股票代码")
    if any(not YAHOO_SYMBOL_PATTERN.fullmatch(symbol) for symbol in symbols):
        raise ValueError("股票代码格式不正确")
    return symbols


def build_quote_from_rows(provider_symbol: str, rows: list[dict]) -> dict:
    ordered = sorted(
        (dict(row) for row in rows if isinstance(row, dict) and row.get("date") and row.get("close") is not None),
        key=lambda row: row["date"],
    )
    if len(ordered) < 2:
        raise LookupError(f"{provider_symbol} 没有足够的近期行情")
    latest, previous = ordered[-1], ordered[-2]
    price = float(latest["close"])
    previous_close = float(previous["close"])
    change_percent = (price / previous_close - 1) * 100 if previous_close else None
    return {
        "providerSymbol": provider_symbol,
        "price": round(price, 4),
        "previousClose": round(previous_close, 4),
        "changePercent": round(change_percent, 4) if change_percent is not None else None,
        "currency": "CNY" if provider_symbol.endswith((".SS", ".SZ", ".BJ")) else "USD",
        "marketDate": str(latest["date"]),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": "Yahoo Finance via yfinance",
    }


def get_quotes(provider_symbols: list[str], *, force: bool = False) -> list[dict]:
    series = get_yfinance_latest_series(provider_symbols, force=force)
    quotes = []
    for symbol in provider_symbols:
        rows = series.get(symbol) or []
        if rows:
            quotes.append(build_quote_from_rows(symbol, rows))
            continue
        quotes.append(get_quote(symbol))
    return quotes


def calculate_technical_snapshot(closes: list[float]) -> dict:
    """Calculate a compact, deterministic technical snapshot from daily closes."""
    clean_closes = [float(value) for value in closes if value is not None and math.isfinite(float(value))]
    if len(clean_closes) < 20:
        raise ValueError("至少需要20个交易日的数据才能生成分析")

    price = clean_closes[-1]
    ma20 = statistics.fmean(clean_closes[-20:])
    ma60 = statistics.fmean(clean_closes[-60:]) if len(clean_closes) >= 60 else None

    rsi_window = clean_closes[-15:]
    changes = [current - previous for previous, current in zip(rsi_window, rsi_window[1:])]
    gains = [max(change, 0.0) for change in changes]
    losses = [max(-change, 0.0) for change in changes]
    average_gain = statistics.fmean(gains)
    average_loss = statistics.fmean(losses)
    rsi14 = 100.0 if average_loss == 0 else 100 - (100 / (1 + average_gain / average_loss))

    volatility_prices = clean_closes[-21:]
    daily_returns = [
        current / previous - 1
        for previous, current in zip(volatility_prices, volatility_prices[1:])
        if previous
    ]
    volatility20 = statistics.pstdev(daily_returns) * math.sqrt(252) * 100 if len(daily_returns) > 1 else 0.0

    period_high = max(clean_closes)
    period_low = min(clean_closes)
    price_range = period_high - period_low
    range_position = ((price - period_low) / price_range * 100) if price_range else 50.0

    if ma60 is not None and price > ma20 > ma60:
        trend = "strong_up"
    elif price > ma20:
        trend = "up"
    elif ma60 is not None and price < ma20 < ma60:
        trend = "strong_down"
    elif price < ma20:
        trend = "down"
    else:
        trend = "neutral"

    return {
        "trend": trend,
        "ma20": round(ma20, 4),
        "ma60": round(ma60, 4) if ma60 is not None else None,
        "rsi14": round(rsi14, 2),
        "volatility20": round(volatility20, 2),
        "periodHigh": round(period_high, 4),
        "periodLow": round(period_low, 4),
        "rangePosition": round(range_position, 2),
        "sampleDays": len(clean_closes),
    }


def build_stock_analysis_from_rows(
    symbol: str,
    rows: list[dict],
    *,
    currency: str,
    range_id: str,
    interval_label: str,
    custom_start: str = "",
) -> dict:
    """Build a single-stock chart using that stock's own OHLCV data."""

    prepared = []
    for source in sorted((row for row in rows if isinstance(row, dict)), key=lambda row: row.get("time", "")):
        row = dict(source)
        buy, sell, delta = estimate_order_flow(
            row.get("open"), row.get("high"), row.get("low"), row.get("close"), row.get("volume")
        )
        row.update({"buyVolume": round(buy, 2), "sellVolume": round(sell, 2), "delta": round(delta, 2)})
        prepared.append(row)
    visible = select_technical_range(prepared, range_id, custom_start or None)
    if len(visible) < 2:
        raise LookupError("没有足够的有效K线生成所选范围分析")
    annotated = calculate_technical_indicators(
        prepared,
        vwap_mode="session" if range_id == "1d" else "range",
        vwap_start="" if range_id == "1d" else visible[0]["time"],
    )
    selected = select_technical_range(annotated, range_id, custom_start or None)
    analysis_rows = selected if len(selected) >= 20 else annotated
    snapshot = calculate_technical_snapshot([row["close"] for row in analysis_rows])
    latest = selected[-1]
    start_price = float(selected[0].get("open") or selected[0]["close"])
    buy_volume = sum(float(row.get("buyVolume") or 0) for row in selected)
    sell_volume = sum(float(row.get("sellVolume") or 0) for row in selected)
    total_volume = buy_volume + sell_volume or 1.0
    profile = build_volume_profile(selected, latest["close"])
    display_candles = aggregate_candles(selected)
    true_ranges = []
    previous_close = None
    for row in analysis_rows:
        high = float(row["high"])
        low = float(row["low"])
        true_range = high - low
        if previous_close is not None:
            true_range = max(true_range, abs(high - previous_close), abs(low - previous_close))
        true_ranges.append(true_range)
        previous_close = float(row["close"])
    atr14 = statistics.fmean(true_ranges[-14:]) if true_ranges else 0.0
    snapshot.update(
        {
            "rsi14": latest.get("rsi14"),
            "macd": latest.get("macd"),
            "macdSignal": latest.get("macdSignal"),
            "macdHistogram": latest.get("macdHistogram"),
            "vwap": latest.get("vwap"),
            "vwapDistancePercent": round((latest["close"] / latest["vwap"] - 1) * 100, 2) if latest.get("vwap") else None,
            "buyShare": round(buy_volume / total_volume * 100, 2),
            "sellShare": round(sell_volume / total_volume * 100, 2),
            "atr14": round(atr14, 4),
        }
    )
    return {
        "providerSymbol": symbol,
        "price": round(float(latest["close"]), 4),
        "previousClose": round(float(selected[-2]["close"]), 4),
        "changePercent": round((float(latest["close"]) / start_price - 1) * 100, 4) if start_price else None,
        "currency": currency,
        "analysis": snapshot,
        "chart": {
            "candles": display_candles,
            "profile": profile,
            "indicatorConfig": {
                "rsi": 14,
                "macd": [12, 26, 9],
                "timeframe": interval_label,
                "vwapMode": "session" if range_id == "1d" else "range-anchored",
                "vwapEstimated": False,
            },
            "orderFlowEstimated": True,
            "dataWindow": {
                "start": selected[0]["time"],
                "end": selected[-1]["time"],
                "interval": interval_label,
                "observations": len(selected),
            },
        },
        "range": range_id,
        "customStart": custom_start,
    }


def _with_stock_analysis_cache(
    key: tuple[str, str, str],
    loader,
    *,
    now: float | None = None,
    ttl: float = STOCK_ANALYSIS_CACHE_TTL_SECONDS,
) -> dict:
    current = time.monotonic() if now is None else now
    with _STOCK_ANALYSIS_CACHE_LOCK:
        cached = _STOCK_ANALYSIS_CACHE.get(key)
        if cached and current - cached[0] <= ttl:
            return cached[1]

    value = loader()
    with _STOCK_ANALYSIS_CACHE_LOCK:
        _STOCK_ANALYSIS_CACHE[key] = (current, value)
        if len(_STOCK_ANALYSIS_CACHE) > STOCK_ANALYSIS_CACHE_MAX_ENTRIES:
            oldest_key = min(_STOCK_ANALYSIS_CACHE, key=lambda item: _STOCK_ANALYSIS_CACHE[item][0])
            if oldest_key != key:
                _STOCK_ANALYSIS_CACHE.pop(oldest_key, None)
    return value


def _fetch_stock_analysis(provider_symbol: str, range_id: str = "3m", custom_start: str = "") -> dict:
    import yfinance as yf

    symbol = (provider_symbol or "").strip().upper()
    if not YAHOO_SYMBOL_PATTERN.fullmatch(symbol):
        raise ValueError("股票代码格式不正确")
    selected_range, selected_start = validate_signal_range(range_id, custom_start)
    config = get_technical_range_config(selected_range, selected_start)

    ticker = yf.Ticker(symbol)
    history = ticker.history(
        start=(date.today() - timedelta(days=int(config["lookback"]))).isoformat(),
        end=(date.today() + timedelta(days=1)).isoformat(),
        interval=config["interval"],
        auto_adjust=False,
        prepost=False,
        actions=False,
    )
    if history.empty or "Close" not in history:
        raise LookupError("没有找到该股票的历史行情数据")

    rows = []
    for timestamp, item in history.iterrows():
        close = float(item.get("Close"))
        if not math.isfinite(close):
            continue
        time_text = timestamp.isoformat() if hasattr(timestamp, "isoformat") else str(timestamp)
        rows.append(
            {
                "time": time_text,
                "date": time_text[:10],
                "open": round(float(item.get("Open")), 4),
                "high": round(float(item.get("High")), 4),
                "low": round(float(item.get("Low")), 4),
                "close": round(close, 4),
                "volume": round(float(item.get("Volume") or 0), 2),
            }
        )

    try:
        fast_info = dict(ticker.fast_info)
    except Exception:
        fast_info = {}

    currency = fast_info.get("currency") or ("CNY" if symbol.endswith((".SS", ".SZ", ".BJ")) else "USD")
    result = build_stock_analysis_from_rows(
        symbol,
        rows,
        currency=currency,
        range_id=selected_range,
        interval_label=config["label"],
        custom_start=selected_start or "",
    )
    result.update({"timestamp": datetime.now(timezone.utc).isoformat(), "source": "Yahoo Finance"})
    return result


def get_stock_analysis(provider_symbol: str, range_id: str = "3m", custom_start: str = "") -> dict:
    cache_key = (
        (provider_symbol or "").strip().upper(),
        (range_id or "3m").strip().lower(),
        (custom_start or "").strip(),
    )
    return _with_stock_analysis_cache(
        cache_key,
        lambda: _fetch_stock_analysis(provider_symbol, range_id, custom_start),
    )


class MarketDataHandler(BaseHTTPRequestHandler):
    server_version = "QuantDeskAPI/0.1"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        try:
            if parsed.path == "/api/instruments/search":
                query = validate_search_query(params.get("q", [""])[0])
                data = search_instruments(query)
                self.send_json(200, {"data": data, "meta": {"query": query, "count": len(data)}})
                return
            if parsed.path == "/api/quotes":
                batch_value = params.get("symbols", [""])[0]
                if batch_value:
                    symbols = parse_quote_symbols(batch_value)
                    data = get_quotes(symbols, force=params.get("refresh", ["0"])[0] == "1")
                else:
                    data = get_quote(params.get("symbol", [""])[0])
                self.send_json(200, {"data": data})
                return
            if parsed.path == "/api/analysis":
                data = get_stock_analysis(
                    params.get("symbol", [""])[0],
                    params.get("range", ["3m"])[0],
                    params.get("start", [""])[0],
                )
                self.send_json(200, {"data": data})
                return
            if parsed.path == "/api/company-research":
                data = get_company_research(
                    params.get("market", [""])[0],
                    params.get("symbol", [""])[0],
                    params.get("providerSymbol", [""])[0],
                    company_name=params.get("companyName", [""])[0],
                    force=params.get("refresh", ["0"])[0] == "1",
                )
                self.send_json(200, {"data": data})
                return
            if parsed.path == "/api/macro":
                force = params.get("refresh", ["0"])[0] == "1"
                data = get_macro_dashboard(force=force)
                self.send_json(200, {"data": data})
                return
            if parsed.path == "/api/signals":
                self.send_json(200, {"data": get_signal_bootstrap()})
                return
            if parsed.path == "/api/market-timing":
                force = params.get("refresh", ["0"])[0] == "1"
                range_id, custom_start = validate_market_timing_range(
                    params.get("range", ["1m"])[0], params.get("start", [""])[0]
                )
                data = apply_market_timing_range(
                    get_market_timing_dashboard(force=force), range_id, custom_start
                )
                self.send_json(200, {"data": data})
                return
            if parsed.path == "/api/sector-rotation":
                force = params.get("refresh", ["0"])[0] == "1"
                data = get_sector_rotation_dashboard(force=force)
                self.send_json(200, {"data": data})
                return
            if parsed.path == "/api/investor-sentiment":
                force = params.get("refresh", ["0"])[0] == "1"
                data = build_sentiment_dashboard(get_market_timing_dashboard(force=force))
                self.send_json(200, {"data": data})
                return
            if parsed.path == "/api/capital-flow":
                force = params.get("refresh", ["0"])[0] == "1"
                data = get_capital_flow_dashboard(force=force)
                self.send_json(200, {"data": data})
                return
            if parsed.path == "/api/capital-flow/constituents":
                data = build_sector_constituents(
                    params.get("market", [""])[0],
                    params.get("sector", [""])[0],
                    range_id=params.get("range", ["1m"])[0],
                    custom_start=params.get("start", [""])[0] or None,
                    force=params.get("refresh", ["0"])[0] == "1",
                )
                self.send_json(200, {"data": data})
                return
            if parsed.path == "/api/micro-market":
                data = get_micro_market_dashboard(
                    range_id=params.get("range", ["1m"])[0],
                    custom_start=params.get("start", [""])[0],
                    china_instrument=params.get("china", ["csi300"])[0],
                    us_instrument=params.get("us", ["sp500"])[0],
                    force=params.get("refresh", ["0"])[0] == "1",
                )
                self.send_json(200, {"data": data})
                return
            if parsed.path == "/api/data-sources":
                self.send_json(200, {"data": get_data_source_center()})
                return
            if parsed.path == "/api/scanner-results":
                if not SCANNER_RESULT_PATH.is_file():
                    self.send_json(200, {"data": {"status": "unavailable", "reason": "尚未生成全市场扫描结果", "rows": []}})
                    return
                payload = json.loads(SCANNER_RESULT_PATH.read_text(encoding="utf-8"))
                if payload.get("schemaVersion") != 1 or not isinstance(payload.get("rows"), list):
                    raise ValueError("全市场扫描结果格式不正确")
                self.send_json(200, {"data": {**payload, "status": "ready"}})
                return
            if parsed.path == "/api/health":
                self.send_json(
                    200,
                    {"data": {"status": "ok", "capabilities": ["broker-read-only-v1", "ibkr-market-data-v1"]}},
                )
                return
            self.send_error_json(404, "NOT_FOUND", "接口不存在")
        except ValueError as error:
            self.send_error_json(400, "VALIDATION_ERROR", str(error))
        except LookupError as error:
            self.send_error_json(404, "QUOTE_NOT_FOUND", str(error))
        except Exception as error:
            print(f"market data request failed: {type(error).__name__}: {error}")
            self.send_error_json(502, "DATA_SOURCE_ERROR", "行情数据源暂时不可用，请稍后重试")

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            if parsed.path not in {"/api/data-sources/check", "/api/news-credentials", "/api/broker-accounts/snapshot", "/api/broker-accounts/quotes"}:
                self.send_error_json(404, "NOT_FOUND", "接口不存在")
                return
            content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            if content_type != "application/json":
                raise ValueError("请求必须使用 application/json")
            content_length = int(self.headers.get("Content-Length", "0") or 0)
            if content_length <= 0 or content_length > 16_384:
                raise ValueError("请求正文大小不正确")
            try:
                payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                raise ValueError("请求正文不是有效的 JSON") from error
            if not isinstance(payload, dict):
                raise ValueError("请求正文必须是对象")
            if parsed.path in {"/api/news-credentials", "/api/broker-accounts/snapshot", "/api/broker-accounts/quotes"}:
                origin = self.headers.get("Origin", "").strip()
                if origin and origin not in {"http://127.0.0.1:5173", "http://localhost:5173"}:
                    raise ValueError("本机敏感配置接口只接受本机应用请求")
            if parsed.path == "/api/broker-accounts/snapshot":
                data = read_broker_snapshot(payload.get("sourceId", ""), payload.get("config", {}))
            elif parsed.path == "/api/broker-accounts/quotes":
                if str(payload.get("sourceId") or "").strip().lower() != "ibkr":
                    raise ValueError("当前只支持从 IBKR 读取美股行情")
                data = read_broker_quotes(payload.get("config", {}), payload.get("symbols", []))
            elif parsed.path == "/api/news-credentials":
                data = save_news_credential(payload.get("providerId", ""), payload.get("apiKey", ""))
            else:
                data = check_data_source(payload.get("sourceId", ""), payload.get("config", {}))
            self.send_json(200, {"data": data})
        except ValueError as error:
            self.send_error_json(400, "VALIDATION_ERROR", str(error))
        except RuntimeError as error:
            self.send_error_json(502, "BROKER_CONNECTION_ERROR", str(error))
        except Exception as error:
            print(f"data source readiness check failed: {type(error).__name__}")
            self.send_error_json(502, "CONNECTOR_CHECK_ERROR", "券商只读连接暂时不可用，请检查本机客户端")

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "http://127.0.0.1:5173")
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            # A browser navigation can cancel an in-flight response. The work is
            # already complete, so do not attempt a second error response.
            return

    def send_error_json(self, status: int, code: str, message: str) -> None:
        self.send_json(status, {"error": {"code": code, "message": message}})

    def log_message(self, format: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {format % args}")


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 8000), MarketDataHandler)
    print("Quant Desk data API: http://127.0.0.1:8000")
    server.serve_forever()


if __name__ == "__main__":
    main()
