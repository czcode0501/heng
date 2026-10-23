import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { FX_STORAGE_KEY, PRESET_USD_CNY, fxRateLabel, loadCachedFxRate, saveFxRate, usdCnyRate } from "../fx-rate.js";

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}

test("live rate replaces the preset and is labelled with date and source", () => {
  const fx = { rate: 6.6606, asOf: "2026-10-23", source: "Yahoo Finance（CNY=X）", stale: false };
  assert.equal(usdCnyRate(fx), 6.6606);
  assert.equal(fxRateLabel(fx), "USD/CNY 6.6606 · 2026-10-23 · Yahoo Finance（CNY=X）");
});

test("without any fetched rate the preset is used but clearly labelled", () => {
  assert.equal(usdCnyRate(null), PRESET_USD_CNY);
  assert.match(fxRateLabel(null), /预设汇率，尚未更新/);
});

test("cached rates survive restarts as stale values and reject nonsense", () => {
  const storage = memoryStorage();
  saveFxRate(storage, { rate: 6.6606, asOf: "2026-10-23", source: "Yahoo" });
  const cached = loadCachedFxRate(storage);
  assert.equal(cached.rate, 6.6606);
  assert.equal(cached.stale, true);
  assert.match(fxRateLabel(cached), /上次成功值/);

  storage.setItem(FX_STORAGE_KEY, JSON.stringify({ rate: 66.6 }));
  assert.equal(loadCachedFxRate(storage), null);
});

test("the app no longer hard-codes the USD/CNY rate", () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.doesNotMatch(app, /const usdCny = 7\.18/);
  assert.match(app, /fetch\("\/api\/fx"/);
});
