"""Market timing replay: does the regime score predict returns, drawdowns or volatility?"""

from __future__ import annotations

import math
import statistics

import market_timing

from .data import CN_TIMING_SYMBOLS, US_TIMING_SYMBOLS
from .metrics import SeriesIndex, mean, performance, spearman

WINDOW = 504  # 与线上一致：约 2 年日线
LABELS = ["进攻", "偏多", "中性", "防守", "风险规避"]
BAND_MIDPOINT = {"0%–20%": 0.1, "20%–40%": 0.3, "40%–60%": 0.5, "60%–80%": 0.7, "80%–100%": 0.9}
VOL_TARGET = 0.10

MARKETS = {
    "us": {"title": "美股", "symbols": US_TIMING_SYMBOLS, "benchmark": "sp500", "builder": market_timing.build_us_market, "start": "2010-01-01"},
    "cn": {"title": "A股", "symbols": CN_TIMING_SYMBOLS, "benchmark": "csi300", "builder": market_timing.build_china_market, "start": "2015-06-01"},
}


def replay(market_id: str, series: dict[str, list[dict]], step: int) -> list[dict]:
    config = MARKETS[market_id]
    index = SeriesIndex(series)
    benchmark_symbol = config["symbols"][config["benchmark"]]
    rows = []
    for date in index.dates[benchmark_symbol][::step]:
        if date < config["start"]:
            continue
        bundle = {key: index.upto(symbol, date, WINDOW) for key, symbol in config["symbols"].items()}
        if min(len(points) for points in bundle.values()) < 260:
            continue
        market = config["builder"](bundle, {"name": "backtest"})
        regime = market["regime"]
        rows.append({
            "date": date,
            "score": regime["score"],
            "label": regime["label"],
            "band": regime["exposureBand"],
            "dimensions": {item["id"]: item["score"] for item in market["dimensions"]},
            "f20": index.forward_return(benchmark_symbol, date, 20),
            "f60": index.forward_return(benchmark_symbol, date, 60),
            "drawdown60": index.forward_drawdown(benchmark_symbol, date, 60),
            "volatility20": index.forward_volatility(benchmark_symbol, date, 20),
        })
    return rows


def strategies(rows: list[dict], benchmark: list[dict]) -> dict:
    """Weekly-rebalanced exposure strategies over the benchmark's daily returns."""
    position = {row["date"]: i for i, row in enumerate(benchmark)}
    closes = [row["close"] for row in benchmark]
    average_exposure = statistics.fmean(BAND_MIDPOINT[row["band"]] for row in rows)
    streams = {"model": [], "constant": [], "buyHold": [], "volTarget": []}
    for current, following in zip(rows, rows[1:]):
        start, end = position[current["date"]], position[following["date"]]
        log_returns = [math.log(closes[k] / closes[k - 1]) for k in range(max(1, start - 19), start + 1)]
        realized = statistics.pstdev(log_returns) * math.sqrt(252) if len(log_returns) > 1 else 0
        vol_exposure = min(1.0, VOL_TARGET / realized) if realized else 1.0
        model_exposure = BAND_MIDPOINT[current["band"]]
        for k in range(start + 1, end + 1):
            daily = closes[k] / closes[k - 1] - 1
            streams["model"].append(model_exposure * daily)
            streams["constant"].append(average_exposure * daily)
            streams["buyHold"].append(daily)
            streams["volTarget"].append(vol_exposure * daily)
    return {"averageExposure": average_exposure, **{name: performance(values) for name, values in streams.items()}}


