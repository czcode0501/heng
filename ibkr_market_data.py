"""Read-only US market data from a local TWS / IB Gateway session.

衡策只通过官方 TWS API 读取行情：不下单、不读取账户凭证，只连接本机回环地址。
美股（含 ^GSPC / ^NDX / ^VIX 指数）优先使用 IBKR；A股等其他代码返回 None，由调用方继续使用免费源。
TWS 未启动或请求失败时抛出 IbkrUnavailable，调用方据此回退到 yfinance 并标注真实来源。
"""

from __future__ import annotations

import atexit
import math
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from typing import Callable

LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
DEFAULT_PORTS = (7496, 7497, 4001, 4002)
DEFAULT_CLIENT_ID = 77
CONNECT_TIMEOUT_SECONDS = 3.0
REQUEST_TIMEOUT_SECONDS = 20.0
RETRY_AFTER_FAILURE_SECONDS = 60.0
MAX_CONCURRENT_HISTORICAL_REQUESTS = 6

SOURCE_NAME = "IBKR TWS"

INDEX_CONTRACTS = {
    "^GSPC": ("SPX", "CBOE"),
    "^NDX": ("NDX", "NASDAQ"),
    "^VIX": ("VIX", "CBOE"),
}
BAR_SIZES = {"5m": "5 mins", "15m": "15 mins", "60m": "1 hour", "1d": "1 day"}
# 只影响提示文案、不影响数据可用性的 TWS 消息。
INFORMATIONAL_CODES = {2100, 2104, 2106, 2107, 2108, 2119, 2158, 2176, 2188, 10167}
CONNECTION_LOST_CODES = {502, 504, 1100, 1300}
CLIENT_ID_IN_USE = 326
CLIENT_ID_ATTEMPTS = 4


class IbkrUnavailable(RuntimeError):
    """IBKR could not supply the requested data; callers should fall back."""


def ibkr_contract_spec(provider_symbol: str) -> dict | None:
    """Map a Yahoo-style symbol to an IBKR contract spec, or None for non-US symbols."""
    symbol = str(provider_symbol or "").strip().upper()
    if not symbol:
        return None
    if symbol in INDEX_CONTRACTS:
        ib_symbol, exchange = INDEX_CONTRACTS[symbol]
        return {"symbol": ib_symbol, "secType": "IND", "exchange": exchange, "currency": "USD"}
    if symbol.startswith("^") or "=" in symbol or "." in symbol:
        return None
    if not all(character.isalnum() or character == "-" for character in symbol):
        return None
    # Yahoo 用连字符表示股份类别（BRK-B），IBKR 用空格（BRK B）。
    return {"symbol": symbol.replace("-", " "), "secType": "STK", "exchange": "SMART", "currency": "USD"}


def duration_for_start(start: date, today: date | None = None) -> str:
    days = max(1, ((today or date.today()) - start).days)
    return f"{days} D" if days <= 365 else f"{math.ceil(days / 365)} Y"


