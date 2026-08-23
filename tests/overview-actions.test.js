import test from "node:test";
import assert from "node:assert/strict";

import { buildOverviewActionModel, renderOverviewActionPanel } from "../overview-actions.js";

test("empty custom portfolio starts with research while keeping broker access visible", () => {
  const model = buildOverviewActionModel({
    mode: "custom",
    portfolioName: "我的自建组合",
    positionCount: 0,
    cash: 0,
    broker: { state: "not-configured" },
  });

  assert.equal(model.action, "先研究，再建仓");
  assert.equal(model.tone, "neutral");
  assert.match(model.broker.detail, /IBKR|QMT/);

  const html = renderOverviewActionPanel(model);
  assert.match(html, /今日交易工作台/);
  assert.match(html, /现在怎么做/);
  assert.match(html, /找机会/);
  assert.match(html, /管理真实账户/);
  assert.match(html, /href="#data-sources"/);
});

test("overweight portfolio receives a concrete reduction amount instead of a vague warning", () => {
  const model = buildOverviewActionModel({
    mode: "custom",
    portfolioName: "测试组合",
    positionCount: 3,
    investedValue: 80_000,
    totalValue: 100_000,
    cash: 20_000,
    targetExposurePct: 55,
    riskLabel: "高仓位风险",
    riskDetail: "高于目标25个百分点",
    broker: { state: "ready", positionCount: 4 },
  });

  assert.equal(model.action, "优先降低仓位");
  assert.equal(model.tone, "negative");
  assert.equal(model.adjustmentAmount, 25_000);
  assert.match(model.actionDetail, /约 ¥25,000/);
  assert.match(model.broker.label, /已连接/);
});

test("broker mode keeps real-account authority and recovery state explicit", () => {
  const model = buildOverviewActionModel({
    mode: "broker",
    broker: {
      state: "cached",
      positionCount: 6,
      currentExposurePct: 68,
      targetExposurePct: 52,
      riskLabel: "仓位偏高",
      riskDetail: "高于目标16个百分点",
    },
  });

  assert.equal(model.sourceLabel, "IBKR 只读真实账户");
  assert.equal(model.action, "优先复核真实持仓");
  assert.match(model.broker.detail, /上次成功快照/);
  assert.match(renderOverviewActionPanel(model), /不会改成模拟持仓/);
});
