import { resolvePortfolioManager } from "./portfolio-managers.js";
import { classifySentimentPhase } from "./signals/investor-sentiment/model.js";

export const DEFAULT_ANALYSIS_PREFERENCES = Object.freeze({
  targetReturn: 12,
  riskCapacity: 50,
});

const SCOPE_FACTORS = Object.freeze({
  macro: "macro",
  "market-timing": "timing",
  "sector-rotation": "sector",
  "investor-sentiment": "sentiment",
  "capital-flow": "sector",
  "stock-analysis": "technical",
});

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function preferenceValue(value, fallback) {
  const number = Number(value);
  return clamp(Number.isFinite(number) ? number : fallback);
}

export function normalizeAnalysisPreferences(value = {}) {
  return {
    targetReturn: preferenceValue(value.targetReturn, DEFAULT_ANALYSIS_PREFERENCES.targetReturn),
    riskCapacity: preferenceValue(value.riskCapacity, DEFAULT_ANALYSIS_PREFERENCES.riskCapacity),
  };
}

export function buildPortfolioAnalysisProfile(value = {}) {
  const manager = resolvePortfolioManager(value.managerId);
  return {
    managerId: manager.id,
    managerName: manager.name,
    manager,
    ...normalizeAnalysisPreferences(value),
  };
}

export function profileSignalScore(rawScore, scope, profileValue = {}) {
  const raw = Number(rawScore);
  if (!Number.isFinite(raw)) return rawScore;
  const profile = buildPortfolioAnalysisProfile(profileValue);
  const factor = SCOPE_FACTORS[scope] || "technical";
  const sensitivity = clamp(Number(profile.manager.factorBias?.[factor]) || 1, 0.35, 1.8);
  const riskShift = (profile.riskCapacity - 50) * 0.18;
  const hurdleShift = (profile.targetReturn - DEFAULT_ANALYSIS_PREFERENCES.targetReturn) * 0.12;
  const score = 50 + (raw - 50) * sensitivity + riskShift - hurdleShift;
  return Math.round(clamp(score) * 10) / 10;
}

function profileNode(node, scope, profile) {
  if (Array.isArray(node)) return node.map((item) => profileNode(item, scope, profile));
  if (!node || typeof node !== "object") return node;
  const result = {};
  for (const [key, value] of Object.entries(node)) {
    const numeric = typeof value === "number" && Number.isFinite(value);
    const isDerivedScore = numeric
      && !key.startsWith("raw")
      && (key === "score" || key === "confidence" || /Score$/.test(key));
    if (isDerivedScore) {
      const rawKey = key === "averageScore"
        ? "rawAverageScore"
        : key === "confidence"
          ? "rawConfidence"
          : key === "score"
            ? "rawScore"
            : `raw${key[0].toUpperCase()}${key.slice(1)}`;
      result[rawKey] = value;
      result[key] = profileSignalScore(value, scope, profile);
    } else {
      result[key] = profileNode(value, scope, profile);
    }
  }
  return result;
}

function roundOne(value) {
  return Math.round(Number(value) * 10) / 10;
}

function weightedScore(items, fallback) {
  const valid = (Array.isArray(items) ? items : []).filter((item) => Number.isFinite(Number(item?.score)) && Number.isFinite(Number(item?.weight)));
  const totalWeight = valid.reduce((sum, item) => sum + Number(item.weight), 0);
  if (!totalWeight) return Number(fallback);
  return roundOne(valid.reduce((sum, item) => sum + Number(item.score) * Number(item.weight), 0) / totalWeight);
}

function timingRegime(score) {
  if (score >= 70) return { label: "进攻", tone: "strong-positive", exposureBand: "80%–100%" };
  if (score >= 58) return { label: "偏多", tone: "positive", exposureBand: "60%–80%" };
  if (score >= 43) return { label: "中性", tone: "neutral", exposureBand: "40%–60%" };
  if (score >= 30) return { label: "防守", tone: "negative", exposureBand: "20%–40%" };
  return { label: "风险规避", tone: "strong-negative", exposureBand: "0%–20%" };
}

