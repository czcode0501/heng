import test from "node:test";
import assert from "node:assert/strict";

import { getSearchResultActions, getTrendPresentation } from "../search-flow.js";

test("search results always allow analysis without mutating the portfolio", () => {
  const portfolio = { positions: [] };
  const stock = { symbol: "000410", name: "沈阳机床" };

  const actions = getSearchResultActions(portfolio, stock);

  assert.deepEqual(actions, {
    canViewAnalysis: true,
    canAdd: true,
    addLabel: "添加",
  });
  assert.deepEqual(portfolio.positions, []);
});

test("an already-held stock remains analyzable and cannot be added twice", () => {
  const portfolio = { positions: [{ symbol: "000410" }] };

  const actions = getSearchResultActions(portfolio, { symbol: "000410" });

  assert.equal(actions.canViewAnalysis, true);
  assert.equal(actions.canAdd, false);
  assert.equal(actions.addLabel, "已持有");
});

test("trend codes are converted into honest user-facing analysis", () => {
  assert.deepEqual(getTrendPresentation("strong_up"), {
    label: "趋势偏强",
    tone: "positive",
    summary: "价格位于20日与60日均线上方，短中期趋势保持正向。",
  });
});
