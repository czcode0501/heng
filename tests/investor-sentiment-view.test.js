import test from "node:test";
import assert from "node:assert/strict";

import {
  getSentimentChartPoint,
  renderInvestorSentimentWorkspace,
  renderInvestorSentimentWorkspaceError,
  renderInvestorSentimentWorkspaceLoading,
  summarizeSentimentRange,
} from "../signals/investor-sentiment/view.js";

const history = [
  { date: "2026-07-01", value: 28 },
  { date: "2026-07-08", value: 24 },
  { date: "2026-07-15", value: 31 },
  { date: "2026-07-22", value: 43 },
  { date: "2026-08-14", value: 58 },
];

function market(id, title) {
  return {
    id,
    title,
    scope: id === "china" ? "A股" : "美股",
    status: "live",
    asOf: "2026-08-14",
    source: { name: id === "china" ? "BaoStock共享行情" : "Yahoo Finance via yfinance" },
    score: id === "china" ? 58 : 67,
    confidence: 88,
    phase: { id: "neutral-recovery", label: "情绪修复", tone: "positive", summary: "恐慌退潮，参与度正在恢复。" },
    history,
    dimensions: [
      { id: "fear-pressure", title: "恐慌与避险", weight: 25, score: 62, history: history.map((point) => ({ ...point, value: point.value + 4 })), summary: "波动压力回落。", metrics: [{ label: "压力分位", value: "38%", tone: "positive" }] },
      { id: "participation", title: "市场参与度", weight: 30, score: 57, history, summary: "上涨参与度改善。", metrics: [{ label: "宽基参与", value: "60%", tone: "positive" }] },
      { id: "positioning", title: "仓位与风险偏好", weight: 25, score: 55, history, summary: "风险资产相对表现转强。", metrics: [{ label: "风险代理", value: "+1.2%", tone: "positive" }] },
      { id: "speculation", title: "投机与拥挤", weight: 20, score: 49, history, summary: "成交尚未过热。", metrics: [{ label: "量比", value: "0.92×", tone: "neutral" }] },
    ],
    legacyMethods: [
      { id: "ground-volume", title: "地量衰竭", state: "正常成交", volumeRatio: 0.92, interpretation: "未达到极度缩量阈值；不能单独确认底部。" },
      { id: "crowding", title: "放量拥挤", state: "未拥挤", volumeRatio: 0.92, interpretation: "尚未出现放量滞涨。" },
    ],
    dataQuality: { label: "数据通过", coverage: 100, reusedSharedMarketCache: true },
  };
}

const payload = {
  generatedAt: "2026-08-14T20:00:00Z",
  refreshAfterSeconds: 1800,
  markets: [market("china", "中国股票"), market("united-states", "美国股票")],
  methodology: { disclaimer: "情绪是多代理变量合成结果，不构成单独买卖依据。" },
};

test("selected range changes sentiment impulse and every dimension comparison", () => {
  const result = summarizeSentimentRange(market("china", "中国股票"), { range: "custom", customStart: "2026-07-08" });

  assert.equal(result.startDate, "2026-07-08");
  assert.equal(result.endDate, "2026-08-14");
  assert.equal(result.impulse, 34);
  assert.equal(result.dimensions.length, 4);
  assert.equal(result.dimensions[0].change, 34);
  assert.equal(result.phase.id, "neutral-recovery");
});

test("chart interaction resolves an exact date and sentiment level", () => {
  assert.deepEqual(getSentimentChartPoint(history, 0.5), {
    index: 2,
    date: "2026-07-15",
    value: 31,
  });
});

test("workspace renders dual markets, four dimensions, old methods, and accessible chart interaction", () => {
  const html = renderInvestorSentimentWorkspace(payload, { range: "1m" });

  assert.match(html, /中国股票/);
  assert.match(html, /美国股票/);
  assert.match(html, /情绪水平/);
  assert.match(html, /情绪动量/);
  assert.match(html, /恐慌与避险/);
  assert.match(html, /市场参与度/);
  assert.match(html, /仓位与风险偏好/);
  assert.match(html, /投机与拥挤/);
  assert.match(html, /地量衰竭/);
  assert.match(html, /放量拥挤/);
  assert.match(html, /data-signal-range="1d"/);
  assert.match(html, /data-signal-range="1y"/);
  assert.match(html, /data-signal-custom-start/);
  assert.match(html, /data-sentiment-chart/);
  assert.match(html, /sentiment-chart-tooltip/);
  assert.match(html, /鼠标、触控或方向键/);
  assert.match(html, /共享缓存/);
  assert.doesNotMatch(html, /等待定义|演示数据/);
});

test("loading and error states never invent sentiment numbers", () => {
  const loading = renderInvestorSentimentWorkspaceLoading();
  const error = renderInvestorSentimentWorkspaceError("共享行情暂不可用");

  assert.match(loading, /正在构建中美投资者情绪证据/);
  assert.match(error, /共享行情暂不可用/);
  assert.doesNotMatch(`${loading}${error}`, /\b[0-9]{2}\.?[0-9]*\s*分/);
});
