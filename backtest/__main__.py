"""Command line: python -m backtest [--quick] [--suite timing,rotation,stocks] [--check] [--update-baseline]."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backtest import data, report, rotation, stocks, timing  # noqa: E402

# 每隔多少个交易日取一个决策点。快速模式用于日常改模型后的自检，完整模式用于正式结论。
STEPS = {"full": {"timing": 5, "rotation": 5, "stocks": 10}, "quick": {"timing": 20, "rotation": 20, "stocks": 40}}
SUITES = ("timing", "rotation", "stocks")


def git_state() -> dict:
    try:
        commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
        dirty = bool(subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip())
        return {"commit": commit, "dirty": dirty}
    except (OSError, subprocess.CalledProcessError):
        return {"commit": None, "dirty": None}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="backtest", description="衡策决策模型的逐点历史回放")
    parser.add_argument("--quick", action="store_true", help="稀疏采样，几分钟内完成；用于改模型后的日常自检")
    parser.add_argument("--suite", default=",".join(SUITES), help="要报告的套件：timing,rotation,stocks（依赖会自动运行）")
    parser.add_argument("--refresh-data", action="store_true", help="重新下载历史数据（默认使用 24 小时内的本地缓存）")
    parser.add_argument("--check", action="store_true", help="任一指标相对基线退步超出容差时以退出码 1 结束")
    parser.add_argument("--update-baseline", action="store_true", help="把本次结果写入 backtest/baseline.json（需提交）")
    parser.add_argument("--output", type=Path, help="报告目录（默认 output/backtest/<时间>/）")
    args = parser.parse_args(argv)

    mode = "quick" if args.quick else "full"
    requested = [name.strip() for name in args.suite.split(",") if name.strip()]
    unknown = set(requested) - set(SUITES)
    if unknown:
        parser.error(f"未知套件：{', '.join(sorted(unknown))}")
    needed = set(requested)
    if "stocks" in needed:
        needed.add("rotation")
    if "rotation" in needed:
        needed.add("timing")
    steps = STEPS[mode]
    started = time.time()
    output_dir = args.output or ROOT / "output" / "backtest" / datetime.now().strftime("%Y%m%d-%H%M%S")

    print(f"[backtest] 模式 {mode}，套件 {', '.join(s for s in SUITES if s in needed)}", flush=True)
    us = data.load_us(refresh=args.refresh_data)
    cn = data.load_cn(refresh=args.refresh_data) if "timing" in needed else {}
    data_end = max(rows[-1]["date"] for rows in us.values() if rows)

    results, metrics, sections = {}, {}, []
    timing_rows = None
    if "timing" in needed:
        print("[backtest] 市场择时回放…", flush=True)
        subset_us = {symbol: us[symbol] for symbol in data.US_TIMING_SYMBOLS.values()}
        timing_rows = timing.replay("us", subset_us, steps["timing"])
        results["timing"] = {
            "us": timing.evaluate("us", timing_rows, subset_us["^GSPC"]),
            "cn": timing.evaluate("cn", timing.replay("cn", cn, steps["timing"]), cn["sh.000300"]),
        }
    rotation_result = None
    if "rotation" in needed:
        print("[backtest] 板块轮动回放…", flush=True)
        symbols = {"SPY"} | {s["symbol"] for s in rotation.US_SECTORS}
        # 个股回放需要与其日期对齐的轮动结果，因此轮动步长取二者中较小者。
        rotation_step = min(steps["rotation"], steps["stocks"]) if "stocks" in needed else steps["rotation"]
        rotation_rows = rotation.replay({s: us[s] for s in symbols}, {row["date"]: row["score"] for row in timing_rows}, rotation_step)
        results["rotation"] = rotation.evaluate(rotation_rows, rotation_step)
    if "stocks" in needed:
        print("[backtest] 个股决策回放（调用应用的 decision.js）…", flush=True)
        stock_step = steps["stocks"]
        results["stocks"] = stocks.run(us, rotation_rows, step=stock_step, work_dir=output_dir / "work")

    if "timing" in requested:
        metrics.update(timing.key_metrics(results["timing"]))
        sections.append(timing.markdown(results["timing"]))
    if "rotation" in requested:
        metrics.update(rotation.key_metrics(results["rotation"]))
        sections.append(rotation.markdown(results["rotation"]))
    if "stocks" in requested:
        metrics.update(stocks.key_metrics(results["stocks"]))
        sections.append(stocks.markdown(results["stocks"]))

    meta = {"mode": mode, "dataEnd": data_end, "createdAt": datetime.now().isoformat(timespec="seconds"), **git_state()}
    baseline = report.load_baseline(mode)
    comparison = report.compare(metrics, (baseline or {}).get("metrics"))
    summary = {"meta": meta, "metrics": metrics, "comparison": comparison, "results": results}
    path = report.write_report(output_dir, sections, report.comparison_markdown(comparison, baseline), summary)
    latest = ROOT / "output" / "backtest" / "latest"
    shutil.rmtree(latest, ignore_errors=True)
    shutil.copytree(output_dir, latest, ignore=shutil.ignore_patterns("work"))

    regressions = [row for row in comparison if row["status"] == "regressed"]
    print(f"[backtest] 完成，用时 {time.time() - started:.0f} 秒；报告 {path}", flush=True)
    for row in regressions:
        print(f"[backtest] 退步：{row['key']} {row['baseline']:+.4f} → {row['current']:+.4f}", flush=True)
    if args.update_baseline:
        report.save_baseline(mode, metrics, {k: meta[k] for k in ("createdAt", "commit", "dataEnd")})
        print(f"[backtest] 已更新基线：{report.BASELINE_PATH}（模式 {mode}），请提交该文件", flush=True)
    if args.check and regressions:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
