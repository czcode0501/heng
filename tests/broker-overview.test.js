import test from "node:test";
import assert from "node:assert/strict";

import { brokerTargetFromTiming, buildBrokerPortfolioAnalysis, renderBrokerOverview, renderBrokerUnavailable } from "../broker-overview.js";

test("broker overview renders only IBKR-authoritative account and position fields", () => {
  const html = renderBrokerOverview([{
    sourceId: "ibkr",
    fetchedAt: "2026-08-15T19:03:26.000Z",
    account: {
      maskedId: "U1•••74",
      currency: "USD",
      totalAsset: 3280,
      marketValue: 2280,
      cash: 1000,
      unrealizedPnl: 102,
      updatedAt: "15:01",
    },
    meta: {
      positionCount: 1,
      priceSource: "IBKR TWS Account Window",
      updateCadenceSeconds: 180,
    },
    positions: [{
      sourceId: "ibkr",
      symbol: "AAPL",
      name: "Apple Inc.",
      market: "NASDAQ",
      currency: "USD",
      quantity: 12,
      averageCost: 181.5,
      costBasis: 2178,
      marketPrice: 190,
      marketValue: 2280,
      unrealizedPnl: 102,
      unrealizedPnlPct: 4.683,
    }],
  }]);

  assert.match(html.summary, /IBKR 真实账户/);
  assert.match(html.summary, /US\$3,280\.00/);
  assert.match(html.summary, /US\$2,280\.00/);
  assert.match(html.summary, /US\$1,000\.00/);
  assert.match(html.summary, /\+US\$102\.00/);
  assert.match(html.rows, /Apple Inc\./);
  assert.match(html.rows, /US\$190\.00/);
  assert.match(html.rows, /US\$181\.50/);
  assert.match(html.rows, /US\$2,178\.00/);
  assert.match(html.rows, /\+US\$102\.00/);
  assert.match(html.rows, /\+4\.68%/);
  assert.match(html.meta, /IBKR TWS Account Window/);
  assert.match(html.meta, /约 3 分钟/);
  assert.doesNotMatch(`${html.summary}${html.rows}${html.meta}`, /估算|模拟/);
});

test("broker overview keeps unavailable broker fields explicit instead of estimating", () => {
  const html = renderBrokerOverview([{
    sourceId: "ibkr",
    fetchedAt: "2026-08-15T19:03:26.000Z",
    account: { maskedId: "U1•••74", currency: "USD" },
    meta: { positionCount: 1, priceSource: "IBKR TWS Account Window", updateCadenceSeconds: 180 },
    positions: [{ symbol: "AAPL", name: "AAPL", market: "NASDAQ", currency: "USD", quantity: 1 }],
  }]);

  assert.match(html.summary, /券商未返回/);
  assert.match(html.rows, /不可用/);
});

test("broker analysis calculates cumulative holding return, exposure target, and risk from live account values", () => {
  const analysis = buildBrokerPortfolioAnalysis([{
    sourceId: "ibkr",
    account: { currency: "USD", totalAsset: 3280, marketValue: 2280, cash: 1000, unrealizedPnl: 102, exchangeRates: { USD: 1 } },
    positions: [{ symbol: "AAPL", currency: "USD", marketValue: 2280, sectorId: "information-technology" }],
  }], { targetExposurePct: 70, targetLabel: "美股择时 60%–80%" });

  assert.equal(analysis.currentExposurePct.toFixed(1), "69.5");
  assert.equal(analysis.cumulativeReturnPct.toFixed(2), "4.68");
  assert.equal(analysis.targetExposurePct, 70);
  assert.equal(analysis.risk.id, "matched");
  assert.equal(analysis.markets[0].label, "美股");
  assert.equal(analysis.markets[0].sectors[0].label, "信息技术");
  assert.equal(analysis.markets[0].sectors[0].assetPct.toFixed(1), "69.5");
});

test("broker allocation converts mixed China and US positions with IBKR exchange rates and keeps market colors distinct", () => {
  const rendered = renderBrokerOverview([{
    sourceId: "ibkr",
    fetchedAt: "2026-08-15T19:03:26.000Z",
    account: { maskedId: "U1•••74", currency: "CNY", totalAsset: 1000, marketValue: 600, cash: 400, unrealizedPnl: 50, exchangeRates: { CNY: 1, USD: 7 } },
    meta: { priceSource: "IBKR TWS Account Window", updateCadenceSeconds: 180 },
    positions: [
      { symbol: "AAPL", market: "NASDAQ", currency: "USD", marketValue: 50, sectorId: "information-technology" },
      { symbol: "600519", market: "SSE", currency: "CNY", marketValue: 250, sectorId: "consumer-staples" },
    ],
  }], { targetExposurePct: 60, targetLabel: "中美市场加权目标" });

  assert.match(rendered.summary, /当前持仓累计收益/);
  assert.match(rendered.summary, /当前仓位/);
  assert.match(rendered.summary, /目标仓位/);
  assert.match(rendered.allocation, /美股/);
  assert.match(rendered.allocation, /A股/);
  assert.match(rendered.allocation, /信息技术/);
  assert.match(rendered.allocation, /日常消费/);
  assert.match(rendered.allocation, /market-us/);
  assert.match(rendered.allocation, /market-cn/);
  assert.match(rendered.allocation, /35\.0%/);
  assert.match(rendered.allocation, /25\.0%/);
});

test("broker target exposure follows the timing bands of the markets actually held", () => {
  const snapshots = [{
    account: { currency: "CNY", totalAsset: 1000, exchangeRates: { CNY: 1, USD: 7 } },
    positions: [
      { symbol: "AAPL", currency: "USD", marketValue: 50 },
      { symbol: "600519", currency: "CNY", marketValue: 150 },
    ],
  }];
  const timing = { markets: [
    { id: "china", regime: { exposureBand: "40%–60%" } },
    { id: "united-states", regime: { exposureBand: "60%–80%" } },
  ] };
  const target = brokerTargetFromTiming(snapshots, timing);

  assert.equal(target.breakdown.marketBasePct, 64);
  assert.ok(target.targetExposurePct < target.breakdown.marketBasePct);
  assert.match(target.targetLabel, /组合自适应/);
});

test("a temporarily unavailable broker keeps a visible real-portfolio recovery surface", () => {
  const rendered = renderBrokerUnavailable("IBKR API 握手超时");

  assert.match(rendered.summary, /真实数据组合仍会保留/);
  assert.match(rendered.summary, /连接暂时中断/);
  assert.match(rendered.rows, /重新连接后自动恢复/);
  assert.match(rendered.meta, /IBKR API 握手超时/);
});
