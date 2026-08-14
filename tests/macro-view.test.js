import test from "node:test";
import assert from "node:assert/strict";

import { buildSparkline, renderMacroWorkspace } from "../signals/macro/view.js";

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

test("sparkline builds a finite path and an honest benchmark position", () => {
  const chart = buildSparkline(indicator.points, { benchmark: indicator.benchmark });

  assert.match(chart.path, /^M/);
  assert.doesNotMatch(chart.path, /NaN|Infinity/);
  assert.ok(chart.benchmarkY >= 0 && chart.benchmarkY <= 72);
});

test("macro workspace renders real values, stage, source, and trend chart", () => {
  const html = renderMacroWorkspace({
    generatedAt: "2026-08-14T15:57:00Z",
    refreshAfterSeconds: 21600,
    quality: { status: "passed", liveMarkets: 2, failures: [] },
    markets: [
      { id: "china", code: "CN", title: "中国宏观环境", status: "live", indicators: [indicator] },
      { id: "united-states", code: "US", title: "美国宏观环境", status: "live", indicators: [{ ...indicator, id: "us-pmi", name: "美国示例指标" }] },
    ],
  });

  assert.match(html, /49\.2/);
  assert.match(html, /收缩区间/);
  assert.match(html, /<svg/);
  assert.match(html, /国家统计局/);
  assert.match(html, /自动更新/);
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
