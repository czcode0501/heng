"""Build the official China/US stock universe and run the cheap first layer."""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from market_scanner import (  # noqa: E402
    evenly_limit_universe,
    fetch_baostock_prescreen,
    fetch_baostock_universe,
    fetch_nasdaq_universe,
    fetch_yfinance_prescreen,
    load_scan_checkpoint,
    save_scan_checkpoint,
    scan_prescreen_batches,
    UNIVERSE_SCHEMA_VERSION,
    write_json_atomic,
)


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Quant Desk 中美全市场第一层扫描")
    parser.add_argument("--market", choices=("both", "us", "china"), default="both")
    parser.add_argument("--batch-size", type=int, default=50)
    parser.add_argument("--top-n", type=int, default=80, help="每个市场进入深度分析的上限")
    parser.add_argument("--max-symbols", type=int, default=0, help="0为全市场；正数用于均匀抽样验证")
    parser.add_argument("--fresh", action="store_true", help="忽略当日检查点并重新获取行情")
    parser.add_argument("--refresh-universe", action="store_true")
    parser.add_argument("--output", default="output/scanner/prescreen-latest.json")
    return parser.parse_args()


def load_universe(market: str, scan_date: str, refresh: bool) -> list[dict]:
    cache_path = ROOT / "output" / "scanner" / f"universe-{market}-{scan_date}.json"
    if cache_path.exists() and not refresh:
        payload = json.loads(cache_path.read_text(encoding="utf-8"))
        if payload.get("schemaVersion") == UNIVERSE_SCHEMA_VERSION and isinstance(payload.get("stocks"), list):
            return payload["stocks"]
    started = time.perf_counter()
    stocks = fetch_nasdaq_universe() if market == "united-states" else fetch_baostock_universe()
    write_json_atomic(
        cache_path,
        {
            "schemaVersion": UNIVERSE_SCHEMA_VERSION,
            "market": market,
            "scanDate": scan_date,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "loadSeconds": round(time.perf_counter() - started, 2),
            "count": len(stocks),
            "stocks": stocks,
        },
    )
    return stocks


def run_market(market: str, args: argparse.Namespace, scan_date: str) -> dict:
    full_universe = load_universe(market, scan_date, args.refresh_universe)
    universe = evenly_limit_universe(full_universe, args.max_symbols)
    checkpoint_path = ROOT / "output" / "scanner" / f"checkpoint-{market}.json"
    current_symbols = {str(item["providerSymbol"] if market == "united-states" else item["baostockSymbol"]) for item in universe}
    previous = {} if args.fresh else load_scan_checkpoint(checkpoint_path, market=market, scan_date=scan_date)
    previous = {symbol: row for symbol, row in previous.items() if symbol in current_symbols}
    provider = fetch_yfinance_prescreen if market == "united-states" else fetch_baostock_prescreen
    provider_universe = []
    for item in universe:
        provider_symbol = item["providerSymbol"] if market == "united-states" else item["baostockSymbol"]
        provider_universe.append({**item, "providerSymbol": provider_symbol, "decisionSymbol": item["providerSymbol"]})

    print(f"[{market}] universe={len(full_universe)} selected={len(provider_universe)} resume={len(previous)}", flush=True)
    started = time.perf_counter()

    def checkpoint(results: dict[str, dict]) -> None:
        save_scan_checkpoint(
            checkpoint_path,
            market=market,
            scan_date=scan_date,
            results=results,
        )
        print(f"[{market}] processed={len(results)}/{len(provider_universe)}", flush=True)

    report = scan_prescreen_batches(
        provider_universe,
        provider,
        market=market,
        batch_size=args.batch_size,
        top_n=args.top_n,
        previous=previous,
        on_batch=checkpoint,
    )
    for candidate in report["candidates"]:
        candidate["providerSymbol"] = candidate.get("decisionSymbol") or candidate["providerSymbol"]
    report["counts"]["officialUniverse"] = len(full_universe)
    report["elapsedSeconds"] = round(time.perf_counter() - started, 2)
    report.pop("results", None)
    return report


def main() -> int:
    args = arguments()
    scan_date = date.today().isoformat()
    markets = {
        "both": ["united-states", "china"],
        "us": ["united-states"],
        "china": ["china"],
    }[args.market]
    reports = [run_market(market, args, scan_date) for market in markets]
    output = ROOT / args.output
    manifest = {
        "schemaVersion": 1,
        "scanDate": scan_date,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "mode": "full-market" if args.max_symbols <= 0 else "validation-sample",
        "maxSymbols": args.max_symbols,
        "markets": reports,
    }
    write_json_atomic(output, manifest)
    print(f"manifest={output}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
