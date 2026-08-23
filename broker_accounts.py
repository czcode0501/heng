"""Read-only broker account adapters with one normalized position contract."""

from __future__ import annotations

import math
import os
import re
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable


LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
IBKR_US_SYMBOL = re.compile(r"^[A-Z][A-Z0-9.-]{0,14}$")
IBKR_MARKET_DATA_TYPES = {1: "live", 2: "frozen", 3: "delayed", 4: "delayed-frozen"}


def _number(value: object) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _integer(value: object, label: str, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{label}必须是{minimum}到{maximum}之间的整数") from error
    if not minimum <= parsed <= maximum:
        raise ValueError(f"{label}必须是{minimum}到{maximum}之间的整数")
    return parsed


def _mask_account(value: object) -> str:
    account_id = str(value or "").strip()
    if len(account_id) <= 4:
        return "••••"
    return f"{account_id[:2]}•••{account_id[-2:]}"


def _pick_account_value(
    values: dict[str, dict[str, object]],
    key: str,
    base_currency: str,
) -> object | None:
    """Select the account-total value without mixing account and position currencies."""
    candidates = values.get(key, {})
    if not isinstance(candidates, dict):
        return candidates
    if "BASE" in candidates:
        return candidates["BASE"]
    normalized_currency = str(base_currency or "").strip().upper()
    if normalized_currency and normalized_currency in candidates:
        return candidates[normalized_currency]
    return next(iter(candidates.values()), None)


def _normalize_position(position: dict, default_currency: str) -> dict:
    symbol = str(position.get("symbol") or "").strip().upper()
    if not symbol:
        raise ValueError("券商返回了缺少证券代码的持仓")
    quantity = _number(position.get("quantity")) or 0.0
    average_cost = _number(position.get("averageCost"))
    cost_basis = abs(quantity) * average_cost if average_cost is not None else None
    unrealized_pnl = _number(position.get("unrealizedPnl"))
    unrealized_pnl_pct = (
        unrealized_pnl / cost_basis * 100
        if unrealized_pnl is not None and cost_basis not in {None, 0}
        else None
    )
    return {
        "symbol": symbol,
        "name": str(position.get("name") or symbol).strip(),
        "market": str(position.get("market") or "--").strip(),
        "securityType": str(position.get("securityType") or "STK").strip().upper(),
        "currency": str(position.get("currency") or default_currency).strip().upper(),
        "quantity": quantity,
        "averageCost": average_cost,
        "costBasis": cost_basis,
        "marketPrice": _number(position.get("marketPrice")),
        "marketValue": _number(position.get("marketValue")),
        "unrealizedPnl": unrealized_pnl,
        "unrealizedPnlPct": unrealized_pnl_pct,
        "realizedPnl": _number(position.get("realizedPnl")),
    }


def _normalize_snapshot(source_id: str, snapshot: dict) -> dict:
    account_id = str(snapshot.get("accountId") or "").strip()
    if not account_id:
        raise ValueError("券商没有返回可识别的账户")
    currency = str(snapshot.get("currency") or ("USD" if source_id == "ibkr" else "CNY")).upper()
    positions = [
        _normalize_position(position, currency)
        for position in snapshot.get("positions", [])
        if isinstance(position, dict)
    ]
    exchange_rates = {
        str(rate_currency).upper(): parsed
        for rate_currency, rate_value in (snapshot.get("exchangeRates") or {}).items()
        if (parsed := _number(rate_value)) is not None and parsed > 0
    }
    exchange_rates.setdefault(currency, 1.0)
    return {
        "sourceId": source_id,
        "state": "ready",
        "readOnly": True,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "account": {
            "maskedId": _mask_account(account_id),
            "currency": currency,
            "cash": _number(snapshot.get("cash")),
            "marketValue": _number(snapshot.get("marketValue")),
            "totalAsset": _number(snapshot.get("totalAsset")),
            "unrealizedPnl": _number(snapshot.get("unrealizedPnl")),
            "exchangeRates": exchange_rates,
            "updatedAt": str(snapshot.get("updatedAt") or "").strip() or None,
        },
        "positions": positions,
        "meta": {
            "positionCount": len(positions),
            "dataMode": "broker-account-read-only",
            "priceSource": "IBKR TWS Account Window" if source_id == "ibkr" else "QMT broker account",
            "updateCadenceSeconds": 180 if source_id == "ibkr" else None,
        },
    }


def _read_ibkr(config: dict) -> dict:
    try:
        from ibapi.client import EClient
        from ibapi.wrapper import EWrapper
    except ImportError as error:
        raise RuntimeError("未安装 IBKR 官方 TWS API Python 包，请先从 IBKR TWS API 安装包完成安装") from error

    class PositionReader(EWrapper, EClient):
        def __init__(self) -> None:
            EClient.__init__(self, self)
            self.ready = threading.Event()
            self.positions_done = threading.Event()
            self.summary_done = threading.Event()
            self.account_done = threading.Event()
            self.positions: list[dict] = []
            self.portfolio_positions: list[dict] = []
            self.accounts: set[str] = set()
            self.summaries: dict[str, dict[str, object]] = {}
            self.account_values: dict[str, dict[str, dict[str, object]]] = {}
            self.account_updated_at: dict[str, str] = {}
            self.failure = ""

        def nextValidId(self, _order_id):  # noqa: N802 - IBKR callback name
            self.ready.set()

        def position(self, account, contract, quantity, avg_cost):
            account = str(account)
            if config.get("accountId") and account != config["accountId"]:
                return
            self.accounts.add(account)
            self.positions.append({
                "symbol": contract.localSymbol or contract.symbol,
                "name": contract.symbol,
                "market": contract.primaryExchange or contract.exchange,
                "securityType": contract.secType,
                "currency": contract.currency,
                "quantity": quantity,
                "averageCost": avg_cost,
            })

        def positionEnd(self):  # noqa: N802
            self.positions_done.set()

        def updatePortfolio(  # noqa: N802 - IBKR callback name
            self,
            contract,
            quantity,
            market_price,
            market_value,
            average_cost,
            unrealized_pnl,
            realized_pnl,
            account,
        ):
            account = str(account)
            if config.get("accountId") and account != config["accountId"]:
                return
            self.accounts.add(account)
            self.portfolio_positions.append({
                "symbol": contract.localSymbol or contract.symbol,
                "name": contract.symbol,
                "market": contract.primaryExchange or contract.exchange,
                "securityType": contract.secType,
                "currency": contract.currency,
                "quantity": quantity,
                "averageCost": average_cost,
                "marketPrice": market_price,
                "marketValue": market_value,
                "unrealizedPnl": unrealized_pnl,
                "realizedPnl": realized_pnl,
            })

        def updateAccountValue(self, key, value, currency, account):  # noqa: N802
            account = str(account)
            if config.get("accountId") and account != config["accountId"]:
                return
            self.accounts.add(account)
            values = self.account_values.setdefault(account, {})
            values.setdefault(str(key), {})[str(currency or "").upper()] = value

        def updateAccountTime(self, timestamp):  # noqa: N802
            for account in self.accounts:
                self.account_updated_at[account] = str(timestamp)

        def accountDownloadEnd(self, account):  # noqa: N802
            self.accounts.add(str(account))
            self.account_done.set()

        def accountSummary(self, _request_id, account, tag, value, currency):  # noqa: N802
            account = str(account)
            if config.get("accountId") and account != config["accountId"]:
                return
            self.accounts.add(account)
            summary = self.summaries.setdefault(account, {})
            summary[tag] = value
            if currency and currency != "BASE":
                summary.setdefault("currency", currency)

        def accountSummaryEnd(self, _request_id):  # noqa: N802
            self.summary_done.set()

        def error(self, _request_id, error_code, error_string, *args):
            if int(error_code or 0) in {502, 504, 1100, 1300}:
                self.failure = str(error_string or "IBKR API 连接失败")
                self.ready.set()
                self.positions_done.set()

    app = PositionReader()
    app.connect(config["host"], config["port"], clientId=config["clientId"])
    worker = threading.Thread(target=app.run, name="ibkr-read-only", daemon=True)
    worker.start()
    try:
        if not app.ready.wait(3.0) or app.failure:
            raise RuntimeError(app.failure or "IBKR API 握手超时，请确认 TWS / IB Gateway 已登录并启用 Socket API")
        app.reqPositions()
        app.reqAccountSummary(9001, "All", "NetLiquidation,TotalCashValue")
        if not app.positions_done.wait(6.0):
            raise RuntimeError("IBKR 持仓读取超时")
        app.summary_done.wait(1.0)
        if len(app.accounts) > 1:
            raise RuntimeError("检测到多个 IBKR 账户，请在数据源中心填写需要读取的账户 ID")
        account_id = next(iter(app.accounts), config.get("accountId") or "")
        summary = app.summaries.get(account_id, {})
        app.reqAccountUpdates(True, account_id)
        if not app.account_done.wait(6.0):
            raise RuntimeError("IBKR 账户估值读取超时")
        account_values = app.account_values.get(account_id, {})
        positions = app.portfolio_positions or app.positions
        account_currency = str(summary.get("currency") or "USD").upper()
        cash = _pick_account_value(account_values, "TotalCashValue", account_currency)
        if cash is None:
            cash = summary.get("TotalCashValue")
        market_value = _pick_account_value(account_values, "StockMarketValue", account_currency)
        if market_value is None:
            market_value = _pick_account_value(account_values, "GrossPositionValue", account_currency)
        total_asset = _pick_account_value(account_values, "NetLiquidation", account_currency)
        if total_asset is None:
            total_asset = summary.get("NetLiquidation")
        exchange_rates = {
            str(rate_currency).upper(): rate_value
            for rate_currency, rate_value in account_values.get("ExchangeRate", {}).items()
            if rate_currency
        }
        return {
            "accountId": account_id,
            "currency": account_currency,
            "cash": cash,
            "marketValue": market_value,
            "totalAsset": total_asset,
            "unrealizedPnl": _pick_account_value(account_values, "UnrealizedPnL", account_currency),
            "exchangeRates": exchange_rates,
            "updatedAt": app.account_updated_at.get(account_id),
            "positions": positions,
        }
    finally:
        try:
            app.cancelPositions()
            app.cancelAccountSummary(9001)
            account_id = next(iter(app.accounts), config.get("accountId") or "")
            if account_id:
                app.reqAccountUpdates(False, account_id)
        except Exception:
            pass
        app.disconnect()


def _read_ibkr_quotes(config: dict, symbols: list[str]) -> list[dict]:
    """Request read-only top-of-book snapshots through the official TWS API."""
    try:
        from ibapi.client import EClient
        from ibapi.contract import Contract
        from ibapi.wrapper import EWrapper
    except ImportError as error:
        raise RuntimeError("未安装 IBKR 官方 TWS API Python 包，请先从 IBKR TWS API 安装包完成安装") from error

    class QuoteReader(EWrapper, EClient):
        def __init__(self) -> None:
            EClient.__init__(self, self)
            self.ready = threading.Event()
            self.all_done = threading.Event()
            self.failure = ""
            self.finished: set[int] = set()
            self.values: dict[int, dict[str, object]] = {
                index: {"providerSymbol": symbol, "marketDataType": 3}
                for index, symbol in enumerate(symbols, start=1)
            }

        def nextValidId(self, _order_id):  # noqa: N802
            self.ready.set()

        def marketDataType(self, request_id, market_data_type):  # noqa: N802
            if request_id in self.values:
                self.values[request_id]["marketDataType"] = int(market_data_type)

        def tickPrice(self, request_id, tick_type, price, _attrib):  # noqa: N802
            if request_id not in self.values or not (_number(price) and _number(price) > 0):
                return
            field_by_tick = {
                1: "bid", 2: "ask", 4: "last", 9: "close",
                66: "bid", 67: "ask", 68: "last", 75: "close",
            }
            field = field_by_tick.get(int(tick_type))
            if field:
                self.values[request_id][field] = float(price)

        def tickSnapshotEnd(self, request_id):  # noqa: N802
            self.finished.add(int(request_id))
            if len(self.finished) >= len(symbols):
                self.all_done.set()

        def error(self, request_id, error_code, error_string, *args):
            code = int(error_code or 0)
            if code in {502, 504, 1100, 1300}:
                self.failure = str(error_string or "IBKR API 连接失败")
                self.ready.set()
                self.all_done.set()
            elif int(request_id or -1) in self.values and code in {200, 354, 10167, 10168}:
                self.finished.add(int(request_id))
                if len(self.finished) >= len(symbols):
                    self.all_done.set()

    app = QuoteReader()
    app.connect(config["host"], config["port"], clientId=config["clientId"])
    worker = threading.Thread(target=app.run, name="ibkr-market-data", daemon=True)
    worker.start()
    try:
        if not app.ready.wait(3.0) or app.failure:
            raise RuntimeError(app.failure or "IBKR API 握手超时，请确认 TWS / IB Gateway 已登录并启用 Socket API")
        # Request delayed data when live permissions are absent. IBKR automatically
        # returns live data instead when the account owns the required subscription.
        app.reqMarketDataType(3)
        for request_id, symbol in enumerate(symbols, start=1):
            contract = Contract()
            contract.symbol = symbol
            contract.secType = "STK"
            contract.exchange = "SMART"
            contract.currency = "USD"
            app.reqMktData(request_id, contract, "", True, False, [])
        app.all_done.wait(6.0)
        if app.failure:
            raise RuntimeError(app.failure)
        results = []
        for value in app.values.values():
            bid = _number(value.get("bid"))
            ask = _number(value.get("ask"))
            last = _number(value.get("last"))
            close = _number(value.get("close"))
            midpoint = (bid + ask) / 2 if bid and ask else None
            price = last or midpoint or close
            if price and price > 0:
                results.append({
                    "providerSymbol": value["providerSymbol"],
                    "price": price,
                    "previousClose": close,
                    "marketDataType": int(value.get("marketDataType") or 3),
                })
        if not results:
            raise RuntimeError("IBKR 未返回可用行情，请检查美股行情订阅或延迟数据权限")
        return results
    finally:
        for request_id in range(1, len(symbols) + 1):
            try:
                app.cancelMktData(request_id)
            except Exception:
                pass
        app.disconnect()


def read_broker_quotes(
    config: dict | None,
    symbols: list[str] | None,
    *,
    reader: Callable[[dict, list[str]], list[dict]] | None = None,
) -> list[dict]:
    """Return IBKR US equity quotes with an explicit live/delayed/frozen label."""
    supplied = config if isinstance(config, dict) else {}
    host = str(supplied.get("host") or "127.0.0.1").strip().lower()
    if host not in LOOPBACK_HOSTS:
        raise ValueError("IBKR 只允许连接本机 TWS / IB Gateway")
    normalized_symbols = list(dict.fromkeys(str(symbol or "").strip().upper() for symbol in (symbols or []) if str(symbol or "").strip()))
    if not normalized_symbols:
        raise ValueError("至少需要一个美股代码")
    if len(normalized_symbols) > 25:
        raise ValueError("单次最多读取25个美股代码")
    if any(not IBKR_US_SYMBOL.fullmatch(symbol) or symbol.endswith((".SS", ".SZ", ".BJ")) for symbol in normalized_symbols):
        raise ValueError("IBKR 行情适配器当前只接受美股代码")
    base_client_id = _integer(supplied.get("clientId", 18), "Client ID", 0, 999_998)
    safe_config = {
        "host": host,
        "port": _integer(supplied.get("port", 7497), "IBKR端口", 1, 65535),
        # Keep quote and account snapshot sessions from disconnecting one another.
        "clientId": base_client_id + 1,
    }
    raw_quotes = (reader or _read_ibkr_quotes)(safe_config, normalized_symbols)
    allowed = set(normalized_symbols)
    results = []
    for raw in raw_quotes or []:
        symbol = str(raw.get("providerSymbol") or "").strip().upper()
        price = _number(raw.get("price"))
        previous_close = _number(raw.get("previousClose"))
        if symbol not in allowed or price is None or price <= 0:
            continue
        data_type_code = int(_number(raw.get("marketDataType")) or 3)
        data_type = IBKR_MARKET_DATA_TYPES.get(data_type_code, "unknown")
        change_percent = (price / previous_close - 1) * 100 if previous_close and previous_close > 0 else None
        results.append({
            "providerSymbol": symbol,
            "price": round(price, 4),
            "previousClose": round(previous_close, 4) if previous_close is not None else None,
            "changePercent": round(change_percent, 4) if change_percent is not None else None,
            "currency": "USD",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": "IBKR TWS Market Data",
            "marketDataType": data_type,
            "delayed": data_type in {"delayed", "delayed-frozen"},
            "sourcePriority": "ibkr-market-data",
        })
    if not results:
        raise RuntimeError("IBKR 未返回可用美股行情")
    return results


def _read_qmt(config: dict) -> dict:
    try:
        from xtquant.xttrader import XtQuantTrader
        from xtquant.xttype import StockAccount
    except ImportError as error:
        raise RuntimeError("未检测到券商 QMT 自带的 xtquant，请使用 QMT 支持的 Python 环境启动本项目") from error

    trader = XtQuantTrader(config["qmtPath"], secrets.randbelow(900_000) + 100_000)
    account = StockAccount(config["accountId"], config.get("accountType") or "STOCK")
    trader.start()
    try:
        if trader.connect() != 0:
            raise RuntimeError("QMT 连接失败，请确认 miniQMT 已以极简模式登录且 userdata_mini 路径正确")
        if trader.subscribe(account) != 0:
            raise RuntimeError("QMT 账户订阅失败，请向券商确认 xtquant 权限")
        positions = trader.query_stock_positions(account)
        asset = trader.query_stock_asset(account)
        if positions is None:
            positions = []
        return {
            "accountId": config["accountId"],
            "currency": "CNY",
            "cash": getattr(asset, "cash", None),
            "marketValue": getattr(asset, "market_value", None),
            "totalAsset": getattr(asset, "total_asset", None),
            "positions": [{
                "symbol": getattr(item, "stock_code", ""),
                "name": getattr(item, "stock_code", ""),
                "market": "中国A股",
                "currency": "CNY",
                "quantity": getattr(item, "volume", 0),
                "averageCost": getattr(item, "avg_price", None),
                "marketValue": getattr(item, "market_value", None),
            } for item in positions],
        }
    finally:
        trader.stop()


def read_broker_snapshot(
    source_id: str,
    config: dict | None,
    *,
    readers: dict[str, Callable[[dict], dict]] | None = None,
    path_validator: Callable[[str], bool] | None = None,
) -> dict:
    """Read positions once; no connector in this module exposes order methods."""
    source_id = str(source_id or "").strip().lower()
    supplied = config if isinstance(config, dict) else {}
    available_readers = readers or {"ibkr": _read_ibkr, "qmt": _read_qmt}

    if source_id == "ibkr":
        host = str(supplied.get("host") or "127.0.0.1").strip().lower()
        if host not in LOOPBACK_HOSTS:
            raise ValueError("IBKR 只允许连接本机 TWS / IB Gateway")
        account_id = str(supplied.get("accountId") or "").strip()
        if account_id and not 4 <= len(account_id) <= 40:
            raise ValueError("IBKR 账户 ID 长度不正确")
        safe_config = {
            "host": host,
            "port": _integer(supplied.get("port", 7497), "IBKR端口", 1, 65535),
            "clientId": _integer(supplied.get("clientId", 18), "Client ID", 0, 999_999),
            "accountId": account_id,
        }
    elif source_id == "qmt":
        account_id = str(supplied.get("accountId") or "").strip()
        if not 4 <= len(account_id) <= 40:
            raise ValueError("请输入券商 QMT 资金账号")
        raw_path = str(supplied.get("qmtPath") or "").strip()
        if not raw_path:
            raise ValueError("请输入 QMT userdata_mini 目录")
        valid_path = path_validator(raw_path) if path_validator else Path(raw_path).is_absolute() and Path(raw_path).is_dir()
        if not valid_path:
            raise ValueError("QMT 路径必须是本机已存在的 userdata_mini 目录")
        safe_config = {
            "qmtPath": os.path.abspath(raw_path),
            "accountId": account_id,
            "accountType": str(supplied.get("accountType") or "STOCK").strip().upper(),
        }
    else:
        raise ValueError("当前只支持 IBKR 与 QMT 的只读持仓同步")

    reader = available_readers.get(source_id)
    if reader is None:
        raise RuntimeError("券商读取适配器不可用")
    return _normalize_snapshot(source_id, reader(safe_config))
