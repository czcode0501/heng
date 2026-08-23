import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_PORTFOLIO_MANAGER_ID,
  PORTFOLIO_MANAGERS,
  applyManagerExposurePolicy,
  assignPortfolioManager,
  managerWeightsFor,
  resolvePortfolioManager,
  managerAllocationRangeFor,
} from "../portfolio-managers.js";
import { renderPortfolioManagerPanel } from "../portfolio-manager-view.js";
import { buildStockDecision } from "../signals/stock-analysis/decision.js";
import { renderStockAnalysisMarkup } from "../signals/stock-analysis/view.js";

const payload = {
  providerSymbol: "AAPL",
  price: 209,
  currency: "USD",
  range: "3m",
  analysis: {
    trend: "up",
    rsi14: 54,
    macdHistogram: 0.4,
    rangePosition: 42,
    atr14: 4,
    sampleDays: 65,
  },
  chart: {
    candles: [],
    profile: {
      supportLevels: [{ low: 206, high: 210, midpoint: 208, source: "VRVP高成交节点" }],
      resistanceLevels: [{ low: 221, high: 224, midpoint: 222.5, source: "VRVP高成交节点" }],
      bins: [],
      vacuumZones: [],
    },
    indicatorConfig: {},
    dataWindow: {},
  },
};

const liveContext = {
  macro: { regime: "扩张阶段", stance: "偏进取", confidence: 86 },
  timing: { score: 72, label: "进攻", exposureBand: "80%–100%", confidence: "高" },
  sector: { title: "信息技术", score: 82, phase: "领先", flowScore: 60, flowState: "资金确认" },
  sentiment: { score: 60, phase: "健康风险偏好", tone: "positive" },
  companyProfile: { sector: "信息技术" },
};

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("manager catalog exposes distinct, switchable investment mandates", () => {
  assert.ok(PORTFOLIO_MANAGERS.length >= 7);
  assert.equal(new Set(PORTFOLIO_MANAGERS.map(({ id }) => id)).size, PORTFOLIO_MANAGERS.length);
  assert.equal(resolvePortfolioManager("missing").id, DEFAULT_PORTFOLIO_MANAGER_ID);
  assert.match(resolvePortfolioManager("buffett").focus.join(" "), /护城河|安全边际/);
  assert.match(resolvePortfolioManager("dalio").focus.join(" "), /宏观|风险平价/);
});

