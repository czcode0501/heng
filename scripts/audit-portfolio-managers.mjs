import {
  PORTFOLIO_MANAGERS,
  applyManagerExposurePolicy,
} from "../portfolio-managers.js";
import { buildStockDecision } from "../signals/stock-analysis/decision.js";

const basePayload = {
  providerSymbol: "AUDIT",
  price: 209,
  currency: "USD",
  range: "3m",
  analysis: { trend: "up", rsi14: 54, macdHistogram: 0.4, rangePosition: 42, atr14: 4, sampleDays: 65 },
  chart: {
    candles: [],
    profile: {
      supportLevels: [{ low: 206, high: 210, midpoint: 208, source: "审计支撑" }],
      resistanceLevels: [{ low: 221, high: 224, midpoint: 222.5, source: "审计压力" }],
      bins: [],
      vacuumZones: [],
    },
    indicatorConfig: {},
    dataWindow: {},
  },
};

const scenarios = [
  {
    id: "bullish-support",
    label: "强势支撑",
    payload: basePayload,
    context: {
      macro: { regime: "扩张阶段", stance: "偏进取", confidence: 86 },
      timing: { score: 72, label: "进攻", exposureBand: "80%–100%", confidence: "高" },
      sector: { title: "信息技术", score: 82, phase: "领先", flowScore: 60, flowState: "资金确认" },
      sentiment: { score: 60, phase: "健康风险偏好", tone: "positive" },
      companyProfile: { sector: "信息技术" },
    },
  },
  {
    id: "cycle-conflict",
    label: "周期冲突",
    payload: basePayload,
    context: {
      macro: { regime: "增长放缓", stance: "偏防守", confidence: 78 },
      timing: { score: 64, label: "偏强", exposureBand: "60%–80%", confidence: "中" },
      sector: { title: "信息技术", score: 76, phase: "领先", flowScore: 57, flowState: "资金确认" },
      sentiment: { score: 78, phase: "拥挤", tone: "warning" },
      companyProfile: { sector: "信息技术" },
    },
  },
  {
    id: "held-breakdown",
    label: "持仓破位",
    payload: {
      ...basePayload,
      price: 198,
      analysis: { ...basePayload.analysis, trend: "down", rsi14: 34, macdHistogram: -0.8, rangePosition: 18 },
    },
    context: {
      held: true,
      macro: { regime: "增长放缓", stance: "中性", confidence: 70 },
      timing: { score: 35, label: "防守", exposureBand: "20%–40%", confidence: "中" },
      sector: { title: "信息技术", score: 36, phase: "落后", flowScore: 31, flowState: "资金流出" },
      sentiment: { score: 32, phase: "谨慎降温", tone: "negative" },
      companyProfile: { sector: "信息技术" },
    },
  },
  {
    id: "neutral-midrange",
    label: "中性区间",
    payload: {
      ...basePayload,
      price: 216,
      analysis: { ...basePayload.analysis, trend: "neutral", rsi14: 51, macdHistogram: 0.02, rangePosition: 58 },
    },
    context: {
      macro: { regime: "温和增长", stance: "中性", confidence: 65 },
      timing: { score: 52, label: "中性", exposureBand: "40%–60%", confidence: "中" },
      sector: { title: "信息技术", score: 54, phase: "中性", flowScore: 49, flowState: "资金平衡" },
      sentiment: { score: 52, phase: "中性", tone: "neutral" },
      companyProfile: { sector: "信息技术" },
    },
  },
];

function allocationMidpoint(label) {
  const match = String(label).match(/首笔(\d+)%–(\d+)%/);
  return match ? (Number(match[1]) + Number(match[2])) / 2 : null;
}

function differenceIndex(left, right) {
  let difference = left.verb === right.verb ? 0 : 30;
  if (left.code !== right.code) difference += 10;
  difference += Math.min(20, Math.abs(left.score - right.score) * 2);
  difference += Math.min(15, Math.abs(left.targetExposure - right.targetExposure) * 1.5);
  if (left.allocationMidpoint == null !== (right.allocationMidpoint == null)) difference += 20;
  else if (left.allocationMidpoint != null && right.allocationMidpoint != null) {
    difference += Math.min(20, Math.abs(left.allocationMidpoint - right.allocationMidpoint) * 1.5);
  }
  return Math.round(Math.min(100, difference) * 10) / 10;
}

const results = scenarios.flatMap((scenario) => PORTFOLIO_MANAGERS.map((manager) => {
  const decision = buildStockDecision(scenario.payload, { ...scenario.context, managerId: manager.id });
  const exposure = applyManagerExposurePolicy({ value: 70, label: "统一70%基准" }, manager.id);
  return {
    scenarioId: scenario.id,
    scenario: scenario.label,
    managerId: manager.id,
    manager: manager.name,
    verb: decision.action.verb,
    code: decision.action.code,
    score: decision.composite.score,
    allocation: decision.allocation,
    allocationMidpoint: allocationMidpoint(decision.allocation),
    targetExposure: exposure.value,
    managerCoverage: decision.manager.coverage,
    missingEvidence: decision.manager.missingLabels,
  };
}));

const baselineByScenario = new Map(
  results.filter(({ managerId }) => managerId === "quant-balanced").map((row) => [row.scenarioId, row]),
);
const managerSummary = PORTFOLIO_MANAGERS.map((manager) => {
  const rows = results.filter(({ managerId }) => managerId === manager.id);
  const differences = rows.map((row) => differenceIndex(row, baselineByScenario.get(row.scenarioId)));
  return {
    managerId: manager.id,
    manager: manager.name,
    averageDifferenceFromQuant: Math.round(differences.reduce((sum, value) => sum + value, 0) / differences.length * 10) / 10,
    actionFingerprint: rows.map(({ scenario, verb, code }) => `${scenario}:${verb}/${code}`).join(" | "),
  };
});

const scenarioSummary = scenarios.map((scenario) => {
  const rows = results.filter(({ scenarioId }) => scenarioId === scenario.id);
  const scores = rows.map(({ score }) => score);
  const allocations = rows.map(({ allocationMidpoint }) => allocationMidpoint).filter((value) => value != null);
  const exposures = rows.map(({ targetExposure }) => targetExposure);
  return {
    scenario: scenario.label,
    uniqueVerbs: new Set(rows.map(({ verb }) => verb)).size,
    uniqueActionCodes: new Set(rows.map(({ code }) => code)).size,
    scoreSpread: Math.round((Math.max(...scores) - Math.min(...scores)) * 10) / 10,
    allocationMidpointRange: allocations.length ? `${Math.min(...allocations)}%–${Math.max(...allocations)}%` : "无新增仓位",
    targetExposureRange: `${Math.min(...exposures)}%–${Math.max(...exposures)}%`,
  };
});

const audit = { metricVersion: 1, scenarios: scenarioSummary, managers: managerSummary, results };

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(audit, null, 2));
} else {
  console.table(scenarioSummary);
  console.table(managerSummary.map(({ manager, averageDifferenceFromQuant }) => ({ manager, averageDifferenceFromQuant })));
  console.table(results.filter(({ scenarioId }) => scenarioId === "bullish-support").map((row) => ({
    manager: row.manager,
    score: row.score,
    verb: row.verb,
    code: row.code,
    allocation: row.allocationMidpoint == null ? "—" : `${row.allocationMidpoint}%`,
    targetExposure: `${row.targetExposure}%`,
  })));
}