def evaluate(market_id: str, rows: list[dict], benchmark: list[dict]) -> dict:
    complete = [row for row in rows if row["f60"] is not None]
    buckets = {}
    for label in LABELS:
        group = [row for row in complete if row["label"] == label]
        buckets[label] = {
            "count": len(group),
            "f20": mean(row["f20"] for row in group),
            "f60": mean(row["f60"] for row in group),
            "drawdown60": mean(row["drawdown60"] for row in group),
            "volatility20": mean(row["volatility20"] for row in group),
        }
    scores = [row["score"] for row in rows]
    switches = sum(1 for a, b in zip(rows, rows[1:]) if a["label"] != b["label"])
    return {
        "market": market_id,
        "start": rows[0]["date"],
        "end": rows[-1]["date"],
        "samples": len(rows),
        "buckets": buckets,
        "spearman": {
            "f20": spearman(scores, [row["f20"] for row in rows]),
            "f60": spearman(scores, [row["f60"] for row in rows]),
            "drawdown60": spearman(scores, [row["drawdown60"] for row in rows]),
            "volatility20": spearman(scores, [row["volatility20"] for row in rows]),
        },
        "dimensionSpearmanF60": {
            dimension: spearman([row["dimensions"][dimension] for row in rows], [row["f60"] for row in rows])
            for dimension in rows[0]["dimensions"]
        },
        "weeksPerSwitch": len(rows) / switches if switches else None,
        "strategies": strategies(rows, benchmark),
    }


def run(us: dict, cn: dict, *, step: int) -> dict:
    results = {}
    for market_id, series in (("us", us), ("cn", cn)):
        config = MARKETS[market_id]
        subset = {symbol: series[symbol] for symbol in config["symbols"].values()}
        rows = replay(market_id, subset, step)
        results[market_id] = evaluate(market_id, rows, subset[config["symbols"][config["benchmark"]]])
    return results


def key_metrics(results: dict) -> dict:
    metrics = {}
    for market_id, result in results.items():
        strategy = result["strategies"]
        metrics[f"timing.{market_id}.spearman_f60"] = result["spearman"]["f60"]
        metrics[f"timing.{market_id}.spearman_volatility20"] = result["spearman"]["volatility20"]
        metrics[f"timing.{market_id}.cagr_vs_constant"] = strategy["model"]["cagr"] - strategy["constant"]["cagr"]
        metrics[f"timing.{market_id}.sharpe"] = strategy["model"]["sharpe"]
        metrics[f"timing.{market_id}.max_drawdown"] = strategy["model"]["maxDrawdown"]
    return metrics


def _pct(value, digits=2, signed=True):
    return "—" if value is None else f"{value * 100:{'+' if signed else ''}.{digits}f}%"


def markdown(results: dict) -> str:
    lines = ["## 市场择时", ""]
    for market_id, result in results.items():
        strategy = result["strategies"]
        lines += [
            f"### {MARKETS[market_id]['title']}（{result['start']} → {result['end']}，{result['samples']} 个决策点）", "",
            "| 分档 | 次数 | 后20日均值 | 后60日均值 | 后60日最大回撤均值 | 后20日年化波动 |",
            "|---|---:|---:|---:|---:|---:|",
        ]
        for label, bucket in result["buckets"].items():
            lines.append(f"| {label} | {bucket['count']} | {_pct(bucket['f20'])} | {_pct(bucket['f60'])} | {_pct(bucket['drawdown60'])} | {_pct(bucket['volatility20'], 1, False)} |")
        s = result["spearman"]
        lines += ["", f"- 秩相关：分数与后60日收益 **{s['f60']:+.3f}**，与后60日回撤 {s['drawdown60']:+.3f}，与后20日波动 **{s['volatility20']:+.3f}**",
                  "- 各维度与后60日收益：" + "、".join(f"{k} {v:+.3f}" for k, v in result["dimensionSpearmanF60"].items() if v is not None),
                  f"- 平均每 {result['weeksPerSwitch']:.1f} 个决策点切换一次分档" if result["weeksPerSwitch"] else "- 分档从未切换",
                  "", "| 策略 | 年化收益 | 年化波动 | 最大回撤 | Sharpe |", "|---|---:|---:|---:|---:|"]
        names = {"model": "衡策择时（按仓位区间中值）", "constant": f"固定 {strategy['averageExposure']*100:.0f}% 仓位（同平均仓位）",
                 "volTarget": f"按波动率控制仓位（目标 {VOL_TARGET*100:.0f}%）", "buyHold": "买入持有"}
        for key, name in names.items():
            p = strategy[key]
            lines.append(f"| {name} | {_pct(p['cagr'], 1)} | {_pct(p['volatility'], 1, False)} | {_pct(p['maxDrawdown'], 1)} | {p['sharpe']:.2f} |")
        lines.append("")
    return "\n".join(lines)
