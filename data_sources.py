"""Safe connector metadata and readiness checks for the data-source center."""

from __future__ import annotations

import importlib.util
import os
import re
import socket
from datetime import datetime, timezone
from typing import Callable

from news_credentials import get_news_credential_status


SOURCE_CATALOG = (
    {
        "id": "free",
        "name": "免费模式",
        "kind": "free",
        "markets": ["china", "united-states"],
        "quality": "estimated",
        "summary": "BaoStock、公开行情与ETF成交量代理，零配置即可使用。",
    },
    {
        "id": "ibkr",
        "name": "IBKR",
        "kind": "broker",
        "markets": ["united-states"],
        "quality": "broker-feed",
        "summary": "连接本机 TWS 或 IB Gateway；网页不接收券商账号与密码。",
    },
    {
        "id": "qmt",
        "name": "QMT",
        "kind": "broker",
        "markets": ["china"],
        "quality": "broker-feed",
        "summary": "检测本机券商 QMT / miniQMT 的 xtquant 运行环境。",
    },
    {
        "id": "ifind",
        "name": "同花顺 iFinD",
        "kind": "vendor",
        "markets": ["china"],
        "quality": "market-data-only",
        "summary": "官方 QuantAPI 行情研究接口，不读取普通同花顺客户端的券商账户持仓。",
    },
    {
        "id": "databento",
        "name": "Databento",
        "kind": "vendor",
        "markets": ["united-states"],
        "quality": "professional",
        "summary": "专业逐笔与 MBO 数据入口；Key 仅用于本次连接检查。",
    },
    {
        "id": "custom",
        "name": "直连交易所",
        "kind": "adapter",
        "markets": ["china", "united-states"],
        "quality": "adapter-defined",
        "summary": "登记经过审查的 FIX、WebSocket 或 REST 适配器，不直接请求任意网址。",
    },
)

LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
ADAPTER_PATTERN = re.compile(r"^[a-z][a-z0-9_-]{1,63}$")
PROTOCOLS = {"FIX", "WEBSOCKET", "REST"}


def _checked_at() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_data_source_center() -> dict:
    checked_at = _checked_at()
    return {
        "sources": [dict(source) for source in SOURCE_CATALOG],
        "routing": {"china": "free", "united-states": "free"},
        "service": {
            "state": "online",
            "checkedAt": checked_at,
            "continuousRefresh": True,
            "healthCheckSeconds": 30,
            "message": "本地数据服务在线；页面每30秒复核，数据工作区按各自刷新策略持续更新。",
        },
        "sourceStatus": {
            "free": {
                "sourceId": "free",
                "state": "ready",
                "readyForActivation": True,
                "message": "本地数据服务在线；免费行情按各市场最新可用交易时段持续刷新。",
                "checkedAt": checked_at,
            }
        },
        "routingStatus": {
            market: {
                "sourceId": "free",
                "state": "ready",
                "checkedAt": checked_at,
                "fallbackAvailable": True,
            }
            for market in ("china", "united-states")
        },
        "fallbackToFree": True,
        "newsCredentials": get_news_credential_status(),
        "security": {
            "brokerCredentialsAccepted": False,
            "secretsPersisted": False,
            "customNetworkProbeAllowed": False,
        },
    }


def _probe_tcp(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.6):
            return True
    except OSError:
        return False


def _base_result(source_id: str, state: str, ready: bool, message: str) -> dict:
    return {
        "sourceId": source_id,
        "state": state,
        "readyForActivation": ready,
        "message": message,
        "checkedAt": _checked_at(),
        "credentialStored": False,
    }


