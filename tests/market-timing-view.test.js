import test from "node:test";
import assert from "node:assert/strict";

import { marketTimingMarkets } from "../signals/market-timing/catalog.js";
import {
  compareMarketTimingHistory,
  getMarketTimingChartPoint,
  getMarketTimingRefreshDelay,
  renderMarketTimingWorkspace,
  renderMarketTimingWorkspaceError,
  renderMarketTimingWorkspaceLoading,
  shouldRefreshMarketTimingNavigation,
} from "../signals/market-timing/view.js";

test("chart hover resolves the nearest date, value, and change from the selected start", () => {
  const points = [
    { date: "2026-08-12", value: 100 },
    { date: "2026-08-13", value: 96 },
    { date: "2026-08-14", value: 102 },
  ];

  assert.deepEqual(getMarketTimingChartPoint(points, 0.55), {
    index: 1,
    date: "2026-08-13",
    value: 96,
    changePercent: -4,
  });
});

test("market timing compares the selected start observation with the latest close", () => {
  const history = [
    { date: "2025-08-14", value: 80 },
    { date: "2026-05-14", value: 90 },
    { date: "2026-08-13", value: 100 },
    { date: "2026-08-14", value: 105 },
  ];

  const oneDay = compareMarketTimingHistory(history, { range: "1d" });
  const custom = compareMarketTimingHistory(history, { range: "custom", customStart: "2026-05-10" });

  assert.equal(oneDay.startDate, "2026-08-13");
  assert.equal(oneDay.changePercent, 5);
  assert.equal(custom.startDate, "2026-05-14");
  assert.equal(custom.endDate, "2026-08-14");
  assert.equal(custom.changePercent, 16.67);
  assert.deepEqual(custom.history.map(({ value }) => value), [100, 111.1111, 116.6667]);
});

test("automatic refresh delay respects the server contract and a one-minute floor", () => {
  assert.equal(getMarketTimingRefreshDelay({ refreshAfterSeconds: 1800 }), 1_800_000);
  assert.equal(getMarketTimingRefreshDelay({ refreshAfterSeconds: 15 }), 60_000);
  assert.equal(getMarketTimingRefreshDelay({}), 1_800_000);
});

test("clicking market timing while it is already open requests an immediate refresh", () => {
  assert.equal(shouldRefreshMarketTimingNavigation("#signals/market-timing", "market-timing"), true);
  assert.equal(shouldRefreshMarketTimingNavigation("#signals/market-timing", "macro"), false);
  assert.equal(shouldRefreshMarketTimingNavigation("#signals/macro", "market-timing"), false);
});

test("market timing separates China equities and United States equities", () => {
  assert.deepEqual(
    marketTimingMarkets.map(({ id, title, scope }) => ({ id, title, scope })),
    [
      { id: "china", title: "中国股票", scope: "A股" },
      { id: "united-states", title: "美国股票", scope: "美股" },
    ],
  );
});

test("China and the US declare market-specific timing dimensions", () => {
  const china = marketTimingMarkets.find(({ id }) => id === "china");
  const unitedStates = marketTimingMarkets.find(({ id }) => id === "united-states");

  assert.deepEqual(china.dimensions, ["趋势", "市场广度", "成交与流动性", "波动与压力", "风险偏好"]);
  assert.deepEqual(unitedStates.dimensions, ["趋势", "市场广度", "成交与流动性", "波动与压力", "风险偏好"]);
  assert.equal(china.primarySource, "BaoStock");
  assert.equal(unitedStates.primarySource, "yfinance");
});

test("market timing workspace renders source-backed scores and automatic update status", () => {
  const payload = {
    generatedAt: "2026-08-14T16:00:00+00:00",
    refreshAfterSeconds: 1800,
    markets: marketTimingMarkets.map((market, marketIndex) => ({
      ...market,
      status: "live",
      asOf: "2026-08-14",
      updateMode: "automatic-eod",
      source: { name: market.primarySource, mode: "zero-config" },
      benchmark: {
        symbol: marketIndex ? "^GSPC" : "000300",
        name: marketIndex ? "S&P 500" : "沪深300",
        close: marketIndex ? 6500.25 : 4665.88,
        changePercent: marketIndex ? 0.52 : 0.04,
        history: [{ date: "2026-08-13", value: 100 }, { date: "2026-08-14", value: 101 }],
      },
      regime: { score: marketIndex ? 63 : 58, label: "偏多", tone: "positive", confidence: "中", exposureBand: "60%–80%", summary: "趋势改善，但仍需要广度确认。" },
      dimensions: [
        { id: "trend", title: "趋势", weight: 30, score: 68, state: "积极", summary: "指数位于中期均线上方。", metrics: [{ id: "priceVsMa", label: "指数 / MA", value: "+2.4%", tone: "positive" }] },
      ],
      dataQuality: { status: "live", label: "数据通过", availableSeries: 5, expectedSeries: 5, issues: [] },
    })),
  };

  const html = renderMarketTimingWorkspace(payload);

  assert.match(html, /中国股票/);
  assert.match(html, /美国股票/);
  assert.match(html, /自动更新/);
  assert.match(html, /数据通过/);
  assert.match(html, /60%–80%/);
  assert.match(html, /Yahoo Finance via yfinance|yfinance/);
  assert.match(html, /data-market-timing-range="1d"/);
  assert.match(html, /data-market-timing-range="1y"/);
  assert.match(html, /data-market-timing-custom-start/);
  assert.match(html, /区间变化/);
  assert.match(html, /data-market-timing-chart/);
  assert.match(html, /timing-chart-tooltip/);
  assert.match(html, /五维证据随所选区间重新计算/);
  assert.doesNotMatch(html, /data-refresh-market-timing/);
  assert.doesNotMatch(html, /等待定义|演示数据|实时数据已连接/);
});

test("market timing has honest loading and source failure states", () => {
  const loading = renderMarketTimingWorkspaceLoading(marketTimingMarkets);
  const error = renderMarketTimingWorkspaceError("上游数据暂时不可用", marketTimingMarkets);

  assert.match(loading, /正在连接免费数据源/);
  assert.match(error, /上游数据暂时不可用/);
  assert.match(error, /再次点击左侧“市场择时”/);
  assert.doesNotMatch(`${loading}${error}`, /data-refresh-market-timing/);
});