def _finite(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _bar_time(raw: str, interval: str) -> tuple[str, str]:
    """Return (time, date) strings from an IBKR bar date (yyyymmdd or epoch seconds)."""
    text = str(raw).strip()
    if interval == "1d" or (len(text) == 8 and text.isdigit()):
        day = f"{text[:4]}-{text[4:6]}-{text[6:8]}"
        return day, day
    moment = datetime.fromtimestamp(int(text), tz=timezone.utc)
    try:
        from zoneinfo import ZoneInfo

        moment = moment.astimezone(ZoneInfo("America/New_York"))
    except Exception:
        pass
    iso = moment.isoformat()
    return iso, iso[:10]


def normalize_bars(bars: list, interval: str) -> list[dict]:
    rows = []
    for bar in bars:
        close = _finite(getattr(bar, "close", None))
        if close is None or close <= 0:
            continue
        time_text, day = _bar_time(getattr(bar, "date", ""), interval)
        volume = max(0.0, _finite(getattr(bar, "volume", 0)) or 0.0)
        rows.append(
            {
                "time": time_text,
                "date": day,
                "open": _finite(getattr(bar, "open", None)) or close,
                "high": _finite(getattr(bar, "high", None)) or close,
                "low": _finite(getattr(bar, "low", None)) or close,
                "close": close,
                "volume": volume,
                "amount": 0.0,
            }
        )
    return rows


def _configured_ports() -> tuple[int, ...]:
    configured = str(os.environ.get("IBKR_PORT") or "").strip()
    if configured.isdigit():
        return (int(configured),)
    return DEFAULT_PORTS


def _connect_as_daemon(client, host: str, port: int, client_id: int) -> None:
    """Connect from a daemon thread so ibapi's reader thread inherits daemon=True.

    ibapi 在 connect() 内部创建非守护的读取线程；线程会继承创建者的 daemon 属性，
    因此在守护线程里连接，残留连接就不会阻止 API 服务或测试进程退出。
    """
    failures: list[BaseException] = []

    def target() -> None:
        try:
            client.connect(host, port, clientId=client_id)
        except BaseException as error:  # noqa: BLE001 - re-raised in the caller
            failures.append(error)

    worker = threading.Thread(target=target, name="ibkr-connect", daemon=True)
    worker.start()
    worker.join(CONNECT_TIMEOUT_SECONDS * 2)
    if worker.is_alive():
        raise IbkrUnavailable(f"{port}: 连接超时")
    if failures:
        raise failures[0]


class _Session:
    """One long-lived TWS API connection shared by every market-data request."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._client = None
        self._port: int | None = None
        self._client_id: int | None = None
        self._failed_at = 0.0
        self._last_error = ""
        self._slots = threading.BoundedSemaphore(MAX_CONCURRENT_HISTORICAL_REQUESTS)

    def close(self) -> None:
        # ibapi 的读取线程不是守护线程；进程退出前必须断开，否则解释器会一直等待。
        with self._lock:
            if self._client:
                self._client.disconnect()
            self._client = None

    def status(self) -> dict:
        connected = bool(self._client and self._client.isConnected())
        return {
            "connected": connected,
            "port": self._port if connected else None,
            "clientId": self._client_id if connected else None,
            "lastError": "" if connected else self._last_error,
        }

    def _connect(self):
        try:
            from ibapi.client import EClient
            from ibapi.wrapper import EWrapper
        except ImportError as error:
            raise IbkrUnavailable("未安装 IBKR 官方 TWS API Python 包") from error

        class Client(EWrapper, EClient):
            def __init__(self) -> None:
                EClient.__init__(self, self)
                self.ready = threading.Event()
                self.client_id_in_use = False
                self.pending: dict[int, dict] = {}
                self.pending_lock = threading.Lock()
                self.next_request_id = 1

            def nextValidId(self, order_id):  # noqa: N802
                self.ready.set()

            def historicalData(self, request_id, bar):  # noqa: N802
                with self.pending_lock:
                    request = self.pending.get(request_id)
                if request:
                    request["bars"].append(bar)

            def historicalDataEnd(self, request_id, start, end):  # noqa: N802
                with self.pending_lock:
                    request = self.pending.get(request_id)
                if request:
                    request["done"].set()

            def error(self, request_id, *args):
                # ibapi 10.x 在 errorCode 前增加了 errorTime 参数。
                if len(args) >= 3 and isinstance(args[1], int):
                    code, message = args[1], args[2]
                else:
                    code, message = args[0], args[1]
                code = int(code or 0)
                if code in INFORMATIONAL_CODES:
                    return
                if code == CLIENT_ID_IN_USE:
                    self.client_id_in_use = True
                    self.ready.set()
                    return
                if code in CONNECTION_LOST_CODES:
                    self.fail_all(f"{code}: {message}")
                    return
                with self.pending_lock:
                    request = self.pending.get(int(request_id or -1))
                if request:
                    request["error"] = f"{code}: {message}"
                    request["done"].set()

            def connectionClosed(self):  # noqa: N802
                self.fail_all("TWS 连接已关闭")

            def fail_all(self, message: str) -> None:
                with self.pending_lock:
                    requests = list(self.pending.values())
                for request in requests:
                    request["error"] = message
                    request["done"].set()

            def allocate(self) -> tuple[int, dict]:
                with self.pending_lock:
                    request_id = self.next_request_id
                    self.next_request_id += 1
                    request = {"bars": [], "error": "", "done": threading.Event()}
                    self.pending[request_id] = request
                return request_id, request

            def release(self, request_id: int) -> None:
                with self.pending_lock:
                    self.pending.pop(request_id, None)

        host = str(os.environ.get("IBKR_HOST") or "127.0.0.1").strip().lower()
        if host not in LOOPBACK_HOSTS:
            raise IbkrUnavailable("IBKR 只允许连接本机 TWS / IB Gateway")
        base_client_id = int(os.environ.get("IBKR_MARKET_DATA_CLIENT_ID") or DEFAULT_CLIENT_ID)
        errors = []
        for port in _configured_ports():
            # 同一 Client ID 已被其他程序占用时（TWS 错误 326），依次尝试后续编号。
            for client_id in range(base_client_id, base_client_id + CLIENT_ID_ATTEMPTS):
                client = Client()
                try:
                    _connect_as_daemon(client, host, port, client_id)
                except Exception as error:  # connection refused etc.
                    errors.append(f"{port}: {error}")
                    break
                if not client.isConnected():
                    client.disconnect()
                    errors.append(f"{port}: 未监听")
                    break
                threading.Thread(target=client.run, name="ibkr-market-data", daemon=True).start()
                if client.ready.wait(CONNECT_TIMEOUT_SECONDS) and not client.client_id_in_use:
                    self._port = port
                    self._client_id = client_id
                    return client
                client.disconnect()
                if not client.client_id_in_use:
                    errors.append(f"{port}: 握手超时")
                    break
                errors.append(f"{port}: Client ID {client_id} 已被占用")
        raise IbkrUnavailable("未连接到本机 TWS / IB Gateway（" + "；".join(errors) + "）")

    def client(self):
        with self._lock:
            if self._client and self._client.isConnected():
                return self._client
            if time.time() - self._failed_at < RETRY_AFTER_FAILURE_SECONDS:
                raise IbkrUnavailable(self._last_error or "IBKR 暂不可用")
            try:
                self._client = self._connect()
            except IbkrUnavailable as error:
                self._client = None
                self._failed_at = time.time()
                self._last_error = str(error)
                raise
            self._last_error = ""
            return self._client

    def historical_bars(self, spec: dict, *, duration: str, bar_size: str, what_to_show: str) -> list:
        from ibapi.contract import Contract

        client = self.client()
        contract = Contract()
        for field, value in spec.items():
            setattr(contract, field, value)
        with self._slots:
            request_id, request = client.allocate()
            try:
                # formatDate=2：日内K线返回 UTC 秒数，日线仍为 yyyymmdd。
                client.reqHistoricalData(request_id, contract, "", duration, bar_size, what_to_show, 1, 2, False, [])
                if not request["done"].wait(REQUEST_TIMEOUT_SECONDS):
                    client.cancelHistoricalData(request_id)
                    raise IbkrUnavailable(f"{spec['symbol']} 历史行情请求超时")
                if request["error"] and not request["bars"]:
                    raise IbkrUnavailable(f"{spec['symbol']}：{request['error']}")
                return list(request["bars"])
            finally:
                client.release(request_id)


_SESSION = _Session()
atexit.register(_SESSION.close)


def ibkr_status(*, connect: bool = False) -> dict:
    """Connection state; with connect=True, try (rate-limited) to open the session first."""
    if connect:
        try:
            _SESSION.client()
        except IbkrUnavailable:
            pass
    return _SESSION.status()


def fetch_ibkr_bars(
    provider_symbol: str,
    *,
    interval: str,
    start: date,
    adjusted: bool = False,
    session: _Session | None = None,
) -> list[dict]:
    """Return normalized bars for one US symbol, or raise IbkrUnavailable."""
    spec = ibkr_contract_spec(provider_symbol)
    if spec is None:
        raise IbkrUnavailable(f"{provider_symbol} 不是 IBKR 美股行情代码")
    if interval not in BAR_SIZES:
        raise IbkrUnavailable(f"不支持的K线周期：{interval}")
    # 指数不支持 ADJUSTED_LAST；个股/ETF 长周期使用复权价，与免费源的自动复权口径一致。
    what_to_show = "ADJUSTED_LAST" if adjusted and spec["secType"] == "STK" else "TRADES"
    bars = (session or _SESSION).historical_bars(
        spec, duration=duration_for_start(start), bar_size=BAR_SIZES[interval], what_to_show=what_to_show
    )
    rows = normalize_bars(bars, interval)
    if not rows:
        raise IbkrUnavailable(f"{provider_symbol} 没有返回K线")
    return rows


def fetch_with_fallback(
    symbols: list[str],
    ibkr_fetch: Callable[[str], list[dict]],
    fallback_fetch: Callable[[list[str]], dict[str, list[dict]]],
    *,
    minimum: int = 1,
) -> tuple[dict[str, list[dict]], dict[str, str]]:
    """Fetch each US symbol from IBKR first; send the rest to the fallback in one batch.

    Returns (rows by symbol, source by symbol) where source is "ibkr" or "fallback".
    """
    rows: dict[str, list[dict]] = {}
    sources: dict[str, str] = {}
    eligible = [symbol for symbol in symbols if ibkr_contract_spec(symbol) is not None]

    def attempt(symbol: str) -> list[dict] | None:
        try:
            fetched = ibkr_fetch(symbol)
        except IbkrUnavailable:
            return None
        return fetched if len(fetched) >= minimum else None

    if eligible:
        with ThreadPoolExecutor(max_workers=MAX_CONCURRENT_HISTORICAL_REQUESTS) as executor:
            for symbol, fetched in zip(eligible, executor.map(attempt, eligible)):
                if fetched is not None:
                    rows[symbol] = fetched
                    sources[symbol] = "ibkr"
    remaining = [symbol for symbol in symbols if symbol not in rows]
    if remaining:
        fallback_rows = fallback_fetch(remaining)
        for symbol in remaining:
            rows[symbol] = fallback_rows.get(symbol) or []
            sources[symbol] = "fallback"
    return rows, sources
