import { calculatePositionSnapshot } from "./portfolio-store.js";
import { resolvePortfolioManager } from "./portfolio-managers.js";
import { buildPortfolioAnalysisProfile, profileSignalPayload, profileSignalScore } from "./portfolio-analysis-profile.js";
import { SECTOR_LABELS, managerLens, sectorExample } from "./portfolio-manager-methodology.js";
import { calculateThesisHealth } from "./portfolio-manager-contract.js";
import { buildCompanyManagerInsight } from "./signals/stock-analysis/company-research.js";

function latestDate(values) {
  return values.filter(Boolean).sort().at(-1) || "数据待更新";
}

function marketIdForStock(stock) {
  return stock?.currency === "CNY" ? "china" : "united-states";
}

function findMarket(payload, marketId) {
  return payload?.markets?.find(({ id }) => id === marketId) || null;
}

function liveSector(sectorRotationPayload, sectorId, marketIds) {
  for (const marketId of marketIds) {
    const sector = findMarket(sectorRotationPayload, marketId)?.sectors?.find(({ id }) => id === sectorId);
    if (sector) return sector;
  }
  return null;
}

function percent(value, signed = false) {
  if (value == null || value === "") return "待补证";
  const number = Number(value);
  if (!Number.isFinite(number)) return "待补证";
  return `${signed && number > 0 ? "+" : ""}${number.toFixed(1)}%`;
}

function companyResearchFor(companyResearchBySymbol, stock) {
  if (!companyResearchBySymbol || !stock) return null;
  if (companyResearchBySymbol instanceof Map) {
    return companyResearchBySymbol.get(stock.symbol) || companyResearchBySymbol.get(stock.providerSymbol) || null;
  }
  return companyResearchBySymbol[stock.symbol] || companyResearchBySymbol[stock.providerSymbol] || null;
}

function holdingReview(manager, lens, position, stock, signals, usdCny, marketIds, analysisProfile, companyResearchBySymbol) {
  const result = calculatePositionSnapshot(position, stock, usdCny);
  const research = companyResearchFor(companyResearchBySymbol, stock);
  const researchInsight = research ? buildCompanyManagerInsight(research, manager.id) : null;
  const sector = liveSector(signals.sectorRotationPayload, stock?.sectorId, marketIds);
  const preferred = lens.preferredSectorIds.includes(stock?.sectorId);
  const rawRotationScore = Number(sector?.score);
  const rotationScore = Number.isFinite(rawRotationScore)
    ? profileSignalScore(rawRotationScore, "sector-rotation", analysisProfile)
    : rawRotationScore;
  const momentum = Number(stock?.change || 0);
  let level = preferred ? 1 : 0;
  if (Number.isFinite(rotationScore)) level += rotationScore >= 65 ? 1 : rotationScore < 45 ? -1 : 0;
  if (manager.id === "soros") level += momentum > 0 ? 1 : -1;
  else if (manager.id === "marks") level += rotationScore >= 75 ? -1 : 0;
  else if (["buffett", "munger", "graham"].includes(manager.id)) level += result.returnRate <= -15 ? 0 : 1;
  else level += result.returnRate > 0 ? 1 : 0;
  const requiresFundamentalEvidence = ["buffett", "munger", "graham", "lynch"].includes(manager.id);
  const verdict = requiresFundamentalEvidence
    ? researchInsight?.verdict || lens.watchVerdict
    : level >= 2 ? lens.positiveVerdict : level <= 0 ? lens.negativeVerdict : lens.watchVerdict;
  const alignment = preferred
    ? `属于其偏好研究的${SECTOR_LABELS[stock?.sectorId] || stock?.sector || "行业"}`
    : `不在其首选行业清单`;
  const marketEvidence = Number.isFinite(rotationScore)
    ? `${alignment}；当前板块轮动 ${rotationScore.toFixed(0)} 分，今日 ${momentum >= 0 ? "+" : ""}${momentum.toFixed(2)}%`
    : `${alignment}；板块轮动证据待补，今日 ${momentum >= 0 ? "+" : ""}${momentum.toFixed(2)}%`;
  const researchEvidence = researchInsight
    ? `${research?.fundamentals?.source?.label || "公司研究源"}：营收同比 ${percent(researchInsight.facts?.revenueGrowth, true)}、自由现金流率 ${percent(researchInsight.facts?.freeCashFlowMargin)}；完整研究覆盖 ${researchInsight.dossier.coverage.completed}/${researchInsight.dossier.coverage.total} 维，证据 ${researchInsight.evidence.grade} 级`
    : "公司研究尚未载入；系统会后台拉取财报、产品、护城河、市场地位、管理层、预期、估值与风险证据";
  const evidence = requiresFundamentalEvidence
    ? `${marketEvidence}；${researchEvidence}；${researchInsight?.workflow?.canBuy ? "研究闸门已通过，仍需人工复核" : "买入闸门未通过，不把行情信号升级为结论"}`
    : marketEvidence;
  return {
    symbol: position.symbol,
    name: stock?.name || position.symbol,
    verdict,
    advice: `${lens.advice} 当前组合目标年化 ${analysisProfile.targetReturn}%，风险预算 ${analysisProfile.riskCapacity}/100，执行仓位与止损宽度按此约束。`,
    evidence,
    preferred,
    sector: SECTOR_LABELS[stock?.sectorId] || stock?.sector || "行业待识别",
    profit: result.profit,
    returnRate: result.returnRate,
    currency: stock?.currency || "CNY",
    thesisHealth: calculateThesisHealth(position?.thesis || {}),
    evidenceGrade: researchInsight?.evidence?.grade || (requiresFundamentalEvidence ? "C" : "B"),
    researchConnected: Boolean(research),
    researchCoverage: researchInsight?.dossier?.coverage || { completed: 0, total: 8, percent: 0 },
  };
}