function profileMarketTiming(payload) {
  return {
    ...payload,
    markets: (payload.markets || []).map((market) => {
      if (!market?.regime) return market;
      const dimensions = (market.dimensions || []).map((dimension) => ({
        ...dimension,
        rawState: dimension.rawState || dimension.state,
        state: Number(dimension.score) >= 65 ? "积极" : Number(dimension.score) >= 45 ? "中性" : "承压",
      }));
      const score = weightedScore(dimensions, market.regime.score);
      const scores = dimensions.map(({ score: value }) => Number(value)).filter(Number.isFinite);
      const average = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : score;
      const dispersion = scores.length
        ? Math.sqrt(scores.reduce((sum, value) => sum + (value - average) ** 2, 0) / scores.length)
        : 0;
      const strongest = dimensions.reduce((best, item) => !best || Number(item.score) > Number(best.score) ? item : best, null);
      const weakest = dimensions.reduce((best, item) => !best || Number(item.score) < Number(best.score) ? item : best, null);
      return {
        ...market,
        dimensions,
        regime: {
          ...market.regime,
          rawLabel: market.regime.rawLabel || market.regime.label,
          rawExposureBand: market.regime.rawExposureBand || market.regime.exposureBand,
          rawSummary: market.regime.rawSummary || market.regime.summary,
          score,
          ...timingRegime(score),
          confidence: dispersion <= 12 ? "高" : dispersion <= 24 ? "中" : "低",
          summary: strongest && weakest ? `${strongest.title}提供主要支撑，${weakest.title}是当前主要约束。` : market.regime.summary,
        },
      };
    }),
  };
}

function sectorTimingOverlay(score) {
  if (score >= 70) return { regime: "进攻", maxExposure: 80 };
  if (score >= 58) return { regime: "偏多", maxExposure: 60 };
  if (score >= 45) return { regime: "中性", maxExposure: 40 };
  if (score >= 30) return { regime: "偏空", maxExposure: 20 };
  return { regime: "风险关闭", maxExposure: 0 };
}

function profileScoreDelta(rawDelta, scope, profile) {
  const delta = Number(rawDelta);
  if (!Number.isFinite(delta)) return rawDelta;
  return roundOne(profileSignalScore(50 + delta, scope, profile) - profileSignalScore(50, scope, profile));
}

function rotationPhase(sector) {
  const score = Number(sector.score);
  const change = Number(sector.scoreChange) || 0;
  const trend = Number(sector.dimensions?.trendQuality) || 0;
  if (sector.phase?.id === "overheated" && score >= 75 && change <= 0) return { id: "overheated", label: "过热", tone: "warning" };
  if (score >= 70 && trend >= 60 && change >= 0) return { id: "leading", label: "领先", tone: "positive" };
  if (score >= 70) return { id: "strong", label: "强势延续", tone: "positive" };
  if (score < 40 && trend < 45) return { id: "lagging", label: "落后", tone: "negative" };
  if (score < 60 && change >= 2 && trend >= 45) return { id: "repairing", label: "修复", tone: "neutral" };
  if (score < 60 && change <= -2) return { id: "weakening", label: "转弱", tone: "negative" };
  return { id: "neutral", label: "中性", tone: "neutral" };
}

function rotationAction(phase, confidence) {
  if (Number(confidence) < 70) return { id: "watch", label: "数据不足 · 观察" };
  const actions = {
    leading: { id: "increase", label: "增配" },
    strong: { id: "hold", label: "持有" },
    overheated: { id: "trim", label: "防追高 · 减配" },
    weakening: { id: "reduce", label: "减配" },
    lagging: { id: "exit", label: "退出/回避" },
    repairing: { id: "watch", label: "进入观察" },
    neutral: { id: "watch", label: "观察" },
  };
  return actions[phase.id] || actions.neutral;
}

function assignProfiledSectorWeights(sectors, maxExposure) {
  const ranked = sectors.map((sector) => ({ ...sector, targetWeight: 0 }));
  const eligible = ranked
    .filter((sector) => Number(sector.score) >= 60 && Number(sector.confidence) >= 70 && ["increase", "hold"].includes(sector.action?.id))
    .slice(0, 3);
  const strengthSum = eligible.reduce((sum, sector) => sum + Math.max(Number(sector.score) - 50, 0), 0);
  let remaining = Number(maxExposure) || 0;
  if (strengthSum && remaining) {
    for (const eligibleSector of eligible) {
      const sector = ranked.find(({ id }) => id === eligibleSector.id);
      const proposed = maxExposure * Math.max(Number(sector.score) - 50, 0) / strengthSum;
      sector.targetWeight = roundOne(Math.min(30, proposed, remaining));
      remaining = roundOne(remaining - sector.targetWeight);
    }
  }
  for (const sector of ranked) {
    if (!sector.targetWeight && ["increase", "hold"].includes(sector.action?.id)) {
      sector.action = maxExposure
        ? { id: "watch", label: "候补观察" }
        : { id: "watch", label: "风险关闭" };
    }
  }
  return ranked;
}

