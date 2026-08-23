"""Zero-configuration index-point structure and estimated order-flow analysis.

Index OHLC bars provide the point scale shown to users. Because cash indices
are not directly tradable, a liquid tracking ETF supplies the volume used to
estimate buyer/seller flow. This proxy is not a Level 2 order book and must be
labelled as such in the UI.
"""

from __future__ import annotations

import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

from technical_indicators import calculate_technical_indicators
from time_ranges import validate_signal_range


MICRO_INSTRUMENTS = {
    "china": [
        {
            "id": "csi300",
            "title": "沪深300",
            "priceLabel": "沪深300指数",
            "priceSymbol": "000300.SS",
            "priceDisplaySymbol": "000300",
            "flowSymbol": "510300.SS",
            "flowDisplaySymbol": "510300",
            "carrier": "510300 沪深300ETF",
            "currency": "CNY",
            "unit": "POINTS",
        },
        {
            "id": "sse50",
            "title": "上证50",
            "priceLabel": "上证50指数",
            "priceSymbol": "000016.SS",
            "priceDisplaySymbol": "000016",
            "flowSymbol": "510050.SS",
            "flowDisplaySymbol": "510050",
            "carrier": "510050 上证50ETF",
            "currency": "CNY",
            "unit": "POINTS",
        },
        {
            "id": "chinext",
            "title": "创业板指",
            "priceLabel": "创业板指数",
            "priceSymbol": "399006.SZ",
            "priceDisplaySymbol": "399006",
            "flowSymbol": "159915.SZ",
            "flowDisplaySymbol": "159915",
            "carrier": "159915 创业板ETF",
            "currency": "CNY",
            "unit": "POINTS",
        },
    ],
    "united-states": [
        {
            "id": "sp500",
            "title": "标普500",
            "priceLabel": "标普500指数",
            "priceSymbol": "^GSPC",
            "priceDisplaySymbol": "^GSPC",
            "flowSymbol": "SPY",
            "flowDisplaySymbol": "SPY",
            "carrier": "SPY · SPDR S&P 500 ETF",
            "currency": "USD",
            "unit": "POINTS",
        },
        {
            "id": "nasdaq100",
            "title": "纳斯达克100",
            "priceLabel": "纳斯达克100指数",
            "priceSymbol": "^NDX",
            "priceDisplaySymbol": "^NDX",
            "flowSymbol": "QQQ",
            "flowDisplaySymbol": "QQQ",
            "carrier": "QQQ · Invesco QQQ",
            "currency": "USD",
            "unit": "POINTS",
        },
        {
            "id": "dow30",
            "title": "道琼斯工业指数",
            "priceLabel": "道琼斯工业平均指数",
            "priceSymbol": "^DJI",
            "priceDisplaySymbol": "^DJI",
            "flowSymbol": "DIA",
            "flowDisplaySymbol": "DIA",
            "carrier": "DIA · SPDR Dow Jones ETF",
            "currency": "USD",
            "unit": "POINTS",
        },
    ],
}

RANGE_CONFIGURATION = {
    "1d": {"frequency": "5", "interval": "5m", "lookback": 10, "label": "5分钟"},
    "1w": {"frequency": "15", "interval": "15m", "lookback": 21, "label": "15分钟"},
    "1m": {"frequency": "60", "interval": "60m", "lookback": 75, "label": "60分钟"},
    "3m": {"frequency": "d", "interval": "1d", "lookback": 220, "label": "日线"},
    "1y": {"frequency": "d", "interval": "1d", "lookback": 550, "label": "日线"},
}

MARKET_LABELS = {"china": "中国市场", "united-states": "美国市场"}
MICRO_CACHE_TTL_SECONDS = 5 * 60
_CACHE: dict[tuple, tuple[float, dict]] = {}
_CACHE_LOCK = threading.Lock()
_YFINANCE_LOCK = threading.Lock()
CHINA_TIMEZONE = timezone(timedelta(hours=8))


