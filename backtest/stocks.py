"""Stock decision card replay: do "buy" decisions beat "wait", and does the plan beat holding?"""

from __future__ import annotations

import json
import shutil
import statistics
import subprocess
from collections import Counter, defaultdict
from datetime import date as Date, timedelta
from pathlib import Path

import market_timing
from api_server import build_stock_analysis_from_rows
from investor_sentiment import build_sentiment_dashboard

from .data import STOCK_UNIVERSE, US_TIMING_SYMBOLS
from .metrics import SeriesIndex, mean, simulate_plan, spearman

WINDOW = 504
LOOKBACK_DAYS = 220  # 应用 3 个月分析的取数窗口
HORIZON = 63
HOLDING_DAYS = 90
START = "2019-01-02"
ROOT = Path(__file__).resolve().parent.parent


def decision_context(sector_id: str, timing_1m: dict, sentiment: dict | None, sector: dict | None) -> dict:
    """Mirror app.js getStockDecisionContext for a new (not held) US position.

    与线上保持一致：市场择时取 signal_bootstrap 的 1 个月区间分（D19）；板块阶段在
    sector.rotation 缺失时按分数退化为“领先/落后/中性轮动”（D20）。修复这两处后需同步此函数。
    """
    return {
        "marketId": "united-states",
        "managerId": "quant-balanced",
        "held": False,
        "macro": None,  # 宏观没有逐点历史，按“宏观数据待恢复”处理
        "timing": {key: timing_1m.get(key) for key in ("score", "label", "exposureBand", "confidence")},
        "companyProfile": {"sectorId": sector_id},
        "sector": None if not sector else {
            "id": sector["id"], "title": sector["title"], "score": sector["score"], "rank": sector["rank"],
            "phase": "领先" if sector["score"] >= 65 else "落后" if sector["score"] <= 40 else "中性轮动",
            "confidence": sector["confidence"], "flowScore": sector["flowScore"], "flowState": sector["flowState"],
        },
        "sentiment": None if not sentiment or sentiment.get("score") is None else {
            "score": sentiment["score"], "impulse": sentiment.get("impulse20d"),
            "phase": (sentiment.get("phase") or {}).get("label"), "tone": (sentiment.get("phase") or {}).get("tone"),
            "confidence": sentiment.get("confidence"),
        },
    }


def build_inputs(us: dict, rotation_rows: list[dict], step: int, path: Path) -> list[dict]:
    index = SeriesIndex(us)
    rotation = {row["date"]: {s["id"]: s for s in row["sectors"]} for row in rotation_rows}
    meta = []
    with path.open("w", encoding="utf-8") as handle:
        for day in index.dates["SPY"][::step]:
            if day < START or day not in rotation:
                continue
            base = market_timing.build_us_market({k: index.upto(s, day, WINDOW) for k, s in US_TIMING_SYMBOLS.items()}, {"name": "backtest"})
            dashboard = {"markets": [base]}
            timing_1m = market_timing.apply_market_timing_range(json.loads(json.dumps(dashboard)), "1m", None)["markets"][0]["regime"]
            sentiment = build_sentiment_dashboard(dashboard)["markets"][0]
            start = (Date.fromisoformat(day) - timedelta(days=LOOKBACK_DAYS)).isoformat()
            for symbol, sector_id in STOCK_UNIVERSE.items():
                rows = [{**row, "time": row["date"]} for row in index.upto(symbol, day) if row["date"] >= start]
                if len(rows) < 60:
                    continue
                try:
                    payload = build_stock_analysis_from_rows(symbol, rows, currency="USD", range_id="3m", interval_label="日线")
                except (LookupError, ValueError):
                    continue
                position = index.position(symbol, day)
                future = [{"low": r["low"], "high": r["high"], "close": r["close"]} for r in us[symbol][position + 1:position + 1 + HORIZON]]
                row_id = len(meta)
                meta.append({"id": row_id, "date": day, "symbol": symbol, "price": payload["price"], "future": future})
                handle.write(json.dumps({
                    "id": row_id,
                    "holdingDays": HOLDING_DAYS,
                    "payload": {"providerSymbol": symbol, "price": payload["price"], "currency": "USD", "range": "3m",
                                "analysis": payload["analysis"], "chart": {"profile": payload["chart"]["profile"]}},
                    "context": decision_context(sector_id, timing_1m, sentiment, rotation[day].get(sector_id)),
                }, ensure_ascii=False) + "\n")
    return meta