def _integer(value: object, name: str, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{name}必须是{minimum}到{maximum}之间的整数") from error
    if not minimum <= parsed <= maximum:
        raise ValueError(f"{name}必须是{minimum}到{maximum}之间的整数")
    return parsed


def check_data_source(
    source_id: str,
    config: dict | None,
    *,
    tcp_probe: Callable[[str, int], bool] | None = None,
) -> dict:
    source_id = str(source_id or "").strip().lower()
    config = config if isinstance(config, dict) else {}

    if source_id == "free":
        result = _base_result("free", "ready", True, "免费数据源已就绪，无需登录或填写 Key。")
        result["config"] = {"mode": "estimated", "fallback": True}
        result["freshness"] = {
            "policy": "latest-available-session",
            "staleWhileRevalidate": True,
            "hardcodedDate": False,
        }
        return result

    if source_id == "ibkr":
        host = str(config.get("host") or "127.0.0.1").strip().lower()
        if host not in LOOPBACK_HOSTS:
            raise ValueError("IBKR 只允许检查本机 TWS / IB Gateway 地址")
        port = _integer(config.get("port", 7497), "IBKR端口", 1, 65535)
        client_id = _integer(config.get("clientId", 18), "Client ID", 0, 999999)
        reachable = (tcp_probe or _probe_tcp)(host, port)
        result = _base_result(
            "ibkr",
            "gateway_reachable" if reachable else "unavailable",
            False,
            "本机网关端口可达；仍需完成 API 握手、登录状态与行情权限验证。"
            if reachable
            else "未发现本机 TWS / IB Gateway，请先启动客户端并启用 API。",
        )
        result["config"] = {"host": host, "port": port, "clientId": client_id}
        return result

    if source_id == "qmt":
        try:
            installed = importlib.util.find_spec("xtquant") is not None
        except (ImportError, ModuleNotFoundError, ValueError):
            installed = False
        result = _base_result(
            "qmt",
            "client_ready" if installed else "unavailable",
            False,
            "已检测到 xtquant；仍需验证本机 QMT 登录状态、账户授权与行情权限。"
            if installed
            else "当前 Python 环境未检测到 xtquant，请先安装券商提供的 QMT 客户端。",
        )
        result["config"] = {"runtime": "xtquant", "accountCredentialsAccepted": False}
        return result

    if source_id == "ifind":
        result = _base_result(
            "ifind",
            "data_only",
            False,
            "同花顺 iFinD / QuantAPI 可用于行情研究，但不提供普通同花顺客户端的持仓读取。",
        )
        result["config"] = {"capability": "market-data-only"}
        return result

    if source_id == "databento":
        api_key = str(config.get("apiKey") or os.environ.get("DATABENTO_API_KEY") or "").strip()
        if not 20 <= len(api_key) <= 256 or any(character.isspace() for character in api_key):
            raise ValueError("请输入有效的 Databento API Key，或设置 DATABENTO_API_KEY 环境变量")
        result = _base_result(
            "databento",
            "credential_ready",
            False,
            "Key 格式检查通过；未保存、未回传，也尚未代表订阅权限验证成功。",
        )
        result["config"] = {"credentialPresent": True, "credentialSource": "session-or-environment"}
        return result

    if source_id == "custom":
        exchange_name = str(config.get("exchangeName") or "").strip()
        adapter_id = str(config.get("adapterId") or "").strip().lower()
        protocol = str(config.get("protocol") or "").strip().upper()
        if not 2 <= len(exchange_name) <= 80:
            raise ValueError("交易所名称需为2到80个字符")
        if not ADAPTER_PATTERN.fullmatch(adapter_id):
            raise ValueError("适配器 ID 需以小写字母开头，并只包含字母、数字、下划线或短横线")
        if protocol not in PROTOCOLS:
            raise ValueError("当前只登记 FIX、WebSocket 或 REST 适配器")
        result = _base_result(
            "custom",
            "adapter_required",
            False,
            "配置已通过格式检查；接入前仍需实现并审查专用适配器。",
        )
        result["config"] = {
            "exchangeName": exchange_name,
            "adapterId": adapter_id,
            "protocol": protocol,
        }
        return result

    raise ValueError("不支持的数据源类型")