export function buildManagerPortfolioInsight({
  managerId,
  portfolio,
  stocks = [],
  usdCny = 1,
  macroPayload,
  timingPayload,
  sectorRotationPayload,
  targetReturn,
  riskCapacity,
  companyResearchBySymbol,
}) {
  const manager = resolvePortfolioManager(managerId);
  const analysisProfile = buildPortfolioAnalysisProfile({ managerId: manager.id, targetReturn, riskCapacity });
  const lens = managerLens(manager.id);
  const stockMap = new Map(stocks.map((stock) => [stock.symbol, stock]));
  const heldMarketIds = [...new Set((portfolio?.positions || []).map(({ symbol }) => marketIdForStock(stockMap.get(symbol))))];
  const marketIds = heldMarketIds.length ? heldMarketIds : ["china", "united-states"];
  const macroMarkets = marketIds.map((marketId) => findMarket(macroPayload, marketId)).filter(Boolean);
  const profiledTimingPayload = profileSignalPayload("market-timing", timingPayload, analysisProfile);
  const profiledSectorRotationPayload = profileSignalPayload("sector-rotation", sectorRotationPayload, analysisProfile);
  const timingMarkets = marketIds.map((marketId) => findMarket(profiledTimingPayload, marketId)).filter(Boolean);
  const environments = macroMarkets.map((market) => market.analysis?.regime).filter(Boolean);
  const timingLabels = timingMarkets.map((market) => {
    const score = Number(market.regime?.score);
    return market.regime?.label
      ? `${market.regime.label}${Number.isFinite(score) ? `（经理评分 ${score.toFixed(1)}）` : ""}`
      : null;
  }).filter(Boolean);
  const asOf = latestDate([
    ...macroMarkets.map((market) => market.asOf),
    ...timingMarkets.map((market) => market.asOf),
    ...marketIds.map((marketId) => findMarket(sectorRotationPayload, marketId)?.asOf),
  ]);
  const environmentText = environments.length ? environments.join(" / ") : "宏观环境待更新";
  const timingText = timingLabels.length ? timingLabels.join(" / ") : "择时信号待更新";
  const preferredSectors = Object.fromEntries(["china", "united-states"].map((marketId) => {
    const profiledMarket = findMarket(profiledSectorRotationPayload, marketId);
    const rawMarket = findMarket(sectorRotationPayload, marketId);
    return [marketId, lens.preferredSectorIds.map((id) => {
      const sector = profiledMarket?.sectors?.find((item) => item.id === id);
      const rawSector = rawMarket?.sectors?.find((item) => item.id === id);
      return {
        id,
        label: SECTOR_LABELS[id] || sector?.title || id,
        rationale: lens.sectorRationale,
        example: sectorExample(id, marketId),
        liveScore: Number.isFinite(Number(sector?.score)) ? Number(sector.score) : null,
        rawScore: Number.isFinite(Number(rawSector?.score)) ? Number(rawSector.score) : null,
      };
    })];
  }));
  const holdings = (portfolio?.positions || [])
    .map((position) => {
      const stock = stockMap.get(position.symbol);
      return stock ? holdingReview(manager, lens, position, stock, { sectorRotationPayload }, usdCny, marketIds, analysisProfile, companyResearchBySymbol) : null;
    })
    .filter((holding) => holding?.preferred);
  const positionValues = (portfolio?.positions || []).map((position) => {
    const stock = stockMap.get(position.symbol);
    const snapshot = stock ? calculatePositionSnapshot(position, stock, usdCny) : null;
    return { symbol: position.symbol, value: snapshot?.marketValue || 0 };
  });
  const investedValue = positionValues.reduce((sum, item) => sum + item.value, 0);
  const topPosition = [...positionValues].sort((a, b) => b.value - a.value)[0] || null;
  const topWeight = investedValue && topPosition ? topPosition.value / investedValue * 100 : null;

  return {
    manager,
    signature: lens.signature,
    preferredSectors,
    watchlists: Object.fromEntries(Object.entries(lens.watchlists).map(([marketId, items]) => (
      [marketId, items.map(([symbol, name]) => ({ symbol, name }))]
    ))),
    analysisProfile,
    macro: {
      headline: lens.macroHeadline,
      summary: `${environmentText}；市场择时 ${timingText}。${lens.signature}。目标年化 ${analysisProfile.targetReturn}%，风险预算 ${analysisProfile.riskCapacity}/100。`,
      asOf,
    },
    holdings,
    portfolioReview: {
      reviewCadence: manager.monitoringPolicy.reviewCadence,
      thesisBaselineCount: (portfolio?.positions || []).filter((position) => position?.thesis?.assumptions?.length).length,
      positionCount: (portfolio?.positions || []).length,
      topPositionSymbol: topPosition?.symbol || null,
      topPositionWeight: topWeight,
      concentrationLabel: topWeight == null ? "尚无持仓" : topWeight >= 40 ? "集中度较高" : topWeight >= 25 ? "集中度需关注" : "集中度分散",
      opportunityCostPrompt: "复核最低确信度持仓：继续占用资金是否优于现金或当前最高确信度候选？",
    },
  };
}