function profileSectorRotation(payload, profile) {
  return {
    ...payload,
    markets: (payload.markets || []).map((market) => {
      if (!market?.timing || !Array.isArray(market.sectors)) return market;
      const rawTimingScore = market.timing.rawScore ?? market.timing.score;
      const timingScore = profileSignalScore(rawTimingScore, "market-timing", profile);
      const timing = {
        ...market.timing,
        rawRegime: market.timing.rawRegime || market.timing.regime,
        rawMaxExposure: market.timing.rawMaxExposure ?? market.timing.maxExposure,
        score: timingScore,
        ...sectorTimingOverlay(timingScore),
      };
      const classified = market.sectors.map((sector) => {
        const scoreChange = profileScoreDelta(sector.rawScoreChange ?? sector.scoreChange, "sector-rotation", profile);
        const candidate = { ...sector, rawScoreChange: sector.rawScoreChange ?? sector.scoreChange, scoreChange };
        const phase = rotationPhase(candidate);
        return {
          ...candidate,
          rawPhase: sector.rawPhase || sector.phase,
          rawAction: sector.rawAction || sector.action,
          rawTargetWeight: sector.rawTargetWeight ?? sector.targetWeight,
          phase,
          action: rotationAction(phase, sector.confidence),
        };
      });
      const sectors = assignProfiledSectorWeights(classified, timing.maxExposure);
      const allocated = roundOne(sectors.reduce((sum, sector) => sum + Number(sector.targetWeight || 0), 0));
      const leaders = sectors.filter((sector) => ["leading", "strong"].includes(sector.phase?.id));
      const repairing = sectors.filter((sector) => sector.phase?.id === "repairing");
      const weakening = sectors.filter((sector) => ["weakening", "lagging"].includes(sector.phase?.id));
      const leader = leaders[0]?.title || sectors[0]?.title || market.summary?.leader || "暂无";
      return {
        ...market,
        timing,
        sectors,
        summary: {
          ...market.summary,
          rawAllocated: market.summary?.rawAllocated ?? market.summary?.allocated,
          rawCash: market.summary?.rawCash ?? market.summary?.cash,
          rawMessage: market.summary?.rawMessage || market.summary?.message,
          stance: allocated >= 50 ? "进攻" : allocated >= 30 ? "均衡" : allocated > 0 ? "谨慎" : "防守",
          allocated,
          cash: roundOne(100 - allocated),
          leader,
          repairing: repairing[0]?.title || "暂无",
          weakening: weakening[0]?.title || "暂无",
          message: `${leader}当前排名第1；${profile.managerName}方法论允许板块仓位最高${timing.maxExposure}%。`,
        },
      };
    }),
  };
}

function profileSentimentHistory(history, profile) {
  return (Array.isArray(history) ? history : []).map((point) => {
    const rawValue = point.rawValue ?? point.value;
    return { ...point, rawValue, value: profileSignalScore(rawValue, "investor-sentiment", profile) };
  });
}

function profileInvestorSentiment(payload, profile) {
  return {
    ...payload,
    markets: (payload.markets || []).map((market) => {
      const history = profileSentimentHistory(market.history, profile);
      const dimensions = (market.dimensions || []).map((dimension) => {
        const dimensionHistory = profileSentimentHistory(dimension.history, profile);
        return { ...dimension, history: dimensionHistory, score: dimensionHistory.at(-1)?.value ?? dimension.score };
      });
      const score = history.at(-1)?.value ?? market.score;
      const rawImpulse = market.rawImpulse20d ?? market.impulse20d;
      const impulse20d = profileScoreDelta(rawImpulse, "investor-sentiment", profile);
      return {
        ...market,
        history,
        dimensions,
        score,
        rawImpulse20d: rawImpulse,
        impulse20d,
        rawPhase: market.rawPhase || market.phase,
        phase: classifySentimentPhase(Number(score), Number(impulse20d) || 0),
      };
    }),
  };
}

function synchronizeProfiledPayload(scope, payload, profile) {
  if (scope === "market-timing") return profileMarketTiming(payload);
  if (scope === "sector-rotation") return profileSectorRotation(payload, profile);
  if (scope === "investor-sentiment") return profileInvestorSentiment(payload, profile);
  return payload;
}

export function profileSignalPayload(scope, payload, profileValue = {}) {
  if (!payload || typeof payload !== "object") return payload;
  const profile = buildPortfolioAnalysisProfile(profileValue);
  const profiled = synchronizeProfiledPayload(scope, profileNode(payload, scope, profile), profile);
  return {
    ...profiled,
    analysisProfile: {
      managerId: profile.managerId,
      managerName: profile.managerName,
      targetReturn: profile.targetReturn,
      riskCapacity: profile.riskCapacity,
      rawFactsPreserved: true,
    },
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderAnalysisProfileStrip(profileValue = {}) {
  const profile = buildPortfolioAnalysisProfile(profileValue);
  return `<aside class="analysis-profile-strip" aria-label="当前分析档案">
    <div><span>ACTIVE ANALYSIS LENS</span><strong>${escapeHtml(profile.managerName)}方法论</strong></div>
    <dl><div><dt>目标年化回报</dt><dd>${profile.targetReturn}%</dd></div><div><dt>风险承担能力</dt><dd>${profile.riskCapacity}/100</dd></div></dl>
    <p>行情、CPI 等原始事实不变；得分与建议已按当前档案重算。</p>
  </aside>`;
}
