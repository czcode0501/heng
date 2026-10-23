"""US sector rotation replay: do higher-ranked sectors outperform afterwards?"""

from __future__ import annotations

import statistics
from collections import defaultdict

from sector_rotation import build_sector_market
from sector_rotation_sources import US_SECTORS

from .metrics import SeriesIndex, mean, spearman

WINDOW = 504
START = "2019-01-02"  # 11 个 SPDR 板块 ETF 自 2018-06 起齐全，再留出 120 日样本
HOLD_DAYS = 20


def replay(series: dict[str, list[dict]], timing_scores: dict[str, float], step: int) -> list[dict]:
    index = SeriesIndex(series)
    rows = []
    for date in index.dates["SPY"][::step]:
        if date < START or date not in timing_scores:
            continue
        definitions = [{**sector, "points": index.upto(sector["symbol"], date, WINDOW)} for sector in US_SECTORS]
        market = build_sector_market(
            "united-states", "美国股票", index.upto("SPY", date, WINDOW), definitions, {"name": "backtest"},
            timing_score=timing_scores[date], include_flow_history=False,
        )
        symbol_of = {sector["id"]: sector["symbol"] for sector in US_SECTORS}
        rows.append({
            "date": date,
            "spy20": index.forward_return("SPY", date, 20),
            "sectors": [{
                "id": sector["id"], "title": sector["title"], "rank": sector["rank"], "score": sector["score"],
                "confidence": sector["confidence"], "phase": sector["phase"]["label"], "action": sector["action"]["label"],
                "weight": sector["targetWeight"], "flowScore": sector["capitalFlow"].get("score"),
                "flowState": (sector["capitalFlow"].get("state") or {}).get("label"),
                "f20": index.forward_return(symbol_of[sector["id"]], date, 20),
                "f60": index.forward_return(symbol_of[sector["id"]], date, 60),
            } for sector in market["sectors"]],
        })
    return rows


def evaluate(rows: list[dict], step: int) -> dict:
    result = {"start": rows[0]["date"], "end": rows[-1]["date"], "samples": len(rows), "horizons": {}}
    for horizon in ("f20", "f60"):
        ics, top, bottom = [], [], []
        for row in rows:
            sectors = [s for s in row["sectors"] if s[horizon] is not None]
            if len(sectors) < len(row["sectors"]):
                continue
            ics.append(spearman([s["score"] for s in sectors], [s[horizon] for s in sectors]))
            equal = statistics.fmean(s[horizon] for s in sectors)
            ordered = sorted(sectors, key=lambda s: s["rank"])
            top.append(statistics.fmean(s[horizon] for s in ordered[:3]) - equal)
            bottom.append(statistics.fmean(s[horizon] for s in ordered[-3:]) - equal)
        result["horizons"][horizon] = {
            "ic": mean(ics), "icPositiveShare": sum(ic > 0 for ic in ics) / len(ics) if ics else None,
            "topMinusEqual": mean(top), "bottomMinusEqual": mean(bottom),
        }

    by_phase, by_action = defaultdict(list), defaultdict(list)
    for row in rows:
        if any(s["f20"] is None for s in row["sectors"]):
            continue
        equal = statistics.fmean(s["f20"] for s in row["sectors"])
        for s in row["sectors"]:
            by_phase[s["phase"]].append(s["f20"] - equal)
            by_action[s["action"]].append(s["f20"] - equal)
    result["phaseExcess20"] = {k: {"count": len(v), "excess": statistics.fmean(v)} for k, v in by_phase.items()}
    result["actionExcess20"] = {k: {"count": len(v), "excess": statistics.fmean(v)} for k, v in by_action.items()}

    # 不重叠持有：每隔 HOLD_DAYS 个交易日按模型目标权重持有 20 日，现金收益为 0。
    stride = max(1, HOLD_DAYS // step)
    model, equal_weight, spy, invested = [], [], [], []
    for row in rows[::stride]:
        if any(s["f20"] is None for s in row["sectors"]) or row["spy20"] is None:
            continue
        weights = {s["id"]: s["weight"] / 100 for s in row["sectors"]}
        invested.append(sum(weights.values()))
        model.append(sum(weights[s["id"]] * s["f20"] for s in row["sectors"]))
        equal_weight.append(statistics.fmean(s["f20"] for s in row["sectors"]))
        spy.append(row["spy20"])

    def annualized(values):
        equity = 1.0
        for value in values:
            equity *= 1 + value
        years = len(values) * HOLD_DAYS / 252
        return equity ** (1 / years) - 1 if years else None

    result["portfolio"] = {
        "averageInvested": mean(invested), "modelCagr": annualized(model),
        "equalWeightCagr": annualized(equal_weight), "spyCagr": annualized(spy),
    }
    return result


def run(us: dict, timing_rows: list[dict], *, step: int) -> dict:
    symbols = {"SPY"} | {sector["symbol"] for sector in US_SECTORS}
    rows = replay({symbol: us[symbol] for symbol in symbols}, {row["date"]: row["score"] for row in timing_rows}, step)
    return evaluate(rows, step)


def key_metrics(result: dict) -> dict:
    return {
        "rotation.us.ic_f20": result["horizons"]["f20"]["ic"],
        "rotation.us.top3_minus_equal_f20": result["horizons"]["f20"]["topMinusEqual"],
        "rotation.us.model_minus_equal_cagr": result["portfolio"]["modelCagr"] - result["portfolio"]["equalWeightCagr"],
    }


def markdown(result: dict) -> str:
    pct = lambda v: "—" if v is None else f"{v * 100:+.2f}%"
    lines = ["## 板块轮动（美股 11 个板块）", "", f"{result['start']} → {result['end']}，{result['samples']} 个决策点", "",
             "| 期限 | 横截面 IC 均值 | IC>0 占比 | 前三名相对等权 | 后三名相对等权 |", "|---|---:|---:|---:|---:|"]
    for horizon, h in result["horizons"].items():
        lines.append(f"| {horizon[1:]} 日 | {h['ic']:+.3f} | {h['icPositiveShare'] * 100:.0f}% | {pct(h['topMinusEqual'])} | {pct(h['bottomMinusEqual'])} |")
    lines += ["", "| 轮动阶段 | 样本数 | 后20日相对等权超额 |", "|---|---:|---:|"]
    for phase, item in sorted(result["phaseExcess20"].items(), key=lambda kv: -kv[1]["excess"]):
        lines.append(f"| {phase} | {item['count']} | {pct(item['excess'])} |")
    p = result["portfolio"]
    lines += ["", f"- 模型目标权重组合（平均投入 {p['averageInvested'] * 100:.0f}%）年化 {pct(p['modelCagr'])}；"
                  f"等权 11 个板块 {pct(p['equalWeightCagr'])}；SPY {pct(p['spyCagr'])}", ""]
    return "\n".join(lines)
