import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPortfolioAnalysisProfile,
  normalizeAnalysisPreferences,
  profileSignalPayload,
  profileSignalScore,
} from "../portfolio-analysis-profile.js";

test("analysis preferences clamp to the shared 0-100 contract", () => {
  assert.deepEqual(normalizeAnalysisPreferences({ targetReturn: 130, riskCapacity: -3 }), {
    targetReturn: 100,
    riskCapacity: 0,
  });
  assert.deepEqual(normalizeAnalysisPreferences({}), { targetReturn: 12, riskCapacity: 50 });
});

test("manager and investor preferences materially change a derived score", () => {
  const conservative = buildPortfolioAnalysisProfile({ managerId: "marks", targetReturn: 30, riskCapacity: 15 });
  const aggressive = buildPortfolioAnalysisProfile({ managerId: "soros", targetReturn: 10, riskCapacity: 90 });

  const cautiousScore = profileSignalScore(68, "market-timing", conservative);
  const aggressiveScore = profileSignalScore(68, "market-timing", aggressive);
  assert.ok(aggressiveScore - cautiousScore >= 8, `${aggressiveScore} should materially exceed ${cautiousScore}`);
});

test("profiling keeps CPI, prices, dates, and the source payload immutable", () => {
  const raw = {
    asOf: "2026-08-15",
    markets: [{
      id: "united-states",
      cpi: { value: 2.8, date: "2026-07-01" },
      quote: { price: 220.15, volume: 123456 },
      regime: { score: 68, label: "偏多" },
      summary: { averageScore: 61 },
    }],
  };
  const before = structuredClone(raw);
  const profiled = profileSignalPayload("market-timing", raw, { managerId: "soros", targetReturn: 10, riskCapacity: 85 });

  assert.deepEqual(raw, before);
  assert.deepEqual(profiled.markets[0].cpi, raw.markets[0].cpi);
  assert.deepEqual(profiled.markets[0].quote, raw.markets[0].quote);
  assert.equal(profiled.asOf, raw.asOf);
  assert.equal(profiled.markets[0].regime.rawScore, 68);
  assert.notEqual(profiled.markets[0].regime.score, 68);
  assert.equal(profiled.markets[0].summary.rawAverageScore, 61);
});

test("market-timing profile keeps the five dimensions, total score, label, and exposure band synchronized", () => {
  const raw = {
    markets: [{
      id: "china",
      benchmark: { close: 4665.88, history: [{ date: "2026-08-14", value: 4665.88 }] },
      regime: { score: 43.4, label: "中性", tone: "neutral", confidence: "中", exposureBand: "40%–60%", summary: "原始结论" },
      dimensions: [
        { id: "trend", title: "趋势", weight: 30, score: 42, state: "承压" },
        { id: "breadth", title: "市场广度", weight: 20, score: 46, state: "中性" },
        { id: "liquidity", title: "成交与流动性", weight: 20, score: 44, state: "承压" },
        { id: "volatility", title: "波动与压力", weight: 15, score: 41, state: "承压" },
        { id: "risk", title: "风险偏好", weight: 15, score: 45, state: "中性" },
      ],
    }],
  };

  const buffett = profileSignalPayload("market-timing", raw, { managerId: "buffett", targetReturn: 12, riskCapacity: 50 });
  const soros = profileSignalPayload("market-timing", raw, { managerId: "soros", targetReturn: 12, riskCapacity: 50 });
  const buffettMarket = buffett.markets[0];
  const sorosMarket = soros.markets[0];

  assert.notEqual(buffettMarket.regime.score, sorosMarket.regime.score);
  assert.notDeepEqual(buffettMarket.dimensions.map(({ score }) => score), sorosMarket.dimensions.map(({ score }) => score));
  assert.notEqual(buffettMarket.regime.label, sorosMarket.regime.label);
  assert.notEqual(buffettMarket.regime.exposureBand, sorosMarket.regime.exposureBand);
  assert.equal(buffettMarket.regime.rawScore, 43.4);
  assert.deepEqual(buffettMarket.benchmark, raw.markets[0].benchmark);
});

test("sector-rotation profile recalculates timing cap, assigned exposure, and retained cash as one chain", () => {
  const raw = {
    markets: [{
      id: "china",
      timing: { score: 43.4, regime: "偏空", maxExposure: 20 },
      sectors: [
        { id: "technology", title: "信息技术", score: 80, scoreChange: 2, confidence: 90, dimensions: { trendQuality: 80 }, phase: { id: "leading" }, action: { id: "increase", label: "增配" }, targetWeight: 12 },
        { id: "financials", title: "金融", score: 75, scoreChange: 1, confidence: 90, dimensions: { trendQuality: 70 }, phase: { id: "strong" }, action: { id: "hold", label: "持有" }, targetWeight: 8 },
      ],
      summary: { stance: "谨慎", allocated: 20, cash: 80, leader: "信息技术", repairing: "暂无", weakening: "暂无", message: "原始结论" },
    }],
  };

  const buffett = profileSignalPayload("sector-rotation", raw, { managerId: "buffett", targetReturn: 12, riskCapacity: 50 }).markets[0];
  const soros = profileSignalPayload("sector-rotation", raw, { managerId: "soros", targetReturn: 12, riskCapacity: 50 }).markets[0];

  assert.notEqual(buffett.timing.score, soros.timing.score);
  assert.notEqual(buffett.timing.maxExposure, soros.timing.maxExposure);
  assert.notEqual(buffett.summary.allocated, soros.summary.allocated);
  assert.notEqual(buffett.summary.cash, soros.summary.cash);
  assert.equal(buffett.summary.allocated + buffett.summary.cash, 100);
  assert.equal(soros.summary.allocated + soros.summary.cash, 100);
  assert.equal(buffett.timing.rawScore, 43.4);
});

test("sentiment profile transforms the derived history used by the visible level and phase", () => {
  const raw = {
    markets: [{
      id: "china",
      score: 71,
      impulse20d: 21,
      phase: { id: "healthy-risk-appetite", label: "健康风险偏好", tone: "positive", summary: "原始结论" },
      history: [
        { date: "2026-08-12", value: 50 },
        { date: "2026-08-13", value: 60 },
        { date: "2026-08-14", value: 71 },
      ],
      dimensions: [{ id: "participation", score: 71, history: [{ date: "2026-08-14", value: 71 }] }],
    }],
  };

  const buffett = profileSignalPayload("investor-sentiment", raw, { managerId: "buffett", targetReturn: 12, riskCapacity: 50 }).markets[0];
  const soros = profileSignalPayload("investor-sentiment", raw, { managerId: "soros", targetReturn: 12, riskCapacity: 50 }).markets[0];

  assert.notEqual(buffett.history.at(-1).value, soros.history.at(-1).value);
  assert.notEqual(buffett.phase.label, soros.phase.label);
  assert.equal(buffett.history.at(-1).rawValue, 71);
  assert.equal(buffett.history.at(-1).date, "2026-08-14");
  assert.equal(raw.markets[0].history.at(-1).value, 71);
});
