"""Local market-data API for the Quant Desk development preview."""

from __future__ import annotations

import json
import re
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


SEARCH_LIMIT = 10
BAOSTOCK_LOCK = threading.Lock()
YAHOO_SYMBOL_PATTERN = re.compile(r"^[A-Za-z0-9.^=-]{1,20}(?:\.(?:SS|SZ|BJ))?$")


def validate_search_query(value: str) -> str:
    query = (value or "").strip()
    if not query:
        raise ValueError("请输入股票代码或名称")
    if len(query) > 40:
        raise ValueError("搜索内容不能超过40个字符")
    return query


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
    return {
        "symbol": symbol,
        "providerSymbol": provider_symbol,
        "name": quote.get("longname") or quote.get("shortname") or symbol,
        "market": market,
        "currency": currency,
        "assetType": quote.get("quoteType") or "EQUITY",
        "source": "Yahoo Finance",
    }


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
        is_us_listing = exchange in {"NMS", "NYQ", "NGM", "NCM", "ASE", "BTS", "PCX", "PNK", "OQX", "OEM"}
        if quote_type in {"EQUITY", "ETF"} and (is_a_share or is_us_listing):
            accepted.append(normalize_yahoo_quote(quote))
    return accepted


def search_instruments(query: str) -> list[dict[str, str]]:
    query = validate_search_query(query)
    results = []
    if re.fullmatch(r"\d{6}", query) or re.search(r"[\u3400-\u9fff]", query):
        results.extend(search_baostock(query))
    if not results or not re.search(r"[\u3400-\u9fff]", query):
        results.extend(search_yahoo(query))

    deduplicated = {}
    for result in results:
        key = result["providerSymbol"]
        if key not in deduplicated or result["source"] == "BaoStock":
            deduplicated[key] = result
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
                data = get_quote(params.get("symbol", [""])[0])
                self.send_json(200, {"data": data})
                return
            if parsed.path == "/api/health":
                self.send_json(200, {"data": {"status": "ok"}})
                return
            self.send_error_json(404, "NOT_FOUND", "接口不存在")
        except ValueError as error:
            self.send_error_json(400, "VALIDATION_ERROR", str(error))
        except LookupError as error:
            self.send_error_json(404, "QUOTE_NOT_FOUND", str(error))
        except Exception as error:
            print(f"market data request failed: {type(error).__name__}: {error}")
            self.send_error_json(502, "DATA_SOURCE_ERROR", "行情数据源暂时不可用，请稍后重试")

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "http://127.0.0.1:5173")
        self.end_headers()
        self.wfile.write(body)

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
