import { CAPABILITY_LABELS, managerWeightsFor, resolvePortfolioManager } from "./portfolio-managers.js";

const FACTOR_LABELS = Object.freeze({
  macro: "宏观周期",
  timing: "市场择时",
  sector: "行业轮动",
  sentiment: "投资者情绪",
  technical: "价格与技术",
});

const PROCESS_BLUEPRINT = Object.freeze([
  { id: "screen", label: "筛选", description: "确认投资范围与硬门槛" },
  { id: "research", label: "研究", description: "采集决策所需事实并标记缺口" },
  { id: "challenge", label: "反方挑战", description: "记录最强反例、失败情景与可证伪条件" },
  { id: "decide", label: "决策", description: "输出明确动作、证据等级和仓位边界" },
  { id: "monitor", label: "监控", description: "维护论文假设、红线与下次复核" },
]);

const DATA_AXIS = Object.freeze([
  { id: "macro", label: "宏观事实", capabilities: ["macro"] },
  { id: "market", label: "市场状态", capabilities: ["timing", "sentiment", "technical"] },
  { id: "sector", label: "行业与资金", capabilities: ["sector", "capitalFlow"] },
  { id: "company", label: "公司与估值", capabilities: ["businessQuality", "fundamentals", "growth", "valuation"] },
  { id: "portfolio", label: "组合与风险", capabilities: ["portfolio", "risk"] },
]);

function geometryEmphasis(manager, layer, decisionStage) {
  const hardGate = layer.capabilities.some((id) => manager.hardGateCapabilities.includes(id));
  const required = layer.capabilities.some((id) => manager.requiredCapabilities.includes(id));
  const marketBias = layer.id === "market"
    ? Math.max(Number(manager.factorBias.timing || 1), Number(manager.factorBias.sentiment || 1), Number(manager.factorBias.technical || 1))
    : layer.id === "macro" ? Number(manager.factorBias.macro || 1)
      : layer.id === "sector" ? Number(manager.factorBias.sector || 1) : 1;
  if ((hardGate && ["research", "challenge", "decide"].includes(decisionStage))
    || (marketBias >= 1.3 && ["screen", "research", "decide", "monitor"].includes(decisionStage))) return "primary";
  if (hardGate || required || marketBias >= 1.05 || (layer.id === "portfolio" && ["decide", "monitor"].includes(decisionStage))) return "supporting";
  return "context";
}

export function buildManagerDecisionGeometry(managerId, { availableCapabilities = [], evidence = assessEvidenceQuality() } = {}) {
  const manager = resolvePortfolioManager(managerId);
  const workflow = buildManagerDecisionWorkflow(manager.id, availableCapabilities, evidence);
  const dataAxis = DATA_AXIS.map(({ capabilities, ...layer }) => ({ ...layer }));
  const decisionAxis = PROCESS_BLUEPRINT.map(({ ...step }) => step);
  return {
    managerId: manager.id,
    framework: {
      investorSkills: "persona-blueprint",
      augur: "factor-attribution",
      aiBerkshire: "evidence-gate",
    },
    dataAxis,
    decisionAxis,
    workflow,
    cells: DATA_AXIS.flatMap((layer) => PROCESS_BLUEPRINT.map((step) => ({
      dataLayer: layer.id,
      decisionStage: step.id,
      emphasis: geometryEmphasis(manager, layer, step.id),
    }))),
  };
}

export function managerContractFor(managerId) {
  const manager = resolvePortfolioManager(managerId);
  return {
    ...manager,
    decisionProcess: PROCESS_BLUEPRINT.map((step) => ({ ...step })),
  };
}

export function managerFactorContributions(baseWeights, managerId, preferences = {}) {
  const manager = resolvePortfolioManager(managerId);
  const weights = managerWeightsFor(baseWeights, manager.id, preferences);
  return Object.keys(baseWeights).map((id) => ({
    id,
    label: FACTOR_LABELS[id] || id,
    baseWeight: Number(baseWeights[id]) || 0,
    bias: Number(manager.factorBias[id] ?? 1),
    weight: Number(weights[id]) || 0,
  }));
}

export function relativeSourceDifference(first, second) {
  const a = Number(first);
  const b = Number(second);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const denominator = Math.max(Math.abs(a), Math.abs(b));
  return denominator === 0 ? 0 : Math.abs(a - b) / denominator;
}

