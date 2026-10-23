"""Report writing and baseline regression gate."""

from __future__ import annotations

import fnmatch
import json
from datetime import datetime, timezone
from pathlib import Path

BASELINE_PATH = Path(__file__).resolve().parent / "baseline.json"

# (方向, 容差)：+1 越高越好，-1 越低越好，0 仅展示不作为闸门。容差为绝对值，吸收数据新增几天带来的正常波动。
METRIC_RULES = {
    "timing.*.spearman_f60": (+1, 0.02),
    "timing.*.spearman_volatility20": (-1, 0.02),
    "timing.*.cagr_vs_constant": (+1, 0.005),
    "timing.*.sharpe": (+1, 0.02),
    "timing.*.max_drawdown": (+1, 0.01),
    "rotation.us.ic_f20": (+1, 0.01),
    "rotation.us.top3_minus_equal_f20": (+1, 0.001),
    "rotation.us.model_minus_equal_cagr": (+1, 0.005),
    "stocks.buy_share": (0, 0),
    "stocks.buy_f63_minus_baseline": (+1, 0.005),
    "stocks.composite_spearman_f63": (+1, 0.01),
    "stocks.plan_per_day_minus_hold": (+1, 0.0001),
    "stocks.median_reward_to_risk": (+1, 0.05),
}

METRIC_LABELS = {
    "spearman_f60": "分数与后60日收益秩相关",
    "spearman_volatility20": "分数与后20日波动秩相关（越负越好）",
    "cagr_vs_constant": "择时年化 − 同平均仓位固定持有",
    "sharpe": "择时策略 Sharpe",
    "max_drawdown": "择时策略最大回撤",
    "ic_f20": "板块排名 20 日 IC",
    "top3_minus_equal_f20": "前三名板块相对等权（20日）",
    "model_minus_equal_cagr": "模型权重组合年化 − 等权",
    "buy_share": "买入决策占比（仅展示）",
    "buy_f63_minus_baseline": "买入后63日收益 − 全样本基准",
    "composite_spearman_f63": "综合分与后63日收益秩相关",
    "plan_per_day_minus_hold": "按计划每日收益 − 直接持有",
    "median_reward_to_risk": "目标/止损距离中位数之比",
}


def rule_for(key: str) -> tuple[int, float]:
    return next((rule for pattern, rule in METRIC_RULES.items() if fnmatch.fnmatch(key, pattern)), (0, 0.0))


def compare(current: dict, baseline: dict | None) -> list[dict]:
    """Classify each metric against the baseline: improved / unchanged / regressed / new."""
    rows = []
    for key, value in current.items():
        direction, tolerance = rule_for(key)
        base = (baseline or {}).get(key)
        if value is None or base is None:
            rows.append({"key": key, "current": value, "baseline": base, "delta": None, "status": "new" if base is None else "missing"})
            continue
        delta = value - base
        signed = delta * direction
        status = "info" if direction == 0 else "regressed" if signed < -tolerance else "improved" if signed > tolerance else "unchanged"
        rows.append({"key": key, "current": value, "baseline": base, "delta": delta, "status": status})
    return rows


def load_baseline(mode: str) -> dict | None:
    if not BASELINE_PATH.exists():
        return None
    return json.loads(BASELINE_PATH.read_text(encoding="utf-8")).get(mode)


def save_baseline(mode: str, metrics: dict, meta: dict) -> None:
    stored = json.loads(BASELINE_PATH.read_text(encoding="utf-8")) if BASELINE_PATH.exists() else {}
    stored[mode] = {"metrics": metrics, **meta}
    BASELINE_PATH.write_text(json.dumps(stored, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def comparison_markdown(rows: list[dict], baseline_meta: dict | None) -> str:
    status_label = {"improved": "改善", "unchanged": "持平", "regressed": "**退步**", "new": "新指标", "missing": "缺失", "info": "—"}
    fmt = lambda v: "—" if v is None else f"{v:+.4f}"
    title = "## 与基线对比"
    if not baseline_meta:
        return f"{title}\n\n尚无基线。确认结果后运行 `npm run backtest -- --update-baseline` 保存。\n"
    lines = [title, "", f"基线：{baseline_meta.get('createdAt', '—')}，提交 {baseline_meta.get('commit', '—')}，数据截至 {baseline_meta.get('dataEnd', '—')}", "",
             "| 指标 | 说明 | 基线 | 本次 | 变化 | 结论 |", "|---|---|---:|---:|---:|---|"]
    for row in rows:
        lines.append(f"| `{row['key']}` | {METRIC_LABELS.get(row['key'].split('.')[-1], '')} | {fmt(row['baseline'])} | {fmt(row['current'])} | {fmt(row['delta'])} | {status_label[row['status']]} |")
    return "\n".join(lines) + "\n"


def write_report(output_dir: Path, sections: list[str], comparison: str, summary: dict) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    header = [
        "# 衡策决策模型回测报告", "",
        f"- 生成时间：{datetime.now(timezone.utc).isoformat(timespec='seconds')}",
        f"- 代码提交：{summary['meta'].get('commit', '—')}{'（有未提交改动）' if summary['meta'].get('dirty') else ''}",
        f"- 模式：{summary['meta']['mode']}；数据截至 {summary['meta'].get('dataEnd', '—')}",
        "- 方法：逐点历史回放，每个决策点只使用当日及以前的数据，调用衡策自己的模型代码；之后的真实走势仅用于评估。",
        "- 局限：宏观与公司财报没有逐点历史，未参与回放；个股样本为当前大盘股（幸存者偏差）；未计交易成本；相邻样本的后续收益区间重叠，显著性偏乐观。",
        "",
    ]
    report = "\n".join(header) + "\n" + comparison + "\n" + "\n".join(sections)
    path = output_dir / "report.md"
    path.write_text(report, encoding="utf-8")
    (output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return path
