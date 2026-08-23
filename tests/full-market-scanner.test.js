import test from "node:test";
import assert from "node:assert/strict";

import { candidatesFromPrescreen, summarizeDecisionRows } from "../scripts/scanner-pipeline.mjs";

test("deep scanner consumes dynamic prescreen candidates from both official market universes", () => {
  const manifest = {
    schemaVersion: 1,
    mode: "full-market",
    markets: [
      {
        market: "united-states",
        counts: { officialUniverse: 5036 },
        candidates: [
          { symbol: "AAA", providerSymbol: "AAA", score: 88, sectorId: "industrials" },
          { symbol: "BBB", providerSymbol: "BBB", score: 84, sectorId: "financials" },
        ],
      },
      {
        market: "china",
        counts: { officialUniverse: 5208 },
        candidates: [
          { symbol: "603986", providerSymbol: "603986.SS", score: 86, sectorId: "information-technology" },
          { symbol: "600938", providerSymbol: "600938.SS", score: 80, sectorId: "energy" },
        ],
      },
    ],
  };

  const candidates = candidatesFromPrescreen(manifest, 1);

  assert.deepEqual(candidates.map(({ providerSymbol }) => providerSymbol), ["AAA", "603986.SS"]);
  assert.deepEqual(candidates.map(({ officialUniverse }) => officialUniverse), [5036, 5208]);
});

test("decision summary discloses successful, failed, and action distributions", () => {
  const summary = summarizeDecisionRows([
    { action: "买入" },
    { action: "等待" },
    { action: "等待" },
    { error: "no data" },
  ]);

  assert.deepEqual(summary, {
    candidates: 4,
    successful: 3,
    failed: 1,
    distribution: { 买入: 1, 等待: 2 },
  });
});