function independentSourcesFor(fact) {
  const providers = new Set();
  return (fact?.sources || []).filter((source) => {
    const provider = String(source?.provider || source?.url || "").trim().toLowerCase();
    if (!provider || providers.has(provider)) return false;
    providers.add(provider);
    return true;
  });
}

export function assessEvidenceQuality({ criticalFacts = [], requiredFactIds = [], conflictTolerance = 0.01 } = {}) {
  if (!criticalFacts.length) {
    return { grade: "C", status: "insufficient", primarySourcePresent: false, dualSourceVerified: false, conflicts: [], missing: ["critical-facts"] };
  }

  const conflicts = [];
  const missing = [];
  const presentFactIds = new Set(criticalFacts.filter((fact) => fact?.sources?.length).map((fact) => fact.id));
  const absentCriticalFacts = requiredFactIds.filter((id) => !presentFactIds.has(id));
  let primarySourcePresent = true;
  let dualSourceVerified = true;
  for (const fact of criticalFacts) {
    const sources = independentSourcesFor(fact);
    if (!sources.some(({ authority }) => authority === "primary")) primarySourcePresent = false;
    if (sources.length < 2) {
      dualSourceVerified = false;
      missing.push(fact.id);
      continue;
    }
    const difference = relativeSourceDifference(sources[0].value, sources[1].value);
    if (difference != null && difference > conflictTolerance) {
      conflicts.push({ id: fact.id, difference, sources: sources.slice(0, 2) });
    }
  }

  if (conflicts.length) {
    return { grade: "C", status: "conflict", primarySourcePresent, dualSourceVerified, conflicts, missing };
  }
  if (absentCriticalFacts.length) {
    return { grade: "C", status: "insufficient", primarySourcePresent, dualSourceVerified: false, conflicts, missing: [...new Set([...missing, ...absentCriticalFacts])] };
  }
  if (primarySourcePresent && dualSourceVerified) {
    return { grade: "A", status: "verified", primarySourcePresent, dualSourceVerified, conflicts, missing };
  }
  return { grade: "B", status: "unverified", primarySourcePresent, dualSourceVerified, conflicts, missing };
}

export function buildManagerDecisionWorkflow(managerId, availableCapabilities = [], evidence = assessEvidenceQuality()) {
  const contract = managerContractFor(managerId);
  const available = new Set(availableCapabilities);
  const missingHardGates = contract.hardGateCapabilities.filter((capability) => !available.has(capability));
  const missingRequired = contract.requiredCapabilities.filter((capability) => !available.has(capability));
  const evidenceBlocked = evidence.status !== "verified";
  const canBuy = missingHardGates.length === 0 && !evidenceBlocked;
  const steps = contract.decisionProcess.map((step) => {
    let status = "ready";
    if (step.id === "research" && missingRequired.length) status = "waiting";
    if (step.id === "challenge" && evidence.status !== "verified") status = "waiting";
    if (step.id === "decide" && !canBuy) status = "blocked";
    if (step.id === "monitor") status = "pending";
    return { ...step, status };
  });
  return {
    managerId: contract.id,
    canBuy,
    evidenceBlocked,
    evidence,
    missingRequired,
    missingRequiredLabels: missingRequired.map((id) => CAPABILITY_LABELS[id] || id),
    missingHardGates,
    missingHardGateLabels: missingHardGates.map((id) => CAPABILITY_LABELS[id] || id),
    steps,
  };
}

export function calculateThesisHealth({ assumptions = [], redLines = [] } = {}) {
  if (!assumptions.length) {
    return { score: null, label: "尚未建立论文基线", redLineTriggered: false, action: "先记录3–7条核心假设与红线" };
  }
  const counts = { weakened: 0, damaged: 0, broken: 0 };
  for (const assumption of assumptions) {
    if (Object.hasOwn(counts, assumption?.status)) counts[assumption.status] += 1;
  }
  const redLineCount = redLines.filter(({ triggered }) => triggered).length;
  const score = Math.min(10, Math.max(1, 10 - counts.broken * 3 - counts.damaged * 2 - counts.weakened - redLineCount * 5));
  const label = score >= 8 ? "论文有效" : score >= 6 ? "边际弱化" : score >= 3 ? "论文受损" : "论文破裂";
  return {
    score,
    label,
    redLineTriggered: redLineCount > 0,
    counts,
    action: redLineCount || score <= 2 ? "立即重新评估" : score <= 5 ? "停止加仓并补充验证" : "按计划复核",
  };
}
