import {
  applyManagerActionPolicy,
  applyManagerDecisionGate,
  managerAllocationFor,
  managerAllocationRangeFor,
  managerCoverageFor,
  managerWeightsFor,
} from "../../portfolio-managers.js";
import { buildPortfolioAnalysisProfile, profileSignalScore } from "../../portfolio-analysis-profile.js";
import { managerSectorPreference } from "../../portfolio-manager-methodology.js";

function finite(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

export const HOLDING_PERIODS = Object.freeze([
  { id: "1d", label: "1日", style: "日内观察", days: 1, weights: { macro: 5, timing: 20, sector: 15, sentiment: 15, technical: 45 }, target: "near" },
  { id: "1w", label: "1周", style: "短线", days: 7, weights: { macro: 8, timing: 20, sector: 20, sentiment: 12, technical: 40 }, target: "near" },
  { id: "1m", label: "1月", style: "波段", days: 30, weights: { macro: 12, timing: 20, sector: 23, sentiment: 10, technical: 35 }, target: "near" },
  { id: "3m", label: "3月", style: "中线", days: 90, weights: { macro: 15, timing: 20, sector: 25, sentiment: 10, technical: 30 }, target: "far" },
  { id: "1y", label: "1年", style: "长期趋势", days: 365, weights: { macro: 25, timing: 20, sector: 25, sentiment: 5, technical: 25 }, target: "far" },
]);

export function holdingPeriodIndex(value) {
  const index = HOLDING_PERIODS.findIndex(({ id }) => id === value);
  return index < 0 ? 3 : index;
}

export function holdingPeriodAt(value) {
  const index = Math.round(clamp(finite(value) ?? 3, 0, HOLDING_PERIODS.length - 1));
  return HOLDING_PERIODS[index];
}

export function normalizeHoldingDays(value, fallback = 90) {
  return Math.round(clamp(finite(value) ?? fallback, 1, 365));
}

export function holdingDaysFromSliderPosition(value) {
  const position = clamp(finite(value) ?? 0, 0, 100) / 100;
  return normalizeHoldingDays(Math.exp(position * Math.log(365)));
}

export function sliderPositionFromHoldingDays(value) {
  const days = normalizeHoldingDays(value);
  return Math.round((Math.log(days) / Math.log(365)) * 10000) / 100;
}

function holdingStyle(days) {
  if (days <= 1) return "日内观察";
  if (days <= 10) return "短线";
  if (days <= 60) return "波段";
  if (days <= 180) return "中线";
  return "长期趋势";
}

export function formatHoldingDays(value) {
  const days = normalizeHoldingDays(value);
  if (days === 365) return "1年";
  if (days >= 60 && days % 30 === 0) return `${days / 30}个月`;
  return `${days}天`;
}

export function holdingProfileForDays(value) {
  const days = normalizeHoldingDays(value);
  const upperIndex = HOLDING_PERIODS.findIndex((period) => period.days >= days);
  const safeUpperIndex = upperIndex < 0 ? HOLDING_PERIODS.length - 1 : upperIndex;
  const upper = HOLDING_PERIODS[safeUpperIndex];
  const lower = HOLDING_PERIODS[Math.max(0, safeUpperIndex - 1)];
  const ratio = lower === upper ? 0 : (days - lower.days) / Math.max(1, upper.days - lower.days);
  const weights = {};
  for (const key of Object.keys(lower.weights)) {
    weights[key] = Math.round((lower.weights[key] + (upper.weights[key] - lower.weights[key]) * ratio) * 10) / 10;
  }
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  weights.technical = Math.round((weights.technical + 100 - total) * 10) / 10;
  const dataRange = days <= 1 ? "1d" : days <= 7 ? "1w" : days <= 30 ? "1m" : days <= 90 ? "3m" : "1y";
  return {
    id: dataRange,
    dataRange,
    days,
    label: formatHoldingDays(days),
    style: holdingStyle(days),
    weights,
    target: days >= 60 ? "far" : "near",
  };
}

function holdingPeriodFor(value) {
  return HOLDING_PERIODS[holdingPeriodIndex(value)];
}

function normalizeLevel(level, fallback, source) {
  if (level && finite(level.midpoint) != null) {
    const midpoint = finite(level.midpoint);
    return {
      low: finite(level.low) ?? midpoint,
      high: finite(level.high) ?? midpoint,
      midpoint,
      share: finite(level.share),
      density: finite(level.density),
      source: level.source || source,
    };
  }
  const midpoint = finite(fallback);
  if (midpoint == null) return null;
  return { low: midpoint, high: midpoint, midpoint, share: null, density: null, source };
}

function percentDistance(from, to) {
  return from ? ((to - from) / from) * 100 : null;
}

function includesDefensive(text) {
  return /防守|收缩|衰退|滞胀|风险规避|恶化|落后/.test(String(text || ""));
}

function includesPositive(text) {
  return /偏多|进攻|进取|扩张|修复|领先|改善|健康|确认/.test(String(text || ""));
}

function macroDecisionScore(macro) {
  if (!macro?.regime) return null;
  const description = `${macro.regime} ${macro.stance || ""}`;
  if (includesDefensive(description)) return 35;
  if (includesPositive(description)) return 65;
  return 50;
}

function sentimentDecisionScore(sentiment) {
  const score = finite(sentiment?.score);
  if (score == null) return null;
  const phase = String(sentiment?.phase || "");
  if (/狂热|拥挤|高位降温/.test(phase) || sentiment?.tone === "warning") {
    return clamp(70 - Math.max(0, score - 75) * 2, 35, 70);
  }
  if (/恐慌恶化|谨慎降温/.test(phase)) return Math.min(score, 35);
  if (/恐慌企稳|情绪修复/.test(phase)) return Math.max(45, Math.min(score + 15, 65));
  return clamp(score);
}

function scoreLabel(score) {
  if (score == null) return "数据待恢复";
  if (score >= 65) return "支持";
  if (score <= 40) return "拖累";
  return "中性";
}

function scoreTone(score) {
  if (score == null) return "neutral";
  if (score >= 65) return "positive";
  if (score <= 40) return "negative";
  return "neutral";
}

function technicalDecisionScore({ trend, histogram, rsi, nearSupport, nearPressure, riskReward, rangePosition }) {
  let score = 50;
  score += { strong_up: 22, up: 12, neutral: 0, down: -14, strong_down: -24 }[trend] || 0;
  if (histogram != null) score += histogram > 0 ? 7 : histogram < 0 ? -7 : 0;
  if (rsi != null && rsi >= 70) score -= 12;
  if (rsi != null && rsi <= 30) score -= 5;
  if (nearSupport) score += 10;
  if (nearPressure) score -= 12;
  if (riskReward != null && riskReward >= 1.5) score += 8;
  if (rangePosition >= 85) score -= 5;
  return clamp(score);
}

function weightedComposite(components) {
  const available = components.filter(({ score }) => score != null);
  const totalWeight = available.reduce((total, item) => total + item.weight, 0);
  const score = totalWeight
    ? available.reduce((total, item) => total + item.score * item.weight, 0) / totalWeight
    : 50;
  const coverage = components.reduce((total, item) => total + (item.score == null ? 0 : item.weight), 0);
  return {
    score: Math.round(score * 10) / 10,
    coverage,
    confidence: coverage >= 90 ? "高" : coverage >= 65 ? "中" : "低",
  };
}

export function buildStockDecision(payload, context = {}) {
  const holdingPeriod = context.holdingDays != null
    ? holdingProfileForDays(context.holdingDays)
    : holdingPeriodFor(context.holdingPeriod || payload?.range || "3m");
  const managerId = context.managerId;
  const analysisProfile = buildPortfolioAnalysisProfile({ managerId, ...context.analysisPreferences });
  const weights = managerWeightsFor(holdingPeriod.weights, managerId, analysisProfile);
  const price = finite(payload?.price) ?? 0;
  const metrics = payload?.analysis || {};
  const profile = payload?.chart?.profile || {};
  const supportLevels = Array.isArray(profile.supportLevels) ? profile.supportLevels : [];
  const resistanceLevels = Array.isArray(profile.resistanceLevels) ? profile.resistanceLevels : [];
  const levels = {
    nearSupport: normalizeLevel(supportLevels[0], profile.support, "VRVP近端支撑"),
    farSupport: normalizeLevel(supportLevels[1], null, "VRVP远端支撑"),
    nearResistance: normalizeLevel(resistanceLevels[0], profile.resistance, "VRVP近端压力"),
    farResistance: normalizeLevel(resistanceLevels[1], null, "VRVP远端压力"),
  };

  const atr = Math.max(0, finite(metrics.atr14) ?? 0);
  const invalidation = levels.nearSupport
    ? Math.max(0, levels.nearSupport.low - Math.max(atr * 0.35, price * 0.005))
    : null;
  const entry = levels.nearSupport;
  const target = holdingPeriod.target === "far"
    ? levels.farResistance || levels.nearResistance
    : levels.nearResistance || levels.farResistance;
  const plannedEntry = entry?.midpoint ?? null;
  const plannedTarget = target?.midpoint ?? null;
  const plannedRisk = plannedEntry != null && invalidation != null ? plannedEntry - invalidation : null;
  const plannedReward = plannedEntry != null && plannedTarget != null ? plannedTarget - plannedEntry : null;
  const plannedRiskReward = plannedRisk > 0 && plannedReward > 0 ? plannedReward / plannedRisk : null;
  const expectedReturnPercent = plannedEntry > 0 && plannedTarget > plannedEntry
    ? ((plannedTarget - plannedEntry) / plannedEntry) * 100
    : null;
  const downsidePercent = plannedEntry > 0 && invalidation != null && invalidation < plannedEntry
    ? ((plannedEntry - invalidation) / plannedEntry) * 100
    : null;
  const requiredReturnPercent = ((1 + analysisProfile.targetReturn / 100) ** (holdingPeriod.days / 365) - 1) * 100;
  const risk = invalidation != null ? price - invalidation : null;
  const reward = levels.nearResistance ? levels.nearResistance.midpoint - price : null;
  const currentRiskReward = risk > 0 && reward > 0 ? reward / risk : null;
  const supportDistance = levels.nearSupport ? percentDistance(levels.nearSupport.high, price) : null;
  const resistanceDistance = levels.nearResistance ? percentDistance(price, levels.nearResistance.low) : null;
  const nearSupport = supportDistance != null && supportDistance >= -1 && supportDistance <= 3;
  const nearPressure = resistanceDistance != null && resistanceDistance >= -1 && resistanceDistance <= 3;

  const macro = context.macro || null;
  const timing = context.timing || null;
  const sector = context.sector || null;
  const sentiment = context.sentiment || null;
  const marketId = context.marketId || (payload?.currency === "CNY" ? "china" : "united-states");
  const companySectorId = context.companyProfile?.sectorId || sector?.id || null;
  const rawTimingScore = finite(timing?.score);
  const rawSectorScore = finite(sector?.score);
  const rawFlowScore = finite(sector?.flowScore);
  const rawSentimentScore = finite(sentiment?.score);
  const rawMacroScore = macroDecisionScore(macro);
  const rawSentimentModelScore = sentimentDecisionScore(sentiment);
  const timingScore = rawTimingScore == null ? null : profileSignalScore(rawTimingScore, "market-timing", analysisProfile);
  const sectorScore = rawSectorScore == null ? null : profileSignalScore(rawSectorScore, "sector-rotation", analysisProfile);
  const flowScore = rawFlowScore == null ? null : profileSignalScore(rawFlowScore, "capital-flow", analysisProfile);
  const sentimentScore = rawSentimentScore == null ? null : profileSignalScore(rawSentimentScore, "investor-sentiment", analysisProfile);
  const macroScore = rawMacroScore == null ? null : profileSignalScore(rawMacroScore, "macro", analysisProfile);
  const sentimentModelScore = rawSentimentModelScore == null ? null : profileSignalScore(rawSentimentModelScore, "investor-sentiment", analysisProfile);
  const macroAvailable = macroScore != null;
  const timingAvailable = timingScore != null && Boolean(timing?.label);
  const sectorAvailable = sectorScore != null;
  const sentimentAvailable = sentimentScore != null;

  const trend = String(metrics.trend || "neutral");
  const histogram = finite(metrics.macdHistogram);
  const rsi = finite(metrics.rsi14);
  const rangePosition = clamp(finite(metrics.rangePosition) ?? 50);
  const technicallyWeak = ["down", "strong_down"].includes(trend) && (histogram == null || histogram < 0);
  const overheated = rsi != null && rsi >= 70;
  const rawTechnicalScore = technicalDecisionScore({ trend, histogram, rsi, nearSupport, nearPressure, riskReward: currentRiskReward, rangePosition });
  const technicalScore = profileSignalScore(rawTechnicalScore, "stock-analysis", analysisProfile);
  const sectorWeak = sectorAvailable && (sectorScore <= 40 || (flowScore != null && flowScore <= 38));
  const sectorSupportive = sectorAvailable && sectorScore >= 65 && (flowScore == null || flowScore >= 42);
  const sentimentCrowded = sentimentAvailable && (/狂热|拥挤/.test(sentiment?.phase || "") || sentiment?.tone === "warning");
  const sentimentWeak = sentimentAvailable && (/恶化|谨慎降温/.test(sentiment?.phase || "") || sentimentScore <= 30);
  const environmentDescription = `${macro?.regime || ""} ${macro?.stance || ""} ${timing?.label || ""}`;
  const macroDefensive = macroAvailable && includesDefensive(environmentDescription);
  const extremeRiskEnvironment = !timingAvailable
    || timingScore < 25
    || /衰退|滞胀|危机|风险规避/.test(environmentDescription);
  const riskConstrainedEnvironment = !macroAvailable || macroDefensive || timingScore < 43;
  const supportiveEnvironment = timingAvailable && timingScore >= 58 && !extremeRiskEnvironment;
  const held = Boolean(context.held);

  const composite = weightedComposite([
    { id: "macro", score: macroScore, weight: weights.macro },
    { id: "timing", score: timingScore, weight: weights.timing },
    { id: "sector", score: sectorScore, weight: weights.sector },
    { id: "sentiment", score: sentimentModelScore, weight: weights.sentiment },
    { id: "technical", score: technicalScore, weight: weights.technical },
  ]);

  const sectorName = sector?.title || context.companyProfile?.sector || "所属板块待识别";
  const sectorPhase = sector?.phase || scoreLabel(sectorScore);
  const sectorFact = sectorAvailable
    ? `${sectorName}得分 ${sectorScore.toFixed(1)}${sector?.rank ? `、排名第${sector.rank}` : ""}`
    : `${sectorName}，暂不把板块因素计入买入强度`;
  const sentimentFact = sentimentAvailable
    ? `${sentiment.phase || scoreLabel(sentimentScore)}（${sentimentScore.toFixed(1)}）`
    : "投资者情绪待恢复";

  let action;
  if (held && (technicallyWeak || timingScore != null && timingScore < 30 || sectorWeak)) {
    action = {
      code: "reduce-risk",
      label: sectorWeak ? `${sectorName}偏弱，优先控制风险` : "趋势转弱，优先控制风险",
      tone: "negative",
      summary: `${sectorFact}；个股若收盘跌破失效位，应先减小风险，不用连续补仓对抗弱势。`,
    };
  } else if (held && (nearPressure || overheated || sentimentCrowded)) {
    action = {
      code: "take-profit",
      label: sentimentCrowded ? "情绪拥挤，压力区分批止盈" : "压力区分批止盈",
      tone: "caution",
      summary: `${sectorFact}；${sentimentFact}。价格接近VRVP压力或动量偏热，保留核心仓位并分批保护收益。`,
    };
  } else if (held && supportiveEnvironment && !sectorWeak && nearSupport && !technicallyWeak) {
    action = {
      code: "scale-in-held",
      label: sectorSupportive ? `${sectorName}共振，企稳后小幅加仓` : "支撑区企稳后可小幅加仓",
      tone: "positive",
      summary: `${sectorFact}；市场允许承担风险，但仍要等价格在VRVP支撑区止跌企稳，再用小仓位验证。`,
    };
  } else if (held) {
    action = {
      code: "hold",
      label: sectorWeak ? "板块拖累，持有但不加仓" : "持有观察，不追加入",
      tone: sectorWeak ? "caution" : "neutral",
      summary: `${sectorFact}；${sentimentFact}。尚未触及主要压力或失效位，维持计划并等待量价确认。`,
    };
  } else if (sectorWeak) {
    action = {
      code: "avoid-weak-sector",
      label: `${sectorName}偏弱，暂不买入`,
      tone: "negative",
      summary: `${sectorFact}，板块轮动与个股买点没有形成共振；即使价格靠近支撑，也先等待板块止跌或资金转强。`,
    };
  } else if (technicallyWeak || extremeRiskEnvironment || sentimentWeak) {
    action = {
      code: "wait-stabilization",
      label: technicallyWeak ? "个股趋势未企稳，暂不买入" : "极端风险环境，等待企稳",
      tone: "negative",
      summary: `${sectorFact}；${sentimentFact}。当前风险已触发硬门槛，即使进入支撑区也不新增仓位，等待市场或价格结构恢复。`,
    };
  } else if (nearPressure || overheated) {
    action = {
      code: "wait-pullback",
      label: sectorSupportive ? `${sectorName}强势，但等待回调` : "等待回调，不在压力区追高",
      tone: "caution",
      summary: `${sectorFact}；${sentimentFact}。板块强不等于当前价格便宜，接近压力区时优先等待更好的风险收益位置。`,
    };
  } else if (sectorSupportive && supportiveEnvironment && nearSupport && composite.score >= 62) {
    action = {
      code: "scale-in-sector",
      label: riskConstrainedEnvironment || sentimentCrowded
        ? `${sectorName}共振，支撑区受限建仓`
        : `${sectorName}共振，支撑区小仓验证`,
      tone: riskConstrainedEnvironment || sentimentCrowded ? "caution" : "positive",
      summary: `${sectorFact}且市场择时偏强；价格进入VRVP支撑并企稳后可以分批验证。宏观偏防守或情绪拥挤时只缩小首笔仓位，不再覆盖有效的板块与价格共振。`,
    };
  } else if (sectorSupportive && supportiveEnvironment && currentRiskReward != null && currentRiskReward >= 1.5) {
    action = {
      code: "wait-sector-entry",
      label: `${sectorName}领先，等待技术买点`,
      tone: "positive",
      summary: `${sectorFact}，但只有回到买入观察区或放量突破确认后才参与，避免把好板块等同于任意价格可买。`,
    };
  } else if (nearSupport && composite.score >= 58) {
    action = {
      code: "scale-in-carefully",
      label: sectorAvailable ? `${sectorName}中性，支撑区小仓验证` : "支撑附近，小仓分批验证",
      tone: "neutral",
      summary: `${sectorFact}；价格接近成交密集支撑，但证据尚未全面共振，首笔只使用计划仓位的一小部分。`,
    };
  } else if (!timingAvailable) {
    action = {
      code: "wait-data",
      label: "市场环境数据不足，先观察",
      tone: "caution",
      summary: `${sectorFact}；技术点位可以观察，但市场择时尚不可用，暂不把单股信号升级为买入建议。`,
    };
  } else {
    action = {
      code: "wait-confirmation",
      label: sectorAvailable ? `${sectorName}未共振，等待更清楚位置` : "等待回调或突破确认",
      tone: "neutral",
      summary: `${sectorFact}；当前位于支撑与压力之间，没有低风险买点，等待回调或有效突破。`,
    };
  }

  action.verb = action.code === "reduce-risk" || action.code === "take-profit"
    ? "卖出/减仓"
    : action.code.startsWith("scale-in")
      ? "买入"
      : action.code === "hold"
        ? "持有"
        : "等待";
  action.horizon = `${holdingPeriod.label} · ${holdingPeriod.style}`;

  const availableCapabilities = [
    macroAvailable && "macro",
    timingAvailable && "timing",
    sectorAvailable && "sector",
    sentimentAvailable && "sentiment",
    "technical",
    ...(context.companyResearchInsight?.capabilities || []),
  ].filter(Boolean);
  const manager = managerCoverageFor(managerId, availableCapabilities);
  const managerPreference = managerSectorPreference(manager.id, companySectorId, marketId);
  action = applyManagerDecisionGate(action, manager);
  const managerSignals = {
    sentimentCrowded,
    riskConstrainedEnvironment,
    technicallyWeak,
    trendAligned: ["up", "strong_up"].includes(trend) && (histogram == null || histogram >= 0) && timingScore >= 55,
  };
  action = applyManagerActionPolicy(action, manager, managerSignals);
  if (action.verb === "买入" && context.companyResearchInsight?.evidence?.status === "conflict") {
    const conflictLabels = context.companyResearchInsight.evidence.conflicts.map(({ id }) => id).join("、");
    action = {
      ...action,
      code: "company-source-conflict",
      label: "关键财务数据冲突，等待核验",
      tone: "caution",
      verb: "等待",
      summary: `${action.summary} ${conflictLabels || "关键字段"}的两个独立来源差异超过1%，在口径解释或修正前不执行买入。`,
    };
  }
  if (action.verb === "买入" && expectedReturnPercent != null && expectedReturnPercent < requiredReturnPercent) {
    action = {
      ...action,
      code: "target-return-hurdle",
      label: `预期回报未达 ${analysisProfile.targetReturn}% 年化目标`,
      tone: "caution",
      verb: "等待",
      summary: `${action.summary} 当前价格结构的期间回报低于本组合目标门槛，继续等待更好买点。`,
    };
  }
  if (!held && managerPreference.preferred === false && action.verb === "买入") {
    action = {
      ...action,
      code: "manager-sector-outside",
      label: `${managerPreference.sectorLabel}不在经理当前偏好清单，等待`,
      tone: "caution",
      verb: "等待",
      summary: `${action.summary} ${managerPreference.label}，因此本次不把技术或轮动强势直接升级为新建仓。`,
    };
  } else {
    action = {
      ...action,
      summary: `${action.summary} ${managerPreference.label}。`,
    };
  }

  const locationLabel = nearPressure
    ? "靠近上方压力"
    : nearSupport
      ? "靠近下方支撑"
      : rangePosition >= 75
        ? "所选区间偏高位置"
        : rangePosition <= 25
          ? "所选区间偏低位置"
          : "支撑与压力之间";

  const environment = macroAvailable && timingAvailable
    ? {
        dataState: "available",
        label: `${macro.regime} · 市场${timing.label}`,
        guidance: `市场择时 ${timingScore.toFixed(1)}；${sectorFact}；情绪为${sentimentFact}。模型会以个股价格位置决定是否执行。`,
        exposureBand: timing.exposureBand || "--",
        confidence: composite.confidence,
      }
    : timingAvailable
      ? {
          dataState: "partial",
          label: `宏观数据待恢复 · 市场${timing.label}`,
          guidance: `市场择时 ${timingScore.toFixed(1)}；${sectorFact}；情绪为${sentimentFact}。宏观缺失只降低建议强度，不再覆盖板块差异。`,
          exposureBand: timing.exposureBand || "--",
          confidence: composite.confidence === "高" ? "中" : composite.confidence,
        }
      : {
          dataState: "unavailable",
          label: "宏观/市场择时暂不可用",
          guidance: `${sectorFact}；仅保留板块和个股技术观察，不提高仓位，等待市场环境数据恢复。`,
          exposureBand: "--",
          confidence: "低",
        };

  const technicalLabel = technicallyWeak ? "趋势偏弱" : overheated ? "动量偏热" : nearSupport ? "靠近支撑" : nearPressure ? "靠近压力" : "结构中性";
  const evidence = [
    {
      id: "macro",
      title: "宏观环境",
      label: macroAvailable ? `${macro.regime} · ${macro.stance || "立场中性"}` : "数据待恢复",
      detail: macroAvailable ? `期限权重${weights.macro}% · 原始置信度 ${macro.confidence ?? "--"}` : "缺失时不以固定中性分数填充，直接降低覆盖率",
      tone: scoreTone(macroScore),
    },
    {
      id: "timing",
      title: "市场择时",
      label: timingAvailable ? `${timing.label} · ${timingScore.toFixed(1)}` : "数据待恢复",
      detail: timingAvailable ? `期限权重${weights.timing}% · 风险暴露参考 ${timing.exposureBand || "--"}` : "市场方向不明时不升级为新增仓位",
      tone: scoreTone(timingScore),
    },
    {
      id: "sector",
      title: "所属板块",
      label: sectorAvailable ? `${sectorName} · ${sectorPhase}` : sectorName,
      detail: sectorAvailable ? `轮动得分 ${sectorScore.toFixed(1)}${sector?.rank ? ` · 排名 ${sector.rank}` : ""} · 期限权重${weights.sector}%（已包含资金维度）` : "股票资料未匹配到11个一级板块",
      tone: scoreTone(sectorScore),
    },
    {
      id: "flow",
      title: "板块资金",
      label: flowScore != null ? (sector.flowState || scoreLabel(flowScore)) : "数据待恢复",
      detail: flowScore != null ? `资金证据 ${flowScore.toFixed(1)} · 作为板块轮动内部证据，不重复加权` : "没有用虚构资金流补齐空值",
      tone: sector?.flowTone || scoreTone(flowScore),
    },
    {
      id: "sentiment",
      title: "投资者情绪",
      label: sentimentAvailable ? (sentiment.phase || scoreLabel(sentimentScore)) : "数据待恢复",
      detail: sentimentAvailable ? `情绪 ${sentimentScore.toFixed(1)} · 20日脉冲 ${finite(sentiment.impulse)?.toFixed(1) ?? "--"} · 期限权重${weights.sentiment}%` : "情绪缺失时不生成贪婪/恐慌判断",
      tone: sentiment?.tone === "warning" ? "caution" : scoreTone(sentimentModelScore),
    },
    {
      id: "technical",
      title: "个股技术",
      label: `${technicalLabel} · ${technicalScore.toFixed(0)}`,
      detail: `期限权重${weights.technical}% · RSI ${rsi?.toFixed(1) ?? "--"} · MACD柱 ${histogram?.toFixed(3) ?? "--"}`,
      tone: scoreTone(technicalScore),
    },
  ];

  const positionCautionCount = [riskConstrainedEnvironment, sentimentCrowded].filter(Boolean).length;
  const starterAllocation = !macroAvailable
    ? "宏观缺失时首笔10%–20%"
    : positionCautionCount >= 2
      ? "首笔5%–10%"
      : positionCautionCount === 1
        ? "首笔10%–20%"
        : "首笔20%–30%";
  const allocationSignals = {
    ...managerSignals,
    actionVerb: action.verb,
    baseAllocation: starterAllocation,
    analysisPreferences: analysisProfile,
  };
  return {
    holdingPeriod,
    analysisProfile,
    manager,
    managerPreference,
    action,
    environment,
    evidence,
    composite,
    location: {
      label: locationLabel,
      rangePosition,
      supportDistance,
      resistanceDistance,
    },
    levels,
    invalidation,
    riskReward: plannedRiskReward,
    tradePlan: {
      entry,
      target,
      expectedReturnPercent,
      downsidePercent,
      riskReward: plannedRiskReward,
      returnLabel: expectedReturnPercent == null ? "预期回报待结构形成" : `预期区间回报 +${expectedReturnPercent.toFixed(1)}%`,
      requiredReturnPercent,
      hurdleLabel: `目标回报门槛：年化 ${analysisProfile.targetReturn}% · ${holdingPeriod.label}折算 ${requiredReturnPercent.toFixed(1)}%`,
    },
    weightMethod: `宏观${weights.macro}% + 市场择时${weights.timing}% + 板块轮动${weights.sector}% + 投资者情绪${weights.sentiment}% + 个股技术${weights.technical}%`,
    allocation: managerAllocationFor(managerId, allocationSignals),
    allocationPlan: managerAllocationRangeFor(managerId, allocationSignals),
  };
}
