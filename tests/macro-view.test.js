import test from "node:test";
import assert from "node:assert/strict";

import { buildSparkline, renderMacroWorkspace, selectRangePoints } from "../signals/macro/view.js";

const indicator = {
  id: "cn-pmi",
  group: "增长周期",
  name: "制造业PMI",
  unit: "",
  frequency: "月度",
  benchmark: 50,
  source: { name: "东方财富数据中心", original: "国家统计局", url: "https://example.com" },
  summary: { date: "2026-07", value: 49.2, previous: 50.3, change: -1.1, direction: "down", percentile: 42, stage: "收缩区间", observations: 24 },
  points: [
    { date: "2026-04", value: 49 },
    { date: "2026-05", value: 49.7 },
    { date: "2026-06", value: 50.3 },
    { date: "2026-07", value: 49.2 },
  ],
};

const analysis = {
  modelVersion: "macro-regime-v1",
  market: "china",
  asOf: "2026-07",
  regimeCode: "uneven-recovery",
  regime: "结构性修复",
  stance: "中性偏进取",
  confidence: 78,
  summary: "增长信号分化，流动性尚未形成强刺激，当前更接近结构性修复。",
  dimensions: [
    { id: "growth", name: "增长动能", score: 3, state: "分化", explanation: "PMI偏弱但工业生产保持增长。" },
    { id: "inflation", name: "通胀压力", score: 0, state: "结构分化", explanation: "消费端温和、生产端偏强。" },
    { id: "liquidity", name: "流动性", score: -8, state: "中性", explanation: "货币扩张力度温和。" },
  ],
  drivers: [{ indicator: "制造业PMI", value: "49.2", signal: "拖累", explanation: "仍在荣枯线下方。" }],
  strategies: [{ asset: "A股风格", stance: "选择性进攻", title: "优先盈利确定性", rationale: "修复并不均衡。", risk: "PMI继续走弱会使信号失效。" }],
  disclaimer: "模型输出仅用于研究，不构成投资建议。",
};

test("sparkline builds a finite path and an honest benchmark position", () => {
  const chart = buildSparkline(indicator.points, { benchmark: indicator.benchmark });

  assert.match(chart.path, /^M/);
  assert.doesNotMatch(chart.path, /NaN|Infinity/);
  assert.ok(chart.benchmarkY >= 0 && chart.benchmarkY <= 72);
});

test("time range keeps the latest requested observations", () => {
  const points = Array.from({ length: 60 }, (_, index) => ({
    date: `${2021 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`,
    value: index,
  }));

  assert.deepEqual(selectRangePoints(points, 12), points.slice(-12));
  assert.deepEqual(selectRangePoints(points, 24), points.slice(-24));
  assert.deepEqual(selectRangePoints(points, 60), points);
});

test("macro workspace renders real values, stage, source, and trend chart", () => {
  const html = renderMacroWorkspace({
    generatedAt: "2026-08-14T15:57:00Z",
    refreshAfterSeconds: 21600,
    quality: { status: "passed", liveMarkets: 2, failures: [] },
    markets: [
      { id: "china", code: "CN", title: "中国宏观环境", status: "live", analysis, indicators: [indicator] },
      { id: "united-states", code: "US", title: "美国宏观环境", status: "live", analysis: { ...analysis, market: "united-states", regime: "晚周期降温" }, indicators: [{ ...indicator, id: "us-pmi", name: "美国示例指标" }] },
    ],
  }, { range: 12 });

  assert.match(html, /49\.2/);
  assert.match(html, /收缩区间/);
  assert.match(html, /<svg/);
  assert.match(html, /国家统计局/);
  assert.match(html, /自动更新/);
  assert.match(html, /data-macro-range="12"[^>]*aria-pressed="true"/);
  assert.match(html, /结构性修复/);
  assert.match(html, /选择性进攻/);
  assert.match(html, /模型输出仅用于研究/);
  assert.doesNotMatch(html, /待接入|NaN|undefined/);
});

test("macro workspace explains a source failure instead of inventing data", () => {
  const html = renderMacroWorkspace({
    generatedAt: "2026-08-14T15:57:00Z",
    quality: { status: "partial", liveMarkets: 1, failures: [{ market: "china" }] },
    markets: [
      { id: "china", code: "CN", title: "中国宏观环境", status: "error", error: "数据源暂时不可用", indicators: [] },
      { id: "united-states", code: "US", title: "美国宏观环境", status: "live", indicators: [{ ...indicator, id: "us-pmi" }] },
    ],
  });

  assert.match(html, /数据源暂时不可用/);
  assert.match(html, /部分数据可用/);
});
