import test from "node:test";
import assert from "node:assert/strict";

import {
  getCapitalFlowChartPoint,
  renderCapitalFlowWorkspace,
} from "../signals/capital-flow/view.js";

const windows = { "1d": 1.2, "5d": 3.4, "20d": 8.6 };
const metrics = {
  priceChange: windows,
  cmf: { "1d": 42, "5d": 31, "20d": 22 },
  estimatedNetFlow: { "1d": 1200000, "5d": 4200000, "20d": 9800000 },
  flowRatio: { "1d": 42, "5d": 31, "20d": 22 },
  upDownVolumeRatio: { "1d": null, "5d": 2.1, "20d": 1.7 },
  rvol: { "1d": 1.2, "5d": 1.1, "20d": 1.05 },
  closeLocation: { "1d": 71, "5d": 68, "20d": 64 },
  mfi: { "1d": null, "5d": 66, "20d": 62 },
  obvChange: { "1d": 2, "5d": 8, "20d": 18 },
};

function sector(id, title, score) {
  return {
    id,
    title,
    symbol: id.toUpperCase(),
    instrument: `${title}指数`,
    flowRank: 1,
    capitalFlow: {
      score,
      confidence: 94,
      state: { id: "confirmed-inflow", label: "上涨获资金确认", tone: "positive" },
      components: { directionPressure: 76, persistence: 80, participation: 69, priceLocationConfirmation: 72, intensity: 64 },
      metrics,
      history: Array.from({ length: 40 }, (_, index) => ({ date: `2026-07-${String(index % 28 + 1).padStart(2, "0")}`, value: 45 + index * 0.6 })),
      methodologyNote: "基于日线价格位置与成交量估算方向性资金压力。",
    },
    rotation: { score: 78, rank: 2, phase: { label: "强势" }, action: { label: "持有" } },
  };
}

function market(id, title) {
  return {
    id,
    title,
    status: "live",
    asOf: "2026-08-14",
    source: { name: "免费公开行情", mode: "zero-config" },
    summary: { averageScore: 61, stance: "资金扩散", strongest: "信息技术", weakest: "能源", inflowSectors: 5, outflowSectors: 2, divergenceSectors: 1 },
    sectors: [sector("information-technology", "信息技术", 76), sector("energy", "能源", 38)],
  };
}

const payload = {
  generatedAt: "2026-08-14T20:00:00Z",
  refreshAfterSeconds: 1800,
  markets: [market("china", "中国股票"), market("united-states", "美国股票")],
  methodology: { disclaimer: "资金流为价格位置与成交量推算值，不代表交易所披露的机构真实净买入。" },
};

test("capital flow chart resolves exact dates for pointer interaction", () => {
  const point = getCapitalFlowChartPoint(sector("technology", "科技", 75).capitalFlow.history, 0.5);
  assert.equal(point.index, 20);
  assert.match(point.date, /^2026-07-\d{2}$/);
  assert.equal(typeof point.value, "number");
});

test("capital flow workspace keeps markets separate and renders the legacy nine-indicator matrix", () => {
  const html = renderCapitalFlowWorkspace(payload, {
    period: "20d",
    activeSectors: { china: "information-technology", "united-states": "energy" },
  });

  assert.match(html, /中国股票/);
  assert.match(html, /美国股票/);
  assert.match(html, /九项资金证据/);
  assert.match(html, /CMF/);
  assert.match(html, /估算净流额/);
  assert.match(html, /涨跌量比/);
  assert.match(html, /MFI/);
  assert.match(html, /OBV/);
  assert.match(html, /MFI<\/strong><\/td><td[^>]*>—<\/td>/);
  assert.match(html, /data-capital-period="20d"[^>]*aria-pressed="true"/);
  assert.match(html, /data-capital-select="information-technology"/);
  assert.match(html, /data-capital-flow-chart/);
  assert.match(html, /上涨获资金确认/);
  assert.match(html, /板块轮动/);
  assert.match(html, /data-reuse-sector-cache/);
  assert.match(html, /不代表交易所披露的机构真实净买入/);
});