def _finite(value, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def estimate_order_flow(
    open_price: float,
    high: float,
    low: float,
    close: float,
    volume: float,
) -> tuple[float, float, float]:
    """Estimate aggressive buyer/seller volume from an OHLCV candle.

    This is a deterministic proxy, not exchange-classified bid/ask volume.
    """

    open_price, high, low, close, volume = map(
        _finite, (open_price, high, low, close, volume)
    )
    volume = max(0.0, volume)
    span = max(high - low, abs(close) * 1e-9, 1e-9)
    close_location = _clamp(((close - low) / span) * 2 - 1, -1, 1)
    body_direction = _clamp((close - open_price) / span, -1, 1)
    pressure = _clamp(close_location * 0.65 + body_direction * 0.35, -0.95, 0.95)
    buy_volume = volume * (1 + pressure) / 2
    sell_volume = volume - buy_volume
    return buy_volume, sell_volume, buy_volume - sell_volume


def aggregate_candles(rows: list[dict], maximum: int = 180) -> list[dict]:
    """Downsample candles without losing OHLC or total estimated flow."""

    if maximum <= 0:
        raise ValueError("最大K线数量必须大于0")
    clean = [row for row in rows if isinstance(row, dict)]
    if len(clean) <= maximum:
        return clean
    chunk_size = math.ceil(len(clean) / maximum)
    aggregated = []
    for offset in range(0, len(clean), chunk_size):
        chunk = clean[offset : offset + chunk_size]
        if not chunk:
            continue
        buy_volume = sum(_finite(row.get("buyVolume")) for row in chunk)
        sell_volume = sum(_finite(row.get("sellVolume")) for row in chunk)
        aggregated.append(
            {
                "time": chunk[-1]["time"],
                "startTime": chunk[0]["time"],
                "date": chunk[-1]["date"],
                "open": _finite(chunk[0].get("open")),
                "high": max(_finite(row.get("high")) for row in chunk),
                "low": min(_finite(row.get("low")) for row in chunk),
                "close": _finite(chunk[-1].get("close")),
                "volume": sum(_finite(row.get("volume")) for row in chunk),
                "amount": sum(_finite(row.get("amount")) for row in chunk),
                "buyVolume": buy_volume,
                "sellVolume": sell_volume,
                "delta": buy_volume - sell_volume,
                "sourceBars": len(chunk),
                **{
                    key: chunk[-1].get(key)
                    for key in ("rsi14", "macd", "macdSignal", "macdHistogram", "vwap")
                    if key in chunk[-1]
                },
            }
        )
    return aggregated


def _percentile(values: list[float], ratio: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    position = (len(ordered) - 1) * _clamp(ratio, 0, 1)
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def _vacuum_zones(bins: list[dict]) -> list[dict]:
    positive = [item["totalVolume"] for item in bins if item["totalVolume"] > 0]
    threshold = _percentile(positive, 0.2) if positive else 0.0
    groups: list[list[dict]] = []
    for item in bins:
        if item["totalVolume"] <= threshold:
            if not groups or groups[-1][-1]["index"] != item["index"] - 1:
                groups.append([])
            groups[-1].append(item)
    zones = []
    for group in groups:
        if not group:
            continue
        zones.append(
            {
                "low": round(group[0]["low"], 4),
                "high": round(group[-1]["high"], 4),
                "midpoint": round((group[0]["low"] + group[-1]["high"]) / 2, 4),
                "share": round(sum(item["share"] for item in group), 2),
                "label": "低成交真空区",
            }
        )
    return sorted(zones, key=lambda item: item["share"])[:4]


def build_volume_profile(
    rows: list[dict], current_price: float | None = None, bin_count: int = 42
) -> dict:
    """Build an estimated visible-range volume profile from OHLCV bars."""

    clean = [
        row
        for row in rows
        if _finite(row.get("high")) >= _finite(row.get("low"))
        and _finite(row.get("volume")) > 0
    ]
    if not clean:
        raise ValueError("没有可用于成交量轮廓计算的K线")
    bin_count = max(12, min(80, int(bin_count)))
    minimum = min(_finite(row["low"]) for row in clean)
    maximum = max(_finite(row["high"]) for row in clean)
    span = maximum - minimum
    if span <= 0:
        span = max(abs(maximum) * 0.01, 0.01)
        minimum -= span / 2
        maximum += span / 2
    step = (maximum - minimum) / bin_count
    bins = [
        {
            "index": index,
            "low": minimum + index * step,
            "high": minimum + (index + 1) * step,
            "buyVolume": 0.0,
            "sellVolume": 0.0,
        }
        for index in range(bin_count)
    ]

    for row in clean:
        low_index = int(_clamp(math.floor((_finite(row["low"]) - minimum) / step), 0, bin_count - 1))
        high_index = int(_clamp(math.floor((_finite(row["high"]) - minimum) / step), 0, bin_count - 1))
        close_index = int(_clamp(math.floor((_finite(row["close"]) - minimum) / step), 0, bin_count - 1))
        indexes = list(range(low_index, high_index + 1)) or [close_index]
        weights = [2.0 if index == close_index else 1.0 for index in indexes]
        weight_total = sum(weights) or 1.0
        buy_volume = _finite(row.get("buyVolume"))
        sell_volume = _finite(row.get("sellVolume"))
        if buy_volume + sell_volume <= 0:
            buy_volume, sell_volume, _ = estimate_order_flow(
                row.get("open"), row.get("high"), row.get("low"), row.get("close"), row.get("volume")
            )
        for index, weight in zip(indexes, weights):
            bins[index]["buyVolume"] += buy_volume * weight / weight_total
            bins[index]["sellVolume"] += sell_volume * weight / weight_total

    total_volume = sum(item["buyVolume"] + item["sellVolume"] for item in bins) or 1.0
    maximum_bin_volume = max(item["buyVolume"] + item["sellVolume"] for item in bins) or 1.0
    for item in bins:
        item["midpoint"] = (item["low"] + item["high"]) / 2
        item["totalVolume"] = item["buyVolume"] + item["sellVolume"]
        item["share"] = item["totalVolume"] / total_volume * 100
        item["density"] = item["totalVolume"] / maximum_bin_volume * 100

    poc_bin = max(bins, key=lambda item: item["totalVolume"])
    value_bins = []
    accumulated = 0.0
    for item in sorted(bins, key=lambda entry: entry["totalVolume"], reverse=True):
        value_bins.append(item)
        accumulated += item["totalVolume"]
        if accumulated / total_volume >= 0.7:
            break

    price = _finite(current_price, _finite(clean[-1].get("close")))
    positive_volumes = [item["totalVolume"] for item in bins if item["totalVolume"] > 0]
    high_volume_threshold = _percentile(positive_volumes, 0.65)
    high_volume_nodes = [item for item in bins if item["totalVolume"] >= high_volume_threshold]
    supports = [item for item in high_volume_nodes if item["midpoint"] < price]
    resistances = [item for item in high_volume_nodes if item["midpoint"] > price]
    value_area_low = min(item["low"] for item in value_bins)
    value_area_high = max(item["high"] for item in value_bins)
    support = max(supports, key=lambda item: item["midpoint"])["midpoint"] if supports else value_area_low
    resistance = min(resistances, key=lambda item: item["midpoint"])["midpoint"] if resistances else value_area_high
    if support >= price:
        support = minimum
    if resistance <= price:
        resistance = maximum

    def level_from_bin(item: dict, source: str) -> dict:
        return {
            "low": round(item["low"], 4),
            "high": round(item["high"], 4),
            "midpoint": round(item["midpoint"], 4),
            "share": round(item["share"], 3),
            "density": round(item["density"], 2),
            "source": source,
        }

    local_peaks = []
    for index, item in enumerate(bins):
        previous_volume = bins[index - 1]["totalVolume"] if index else -1
        next_volume = bins[index + 1]["totalVolume"] if index < len(bins) - 1 else -1
        if item["totalVolume"] >= previous_volume and item["totalVolume"] >= next_volume and item["density"] >= 35:
            local_peaks.append(item)

    def distinct_levels(candidates: list[dict], reverse: bool) -> list[dict]:
        ordered = sorted(candidates, key=lambda item: item["midpoint"], reverse=reverse)
        selected = []
        for item in ordered:
            if any(abs(item["midpoint"] - existing["midpoint"]) < step * 1.5 for existing in selected):
                continue
            selected.append(item)
            if len(selected) == 2:
                break
        return selected

    support_nodes = distinct_levels([item for item in local_peaks if item["high"] < price], True)
    resistance_nodes = distinct_levels([item for item in local_peaks if item["low"] > price], False)

    def append_boundary(levels: list[dict], boundary: float, side: str, source: str) -> None:
        if len(levels) >= 2:
            return
        if side == "support":
            low, high = max(minimum, boundary - step), min(price - step * 0.05, boundary)
        else:
            low, high = max(price + step * 0.05, boundary), min(maximum, boundary + step)
        if low >= high:
            return
        midpoint = (low + high) / 2
        if any(abs(midpoint - item["midpoint"]) < step * 1.5 for item in levels):
            return
        levels.append({
            "low": low,
            "high": high,
            "midpoint": midpoint,
            "share": 0.0,
            "density": 0.0,
            "source": source,
        })

    append_boundary(support_nodes, value_area_low, "support", "VRVP价值区下沿")
    append_boundary(support_nodes, minimum + step, "support", "所选区间低位边界")
    append_boundary(resistance_nodes, value_area_high, "resistance", "VRVP价值区上沿")
    append_boundary(resistance_nodes, maximum - step, "resistance", "所选区间高位边界")

    support_levels = [
        level_from_bin(item, item.get("source", "VRVP高成交节点"))
        for item in sorted(support_nodes, key=lambda item: item["midpoint"], reverse=True)[:2]
    ]
    resistance_levels = [
        level_from_bin(item, item.get("source", "VRVP高成交节点"))
        for item in sorted(resistance_nodes, key=lambda item: item["midpoint"])[:2]
    ]

    serialized_bins = []
    for item in bins:
        serialized_bins.append(
            {
                "low": round(item["low"], 4),
                "high": round(item["high"], 4),
                "midpoint": round(item["midpoint"], 4),
                "buyVolume": round(item["buyVolume"], 2),
                "sellVolume": round(item["sellVolume"], 2),
                "totalVolume": round(item["totalVolume"], 2),
                "share": round(item["share"], 3),
                "density": round(item["density"], 2),
            }
        )
    vacuum_source = [dict(item) for item in bins]
    return {
        "bins": serialized_bins,
        "poc": round(poc_bin["midpoint"], 4),
        "valueAreaLow": round(value_area_low, 4),
        "valueAreaHigh": round(value_area_high, 4),
        "support": round(support, 4),
        "resistance": round(resistance, 4),
        "supportLevels": support_levels,
        "resistanceLevels": resistance_levels,
        "vacuumZones": _vacuum_zones(vacuum_source),
        "valueAreaPercent": 70,
        "method": "OHLCV估算成交量轮廓",
    }


def _range_config(range_id: str, custom_start: str | None) -> dict:
    if range_id != "custom":
        return dict(RANGE_CONFIGURATION[range_id])
    start = date.fromisoformat(custom_start)
    days = max(1, (date.today() - start).days)
    if days <= 7:
        frequency, interval, label = "5", "5m", "5分钟"
        warmup_days = 10
    elif days <= 31:
        frequency, interval, label = "15", "15m", "15分钟"
        warmup_days = 20
    elif days <= 180:
        frequency, interval, label = "60", "60m", "60分钟"
        warmup_days = 45
    else:
        frequency, interval, label = "d", "1d", "日线"
        warmup_days = 180
    return {"frequency": frequency, "interval": interval, "lookback": days + warmup_days, "label": label}


def _requested_start(config: dict, custom_start: str | None) -> date:
    return date.today() - timedelta(days=int(config["lookback"]))


def _request_end_date(now: datetime | None = None) -> date:
    """Return Yahoo's exclusive end date far enough to include today's China session."""
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return current.astimezone(CHINA_TIMEZONE).date() + timedelta(days=1)


def get_technical_range_config(range_id: str, custom_start: str | None = None) -> dict:
    """Return the shared chart interval and hidden warm-up window."""

    return _range_config(range_id, custom_start)


def select_technical_range(rows: list[dict], range_id: str, custom_start: str | None = None) -> list[dict]:
    """Crop preloaded rows to the user-visible comparison range."""

    return _select_requested_window(rows, range_id, custom_start)


def _select_requested_window(rows: list[dict], range_id: str, custom_start: str | None) -> list[dict]:
    clean = sorted(rows, key=lambda row: row["time"])
    if not clean:
        return []
    latest = date.fromisoformat(clean[-1]["date"])
    if range_id == "1d":
        return [row for row in clean if row["date"] == latest.isoformat()]
    if range_id == "custom":
        start = date.fromisoformat(custom_start)
    else:
        days = {"1w": 7, "1m": 31, "3m": 93, "1y": 366}[range_id]
        start = latest - timedelta(days=days)
    return [row for row in clean if row["date"] >= start.isoformat()]


def _normalize_row(time_text: str, open_, high, low, close, volume, amount=0) -> dict:
    open_, high, low, close, volume, amount = map(
        _finite, (open_, high, low, close, volume, amount)
    )
    buy, sell, delta = estimate_order_flow(open_, high, low, close, volume)
    return {
        "time": time_text,
        "date": time_text[:10],
        "open": round(open_, 4),
        "high": round(high, 4),
        "low": round(low, 4),
        "close": round(close, 4),
        "volume": round(volume, 2),
        "amount": round(amount, 2),
        "buyVolume": round(buy, 2),
        "sellVolume": round(sell, 2),
        "delta": round(delta, 2),
    }


def _market_time_key(value: str) -> str:
    """Match index and ETF bars by their exchange-local minute."""

    return str(value or "")[:16]


def combine_index_price_with_flow(
    price_rows: list[dict], flow_rows: list[dict]
) -> list[dict]:
    """Map ETF-estimated flow onto cash-index OHLC bars at the same minute."""

    flow_by_time = {
        _market_time_key(row.get("time")): row
        for row in flow_rows
        if isinstance(row, dict) and row.get("time")
    }
    combined = []
    for price_row in price_rows:
        if not isinstance(price_row, dict):
            continue
        proxy = flow_by_time.get(_market_time_key(price_row.get("time")))
        if not proxy:
            continue
        combined.append(
            {
                **price_row,
                "volume": _finite(proxy.get("volume")),
                "amount": _finite(proxy.get("amount")),
                "buyVolume": _finite(proxy.get("buyVolume")),
                "sellVolume": _finite(proxy.get("sellVolume")),
                "delta": _finite(proxy.get("delta")),
            }
        )
    return combined


def _fetch_yfinance(symbol: str, config: dict, start: date) -> list[dict]:
    import yfinance as yf

    with _YFINANCE_LOCK:
        frame = yf.Ticker(symbol).history(
            start=start.isoformat(),
            end=_request_end_date().isoformat(),
            interval=config["interval"],
            auto_adjust=False,
            prepost=False,
            actions=False,
        )
    rows = []
    if frame.empty:
        return rows
    for timestamp, item in frame.iterrows():
        if hasattr(timestamp, "isoformat"):
            time_text = timestamp.isoformat()
        else:
            time_text = str(timestamp)
        rows.append(
            _normalize_row(
                time_text,
                item.get("Open"),
                item.get("High"),
                item.get("Low"),
                item.get("Close"),
                item.get("Volume"),
                _finite(item.get("Close")) * _finite(item.get("Volume")),
            )
        )
    return rows


def _instrument_definition(market_id: str, instrument_id: str) -> dict:
    if market_id not in MICRO_INSTRUMENTS:
        raise ValueError("不支持的市场")
    definition = next(
        (item for item in MICRO_INSTRUMENTS[market_id] if item["id"] == instrument_id),
        None,
    )
    if not definition:
        raise ValueError("不支持的指数")
    return definition


def _public_instrument(definition: dict) -> dict:
    public = {
        key: value
        for key, value in definition.items()
        if key not in {"priceSymbol", "flowSymbol", "priceDisplaySymbol", "flowDisplaySymbol"}
    }
    public["priceSymbol"] = definition["priceDisplaySymbol"]
    public["flowSymbol"] = definition["flowDisplaySymbol"]
    return public


def _build_market(market_id: str, instrument_id: str, range_id: str, custom_start: str | None) -> dict:
    definition = _instrument_definition(market_id, instrument_id)
    config = _range_config(range_id, custom_start)
    start = _requested_start(config, custom_start)
    price_rows = _fetch_yfinance(definition["priceSymbol"], config, start)
    flow_rows = _fetch_yfinance(definition["flowSymbol"], config, start)
    rows = combine_index_price_with_flow(price_rows, flow_rows)
    visible_rows = _select_requested_window(rows, range_id, custom_start)
    if len(visible_rows) < 2:
        raise LookupError(f"{definition['title']}没有足够的有效K线")
    annotated = calculate_technical_indicators(
        rows,
        vwap_mode="session" if range_id == "1d" else "range",
        vwap_start="" if range_id == "1d" else visible_rows[0]["time"],
    )
    selected = _select_requested_window(annotated, range_id, custom_start)
    if len(selected) < 2:
        raise LookupError(f"{definition['title']}没有足够的有效K线")
    close = selected[-1]["close"]
    start_close = selected[0]["open"] or selected[0]["close"]
    buy_volume = sum(item["buyVolume"] for item in selected)
    sell_volume = sum(item["sellVolume"] for item in selected)
    total_flow = buy_volume + sell_volume or 1.0
    profile = build_volume_profile(selected, close)
    display_candles = aggregate_candles(selected)
    latest_indicator = selected[-1]
    return {
        "id": market_id,
        "title": MARKET_LABELS[market_id],
        "status": "live",
        "instrument": _public_instrument(definition),
        "source": {
            "name": "Yahoo Finance 指数 + ETF成交代理",
            "access": "无需 API Key",
            "mode": "zero-config",
            "price": definition["priceLabel"],
            "flow": definition["carrier"],
        },
        "candles": display_candles,
        "profile": profile,
        "summary": {
            "close": round(close, 4),
            "changePercent": round((close / start_close - 1) * 100, 2) if start_close else 0.0,
            "buyShare": round(buy_volume / total_flow * 100, 2),
            "sellShare": round(sell_volume / total_flow * 100, 2),
            "delta": round(buy_volume - sell_volume, 2),
            "rsi14": latest_indicator.get("rsi14"),
            "macd": latest_indicator.get("macd"),
            "macdSignal": latest_indicator.get("macdSignal"),
            "macdHistogram": latest_indicator.get("macdHistogram"),
            "vwap": latest_indicator.get("vwap"),
        },
        "indicatorConfig": {
            "rsi": 14,
            "macd": [12, 26, 9],
            "timeframe": config["label"],
            "vwapMode": "session" if range_id == "1d" else "range-anchored",
            "vwapEstimated": True,
        },
        "dataWindow": {
            "start": selected[0]["time"],
            "end": selected[-1]["time"],
            "interval": config["label"],
            "observations": len(selected),
            "displayCandles": len(display_candles),
            "priceObservations": len(price_rows),
            "flowObservations": len(flow_rows),
        },
    }


def get_micro_market_dashboard(
    range_id: str = "1m",
    custom_start: str = "",
    china_instrument: str = "csi300",
    us_instrument: str = "sp500",
    force: bool = False,
) -> dict:
    selected_range, selected_start = validate_signal_range(range_id, custom_start)
    key = (selected_range, selected_start, china_instrument, us_instrument)
    now = time.monotonic()
    with _CACHE_LOCK:
        cached = _CACHE.get(key)
        if cached and cached[0] > now and not force:
            return cached[1]

    requests = (("china", china_instrument), ("united-states", us_instrument))
    markets = []
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = {
            market_id: executor.submit(
                _build_market, market_id, instrument_id, selected_range, selected_start
            )
            for market_id, instrument_id in requests
        }
        for market_id, instrument_id in requests:
            try:
                markets.append(futures[market_id].result())
            except Exception as error:
                definition = _instrument_definition(market_id, instrument_id)
                markets.append(
                    {
                        "id": market_id,
                        "title": MARKET_LABELS[market_id],
                        "status": "error",
                        "instrument": _public_instrument(definition),
                        "issue": f"{type(error).__name__}: {error}",
                    }
                )

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "refreshAfterSeconds": MICRO_CACHE_TTL_SECONDS,
        "range": selected_range,
        "customStart": selected_start,
        "selections": {
            market: [
                _public_instrument(definition)
                for definition in definitions
            ]
            for market, definitions in MICRO_INSTRUMENTS.items()
        },
        "markets": markets,
        "methodology": {
            "orderFlow": "K线收盘位置65% + 实体方向35%，估算主动买量与主动卖量",
            "profile": "在指数点位区间内分配对应时刻ETF成交量，收盘点位所在区间加权",
            "disclaimer": "K线与关键价位使用指数点位；成交量与买卖量使用对应ETF代理并由OHLCV估算，不等同于交易所逐笔成交、Level 2挂单簿或真实委托队列。",
        },
    }
    with _CACHE_LOCK:
        _CACHE[key] = (now + MICRO_CACHE_TTL_SECONDS, payload)
    return payload
