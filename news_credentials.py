"""Local-only credential storage and validation for optional media-news providers."""

from __future__ import annotations

import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Callable, Mapping
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


NEWS_PROVIDERS = {
    "finnhub": {
        "label": "Finnhub",
        "environment": "FINNHUB_API_KEY",
        "checkUrl": "https://finnhub.io/api/v1/quote?symbol=AAPL",
        "header": "X-Finnhub-Token",
    },
    "gnews": {
        "label": "GNews",
        "environment": "GNEWS_API_KEY",
        "checkUrl": "https://gnews.io/api/v4/search?q=Apple&lang=en&country=us&max=1",
        "header": "X-Api-Key",
    },
}


def default_credential_path(environ: Mapping[str, str] | None = None) -> Path:
    env = environ if environ is not None else os.environ
    override = str(env.get("QUANT_DESK_CONFIG_DIR") or "").strip()
    if override:
        return Path(override).expanduser() / "credentials.json"
    if os.name == "nt" and env.get("APPDATA"):
        return Path(env["APPDATA"]) / "HengCeQuantDesk" / "credentials.json"
    if os.name == "posix" and env.get("XDG_CONFIG_HOME"):
        return Path(env["XDG_CONFIG_HOME"]) / "hengce-quant-desk" / "credentials.json"
    return Path.home() / ".config" / "hengce-quant-desk" / "credentials.json"


def _provider(provider_id: str) -> tuple[str, dict]:
    normalized = str(provider_id or "").strip().lower()
    provider = NEWS_PROVIDERS.get(normalized)
    if not provider:
        raise ValueError("不支持的媒体新闻供应商")
    return normalized, provider


def _read_local_credentials(config_path: Path) -> dict[str, str]:
    try:
        payload = json.loads(config_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    if not isinstance(payload, dict):
        return {}
    return {
        provider_id: str(payload.get(provider_id) or "").strip()
        for provider_id in NEWS_PROVIDERS
        if str(payload.get(provider_id) or "").strip()
    }


def get_news_api_key(
    provider_id: str,
    *,
    config_path: Path | None = None,
    environ: Mapping[str, str] | None = None,
) -> str:
    normalized, provider = _provider(provider_id)
    env = environ if environ is not None else os.environ
    environment_value = str(env.get(provider["environment"]) or "").strip()
    if environment_value:
        return environment_value
    path = Path(config_path) if config_path is not None else default_credential_path(env)
    return _read_local_credentials(path).get(normalized, "")


def get_news_credential_status(
    *,
    config_path: Path | None = None,
    environ: Mapping[str, str] | None = None,
) -> dict[str, dict]:
    env = environ if environ is not None else os.environ
    path = Path(config_path) if config_path is not None else default_credential_path(env)
    local_values = _read_local_credentials(path)
    result = {}
    for provider_id, provider in NEWS_PROVIDERS.items():
        from_environment = bool(str(env.get(provider["environment"]) or "").strip())
        from_local = bool(local_values.get(provider_id))
        configured = from_environment or from_local
        source = "environment" if from_environment else "local-user-config" if from_local else "none"
        result[provider_id] = {
            "providerId": provider_id,
            "label": provider["label"],
            "configured": configured,
            "state": "ready" if configured else "not-configured",
            "source": source,
            "message": (
                f"已通过环境变量 {provider['environment']} 配置；环境变量优先于网页保存值。"
                if from_environment
                else "已保存在当前操作系统用户的本机配置目录。"
                if from_local
                else f"尚未配置 {provider['environment']}。"
            ),
        }
    return result


def validate_news_credential(provider_id: str, api_key: str) -> None:
    _, provider = _provider(provider_id)
    request = Request(
        provider["checkUrl"],
        headers={provider["header"]: api_key, "User-Agent": "HengCeQuantDesk/0.1"},
    )
    try:
        with urlopen(request, timeout=8) as response:
            if response.status != 200:
                raise ValueError(f"{provider['label']} 返回状态 {response.status}")
            payload = json.loads(response.read().decode("utf-8"))
            if not isinstance(payload, (dict, list)):
                raise ValueError(f"{provider['label']} 返回内容格式不正确")
    except HTTPError as error:
        if error.code in {401, 403}:
            raise ValueError(f"{provider['label']} API Key 无效或当前套餐无权访问检查接口") from error
        raise ValueError(f"{provider['label']} 检查失败（HTTP {error.code}）") from error
    except (URLError, TimeoutError, OSError) as error:
        raise RuntimeError(f"暂时无法连接 {provider['label']}，请检查网络后重试") from error
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{provider['label']} 返回内容格式不正确") from error


def save_news_credential(
    provider_id: str,
    api_key: str,
    *,
    config_path: Path | None = None,
    environ: Mapping[str, str] | None = None,
    validator: Callable[[str, str], None] | None = None,
) -> dict:
    normalized, _ = _provider(provider_id)
    secret = str(api_key or "").strip()
    if not 8 <= len(secret) <= 512 or any(character.isspace() for character in secret):
        raise ValueError("API Key 长度或格式不正确")
    (validator or validate_news_credential)(normalized, secret)

    env = environ if environ is not None else os.environ
    path = Path(config_path) if config_path is not None else default_credential_path(env)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = _read_local_credentials(path)
    payload[normalized] = secret
    with NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as temporary:
        json.dump(payload, temporary, ensure_ascii=False, indent=2)
        temporary.write("\n")
        temporary_path = Path(temporary.name)
    try:
        os.chmod(temporary_path, 0o600)
    except OSError:
        pass
    temporary_path.replace(path)

    status = get_news_credential_status(config_path=path, environ=env)[normalized]
    return {**status, "checked": True}
