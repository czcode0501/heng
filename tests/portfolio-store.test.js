import test from "node:test";
import assert from "node:assert/strict";

import {
  calculatePositionSnapshot,
  calculatePortfolioSnapshot,
  createPositionFromPurchase,
  loadPortfolioState,
  migrateLegacyDemoPortfolios,
  savePortfolioState,
  updatePortfolioAllocation,
} from "../portfolio-store.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
  };
}

const defaults = [{ id: "core", name: "核心组合", cash: 1000, positions: [] }];

test("portfolio state survives a save and reload without mutating defaults", () => {
  const storage = memoryStorage();
  const state = loadPortfolioState(storage, defaults);
  state.portfolios.push({ id: "idea", name: "新思路", cash: 500, positions: [] });
  state.activePortfolioId = "idea";
  state.customStocks.push({ symbol: "AAPL", currency: "USD", price: 200, change: 1 });
  savePortfolioState(storage, state);

  const restored = loadPortfolioState(storage, defaults);
  assert.equal(restored.portfolios.length, 2);
  assert.equal(restored.activePortfolioId, "idea");
  assert.equal(restored.customStocks[0].symbol, "AAPL");
  assert.equal(defaults.length, 1);
});

test("invalid saved data safely falls back to the defaults", () => {
  const storage = memoryStorage();
  storage.setItem("quant-desk.portfolios.v1", "not-json");
  const restored = loadPortfolioState(storage, defaults);
  assert.deepEqual(restored.portfolios, defaults);
  assert.notEqual(restored.portfolios, defaults);
});

test("storage write failures do not break portfolio interactions", () => {
  const storage = { setItem() { throw new Error("quota exceeded"); } };
  assert.equal(savePortfolioState(storage, {
    portfolios: defaults,
    activePortfolioId: "core",
    customStocks: [],
  }), false);
});

test("allocation edits validate cash, quantity, and cost", () => {
  const portfolio = { id: "core", cash: 1000, positions: [{ symbol: "AAPL", quantity: 2, cost: 100 }] };
  const updated = updatePortfolioAllocation(portfolio, {
    cash: "2500",
    positions: [{ symbol: "AAPL", quantity: "3", cost: "120" }],
  });
  assert.equal(updated.cash, 2500);
  assert.deepEqual(updated.positions[0], { symbol: "AAPL", quantity: 3, cost: 120 });
  assert.throws(() => updatePortfolioAllocation(portfolio, { cash: "-1", positions: [] }), /现金/);
});

test("portfolio comparison snapshot uses the stock market and exchange rate", () => {
  const portfolio = {
    id: "core",
    cash: 1000,
    positions: [
      { symbol: "600519", quantity: 1, cost: 1000 },
      { symbol: "AAPL", quantity: 1, cost: 100 },
    ],
  };
  const stocks = [
    { symbol: "600519", currency: "CNY", price: 1200, change: 1 },
    { symbol: "AAPL", currency: "USD", price: 110, change: -2 },
  ];
  const snapshot = calculatePortfolioSnapshot(portfolio, stocks, 7);
  assert.equal(snapshot.totalValue, 2970);
  assert.equal(snapshot.investedValue, 1970);
  assert.equal(snapshot.totalCost, 1700);
  assert.equal(snapshot.marketValues.cn, 1200);
  assert.equal(snapshot.marketValues.us, 770);
});

test("today profit uses current price minus previous close instead of multiplying current value by return", () => {
  const portfolio = {
    id: "core",
    cash: 0,
    positions: [{ symbol: "600519", quantity: 2, cost: 90 }],
  };
  const stocks = [
    { symbol: "600519", currency: "CNY", price: 110, previousClose: 100, change: 10 },
  ];

  const snapshot = calculatePortfolioSnapshot(portfolio, stocks, 1);

  assert.equal(snapshot.dailyChange, 20);
  assert.equal(snapshot.dailyReturnRate, 10);
});

test("each holding exposes purchase-price profit separately from today's move", () => {
  const result = calculatePositionSnapshot(
    { symbol: "AAPL", quantity: 2, cost: 100 },
    { symbol: "AAPL", currency: "USD", price: 120, previousClose: 115 },
    7,
  );

  assert.equal(result.costValue, 1400);
  assert.equal(result.marketValue, 1680);
  assert.equal(result.profit, 280);
  assert.equal(result.returnRate, 20);
  assert.equal(result.dailyProfit, 70);
});

test("a custom holding requires either a positive share count or a positive investment amount", () => {
  const stock = { symbol: "AAPL", currency: "USD", price: 200 };
  assert.deepEqual(createPositionFromPurchase(stock, { mode: "quantity", quantity: "3", cost: "190" }), {
    symbol: "AAPL",
    quantity: 3,
    cost: 190,
  });
  assert.deepEqual(createPositionFromPurchase(stock, { mode: "amount", amount: "1000", cost: "200" }), {
    symbol: "AAPL",
    quantity: 5,
    cost: 200,
  });
  assert.throws(() => createPositionFromPurchase(stock, { mode: "quantity", quantity: "0", cost: "200" }), /股数/);
  assert.throws(() => createPositionFromPurchase(stock, { mode: "amount", amount: "", cost: "200" }), /金额/);
});

test("legacy demonstration portfolios are removed while user-created portfolios are preserved", () => {
  const portfolios = [
    { id: "core", name: "核心长期组合", cash: 1000, positions: [] },
    { id: "ai-growth", name: "AI 成长实验", cash: 1000, positions: [] },
    { id: "portfolio-user", name: "我的红利组合", cash: 0, positions: [] },
  ];
  assert.deepEqual(migrateLegacyDemoPortfolios(portfolios, defaults), [portfolios[2]]);
  assert.deepEqual(migrateLegacyDemoPortfolios(portfolios.slice(0, 2), defaults), defaults);
});
