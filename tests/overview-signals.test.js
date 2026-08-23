import test from "node:test";
import assert from "node:assert/strict";

import {
  detectHeldMarkets,
  overviewScoreForMarket,
  renderOverviewSignalLinks,
} from "../overview-signals.js";
import { signalDirectories } from "../signals/catalog.js";

const workspaces = {
  macro: { markets: [
    { id: "china", analysis: { confidence: 81, regime: "结构性修复" } },
    { id: "united-states", analysis: { confidence: 76, regime: "晚周期降温" } },
  ] },
  marketTiming: { markets: [
    { id: "china", regime: { score: 61.2, label: "偏多" } },
    { id: "united-states", regime: { score: 67.8, label: "偏多" } },
  ] },
  sectorRotation: { markets: [
    { id: "china", sectors: [{ title: "工业", score: 72.4 }, { title: "金融", score: 64 }] },
    { id: "united-states", sectors: [{ title: "信息技术", score: 84.6 }, { title: "能源", score: 55 }] },
  ] },
  investorSentiment: { markets: [
    { id: "china", score: 58.1, phase: { label: "情绪修复" } },
    { id: "united-states", score: 66.7, phase: { label: "健康风险偏好" } },
  ] },
  capitalFlow: { markets: [
    { id: "china", summary: { averageScore: 53.4, stance: "均衡" } },
    { id: "united-states", summary: { averageScore: 63.9, stance: "温和流入" } },
  ] },
};

test("held-market detection follows the active custom portfolio", () => {
  const stockCatalog = [
    { symbol: "AAPL", currency: "USD" },
    { symbol: "000410", currency: "CNY" },
  ];
  assert.deepEqual(detectHeldMarkets({ portfolio: { positions: [{ symbol: "AAPL" }] }, stockCatalog }), ["united-states"]);
  assert.deepEqual(detectHeldMarkets({ portfolio: { positions: [{ symbol: "000410" }] }, stockCatalog }), ["china"]);
  assert.deepEqual(detectHeldMarkets({ portfolio: { positions: [{ symbol: "AAPL" }, { symbol: "000410" }] }, stockCatalog }), ["china", "united-states"]);
});

test("held-market detection gives broker positions priority in real-account mode", () => {
  const markets = detectHeldMarkets({
    brokerSnapshots: [{ positions: [
      { symbol: "AAPL", currency: "USD", market: "NASDAQ" },
      { symbol: "600519", currency: "CNY", market: "SSE" },
    ] }],
    portfolio: { positions: [{ symbol: "000410" }] },
    stockCatalog: [{ symbol: "000410", currency: "CNY" }],
  });
  assert.deepEqual(markets, ["china", "united-states"]);
});

test("each overview directory exposes an auditable existing score", () => {
  assert.deepEqual(overviewScoreForMarket("macro", workspaces.macro, "united-states"), {
    value: 76, metric: "信号清晰度", detail: "晚周期降温",
  });
  assert.equal(overviewScoreForMarket("market-timing", workspaces.marketTiming, "united-states").value, 67.8);
  assert.deepEqual(overviewScoreForMarket("sector-rotation", workspaces.sectorRotation, "united-states"), {
    value: 84.6, metric: "领先板块", detail: "信息技术",
  });
  assert.equal(overviewScoreForMarket("investor-sentiment", workspaces.investorSentiment, "united-states").value, 66.7);
  assert.equal(overviewScoreForMarket("capital-flow", workspaces.capitalFlow, "united-states").value, 63.9);
});

test("US-only holdings render one blue-labelled US score per directory", () => {
  const html = renderOverviewSignalLinks(signalDirectories, ["united-states"], workspaces);
  assert.equal((html.match(/class="overview-market-score market-us"/g) || []).length, 5);
  assert.equal((html.match(/>美股</g) || []).length, 5);
  assert.doesNotMatch(html, />A股</);
  assert.match(html, /67\.8/);
  assert.match(html, /信息技术/);
});

test("mixed holdings render explicit red A-share and blue US labels without using color alone", () => {
  const html = renderOverviewSignalLinks(signalDirectories, ["china", "united-states"], workspaces);
  assert.equal((html.match(/class="overview-market-score market-cn"/g) || []).length, 5);
  assert.equal((html.match(/class="overview-market-score market-us"/g) || []).length, 5);
  assert.equal((html.match(/>A股</g) || []).length, 5);
  assert.equal((html.match(/>美股</g) || []).length, 5);
});

test("an empty portfolio asks for holdings and never invents a score", () => {
  const html = renderOverviewSignalLinks(signalDirectories, [], workspaces);
  assert.match(html, /建立持仓后自动匹配市场评分/);
  assert.doesNotMatch(html, /overview-market-score/);
});

test("missing upstream values remain explicitly unavailable", () => {
  const unavailable = {
    macro: { markets: [{ id: "united-states", analysis: { confidence: null } }] },
    marketTiming: { markets: [{ id: "united-states", regime: { score: null } }] },
  };
  const html = renderOverviewSignalLinks(signalDirectories, ["united-states"], unavailable);
  assert.equal((html.match(/数据待更新/g) || []).length, 5);
});