test("every named manager exposes auditable methodology sources", () => {
  const namedManagers = PORTFOLIO_MANAGERS.filter(({ id }) => id !== DEFAULT_PORTFOLIO_MANAGER_ID);

  for (const manager of namedManagers) {
    assert.ok(Array.isArray(manager.sources), `${manager.name} should expose sources`);
    assert.ok(manager.sources.length >= 2, `${manager.name} should have at least two sources`);
    assert.ok(manager.sources.some(({ authority }) => authority?.startsWith("primary")), `${manager.name} should have primary material`);
    for (const source of manager.sources) {
      assert.match(source.url, /^https:\/\//);
      assert.ok(source.title);
      assert.ok(source.supports?.length);
    }
  }
});

test("manager catalog carries execution cadence, evidence policy, sizing and monitoring rules", () => {
  for (const manager of PORTFOLIO_MANAGERS) {
    assert.ok(manager.decisionCadence, `${manager.name} should define a decision cadence`);
    assert.ok(manager.universe?.assetClasses?.length, `${manager.name} should define an investable universe`);
    assert.equal(manager.evidencePolicy?.conflictTolerance, 0.01);
    assert.ok(manager.sizingPolicy?.initialPosition, `${manager.name} should define initial sizing`);
    assert.ok(manager.monitoringPolicy?.reviewCadence, `${manager.name} should define review cadence`);
  }
});

test("manager factor weights remain normalized and materially change the decision lens", () => {
  const base = { macro: 15, timing: 20, sector: 25, sentiment: 10, technical: 30 };
  const buffett = managerWeightsFor(base, "buffett");
  const soros = managerWeightsFor(base, "soros");

  assert.equal(Object.values(buffett).reduce((sum, value) => sum + value, 0), 100);
  assert.equal(Object.values(soros).reduce((sum, value) => sum + value, 0), 100);
  assert.ok(buffett.technical < soros.technical);
  assert.ok(soros.timing > buffett.timing);
});

test("manager risk policy changes the target exposure without hiding the baseline evidence", () => {
  const baseline = { value: 70, label: "基准 65 · 板块 +5", breakdown: { marketBasePct: 65 } };
  const buffett = applyManagerExposurePolicy(baseline, "buffett");
  const marks = applyManagerExposurePolicy(baseline, "marks");

  assert.ok(buffett.value > marks.value);
  assert.match(buffett.label, /巴菲特/);
  assert.match(marks.label, /霍华德·马克斯/);
  assert.deepEqual(buffett.breakdown, baseline.breakdown);
});

test("risk capacity changes exposure and allocation while target return raises the hurdle", () => {
  const baseline = { value: 65, label: "市场基准", breakdown: { marketBasePct: 65 } };
  const lowRisk = applyManagerExposurePolicy(baseline, "soros", { targetReturn: 25, riskCapacity: 10 });
  const highRisk = applyManagerExposurePolicy(baseline, "soros", { targetReturn: 10, riskCapacity: 90 });

  assert.ok(highRisk.value > lowRisk.value);
  assert.match(lowRisk.label, /目标年化25%/);
});

test("the same stock advice follows target return and risk capacity", () => {
  const conservative = buildStockDecision(payload, {
    ...liveContext,
    managerId: "soros",
    analysisPreferences: { targetReturn: 30, riskCapacity: 10 },
  });
  const aggressive = buildStockDecision(payload, {
    ...liveContext,
    managerId: "soros",
    analysisPreferences: { targetReturn: 8, riskCapacity: 90 },
  });

  assert.notEqual(conservative.composite.score, aggressive.composite.score);
  assert.notEqual(conservative.allocation, aggressive.allocation);
  assert.match(conservative.tradePlan.hurdleLabel, /目标回报门槛/);
});

test("manager allocation exposes a numeric range for executable position sizing", () => {
  const range = managerAllocationRangeFor("marks", {
    actionVerb: "买入",
    riskConstrainedEnvironment: true,
    analysisPreferences: { targetReturn: 12, riskCapacity: 50 },
  });

  assert.deepEqual(range, { lowPct: 5, highPct: 8, maxRiskPct: 0.25 });
  assert.equal(managerAllocationRangeFor("marks", { actionVerb: "等待" }), null);
  assert.equal(managerAllocationRangeFor("dalio", { actionVerb: "买入" }), null);
});

test("a portfolio owns one normalized manager selection", () => {
  const original = { id: "core", name: "核心组合", managerId: "marks", positions: [] };
  const changed = assignPortfolioManager(original, "dalio");
  const normalized = assignPortfolioManager(original, "not-a-manager");

  assert.equal(changed.managerId, "dalio");
  assert.equal(normalized.managerId, DEFAULT_PORTFOLIO_MANAGER_ID);
  assert.equal(original.managerId, "marks");
});

test("fundamental managers wait when required valuation evidence is absent", () => {
  const quant = buildStockDecision(payload, { ...liveContext, managerId: "quant-balanced" });
  const buffett = buildStockDecision(payload, { ...liveContext, managerId: "buffett" });

  assert.equal(quant.action.verb, "买入");
  assert.equal(buffett.action.verb, "等待");
  assert.equal(buffett.manager.id, "buffett");
  assert.match(buffett.manager.missingLabels.join(" "), /财务质量|估值/);
  assert.notEqual(buffett.weightMethod, quant.weightMethod);
});

test("the same bullish evidence produces materially different manager recommendations", () => {
  const decisions = PORTFOLIO_MANAGERS.map((manager) => ({
    manager,
    decision: buildStockDecision(payload, { ...liveContext, managerId: manager.id }),
  }));
  const actionCodes = new Set(decisions.map(({ decision }) => decision.action.code));
  const executableAllocations = new Set(
    decisions
      .filter(({ decision }) => !decision.manager.constrained)
      .map(({ decision }) => decision.allocation),
  );
  const scores = decisions.map(({ decision }) => decision.composite.score);

  assert.ok(actionCodes.size >= 6, `expected >=6 action variants, received ${actionCodes.size}`);
  assert.ok(executableAllocations.size >= 3, `expected >=3 executable allocation variants, received ${executableAllocations.size}`);
  const dalio = decisions.find(({ manager }) => manager.id === "dalio").decision;
  assert.equal(dalio.action.verb, "等待");
  assert.equal(dalio.action.code, "dalio-portfolio-risk-input");
  assert.ok(Math.max(...scores) - Math.min(...scores) >= 3);
  assert.deepEqual(new Set(decisions.map(({ decision }) => decision.action.verb)), new Set(["买入", "等待"]));
});

test("cycle conflict separates Marks defensiveness from Soros trend participation", () => {
  const cycleConflict = {
    ...liveContext,
    macro: { regime: "增长放缓", stance: "偏防守", confidence: 78 },
    timing: { score: 64, label: "偏强", exposureBand: "60%–80%", confidence: "中" },
    sector: { title: "信息技术", score: 76, phase: "领先", flowScore: 57, flowState: "资金确认" },
    sentiment: { score: 78, phase: "拥挤", tone: "warning" },
  };
  const marks = buildStockDecision(payload, { ...cycleConflict, managerId: "marks" });
  const dalio = buildStockDecision(payload, { ...cycleConflict, managerId: "dalio" });
  const soros = buildStockDecision(payload, { ...cycleConflict, managerId: "soros" });

  assert.equal(marks.action.verb, "等待");
  assert.equal(soros.action.verb, "买入");
  assert.notEqual(marks.action.code, dalio.action.code);
  assert.notEqual(dalio.action.code, soros.action.code);
  assert.notEqual(dalio.allocation, soros.allocation);
});

test("a company data conflict above one percent blocks an otherwise executable buy", () => {
  const baseline = buildStockDecision(payload, { ...liveContext, managerId: "quant-balanced" });
  const conflicted = buildStockDecision(payload, {
    ...liveContext,
    managerId: "quant-balanced",
    companyResearchInsight: {
      capabilities: ["fundamentals"],
      evidence: { status: "conflict", conflicts: [{ id: "freeCashFlow", difference: 0.02 }] },
    },
  });

  assert.equal(baseline.action.verb, "买入");
  assert.equal(conflicted.action.verb, "等待");
  assert.equal(conflicted.action.code, "company-source-conflict");
  assert.match(conflicted.action.summary, /超过1%/);
});

test("portfolio manager panel and stock analysis expose the active methodology accessibly", () => {
  const panel = renderPortfolioManagerPanel("marks", { portfolioName: "稳健组合" });
  assert.match(panel, /<details class="manager-workbench-details">/);
  assert.match(panel, /<summary[^>]*>.*查看完整方法/s);
  assert.match(panel, /data-portfolio-manager-select/);
  assert.match(panel, /aria-describedby="portfolio-manager-method"/);
  assert.match(panel, /霍华德·马克斯/);
  assert.match(panel, /selected/);
  assert.match(panel, /稳健组合/);

  const analysis = renderStockAnalysisMarkup(payload, {
    holdingPeriod: "3m",
    context: { ...liveContext, managerId: "marks" },
  });
  assert.match(analysis, /投资方法/);
  assert.match(analysis, /霍华德·马克斯/);
  assert.match(analysis, /数据覆盖/);
  assert.match(analysis, /公开方法论映射.*非本人观点.*非授权.*非真实持仓.*非收益承诺/);
});

test("manager identity is primary while method remains a clear explanation", () => {
  const panel = renderPortfolioManagerPanel("buffett");
  assert.match(panel, /当前投资经理/);
  assert.ok(panel.indexOf("沃伦·巴菲特") < panel.indexOf("质量价值"));
  assert.match(panel, /质量价值/);
  assert.match(panel, /warren-buffett-avatar/);
  assert.match(panel, /alt="沃伦·巴菲特头像"/);
  assert.match(panel, /切换投资经理/);
  assert.match(panel, /第一次选择/);
  assert.match(panel, /不是适当性建议/);
});

test("dashboard wires the manager panel to portfolio state and responsive styling", () => {
  assert.match(indexSource, /id="portfolio-manager-panel"/);
  assert.match(appSource, /renderPortfolioManagerPanel/);
  assert.match(appSource, /data-portfolio-manager-select/);
  assert.match(appSource, /assignPortfolioManager/);
  assert.match(styles, /\.portfolio-manager-panel\s*\{/);
  assert.match(styles, /\.manager-select-field select\s*\{[^}]*appearance:\s*none/s);
  assert.match(styles, /@media \(max-width:\s*760px\)[\s\S]*\.portfolio-manager-panel/s);
  assert.match(styles, /html\s*\{[^}]*overflow-x:\s*hidden/s);
});
