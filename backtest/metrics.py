"""Shared replay helpers and statistics (pure functions, unit-tested)."""

from __future__ import annotations

import bisect
import math
import statistics


class SeriesIndex:
    """Fast point-in-time slicing of {symbol: [daily rows]}."""

    def __init__(self, series: dict[str, list[dict]]):
        self.series = series
        self.dates = {symbol: [row["date"] for row in rows] for symbol, rows in series.items()}

    def upto(self, symbol: str, date: str, window: int | None = None) -> list[dict]:
        """Rows dated on or before `date` (never later), optionally the last `window` of them."""
        end = bisect.bisect_right(self.dates[symbol], date)
        start = max(0, end - window) if window else 0
        return self.series[symbol][start:end]

    def position(self, symbol: str, date: str) -> int:
        return bisect.bisect_right(self.dates[symbol], date) - 1

    def forward_return(self, symbol: str, date: str, days: int) -> float | None:
        rows = self.series[symbol]
        index = self.position(symbol, date)
        if index < 0 or index + days >= len(rows):
            return None
        return rows[index + days]["close"] / rows[index]["close"] - 1

    def forward_drawdown(self, symbol: str, date: str, days: int) -> float | None:
        rows = self.series[symbol]
        index = self.position(symbol, date)
        if index < 0 or index + days >= len(rows):
            return None
        peak, worst = rows[index]["close"], 0.0
        for row in rows[index + 1:index + days + 1]:
            peak = max(peak, row["close"])
            worst = min(worst, row["close"] / peak - 1)
        return worst

    def forward_volatility(self, symbol: str, date: str, days: int) -> float | None:
        rows = self.series[symbol]
        index = self.position(symbol, date)
        if index < 0 or index + days >= len(rows):
            return None
        returns = [math.log(rows[k]["close"] / rows[k - 1]["close"]) for k in range(index + 1, index + days + 1)]
        return statistics.pstdev(returns) * math.sqrt(252)


def spearman(left: list[float | None], right: list[float | None]) -> float | None:
    pairs = [(a, b) for a, b in zip(left, right) if a is not None and b is not None]
    if len(pairs) < 3:
        return None

    def ranks(values):
        order = sorted(range(len(values)), key=lambda i: values[i])
        result = [0.0] * len(values)
        k = 0
        while k < len(order):
            j = k
            while j + 1 < len(order) and values[order[j + 1]] == values[order[k]]:
                j += 1
            for m in range(k, j + 1):
                result[order[m]] = (k + j) / 2
            k = j + 1
        return result

    ra, rb = ranks([p[0] for p in pairs]), ranks([p[1] for p in pairs])
    ma, mb = statistics.fmean(ra), statistics.fmean(rb)
    covariance = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    denominator = math.sqrt(sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb))
    return covariance / denominator if denominator else None


def performance(daily_returns: list[float], periods_per_year: int = 252) -> dict:
    """CAGR / volatility / max drawdown / Sharpe (risk-free rate 0) of a daily return stream."""
    equity, peak, max_drawdown = 1.0, 1.0, 0.0
    for value in daily_returns:
        equity *= 1 + value
        peak = max(peak, equity)
        max_drawdown = min(max_drawdown, equity / peak - 1)
    years = len(daily_returns) / periods_per_year
    cagr = equity ** (1 / years) - 1 if years > 0 and equity > 0 else -1.0
    volatility = statistics.pstdev(daily_returns) * math.sqrt(periods_per_year) if len(daily_returns) > 1 else 0.0
    return {"cagr": cagr, "volatility": volatility, "maxDrawdown": max_drawdown, "sharpe": cagr / volatility if volatility else 0.0}


def simulate_plan(entry: float, stop: float, target: float | None, path: list[dict]) -> dict:
    """Exit at the first touch of stop (checked first, conservatively) or target; otherwise at the last close."""
    risk = entry - stop
    for day, row in enumerate(path, 1):
        if row["low"] <= stop:
            return {"return": stop / entry - 1, "r": -1.0, "outcome": "stop", "days": day}
        if target and row["high"] >= target:
            return {"return": target / entry - 1, "r": (target - entry) / risk, "outcome": "target", "days": day}
    last = path[-1]["close"]
    return {"return": last / entry - 1, "r": (last - entry) / risk, "outcome": "time", "days": len(path)}


def mean(values) -> float | None:
    clean = [value for value in values if value is not None]
    return statistics.fmean(clean) if clean else None
