function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function exposureMidpoint(value) {
  const bounds = String(value || "").match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (!bounds.length) return null;
  return bounds.length > 1 ? (bounds[0] + bounds[1]) / 2 : bounds[0];
}

function weightedAverage(items, scoreFor) {
  let weighted = 0;
  let covered = 0;
  for (const item of items) {
    const score = scoreFor(item);
    if (!Number.isFinite(score)) continue;
    weighted += score * item.value;
    covered += item.value;
  }
  return { score: covered > 0 ? weighted / covered : null, covered };
}

function concentrationIndex(items, keyFor) {
  const buckets = new Map();
  for (const item of items) {
    const key = keyFor(item);
    if (!key) continue;
    buckets.set(key, finite(buckets.get(key)) + item.value);
  }
  const covered = [...buckets.values()].reduce((sum, value) => sum + value, 0);
  if (!covered) return null;
  return [...buckets.values()].reduce((sum, value) => sum + (value / covered) ** 2, 0);
}

function signed(value) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.05) return "±0";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
}

/**
 * Calculates a portfolio-specific equity exposure target.
 *
 * Market timing is the anchor. Sector rotation and an optional per-stock
 * five-layer score adjust that anchor, while position/sector concentration
 * can only reduce it. Missing evidence is never replaced by a fabricated 50.
 */
export function calculatePortfolioTarget({
  positions = [],
  timingPayload = null,
  sectorRotationPayload = null,
} = {}) {
  const normalized = positions
    .map((position) => ({ ...position, value: Math.max(0, finite(position.value)) }))
    .filter((position) => position.value > 0);
  const totalValue = normalized.reduce((sum, position) => sum + position.value, 0);
  if (!totalValue) {
    return {
      targetExposurePct: 50,
      targetLabel: "建仓后计算组合自适应目标",
      detailLabel: "需要持仓市值后评估市场、板块、个股与集中度",
      breakdown: {
        marketBasePct: 50,
        sectorAdjustmentPct: 0,
        stockAdjustmentPct: 0,
        concentrationPenaltyPct: 0,
        timingCoveragePct: 0,
        sectorCoveragePct: 0,
        stockCoveragePct: 0,
      },
    };
  }

  const timingByMarket = new Map((timingPayload?.markets || []).map((market) => [market.id, market]));
  let marketWeighted = 0;
  let timingCovered = 0;
  for (const position of normalized) {
    const midpoint = exposureMidpoint(timingByMarket.get(position.marketId)?.regime?.exposureBand);
    marketWeighted += (midpoint ?? 50) * position.value;
    if (midpoint != null) timingCovered += position.value;
  }
  const marketBase = marketWeighted / totalValue;

  const sectorScores = new Map();
  for (const market of sectorRotationPayload?.markets || []) {
    for (const sector of market.sectors || []) {
      const score = Number(sector.score);
      if (Number.isFinite(score)) sectorScores.set(`${market.id}:${sector.id}`, score);
    }
  }
  const sectorEvidence = weightedAverage(normalized, (position) => (
    sectorScores.get(`${position.marketId}:${position.sectorId}`)
  ));
  const sectorCoverage = sectorEvidence.covered / totalValue;
  const sectorAdjustment = sectorEvidence.score == null
    ? 0
    : clamp((sectorEvidence.score - 50) * 0.25, -10, 10) * sectorCoverage;

  const stockEvidence = weightedAverage(normalized, (position) => {
    const score = Number(position.stockScore);
    return Number.isFinite(score) ? score : null;
  });
  const stockCoverage = stockEvidence.covered / totalValue;
  const stockAdjustment = stockEvidence.score == null
    ? 0
    : clamp((stockEvidence.score - 50) * 0.2, -8, 8) * stockCoverage;

  const positionHhi = concentrationIndex(normalized, (position) => position.symbol || null) ?? 1;
  const maxWeight = Math.max(...normalized.map((position) => position.value / totalValue));
  const sectorHhi = concentrationIndex(normalized, (position) => (
    position.sectorId ? `${position.marketId}:${position.sectorId}` : null
  ));
  const positionPenalty = clamp(((positionHhi - 0.2) / 0.8) * 12, 0, 12);
  const maxPositionPenalty = clamp(((maxWeight - 0.35) / 0.65) * 4, 0, 4);
  const sectorPenalty = sectorHhi == null ? 0 : clamp(((sectorHhi - 0.4) / 0.6) * 4, 0, 4);
  const concentrationPenalty = clamp(positionPenalty + maxPositionPenalty + sectorPenalty, 0, 16);

  const target = clamp(marketBase + sectorAdjustment + stockAdjustment - concentrationPenalty, 10, 90);
  const missing = [];
  if (sectorCoverage < 0.999) missing.push("板块待补");
  if (stockCoverage < 0.999) missing.push("个股待补");
  const evidenceSuffix = missing.length ? ` · ${missing.join("/")}` : " · 证据完整";

  return {
    targetExposurePct: round1(target),
    targetLabel: "组合自适应目标",
    detailLabel: `基准 ${marketBase.toFixed(0)} · 板块 ${signed(sectorAdjustment)} · 个股 ${signed(stockAdjustment)} · 集中度 −${concentrationPenalty.toFixed(1)}${evidenceSuffix}`,
    breakdown: {
      marketBasePct: round1(marketBase),
      sectorAdjustmentPct: round1(sectorAdjustment),
      stockAdjustmentPct: round1(stockAdjustment),
      concentrationPenaltyPct: round1(concentrationPenalty),
      timingCoveragePct: round1(timingCovered / totalValue * 100),
      sectorCoveragePct: round1(sectorCoverage * 100),
      stockCoveragePct: round1(stockCoverage * 100),
      positionConcentration: round1(positionHhi * 100),
      maxPositionWeightPct: round1(maxWeight * 100),
      sectorConcentration: sectorHhi == null ? null : round1(sectorHhi * 100),
    },
  };
}
