import test from "node:test";
import assert from "node:assert/strict";

import {
  getSectorRotationChartPoint,
  renderSectorRotationWorkspace,
  selectSectorRange,
} from "../signals/sector-rotation/view.js";

function history(count = 140) {
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    value: 100 + index * 0.2,
  }));
}

function sector(id, title, rank) {
  return {
    id,
    title,
    english: id.toUpperCase(),
    symbol: id,
    instrument: `${title}指数`,
    rank,
    rankChange: rank === 1 ? 2 : -1,
    score: 82 - rank,
    scoreChange: 2.4,
    confidence: 92,
    phase: { id: rank === 1 ? "leading" : "strong", label: rank === 1 ? "领先" : "强势", tone: "positive" },
    action: { id: rank === 1 ? "increase" : "hold", label: rank === 1 ? "增配" : "持有" },
    targetWeight: rank === 1 ? 24 : 0,
    returns: { "5d": 1.2, "20d": 6.8, "60d": 9.3, "120d": 13.1 },
    dimensions: { relativeMomentum: 88, trendQuality: 84, breadth: 72, capitalFlow: 66, riskEfficiency: 79, macroFit: 50 },
    history: history(),
    dataQuality: { status: "live", observations: 140, issues: [] },
  };
}

function market(id, title) {
  return {
    id,
    title,
    status: "live",
    asOf: "2026-08-14",
    source: { name: "Free market source", access: "无需 API Key", notes: "公开行情代理" },
    timing: { score: 64, regime: "偏多", maxExposure: 60 },
    summary: { stance: "偏多", allocated: 24, cash: 76, leader: "信息技术", repairing: "金融", weakening: "能源", message: "当前由信息技术领跑。" },
    sectors: [sector("information-technology", "信息技术", 1), sector("financials", "金融", 2)],
    dataQuality: { status: "live", availableSectors: 11, expectedSectors: 11, issues: [] },
  };
}

const payload = {
  generatedAt: "2026-08-14T20:00:00Z",
  refreshAfterSeconds: 1800,
  methodologyVersion: "1.0.0",
  markets: [market("china", "中国股票"), market("united-states", "美国股票")],
};

test("sector range selects the requested trading window and hover resolves exact date", () => {
  const selected = selectSectorRange(history(), "3m");
  assert.equal(selected[0].date, "2026-02-20");
  const point = getSectorRotationChartPoint(selected, 0.5);
  assert.equal(point.index, 45);
  assert.match(point.date, /^2026-\d{2}-\d{2}$/);
  assert.equal(typeof point.changePercent, "number");
});

test("sector rotation renders independent China and US workspaces with ranking and evidence", () => {
  const html = renderSectorRotationWorkspace(payload, {
    range: "3m",
    activeSectors: { china: "information-technology", "united-states": "financials" },
  });

  assert.match(html, /中国股票/);
  assert.match(html, /美国股票/);
  assert.match(html, /data-signal-range="3m"[^>]*aria-pressed="true"/);
  assert.match(html, /轮动排名/);
  assert.match(html, /六维证据/);
  assert.match(html, /相对动量/);
  assert.match(html, /趋势质量/);
  assert.match(html, /市场宽度/);
  assert.match(html, /资金确认/);
  assert.match(html, /风险效率/);
  assert.match(html, /宏观适配/);
  assert.match(html, /data-sector-select="information-technology"/);
  assert.match(html, /data-sector-chart/);
  assert.match(html, /sector-chart-tooltip/);
  assert.match(html, /目标权重/);
  assert.match(html, /中性占位/);
});
