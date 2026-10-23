# 决策模型回测（逐点历史回放）

衡策的目标是成为量化交易平台。在那之前，每个决策模型都必须先证明自己在历史上做出过“对的决策”。`backtest/` 用**衡策自己的模型代码**逐点回放历史：每个决策点只给模型当日及以前的数据，再用之后的真实走势评估。

## 命令

```bash
npm run backtest:quick                      # 稀疏采样，数据已缓存时约 20 秒；改模型后先跑这个
npm run backtest                            # 完整回放，约 1–2 分钟；形成正式结论时使用
npm run backtest -- --check                 # 任一关键指标相对基线退步时退出码为 1
npm run backtest -- --update-baseline       # 确认新结果后更新 backtest/baseline.json（需提交）
npm run backtest -- --suite timing          # 只报告某个套件（依赖的套件会自动运行）
npm run backtest -- --refresh-data          # 重新下载历史数据（默认使用 24 小时内的缓存）
```

报告写入 `output/backtest/<时间>/report.md` 与 `summary.json`，最新一次同时复制到 `output/backtest/latest/`。历史数据缓存在 `.cache/backtest/`。两个目录都不进入版本库。

## 回放内容

| 套件 | 回放对象 | 范围 | 主要问题 |
|---|---|---|---|
| `timing` | `market_timing.build_us_market` / `build_china_market` | 美股 2010 起、A股 2015 起，每周 | 分数能否预测后续收益、回撤、波动？按建议仓位操作是否优于同等平均仓位的固定持有？ |
| `rotation` | `sector_rotation.build_sector_market`（美股 11 个 SPDR 板块） | 2019 起，每周 | 排名靠前的板块之后是否跑赢？按模型目标权重持有是否优于等权？ |
| `stocks` | `signals/stock-analysis/decision.js` 的 `buildStockDecision`（30 只美股大盘股） | 2019 起，每 10 个交易日 | “买入”是否优于“等待”？综合分有无预测力？按决策价位执行是否优于直接持有？ |

个股回放的输入按应用的实际做法生成（`backtest/stocks.py` 中的 `decision_context`）。修改 `app.js` 的 `getStockDecisionContext` 或 `signal_bootstrap.py` 时，需要同步修改这个函数，否则回测测的就不是线上行为。

## 基线与退步闸门

`backtest/baseline.json` 按模式（`quick` / `full`）保存关键指标。每次运行都会与基线对比，并标出“改善 / 持平 / 退步”。每个指标的“更好”方向和容差定义在 `backtest/report.py` 的 `METRIC_RULES` 中；容差用于吸收新增交易日带来的正常波动。

修改决策模型的流程：

1. 修改前运行一次 `npm run backtest:quick`，确认与基线一致。
2. 修改模型并补充单元测试。
3. 运行 `npm run backtest:quick -- --check`。出现退步时，要么修正，要么在提交说明中写明为什么接受这个退步。
4. 结论成立后运行完整回测，用 `--update-baseline` 更新两种模式的基线，并与代码一起提交。

## 局限

- 宏观数据与公司财报没有逐点历史，未参与回放；个股回放中宏观输入为空，应用会按“宏观数据待恢复”处理。
- 个股样本是当前的大盘股，存在幸存者偏差，结果偏乐观。
- 未计入交易成本与滑点；高换手的方案计入后会更差。
- 相邻决策点的后续收益区间重叠，统计显著性偏乐观。
- 板块轮动只回放了美股。
