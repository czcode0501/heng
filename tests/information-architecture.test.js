import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { renderStockAnalysisMarkup } from "../signals/stock-analysis/view.js";
import { renderCompanyAnalysisShell } from "../signals/stock-analysis/company-research-view.js";

const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const stock = {
  symbol: "EXM", providerSymbol: "EXM", price: 100, currency: "USD", changePercent: 1.2, range: "3m",
  analysis: { trend: "up", ma20: 95, ma60: 90, rsi14: 55, macdHistogram: 0.5, vwapDistancePercent: 2, buyShare: 54, rangePosition: 60, sampleDays: 90, periodLow: 70, periodHigh: 120 },
  chart: { candles: [], profile: { bins: [], vacuumZones: [], supportLevels: [{ low: 94, high: 96, midpoint: 95, source: "VRVP" }], resistanceLevels: [{ low: 108, high: 110, midpoint: 109, source: "VRVP" }] }, dataWindow: {} },
};

test("overview keeps only the action workbench outside professional disclosure", () => {
  const action = index.indexOf('id="today-action-panel"');
  const disclosure = index.indexOf('class="overview-professional-mode"');
  const metrics = index.indexOf('id="research-metrics"');
  const manager = index.indexOf('id="portfolio-manager-panel"');
  assert.ok(action < disclosure && disclosure < metrics && disclosure < manager);
  assert.doesNotMatch(index.match(/<details class="overview-professional-mode"[^>]*>/)?.[0] || "", /open/);
});

test("stock beginner surface exposes six essentials before two collapsed evidence layers", () => {
  const html = renderStockAnalysisMarkup(stock, { context: { sizing: { capital: 0, cash: 0 } } });
  for (const label of ["行动", "买卖区间", "买多少", "等待条件", "失效位", "数据是否足够"]) assert.match(html, new RegExp(label));
  assert.ok(html.indexOf("数据是否足够") < html.indexOf("stock-professional-mode"));
  assert.ok(html.indexOf("stock-professional-mode") < html.indexOf("stock-raw-data-mode"));
  assert.doesNotMatch(html.match(/<details class="stock-professional-mode"[^>]*>/)?.[0] || "", /open/);
  assert.doesNotMatch(html.match(/<details class="stock-raw-data-mode"[^>]*>/)?.[0] || "", /open/);
});

test("quarterly facts summarize change before a collapsed full table", () => {
  const research = {
    fundamentals: { periods: [
      { periodEnd: "2030-06-30", filedAt: "2030-07-25", revenue: 10, currency: "USD" },
      { periodEnd: "2030-03-31", filedAt: "2030-04-25", revenue: 9, currency: "USD" },
    ] },
    meta: { fetchedAt: "2030-07-27T00:00:00Z" }, providers: [], news: [],
  };
  const html = renderCompanyAnalysisShell({ marketMarkup: "MARKET", research, activeTab: "fundamentals" });
  assert.match(html, /最近有变化/);
  assert.ok(html.indexOf("最近有变化") < html.indexOf("完整季度财报与指标表"));
  assert.doesNotMatch(html.match(/<details class="company-fundamentals-details"[^>]*>/)?.[0] || "", /open/);
});

