import test from "node:test";
import assert from "node:assert/strict";

import { calculatePortfolioTarget } from "../portfolio-target.js";

const timing = {
  markets: [
    { id: "china", regime: { exposureBand: "40%–60%" } },
    { id: "united-states", regime: { exposureBand: "60%–80%" } },
  ],
};

const rotation = {
  markets: [{
    id: "united-states",
    sectors: [
      { id: "information-technology", score: 82 },
      { id: "health-care", score: 74 },
      { id: "utilities", score: 38 },
    ],
  }],
};

test("same-market portfolios receive materially different targets when quality and concentration differ", () => {
  const diversified = calculatePortfolioTarget({
    positions: [
      { symbol: "AAA", marketId: "united-states", sectorId: "information-technology", value: 25, stockScore: 78 },
      { symbol: "BBB", marketId: "united-states", sectorId: "information-technology", value: 25, stockScore: 72 },
      { symbol: "CCC", marketId: "united-states", sectorId: "health-care", value: 25, stockScore: 70 },
      { symbol: "DDD", marketId: "united-states", sectorId: "health-care", value: 25, stockScore: 68 },
    ],
    timingPayload: timing,
    sectorRotationPayload: rotation,
  });
  const concentrated = calculatePortfolioTarget({
    positions: [
      { symbol: "ZZZ", marketId: "united-states", sectorId: "utilities", value: 100, stockScore: 34 },
    ],
    timingPayload: timing,
    sectorRotationPayload: rotation,
  });

  assert.equal(diversified.breakdown.marketBasePct, concentrated.breakdown.marketBasePct);
  assert.ok(diversified.targetExposurePct - concentrated.targetExposurePct >= 20);
  assert.ok(diversified.breakdown.sectorAdjustmentPct > 0);
  assert.ok(concentrated.breakdown.sectorAdjustmentPct < 0);
  assert.ok(concentrated.breakdown.concentrationPenaltyPct >= 10);
  assert.match(diversified.targetLabel, /组合自适应/);
});

test("target remains evidence-transparent when stock or sector scores are unavailable", () => {
  const target = calculatePortfolioTarget({
    positions: [
      { symbol: "AAPL", marketId: "united-states", value: 60 },
      { symbol: "MSFT", marketId: "united-states", value: 40 },
    ],
    timingPayload: timing,
    sectorRotationPayload: rotation,
  });

  assert.equal(target.breakdown.marketBasePct, 70);
  assert.equal(target.breakdown.sectorCoveragePct, 0);
  assert.equal(target.breakdown.stockCoveragePct, 0);
  assert.match(target.detailLabel, /板块待补|个股待补/);
});

test("market timing still anchors mixed China and US portfolios", () => {
  const target = calculatePortfolioTarget({
    positions: [
      { symbol: "600519", marketId: "china", value: 75 },
      { symbol: "AAPL", marketId: "united-states", value: 25 },
    ],
    timingPayload: timing,
  });

  assert.equal(target.breakdown.marketBasePct, 55);
});
