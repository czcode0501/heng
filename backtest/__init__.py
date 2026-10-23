"""Point-in-time replay backtests for Hengce decision models.

每个回放日只把当日及以前的数据交给衡策自己的模型代码，再用之后的真实走势评估决策。
运行：npm run backtest（或 python -m backtest --help）。
"""
