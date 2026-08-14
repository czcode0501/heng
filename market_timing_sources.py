"""Zero-configuration external data adapters for the market-timing model."""

from __future__ import annotations

import json
import math
import re
import threading
import time
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from market_timing import build_china_market, build_us_market


SINA_JSONP_PATTERN = re.compile(r"\(\s*(\[.*\])\s*\)\s*;?\s*$", re.DOTALL)
REQUEST_TIMEOUT_SECONDS = 15
MARKET_CACHE_TTL_SECONDS = 30 * 60
ERROR_CACHE_TTL_SECONDS = 5 * 60
DEFAULT_CACHE_PATH = Path(__file__).resolve().parent / ".cache" / "market-timing.json"
BAOSTOCK_LOCK = threading.Lock()
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


def _fetch_china_baostock() -> dict[str, list[dict]]:
    # BaoStock package and release metadata: https://pypi.org/project/baostock/
    import baostock as bs

    start_date = (date.today() - timedelta(days=520)).isoformat()
    fields = "date,code,open,high,low,close,preclose,volume,amount,pctChg"
    with BAOSTOCK_LOCK:
        login = bs.login()
        if login.error_code != "0":
            raise RuntimeError(f"BaoStock 登录失败: {login.error_msg}")
        try:
            bundle = {}
            for key, symbols in CHINA_SERIES.items():
                result = bs.query_history_k_data_plus(
                    symbols["baostock"],
                    fields,
                    start_date=start_date,
                    frequency="d",
                    adjustflag="3",
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
                                "volume": float(values[7] or 0),
                                "amount": float(values[8] or 0),
                            }
                        )
                    except (IndexError, TypeError, ValueError):
                        continue
                if result.error_code != "0":
                    raise RuntimeError(f"BaoStock {symbols['baostock']} 查询失败: {result.error_msg}")
                if len(rows) < 220:
                    raise RuntimeError(f"BaoStock {symbols['baostock']} 有效日线不足")
                bundle[key] = rows
            return bundle
        finally:
            bs.logout()


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


def fetch_china_market() -> dict:
    try:
        bundle = _fetch_china_baostock()
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


def _finite(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _yahoo_series(frame, symbol: str, *, is_batch: bool) -> list[dict]:
    rows = []
    for index, row in frame.iterrows():
        def field(name: str) -> float | None:
            try:
                value = row[(name, symbol)] if is_batch else row[name]
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


def _fetch_us_yfinance() -> dict[str, list[dict]]:
    # Multi-ticker download API: https://ranaroussi.github.io/yfinance/reference/index.html
    # Yahoo market data is documented by yfinance as research/personal-use data.
    import yfinance as yf

    symbols = list(US_SERIES.values())
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
    for key, symbol in US_SERIES.items():
        rows = _yahoo_series(frame, symbol, is_batch=True) if not frame.empty else []
        if len(rows) < 220:
            history = yf.Ticker(symbol).history(
                period="2y",
                interval="1d",
                auto_adjust=True,
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
            rows = _yahoo_series(history, symbol, is_batch=False)
        if len(rows) < 220:
            raise RuntimeError(f"yfinance {symbol} 有效日线不足")
        bundle[key] = rows
    return bundle


def fetch_us_market() -> dict:
    source = {
        "name": "Yahoo Finance via yfinance",
        "provider": "yfinance",
        "mode": "zero-config",
        "access": "无需 API Key · 研究与个人使用",
        "url": "https://ranaroussi.github.io/yfinance",
        "isFallback": False,
    }
    return build_us_market(_fetch_us_yfinance(), source)


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
    active_fetchers = fetchers or {"china": fetch_china_market, "united-states": fetch_us_market}
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
