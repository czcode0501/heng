import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { analysisQuoteForStock, dailyChangePercent } from "../quote-change.js";

test("daily change uses previous close, not the analysis range change", () => {
  // 实测 AAPL：区间（3个月）+5.61%，当日 346.27 / 348.22
  const analysis = { price: 346.2738, previousClose: 348.22, changePercent: 5.6131 };
  const quote = analysisQuoteForStock(analysis);
  assert.ok(Math.abs(quote.changePercent - -0.559) < 0.001);
  assert.equal(quote.price, 346.2738);
});

test("missing or invalid previous close falls back instead of inventing a change", () => {
  assert.equal(dailyChangePercent({ price: 10, previousClose: null }, 1.5), 1.5);
  assert.equal(dailyChangePercent({ price: 10, previousClose: 0 }), 0);
  assert.equal(dailyChangePercent({ price: "bad", previousClose: 9 }, -2), -2);
});

test("both new and existing stocks get daily change from the analysis payload helper", () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /applyQuoteToStock\(stock, analysisQuoteForStock\(payload\.data\)\)/);
  assert.match(app, /applyQuoteToStock\(existingStock, analysisQuoteForStock\(payload\.data, existingStock\.change\)\)/);
});