def decide(input_path: Path, output_path: Path) -> dict[int, dict]:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("需要 Node.js 运行应用的决策引擎")
    subprocess.run([node, str(ROOT / "backtest" / "stock_decide.mjs"), str(input_path), str(output_path)], cwd=ROOT, check=True)
    decisions = {}
    with output_path.open(encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            decisions[row["id"]] = row
    return decisions


def evaluate(meta: list[dict], decisions: dict[int, dict]) -> dict:
    rows = []
    for item in meta:
        decision = decisions[item["id"]]
        future = item["future"]
        rows.append({**item, **decision,
                     "f20": future[19]["close"] / item["price"] - 1 if len(future) >= 20 else None,
                     "f63": future[HORIZON - 1]["close"] / item["price"] - 1 if len(future) >= HORIZON else None})
    complete = [row for row in rows if row["f63"] is not None]
    baseline20, baseline63 = mean(r["f20"] for r in complete), mean(r["f63"] for r in complete)

    by_code = defaultdict(list)
    for row in complete:
        by_code[(row["verb"], row["code"])].append(row)
    codes = [{"verb": verb, "code": code, "count": len(group), "f20": mean(r["f20"] for r in group),
              "f63": mean(r["f63"] for r in group), "positiveShare": sum(r["f63"] > 0 for r in group) / len(group)}
             for (verb, code), group in sorted(by_code.items(), key=lambda kv: -len(kv[1]))]

    buys = [r for r in complete if r["verb"] == "买入"]
    plans, holds, target_gaps, stop_gaps = [], [], [], []
    for row in complete:
        stop, target = row["invalidation"], (row["target"] or {}).get("midpoint")
        if stop is None or not target or not (stop < row["price"] < target):
            continue
        plans.append(simulate_plan(row["price"], stop, target, row["future"]))
        holds.append(row["f63"])
        target_gaps.append(target / row["price"] - 1)
        stop_gaps.append(1 - stop / row["price"])
    plan_per_day = mean(p["return"] for p in plans) / mean(p["days"] for p in plans) if plans else None
    hold_per_day = mean(holds) / HORIZON if holds else None

    return {
        "start": rows[0]["date"], "end": rows[-1]["date"], "decisions": len(rows),
        "symbols": len({r["symbol"] for r in rows}), "dates": len({r["date"] for r in rows}),
        "baseline": {"f20": baseline20, "f63": baseline63},
        "verbs": dict(Counter(r["verb"] for r in rows)),
        "buyShare": sum(r["verb"] == "买入" for r in rows) / len(rows),
        "buyCount": len(buys),
        "buyF63": mean(r["f63"] for r in buys),
        "codes": codes,
        "stabilizationReasons": dict(Counter(r["reason"] for r in rows if r["code"] == "wait-stabilization")),
        "compositeSpearmanF63": spearman([r["composite"] for r in complete], [r["f63"] for r in complete]),
        "plan": {
            "trades": len(plans), "averageDays": mean(p["days"] for p in plans), "averageReturn": mean(p["return"] for p in plans),
            "winRate": sum(p["return"] > 0 for p in plans) / len(plans) if plans else None,
            "outcomes": dict(Counter(p["outcome"] for p in plans)),
            "perDay": plan_per_day, "holdPerDay": hold_per_day,
            "medianTargetGap": statistics.median(target_gaps) if target_gaps else None,
            "medianStopGap": statistics.median(stop_gaps) if stop_gaps else None,
        },
    }


def run(us: dict, rotation_rows: list[dict], *, step: int, work_dir: Path) -> dict:
    work_dir.mkdir(parents=True, exist_ok=True)
    inputs, outputs = work_dir / "stock_inputs.jsonl", work_dir / "stock_decisions.jsonl"
    meta = build_inputs(us, rotation_rows, step, inputs)
    return evaluate(meta, decide(inputs, outputs))


def key_metrics(result: dict) -> dict:
    plan = result["plan"]
    return {
        "stocks.buy_share": result["buyShare"],
        "stocks.buy_f63_minus_baseline": (result["buyF63"] - result["baseline"]["f63"]) if result["buyF63"] is not None else None,
        "stocks.composite_spearman_f63": result["compositeSpearmanF63"],
        "stocks.plan_per_day_minus_hold": (plan["perDay"] - plan["holdPerDay"]) if plan["perDay"] is not None else None,
        "stocks.median_reward_to_risk": (plan["medianTargetGap"] / plan["medianStopGap"]) if plan["medianStopGap"] else None,
    }


def markdown(result: dict) -> str:
    pct = lambda v: "—" if v is None else f"{v * 100:+.2f}%"
    plan = result["plan"]
    lines = ["## 个股决策卡", "",
             f"{result['symbols']} 只股票 × {result['dates']} 个日期 = {result['decisions']} 个决策（{result['start']} → {result['end']}，持有期 {HOLDING_DAYS} 天，多因子方法）", "",
             f"- 动作分布：{result['verbs']}；买入占比 **{result['buyShare'] * 100:.1f}%**",
             f"- 全部样本基准：后20日 {pct(result['baseline']['f20'])}，后63日 {pct(result['baseline']['f63'])}",
             f"- 综合分与后63日收益的秩相关：**{result['compositeSpearmanF63']:+.3f}**",
             f"- “等待企稳”触发原因：{result['stabilizationReasons']}", "",
             "| 动作 | 代码 | 样本数 | 后20日 | 后63日 | 后63日上涨占比 |", "|---|---|---:|---:|---:|---:|"]
    for item in result["codes"]:
        lines.append(f"| {item['verb']} | {item['code']} | {item['count']} | {pct(item['f20'])} | {pct(item['f63'])} | {item['positiveShare'] * 100:.0f}% |")
    if plan["trades"]:
        lines += ["", f"- 按决策价位执行（先触及止损还是目标，最长 {HORIZON} 日）：{plan['trades']} 笔，平均持有 {plan['averageDays']:.1f} 天，"
                      f"平均每笔 {pct(plan['averageReturn'])}，胜率 {plan['winRate'] * 100:.0f}%，结果 {plan['outcomes']}",
                  f"- 每持有一天：按计划 {pct(plan['perDay'])}，直接持有 {HORIZON} 天 {pct(plan['holdPerDay'])}",
                  f"- 目标价距现价中位数 {pct(plan['medianTargetGap'])}，止损距现价中位数 {pct(-plan['medianStopGap'])}"]
    lines.append("")
    return "\n".join(lines)
