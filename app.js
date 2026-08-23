import { getSearchResultActions } from "./search-flow.js";
import { resolveWorkspaceRoute, shouldForceWorkspaceRefresh, signalDirectories } from "./signals/catalog.js";
import { detectHeldMarkets, renderOverviewSignalLinks } from "./overview-signals.js";
import { buildOverviewActionModel, renderOverviewActionPanel } from "./overview-actions.js";
import {
  calculatePositionSnapshot,
  calculatePortfolioSnapshot,
  createPositionFromPurchase,
  loadPortfolioState,
  migrateLegacyDemoPortfolios,
  savePortfolioState,
  updatePortfolioAllocation,
} from "./portfolio-store.js";
import { createSignalPreloader, isSignalPayloadFresh } from "./signals/data-preload.js";
import { macroMarkets } from "./signals/macro/catalog.js";
import { getMacroChartPoint, renderMacroWorkspace, renderMacroWorkspaceError, renderMacroWorkspaceLoading } from "./signals/macro/view.js";
import { marketTimingMarkets } from "./signals/market-timing/catalog.js";
import {
  getMarketTimingChartPoint,
  getMarketTimingRefreshDelay,
  renderMarketTimingWorkspace,
  renderMarketTimingWorkspaceError,
  renderMarketTimingWorkspaceLoading,
} from "./signals/market-timing/view.js";
import {
  getSectorRotationChartPoint,
  getSectorRotationRefreshDelay,
  renderSectorRotationWorkspace,
  renderSectorRotationWorkspaceError,
  renderSectorRotationWorkspaceLoading,
} from "./signals/sector-rotation/view.js";
import {
  getInvestorSentimentRefreshDelay,
  getSentimentChartPoint,
  renderInvestorSentimentWorkspace,
  renderInvestorSentimentWorkspaceError,
  renderInvestorSentimentWorkspaceLoading,
} from "./signals/investor-sentiment/view.js";
import {
  getCapitalFlowChartPoint,
  getCapitalFlowRefreshDelay,
  renderCapitalConstituents,
  renderCapitalConstituentsError,
  renderCapitalConstituentsLoading,
  renderCapitalFlowWorkspace,
  renderCapitalFlowWorkspaceError,
  renderCapitalFlowWorkspaceLoading,
} from "./signals/capital-flow/view.js";
import {
  formatIndexPoints,
  formatMicroMarketTime,
  getMicroChartPoint,
  renderMicroWorkspace,
  renderMicroWorkspaceError,
  renderMicroWorkspaceLoading,
} from "./signals/micro-data/view.js";
import {
  renderStockAnalysisMarkup,
  renderStockDecisionDynamicMarkup,
} from "./signals/stock-analysis/view.js";
import { buildCompanyManagerInsight, companyResearchRefreshDelay } from "./signals/stock-analysis/company-research.js";
import { renderCompanyAnalysisShell } from "./signals/stock-analysis/company-research-view.js";
import {
  buildStockDecision,
  formatHoldingDays,
  holdingDaysFromSliderPosition,
  holdingProfileForDays,
  normalizeHoldingDays,
  sliderPositionFromHoldingDays,
} from "./signals/stock-analysis/decision.js";
import {
  brokerConnectionErrorMessage,
  dataSourceNetworkFailure,
  loadDataSourcePreferences,
  loadIbkrAutoSyncConfig,
  loadIbkrSnapshotCache,
  normalizeDataSourcePreferences,
  saveDataSourcePreferences,
  saveIbkrAutoSyncConfig,
  saveIbkrSnapshotCache,
} from "./data-sources/model.js";
import { renderDataSourceCenter } from "./data-sources/view.js";
import { brokerTargetFromTiming, renderBrokerOverview, renderBrokerUnavailable } from "./broker-overview.js";
import { calculatePortfolioTarget } from "./portfolio-target.js";
import {
  DEFAULT_PORTFOLIO_MANAGER_ID,
  applyManagerExposurePolicy,
  assignPortfolioManager,
  resolvePortfolioManager,
} from "./portfolio-managers.js";
import { renderManagerHoldingsReview, renderPortfolioManagerPanel } from "./portfolio-manager-view.js";
import { buildManagerPortfolioInsight } from "./portfolio-manager-insights.js";
import {
  buildPortfolioAnalysisProfile,
  normalizeAnalysisPreferences,
  profileSignalPayload,
  renderAnalysisProfileStrip,
} from "./portfolio-analysis-profile.js";
import { preferBrokerQuote } from "./broker-quote-priority.js";

const BROKER_PORTFOLIO_ID = "broker-real";

const stockCatalog = [
  { symbol: "600519", yahoo: "600519.SS", name: "贵州茅台", market: "A股 · 上海", currency: "CNY", sectorId: "consumer-staples", sector: "日常消费", price: 1341.99, change: -0.98 },
  { symbol: "000001", yahoo: "000001.SZ", name: "平安银行", market: "A股 · 深圳", currency: "CNY", sectorId: "financials", sector: "金融", price: 11.11, change: -1.24 },
  { symbol: "588170", yahoo: "588170.SS", name: "科创半导体ETF", market: "A股 · 上海", currency: "CNY", sectorId: "information-technology", sector: "信息技术", price: 1.021, change: 1.09 },
  { symbol: "588200", yahoo: "588200.SS", name: "科创芯片ETF", market: "A股 · 上海", currency: "CNY", sectorId: "information-technology", sector: "信息技术", price: 1.212, change: 0.66 },
  { symbol: "AAPL", yahoo: "AAPL", name: "Apple", market: "美股 · NASDAQ", currency: "USD", sectorId: "information-technology", sector: "信息技术", price: 305.3, change: 0.17 },
  { symbol: "MSFT", yahoo: "MSFT", name: "Microsoft", market: "美股 · NASDAQ", currency: "USD", sectorId: "information-technology", sector: "信息技术", price: 499.35, change: 0.7 },
  { symbol: "NVDA", yahoo: "NVDA", name: "NVIDIA", market: "美股 · NASDAQ", currency: "USD", sectorId: "information-technology", sector: "信息技术", price: 182.44, change: 1.86 },
  { symbol: "TSLA", yahoo: "TSLA", name: "Tesla", market: "美股 · NASDAQ", currency: "USD", sectorId: "consumer-discretionary", sector: "可选消费", price: 412.76, change: -0.62 },
];
const builtInStockSymbols = new Set(stockCatalog.map(({ symbol }) => symbol));

const defaultPortfolios = [
  {
    id: "custom-default",
    name: "我的自建组合",
    description: "按实际购买股数或投入金额建立持仓",
    color: "#39d98a",
    managerId: DEFAULT_PORTFOLIO_MANAGER_ID,
    targetReturn: 12,
    riskCapacity: 50,
    cash: 0,
    positions: [],
  },
];

const savedPortfolioState = loadPortfolioState(window.localStorage, defaultPortfolios);
const portfolios = migrateLegacyDemoPortfolios(savedPortfolioState.portfolios, defaultPortfolios);
for (let index = 0; index < portfolios.length; index += 1) {
  portfolios[index] = {
    ...assignPortfolioManager(portfolios[index], portfolios[index].managerId),
    ...normalizeAnalysisPreferences(portfolios[index]),
  };
}
for (const stock of savedPortfolioState.customStocks) {
  if (!stockCatalog.some(({ symbol }) => symbol === stock.symbol)) stockCatalog.push(stock);
}
let activePortfolioId = portfolios.some(({ id }) => id === savedPortfolioState.activePortfolioId)
  ? savedPortfolioState.activePortfolioId
  : portfolios[0].id;
const usdCny = 7.18;
let latestSearchResults = [];
let searchTimer;
let searchRequestId = 0;
let analysisRequestId = 0;
let analysisTimeRange = "3m";
let analysisChartRange = "3m";
let analysisHoldingDays = 90;
let analysisCustomStart = "";
let holdingDecisionTimer;
let holdingDecisionFrame;
let macroRequestId = 0;
let macroRefreshTimer;
let latestMacroPayload = null;
let marketTimingRequestId = 0;
let marketTimingRefreshTimer;
let latestMarketTimingPayload = null;
let portfolioQuoteRefreshTimer;
let portfolioQuoteRequest = null;
let sectorRotationRequestId = 0;
let sectorRotationRefreshTimer;
let latestSectorRotationPayload = null;
const activeSectorRotationSectors = { china: null, "united-states": null };
let investorSentimentRequestId = 0;
let investorSentimentRefreshTimer;
let latestInvestorSentimentPayload = null;
let capitalFlowRequestId = 0;
let capitalFlowRefreshTimer;
let latestCapitalFlowPayload = null;
let microRequestId = 0;
let microRefreshTimer;
let latestMicroPayload = null;
let dataSourcePreferences = loadDataSourcePreferences(window.localStorage);
let selectedDataSource = "free";
const dataSourceStatuses = {};
let newsCredentialStatuses = {};
let dataSourceHealthTimer;
const brokerAccountSnapshots = {};
const cachedIbkrSnapshot = loadIbkrSnapshotCache(window.sessionStorage);
if (cachedIbkrSnapshot) brokerAccountSnapshots.ibkr = cachedIbkrSnapshot;
const brokerSectorRequests = new Map();
let brokerAutoRefreshTimer;
let brokerSnapshotRequest;
let brokerAutoSelected = Boolean(cachedIbkrSnapshot);
let lastBrokerConnectionError = "";
if (cachedIbkrSnapshot) activePortfolioId = BROKER_PORTFOLIO_ID;
let pendingPositionStock = null;
let signalTimeRange = "1m";
let signalCustomStart = "";
const activeMicroInstruments = { china: "csi300", "united-states": "sp500" };
const activeCapitalFlowSectors = { china: null, "united-states": null };
const capitalConstituentCache = new Map();
const capitalConstituentRequests = new Map();
let activeAnalysisResult = null;
let activeAnalysisPayload = null;
const analysisPayloadCache = new Map();
let activeCompanyResearch = null;
let activeCompanyAnalysisTab = "market";
let companyResearchRefreshTimer;
const companyResearchCache = new Map();
const portfolioCompanyResearchRequests = new Map();
const stockDecisionScores = new Map();
const signalPreloader = createSignalPreloader();

function persistPortfolioState() {
  savePortfolioState(window.localStorage, {
    portfolios,
    activePortfolioId: activePortfolioId === BROKER_PORTFOLIO_ID ? portfolios[0]?.id : activePortfolioId,
    customStocks: stockCatalog.filter(({ symbol }) => !builtInStockSymbols.has(symbol)),
  });
}

function stockDecisionScoreKey(symbol, managerId, preferences = {}) {
  const normalized = normalizeAnalysisPreferences(preferences);
  return `${resolvePortfolioManager(managerId).id}:${normalized.targetReturn}:${normalized.riskCapacity}:${symbol}`;
}

function hydrateSignalWorkspaces(workspaces = {}) {
  if (!latestMacroPayload && Array.isArray(workspaces.macro?.markets) && isSignalPayloadFresh(workspaces.macro)) latestMacroPayload = workspaces.macro;
  if (!latestMarketTimingPayload && Array.isArray(workspaces.marketTiming?.markets) && isSignalPayloadFresh(workspaces.marketTiming)) latestMarketTimingPayload = workspaces.marketTiming;
  if (!latestSectorRotationPayload && Array.isArray(workspaces.sectorRotation?.markets) && isSignalPayloadFresh(workspaces.sectorRotation)) latestSectorRotationPayload = workspaces.sectorRotation;
  if (!latestInvestorSentimentPayload && Array.isArray(workspaces.investorSentiment?.markets) && isSignalPayloadFresh(workspaces.investorSentiment)) latestInvestorSentimentPayload = workspaces.investorSentiment;
  if (!latestCapitalFlowPayload && Array.isArray(workspaces.capitalFlow?.markets) && isSignalPayloadFresh(workspaces.capitalFlow)) latestCapitalFlowPayload = workspaces.capitalFlow;
  for (const market of latestSectorRotationPayload?.markets || []) {
    if (!activeSectorRotationSectors[market.id] && market.sectors?.length) activeSectorRotationSectors[market.id] = market.sectors[0].id;
  }
  for (const market of latestCapitalFlowPayload?.markets || []) {
    if (!activeCapitalFlowSectors[market.id] && market.sectors?.length) activeCapitalFlowSectors[market.id] = market.sectors[0].id;
  }
  renderOverviewSignalDirectory();
  if (resolveWorkspaceRoute(window.location.hash).workspace === "overview") {
    if (isBrokerPortfolioMode()) renderBrokerAccountOverview();
    else renderActivePortfolio();
  }
}

async function getPreloadedSignalWorkspace(id) {
  const bootstrap = await signalPreloader.load();
  hydrateSignalWorkspaces(bootstrap.workspaces);
  return bootstrap.workspaces[id];
}

function marketTimingRequestPath(force = false) {
  const params = new URLSearchParams({ range: signalTimeRange });
  if (signalTimeRange === "custom" && signalCustomStart) params.set("start", signalCustomStart);
  if (force) params.set("refresh", "1");
  return `/api/market-timing?${params.toString()}`;
}

function microMarketRequestPath(force = false) {
  const params = new URLSearchParams({
    range: signalTimeRange,
    china: activeMicroInstruments.china,
    us: activeMicroInstruments["united-states"],
  });
  if (signalTimeRange === "custom" && signalCustomStart) params.set("start", signalCustomStart);
  if (force) params.set("refresh", "1");
  return `/api/micro-market?${params.toString()}`;
}

const elements = {
  portfolioList: document.querySelector("#portfolio-list"),
  portfolioManagerPanel: document.querySelector("#portfolio-manager-panel"),
  todayActionPanel: document.querySelector("#today-action-panel"),
  managerHoldingsReview: document.querySelector("#manager-holdings-review"),
  portfolioTitle: document.querySelector("#portfolio-title"),
  holdingsBody: document.querySelector("#holdings-body"),
  holdingsEmpty: document.querySelector("#holdings-empty"),
  customHoldingsTableWrap: document.querySelector("#custom-holdings-table-wrap"),
  totalValue: document.querySelector("#total-value"),
  totalChange: document.querySelector("#total-change"),
  totalReturn: document.querySelector("#total-return"),
  marketDataStatus: document.querySelector("#market-data-status"),
  profitValue: document.querySelector("#profit-value"),
  targetPosition: document.querySelector("#target-position"),
  targetPositionDetail: document.querySelector("#target-position-detail"),
  customRiskState: document.querySelector("#custom-risk-state"),
  customRiskDetail: document.querySelector("#custom-risk-detail"),
  allocationRing: document.querySelector("#allocation-ring"),
  investedPercent: document.querySelector("#invested-percent"),
  allocationLegend: document.querySelector("#allocation-legend"),
  researchMetrics: document.querySelector("#research-metrics"),
  customPortfolioDashboard: document.querySelector("#custom-portfolio-dashboard"),
  search: document.querySelector("#stock-search"),
  searchResults: document.querySelector("#search-results"),
  dialog: document.querySelector("#create-portfolio-dialog"),
  createForm: document.querySelector("#create-portfolio-form"),
  toast: document.querySelector("#toast"),
  themeToggle: document.querySelector("#theme-toggle"),
  analysisDialog: document.querySelector("#stock-analysis-dialog"),
  analysisContent: document.querySelector("#analysis-content"),
  analysisName: document.querySelector("#analysis-stock-name"),
  analysisAvatar: document.querySelector("#analysis-stock-avatar"),
  analysisMarket: document.querySelector("#analysis-stock-market"),
  analysisMeta: document.querySelector("#analysis-stock-meta"),
  analysisSource: document.querySelector("#analysis-source"),
  analysisAddButton: document.querySelector("#analysis-add-button"),
  overviewWorkspace: document.querySelector("#overview-workspace"),
  microWorkspace: document.querySelector("#micro-workspace"),
  dataSourcesWorkspace: document.querySelector("#data-sources-workspace"),
  comparisonWorkspace: document.querySelector("#comparison-workspace"),
  comparisonGrid: document.querySelector("#comparison-grid"),
  comparisonTableBody: document.querySelector("#comparison-table-body"),
  signalsWorkspace: document.querySelector("#signals-workspace"),
  signalsHub: document.querySelector("#signals-hub"),
  signalDetail: document.querySelector("#signal-detail"),
  signalSubnav: document.querySelector("#signal-subnav"),
  overviewSubnav: document.querySelector("#overview-subnav"),
  signalDirectoryGrid: document.querySelector("#signal-directory-grid"),
  overviewSignalLinks: document.querySelector("#overview-signal-links"),
  navOverview: document.querySelector("#nav-overview"),
  navSignals: document.querySelector("#nav-signals"),
  navMicro: document.querySelector("#nav-micro"),
  navDataSources: document.querySelector("#nav-data-sources"),
  navComparison: document.querySelector("#nav-comparison"),
  pageContextCurrent: document.querySelector("#page-context-current"),
  allocationDialog: document.querySelector("#allocation-dialog"),
  allocationForm: document.querySelector("#allocation-form"),
  allocationPortfolioName: document.querySelector("#allocation-portfolio-name"),
  allocationCash: document.querySelector("#allocation-cash"),
  allocationPositions: document.querySelector("#allocation-positions"),
  addPositionDialog: document.querySelector("#add-position-dialog"),
  addPositionForm: document.querySelector("#add-position-form"),
  addPositionStock: document.querySelector("#add-position-stock"),
  purchaseCost: document.querySelector("#purchase-cost"),
  purchaseQuantity: document.querySelector("#purchase-quantity"),
  purchaseAmount: document.querySelector("#purchase-amount"),
  purchaseQuantityField: document.querySelector("#purchase-quantity-field"),
  purchaseAmountField: document.querySelector("#purchase-amount-field"),
  purchaseCurrencyLabel: document.querySelector("#purchase-currency-label"),
  purchasePreview: document.querySelector("#purchase-preview"),
  brokerPositionsPanel: document.querySelector("#broker-positions-panel"),
  brokerPositionsMeta: document.querySelector("#broker-positions-meta"),
  brokerAccountSummary: document.querySelector("#broker-account-summary"),
  brokerAllocation: document.querySelector("#broker-allocation"),
  brokerPositionsBody: document.querySelector("#broker-positions-body"),
  refreshBrokerPositions: document.querySelector("#refresh-broker-positions"),
};

function stockBySymbol(symbol) {
  return stockCatalog.find((stock) => stock.symbol === symbol);
}

function applyQuoteToStock(stock, quote) {
  stock.price = Number(quote.price);
  stock.previousClose = Number(quote.previousClose);
  stock.change = Number.isFinite(Number(quote.changePercent)) ? Number(quote.changePercent) : 0;
  stock.quoteTimestamp = quote.timestamp || null;
  stock.marketDate = quote.marketDate || null;
  stock.quoteSource = quote.source || null;
  stock.marketDataType = quote.marketDataType || null;
  if (quote.currency) stock.currency = quote.currency;
  return stock;
}

function heldQuoteStocks() {
  const held = new Set(portfolios.flatMap((portfolio) => (portfolio.positions || []).map(({ symbol }) => symbol)));
  return stockCatalog.filter((stock) => held.has(stock.symbol) && stock.yahoo);
}

async function requestIbkrMarketQuotes(symbols) {
  const config = loadIbkrAutoSyncConfig(window.localStorage);
  const usSymbols = [...new Set((symbols || []).filter((symbol) => !/\.(SS|SZ|BJ)$/i.test(symbol)))];
  if (!config || !usSymbols.length) return [];
  try {
    const response = await fetch("/api/broker-accounts/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId: "ibkr", config, symbols: usSymbols }),
    });
    const payload = await response.json();
    return response.ok && Array.isArray(payload.data) ? payload.data : [];
  } catch {
    return [];
  }
}

async function refreshPortfolioQuotes(force = false) {
  window.clearTimeout(portfolioQuoteRefreshTimer);
  const stocks = heldQuoteStocks();
  if (!stocks.length) {
    elements.marketDataStatus.textContent = "A股盘中 / 美股交易时段 · 暂无自建持仓";
    return [];
  }
  if (portfolioQuoteRequest) return portfolioQuoteRequest;
  elements.marketDataStatus.textContent = "正在同步持仓实时行情…";
  const symbols = [...new Set(stocks.map(({ yahoo }) => yahoo))];
  const params = new URLSearchParams({ symbols: symbols.join(",") });
  if (force) params.set("refresh", "1");
  portfolioQuoteRequest = Promise.all([
    fetch(`/api/quotes?${params.toString()}`),
    requestIbkrMarketQuotes(symbols),
  ])
    .then(async ([response, ibkrMarketQuotes]) => {
      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload.data)) throw new Error(payload?.error?.message || "组合行情读取失败");
      const quotes = new Map(payload.data.map((quote) => [quote.providerSymbol, quote]));
      const ibkrQuotes = new Map(ibkrMarketQuotes.map((quote) => [quote.providerSymbol, quote]));
      const ibkrModes = { live: 0, delayed: 0, account: 0 };
      for (const stock of stocks) {
        const fallbackQuote = quotes.get(stock.yahoo);
        if (!fallbackQuote) continue;
        const marketQuote = ibkrQuotes.get(stock.yahoo);
        const quote = marketQuote || preferBrokerQuote(stock, fallbackQuote, brokerAccountSnapshots.ibkr);
        if (marketQuote?.marketDataType === "live") ibkrModes.live += 1;
        else if (marketQuote) ibkrModes.delayed += 1;
        else if (quote.sourcePriority === "ibkr-position") ibkrModes.account += 1;
        applyQuoteToStock(stock, quote);
      }
      const marketDates = payload.data.map(({ marketDate }) => marketDate).filter(Boolean).sort();
      const newestDate = marketDates.at(-1) || "最新交易日";
      const ibkrCount = ibkrModes.live + ibkrModes.delayed + ibkrModes.account;
      const ibkrParts = [
        ibkrModes.live && `实时 ${ibkrModes.live}`,
        ibkrModes.delayed && `延迟/冻结 ${ibkrModes.delayed}`,
        ibkrModes.account && `账户估值 ${ibkrModes.account}`,
      ].filter(Boolean).join("、");
      const sourceNote = ibkrCount
        ? `IBKR 优先（${ibkrParts}） · 其余 yfinance 回退`
        : "yfinance 行情（IBKR 未返回可用报价）";
      elements.marketDataStatus.textContent = `持仓行情已更新 · ${newestDate} · ${sourceNote} · 每60秒检查`;
      persistPortfolioState();
      renderActivePortfolio();
      renderComparisonWorkspace();
      return payload.data;
    })
    .catch((error) => {
      elements.marketDataStatus.textContent = "行情更新失败 · 使用上次成功数据 · 60秒后重试";
      return Promise.reject(error);
    })
    .finally(() => {
      portfolioQuoteRequest = null;
      portfolioQuoteRefreshTimer = window.setTimeout(() => refreshPortfolioQuotes(false).catch(() => null), 60_000);
    });
  return portfolioQuoteRequest;
}

function valueInCny(position) {
  const stock = stockBySymbol(position.symbol);
  const rate = stock.currency === "USD" ? usdCny : 1;
  return stock.price * position.quantity * rate;
}

function costInCny(position) {
  const stock = stockBySymbol(position.symbol);
  const rate = stock.currency === "USD" ? usdCny : 1;
  return position.cost * position.quantity * rate;
}

function formatMoney(value, currency = "CNY") {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "CNY" ? 0 : 2,
  }).format(value);
}

function formatPrice(value, currency = "CNY") {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "CNY" ? 3 : 2,
  }).format(value);
}

function hasBrokerSnapshot() {
  return Object.values(brokerAccountSnapshots).some(Boolean);
}

function hasBrokerWorkspace() {
  return hasBrokerSnapshot() || Boolean(loadIbkrAutoSyncConfig(window.localStorage));
}

function isBrokerPortfolioMode() {
  return activePortfolioId === BROKER_PORTFOLIO_ID && hasBrokerWorkspace();
}

function activeCustomPortfolio() {
  return portfolios.find((item) => item.id === activePortfolioId) || portfolios[0];
}

function activeAnalysisProfile() {
  const portfolio = activeCustomPortfolio();
  return buildPortfolioAnalysisProfile(portfolio || {});
}

function profiledSignalPayload(scope, payload) {
  return profileSignalPayload(scope, payload, activeAnalysisProfile());
}

function renderProfiledSignalWorkspace(scope, payload, renderer, options = {}) {
  const profile = activeAnalysisProfile();
  return `${renderAnalysisProfileStrip(profile)}${renderer(profileSignalPayload(scope, payload, profile), options)}`;
}

function customPortfolioTarget(portfolio) {
  const positions = (portfolio.positions || []).map((position) => {
    const stock = stockBySymbol(position.symbol);
    return {
      symbol: position.symbol,
      marketId: stock?.currency === "CNY" ? "china" : "united-states",
      sectorId: stock?.sectorId || null,
      value: valueInCny(position),
      stockScore: stockDecisionScores.get(stockDecisionScoreKey(position.symbol, portfolio.managerId, portfolio)),
    };
  });
  const target = calculatePortfolioTarget({
    positions,
    timingPayload: latestMarketTimingPayload,
    sectorRotationPayload: latestSectorRotationPayload,
  });
  return applyManagerExposurePolicy({
    value: target.targetExposurePct,
    label: target.detailLabel,
    breakdown: target.breakdown,
  }, portfolio.managerId, portfolio);
}

function customRiskForExposure(current, target) {
  const gap = current - target;
  if (current > 100 || gap >= 20) return ["高仓位风险", `高于目标 ${Math.abs(gap).toFixed(1)} 个百分点`];
  if (gap >= 8) return ["仓位偏高", `高于目标 ${gap.toFixed(1)} 个百分点`];
  if (gap <= -15) return ["仓位偏低", `低于目标 ${Math.abs(gap).toFixed(1)} 个百分点`];
  return ["仓位匹配", `与目标相差 ${Math.abs(gap).toFixed(1)} 个百分点`];
}

function renderPortfolioNav() {
  const brokerButton = hasBrokerWorkspace()
    ? `<button class="portfolio-button broker-portfolio-button${isBrokerPortfolioMode() ? " active" : ""}" type="button" data-portfolio-id="${BROKER_PORTFOLIO_ID}" ${isBrokerPortfolioMode() ? 'aria-current="true"' : ""}>
        <span class="portfolio-color broker-color" aria-hidden="true"></span>
        <span><strong>真实数据组合</strong><small>IBKR · ${hasBrokerSnapshot() ? `${Object.values(brokerAccountSnapshots).reduce((sum, snapshot) => sum + Number(snapshot?.meta?.positionCount || 0), 0)} 个真实持仓` : "连接待恢复"}</small></span>
        <span>›</span>
      </button>`
    : "";
  const customButtons = portfolios
    .map((portfolio) => {
      const active = portfolio.id === activePortfolioId;
      return `<button class="portfolio-button${active ? " active" : ""}" type="button" data-portfolio-id="${portfolio.id}" style="--portfolio-color:${portfolio.color}" ${active ? 'aria-current="true"' : ""}>
        <span class="portfolio-color" aria-hidden="true"></span>
        <span><strong>${escapeHtml(portfolio.name)}</strong><small>${portfolio.positions.length} 个标的</small></span>
        <span>›</span>
      </button>`;
    })
    .join("");
  elements.portfolioList.innerHTML = `${brokerButton}${customButtons}`;
}

function renderAllocation(portfolio, investedValue, totalValue) {
  const marketValues = portfolio.positions.reduce(
    (acc, position) => {
      const stock = stockBySymbol(position.symbol);
      const bucket = stock.currency === "USD" ? "美股" : "A股";
      acc[bucket] += valueInCny(position);
      return acc;
    },
    { A股: 0, 美股: 0 },
  );
  const invested = totalValue ? (investedValue / totalValue) * 100 : 0;
  const aShare = totalValue ? (marketValues.A股 / totalValue) * 100 : 0;
  const usShare = totalValue ? (marketValues.美股 / totalValue) * 100 : 0;
  const cash = Math.max(0, 100 - aShare - usShare);
  elements.investedPercent.textContent = `${invested.toFixed(0)}%`;
  elements.allocationRing.style.background = `conic-gradient(var(--market-cn) 0 ${aShare}%, var(--market-us) ${aShare}% ${aShare + usShare}%, var(--cash) ${aShare + usShare}% 100%)`;
  elements.allocationRing.setAttribute("aria-label", `A股 ${aShare.toFixed(1)}%，美股 ${usShare.toFixed(1)}%，现金 ${cash.toFixed(1)}%`);
  const items = [
    ["A股", aShare, "var(--market-cn)"],
    ["美股", usShare, "var(--market-us)"],
    ["现金", cash, "var(--cash)"],
  ];
  elements.allocationLegend.innerHTML = items
    .map(([label, value, color]) => `<div><span class="legend-dot" style="--legend-color:${color}" aria-hidden="true"></span><dt>${label}</dt><dd>${value.toFixed(1)}%</dd></div>`)
    .join("");
}

function portfolioCompanyResearch(portfolio) {
  return Object.fromEntries((portfolio?.positions || []).map(({ symbol }) => {
    const stock = stockBySymbol(symbol);
    return [symbol, stock ? companyResearchCache.get(stock.yahoo) || null : null];
  }).filter(([, research]) => research));
}

function queuePortfolioCompanyResearch(portfolio) {
  const candidates = (portfolio?.positions || []).slice(0, 12).map(({ symbol }) => stockBySymbol(symbol)).filter(Boolean);
  const tasks = candidates.map((stock) => {
    const cached = companyResearchCache.get(stock.yahoo);
    const nextRefreshAt = Date.parse(cached?.meta?.nextRefreshAt || "");
    if (cached && (!Number.isFinite(nextRefreshAt) || nextRefreshAt > Date.now())) return null;
    if (portfolioCompanyResearchRequests.has(stock.yahoo)) return portfolioCompanyResearchRequests.get(stock.yahoo);
    const market = stock.currency === "CNY" ? "china" : "united-states";
    const params = new URLSearchParams({ market, symbol: stock.symbol, providerSymbol: stock.yahoo, companyName: stock.name });
    const request = fetch(`/api/company-research?${params.toString()}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error?.message || "公司研究读取失败");
        companyResearchCache.set(stock.yahoo, payload.data);
      })
      .catch(() => {
        companyResearchCache.set(stock.yahoo, {
          market, symbol: stock.symbol, providerSymbol: stock.yahoo, companyName: stock.name,
          fundamentals: { status: "unavailable", periods: [], reason: "公司研究源暂时不可用，系统将在下一刷新周期重试。" },
          news: [], providers: [],
          meta: { fetchedAt: new Date().toISOString(), nextRefreshAt: new Date(Date.now() + 600_000).toISOString(), refreshAfterSeconds: 600, dynamic: true },
        });
      })
      .finally(() => portfolioCompanyResearchRequests.delete(stock.yahoo));
    portfolioCompanyResearchRequests.set(stock.yahoo, request);
    return request;
  }).filter(Boolean);
  if (!tasks.length) return;
  Promise.allSettled(tasks).then(() => {
    if (activeCustomPortfolio()?.id === portfolio.id) renderActivePortfolio();
  });
}

function renderActivePortfolio() {
  const brokerMode = isBrokerPortfolioMode();
  elements.researchMetrics.hidden = brokerMode;
  elements.customPortfolioDashboard.hidden = brokerMode;
  elements.portfolioManagerPanel.hidden = brokerMode;
  if (brokerMode) {
    renderBrokerAccountOverview();
    return;
  }
  elements.brokerPositionsPanel.hidden = true;
  const portfolio = activeCustomPortfolio();
  if (!portfolio) return;
  queuePortfolioCompanyResearch(portfolio);
  const managerInsight = buildManagerPortfolioInsight({
    managerId: portfolio.managerId,
    portfolio,
    stocks: stockCatalog,
    usdCny,
    macroPayload: latestMacroPayload,
    timingPayload: latestMarketTimingPayload,
    sectorRotationPayload: latestSectorRotationPayload,
    targetReturn: portfolio.targetReturn,
    riskCapacity: portfolio.riskCapacity,
    companyResearchBySymbol: portfolioCompanyResearch(portfolio),
  });
  elements.portfolioManagerPanel.innerHTML = renderPortfolioManagerPanel(portfolio.managerId, {
    portfolioName: portfolio.name,
    insight: managerInsight,
    targetReturn: portfolio.targetReturn,
    riskCapacity: portfolio.riskCapacity,
  });
  elements.portfolioTitle.textContent = portfolio.name;
  const snapshot = portfolioSnapshot(portfolio);
  const investedValue = snapshot.investedValue;
  const totalCost = snapshot.totalCost;
  const totalValue = investedValue + portfolio.cash;
  const profit = snapshot.profit;
  const returnRate = snapshot.returnRate;
  const dailyChange = snapshot.dailyChange;

  elements.totalValue.textContent = formatMoney(investedValue);
  elements.totalChange.textContent = `${dailyChange >= 0 ? "+" : ""}${formatMoney(dailyChange)}`;
  elements.totalChange.className = dailyChange >= 0 ? "gain" : "loss";
  elements.totalReturn.textContent = `${returnRate >= 0 ? "+" : ""}${returnRate.toFixed(2)}%`;
  elements.totalReturn.className = returnRate >= 0 ? "gain" : "loss";
  elements.profitValue.textContent = `${profit >= 0 ? "+" : ""}${formatMoney(profit)}`;
  const target = customPortfolioTarget(portfolio);
  const currentExposure = totalValue > 0 ? investedValue / totalValue * 100 : 0;
  const [riskLabel, riskDetail] = portfolio.positions.length
    ? customRiskForExposure(currentExposure, target.value)
    : ["待建仓", "建立持仓后计算仓位偏差"];
  elements.targetPosition.textContent = portfolio.positions.length ? `${target.value.toFixed(0)}%` : "—";
  elements.targetPositionDetail.textContent = target.label;
  elements.customRiskState.textContent = riskLabel;
  elements.customRiskDetail.textContent = riskDetail;
  const brokerSnapshot = Object.values(brokerAccountSnapshots).find(Boolean);
  elements.todayActionPanel.innerHTML = renderOverviewActionPanel(buildOverviewActionModel({
    mode: "custom",
    portfolioName: portfolio.name,
    positionCount: portfolio.positions.length,
    investedValue,
    totalValue,
    cash: portfolio.cash,
    targetExposurePct: target.value,
    riskLabel,
    riskDetail,
    broker: brokerSnapshot
      ? { state: brokerSnapshot.meta?.snapshotState === "cached" ? "cached" : "ready", positionCount: brokerSnapshot.meta?.positionCount }
      : hasBrokerWorkspace()
        ? { state: "unavailable", message: lastBrokerConnectionError }
        : { state: "not-configured" },
  }));

  elements.holdingsBody.innerHTML = portfolio.positions
    .map((position) => {
      const stock = stockBySymbol(position.symbol);
      const positionSnapshot = calculatePositionSnapshot(position, stock, usdCny);
      const value = positionSnapshot.marketValue;
      const weight = investedValue ? (value / investedValue) * 100 : 0;
      const changeClass = stock.change >= 0 ? "gain" : "loss";
      const profitClass = positionSnapshot.profit > 0 ? "gain" : positionSnapshot.profit < 0 ? "loss" : "neutral";
      const profitSign = positionSnapshot.profit > 0 ? "+" : "";
      const marketName = stock.currency === "USD" ? "美股" : "A股";
      const marketClass = stock.currency === "USD" ? "market-us" : "market-cn";
      return `<tr>
        <td><div class="stock-cell"><span class="stock-avatar">${escapeHtml(stock.symbol.slice(0, 2))}</span><span><strong>${escapeHtml(stock.name)}</strong><small>${escapeHtml(stock.symbol)}</small></span></div></td>
        <td><span class="market-badge ${marketClass}">${marketName}</span></td>
        <td>${formatPrice(positionSnapshot.purchasePrice, stock.currency)}</td>
        <td>${formatPrice(stock.price, stock.currency)}</td>
        <td class="${changeClass}">${stock.change >= 0 ? "+" : ""}${stock.change.toFixed(2)}%</td>
        <td class="holding-profit-cell ${profitClass}"><strong>${profitSign}${formatMoney(positionSnapshot.profit)}</strong><small>${profitSign}${positionSnapshot.returnRate.toFixed(2)}%</small></td>
        <td>${formatMoney(value)}</td>
        <td><span class="weight-bar"><i style="--weight:${Math.min(weight, 100)}%"></i>${weight.toFixed(1)}%</span></td>
        <td><button class="remove-button" type="button" data-remove-symbol="${escapeHtml(stock.symbol)}" aria-label="从${escapeHtml(portfolio.name)}移除${escapeHtml(stock.name)}">×</button></td>
      </tr>`;
    })
    .join("");
  const managerReviewMarkup = renderManagerHoldingsReview(managerInsight);
  elements.managerHoldingsReview.innerHTML = managerReviewMarkup;
  elements.managerHoldingsReview.hidden = !managerReviewMarkup;
  elements.holdingsEmpty.hidden = portfolio.positions.length > 0;
  elements.customHoldingsTableWrap.hidden = portfolio.positions.length === 0;
  renderAllocation(portfolio, investedValue, totalValue);
}

function renderBrokerAccountOverview() {
  const snapshots = Object.values(brokerAccountSnapshots).filter(Boolean);
  const brokerMode = isBrokerPortfolioMode();
  elements.brokerPositionsPanel.hidden = !brokerMode;
  if (!brokerMode) return;
  const rendered = snapshots.length
    ? renderBrokerOverview(snapshots, brokerTargetFromTiming(snapshots, latestMarketTimingPayload, {
        sectorRotationPayload: latestSectorRotationPayload,
        stockScores: stockDecisionScores,
      }))
    : renderBrokerUnavailable(lastBrokerConnectionError || "IBKR TWS 当前未建立 Socket 连接");
  elements.brokerPositionsMeta.textContent = rendered.meta;
  elements.brokerAccountSummary.innerHTML = rendered.summary;
  elements.brokerAllocation.innerHTML = rendered.allocation;
  elements.brokerPositionsBody.innerHTML = rendered.rows;
  elements.todayActionPanel.innerHTML = renderOverviewActionPanel(buildOverviewActionModel({
    mode: "broker",
    broker: snapshots.length
      ? {
          state: snapshots.some((snapshot) => snapshot.meta?.snapshotState === "cached") ? "cached" : "ready",
          positionCount: rendered.positionCount,
          currentExposurePct: rendered.analysis.currentExposurePct,
          targetExposurePct: rendered.analysis.targetExposurePct,
          riskLabel: rendered.analysis.risk.label,
          riskDetail: rendered.analysis.risk.detail,
        }
      : { state: "unavailable", message: lastBrokerConnectionError },
  }));
  if (resolveWorkspaceRoute(window.location.hash).workspace === "overview") {
    elements.portfolioTitle.textContent = "真实数据组合";
    elements.pageContextCurrent.textContent = "IBKR 真实账户";
  }
}

function portfolioSnapshot(portfolio) {
  return calculatePortfolioSnapshot(portfolio, stockCatalog, usdCny);
}

function renderComparisonWorkspace() {
  const snapshots = portfolios.map((portfolio) => ({ portfolio, snapshot: portfolioSnapshot(portfolio) }));
  const leader = snapshots.reduce((best, item) => (
    !best || item.snapshot.returnRate > best.snapshot.returnRate ? item : best
  ), null);
  elements.comparisonGrid.innerHTML = snapshots.map(({ portfolio, snapshot }) => {
    const total = snapshot.totalValue || 1;
    const cnWeight = snapshot.marketValues.cn / total * 100;
    const usWeight = snapshot.marketValues.us / total * 100;
    const cashWeight = Math.max(0, Number(portfolio.cash || 0) / total * 100);
    const tone = snapshot.returnRate >= 0 ? "gain" : "loss";
    return `<article class="comparison-card${leader?.portfolio.id === portfolio.id ? " is-leader" : ""}">
      <header><span class="portfolio-color" style="--portfolio-color:${portfolio.color}" aria-hidden="true"></span><div><h3>${escapeHtml(portfolio.name)}</h3><p>${escapeHtml(portfolio.description || "暂无投资思路说明")}</p></div>${leader?.portfolio.id === portfolio.id ? '<em>当前收益领先</em>' : ""}</header>
      <div class="comparison-value"><span>组合总市值</span><strong>${formatMoney(snapshot.totalValue)}</strong></div>
      <dl class="comparison-kpis">
        <div><dt>累计收益</dt><dd class="${tone}">${snapshot.returnRate >= 0 ? "+" : ""}${snapshot.returnRate.toFixed(2)}%</dd></div>
        <div><dt>持仓数</dt><dd>${portfolio.positions.length}</dd></div>
        <div><dt>现金占比</dt><dd>${cashWeight.toFixed(1)}%</dd></div>
      </dl>
      <div class="comparison-allocation" aria-label="A股 ${cnWeight.toFixed(1)}%，美股 ${usWeight.toFixed(1)}%，现金 ${cashWeight.toFixed(1)}%">
        <i class="cn" style="--segment:${cnWeight}%"></i><i class="us" style="--segment:${usWeight}%"></i><i class="cash" style="--segment:${cashWeight}%"></i>
      </div>
      <footer><span class="market-label market-cn">A股 ${cnWeight.toFixed(1)}%</span><span class="market-label market-us">美股 ${usWeight.toFixed(1)}%</span><span>现金 ${cashWeight.toFixed(1)}%</span></footer>
    </article>`;
  }).join("");
  elements.comparisonTableBody.innerHTML = snapshots
    .sort((a, b) => b.snapshot.returnRate - a.snapshot.returnRate)
    .map(({ portfolio, snapshot }, index) => `<tr>
      <td>${index + 1}</td><td><strong>${escapeHtml(portfolio.name)}</strong><small>${escapeHtml(portfolio.description || "未填写")}</small></td>
      <td>${formatMoney(snapshot.totalValue)}</td><td class="${snapshot.returnRate >= 0 ? "gain" : "loss"}">${snapshot.returnRate >= 0 ? "+" : ""}${snapshot.returnRate.toFixed(2)}%</td>
      <td>${snapshot.dailyChange >= 0 ? "+" : ""}${formatMoney(snapshot.dailyChange)}</td><td>${portfolio.positions.length}</td>
    </tr>`).join("");
}

function openAllocationDialog() {
  const portfolio = activeCustomPortfolio();
  elements.allocationPortfolioName.textContent = portfolio.name;
  elements.allocationCash.value = String(portfolio.cash);
  elements.allocationPositions.innerHTML = portfolio.positions.length
    ? portfolio.positions.map((position) => {
      const stock = stockBySymbol(position.symbol);
      return `<div class="allocation-edit-row" data-allocation-symbol="${escapeHtml(position.symbol)}">
        <div><strong>${escapeHtml(stock?.name || position.symbol)}</strong><small>${escapeHtml(position.symbol)} · ${stock?.currency === "USD" ? "美元" : "人民币"}</small></div>
        <label><span>数量</span><input data-allocation-quantity type="number" min="0" step="any" required value="${position.quantity}"></label>
        <label><span>成本价</span><input data-allocation-cost type="number" min="0" step="any" required value="${position.cost}"></label>
      </div>`;
    }).join("")
    : '<div class="dialog-empty-state">当前组合还没有持仓，可先通过顶部搜索添加股票。</div>';
  elements.allocationDialog.showModal();
}

function currentOverviewMarkets() {
  return detectHeldMarkets(isBrokerPortfolioMode()
    ? { brokerSnapshots: Object.values(brokerAccountSnapshots).filter(Boolean) }
    : { portfolio: activeCustomPortfolio(), stockCatalog });
}

function overviewSignalWorkspaces() {
  return {
    macro: latestMacroPayload ? profiledSignalPayload("macro", latestMacroPayload) : null,
    marketTiming: latestMarketTimingPayload ? profiledSignalPayload("market-timing", latestMarketTimingPayload) : null,
    sectorRotation: latestSectorRotationPayload ? profiledSignalPayload("sector-rotation", latestSectorRotationPayload) : null,
    investorSentiment: latestInvestorSentimentPayload ? profiledSignalPayload("investor-sentiment", latestInvestorSentimentPayload) : null,
    capitalFlow: latestCapitalFlowPayload ? profiledSignalPayload("capital-flow", latestCapitalFlowPayload) : null,
  };
}

function renderOverviewSignalDirectory() {
  elements.overviewSignalLinks.innerHTML = renderOverviewSignalLinks(
    signalDirectories,
    currentOverviewMarkets(),
    overviewSignalWorkspaces(),
  );
}

function renderSignalDirectoryStructure(activeDirectory = null) {
  elements.signalSubnav.innerHTML = signalDirectories
    .map((directory) => `<a class="signal-subnav-link${directory.id === activeDirectory ? " active" : ""}" href="#signals/${directory.id}" ${directory.id === activeDirectory ? 'aria-current="page"' : ""}>
      <span>${directory.index}</span>${escapeHtml(directory.title)}
    </a>`)
    .join("");

  renderOverviewSignalDirectory();

  elements.signalDirectoryGrid.innerHTML = signalDirectories
    .map((directory) => `<a class="signal-directory-card" href="#signals/${directory.id}" aria-label="进入${escapeHtml(directory.title)}目录">
      <span class="directory-index">${directory.index}</span>
      <div class="directory-name"><small>${directory.english}</small><h3>${escapeHtml(directory.title)}</h3></div>
      <p>${escapeHtml(directory.description)}</p>
      <em class="directory-status">${escapeHtml(directory.status)}</em>
      <strong>打开目录 <span aria-hidden="true">→</span></strong>
    </a>`)
    .join("");
}

function renderSignalDetail(directory) {
  if (directory.id === "macro") {
    elements.signalDetail.innerHTML = latestMacroPayload
      ? renderProfiledSignalWorkspace("macro", latestMacroPayload, renderMacroWorkspace, { range: signalTimeRange, customStart: signalCustomStart })
      : renderMacroWorkspaceLoading(macroMarkets);
    loadMacroWorkspaceData();
    return;
  }

  if (directory.id === "market-timing") {
    elements.signalDetail.innerHTML = latestMarketTimingPayload
      ? renderProfiledSignalWorkspace("market-timing", latestMarketTimingPayload, renderMarketTimingWorkspace, { range: signalTimeRange, customStart: signalCustomStart })
      : renderMarketTimingWorkspaceLoading(marketTimingMarkets);
    loadMarketTimingWorkspaceData(false, false);
    return;
  }

  if (directory.id === "sector-rotation") {
    elements.signalDetail.innerHTML = latestSectorRotationPayload
      ? renderProfiledSignalWorkspace("sector-rotation", latestSectorRotationPayload, renderSectorRotationWorkspace, { range: signalTimeRange, customStart: signalCustomStart, activeSectors: activeSectorRotationSectors })
      : renderSectorRotationWorkspaceLoading();
    loadSectorRotationWorkspaceData();
    return;
  }

  if (directory.id === "investor-sentiment") {
    elements.signalDetail.innerHTML = latestInvestorSentimentPayload
      ? renderProfiledSignalWorkspace("investor-sentiment", latestInvestorSentimentPayload, renderInvestorSentimentWorkspace, { range: signalTimeRange, customStart: signalCustomStart })
      : renderInvestorSentimentWorkspaceLoading();
    loadInvestorSentimentWorkspaceData(false, false);
    return;
  }

  if (directory.id === "capital-flow") {
    elements.signalDetail.innerHTML = latestCapitalFlowPayload
      ? renderProfiledSignalWorkspace("capital-flow", latestCapitalFlowPayload, renderCapitalFlowWorkspace, { range: signalTimeRange, customStart: signalCustomStart, activeSectors: activeCapitalFlowSectors })
      : renderCapitalFlowWorkspaceLoading();
    loadCapitalFlowWorkspaceData();
    return;
  }

  elements.signalDetail.innerHTML = `<a class="back-link" href="#signals">← 返回宏观数据目录</a>
    <header class="signal-detail-header">
      <div><p class="eyebrow">${directory.english}</p><h2>${escapeHtml(directory.title)}</h2><p>${escapeHtml(directory.description)}</p></div>
      <span class="structure-status">目录已创建</span>
    </header>
    <section class="definition-placeholder" aria-labelledby="definition-title">
      <span class="placeholder-index">${directory.index}</span>
      <div>
        <p class="eyebrow">MODULE DEFINITION</p>
        <h3 id="definition-title">等待你的模块定义</h3>
        <p>这里暂不预设分析逻辑。你讲解这个板块后，我们再补充数据源、指标、计算规则和最终输出。</p>
      </div>
      <dl class="definition-list">
        <div><dt>数据源</dt><dd>待确定</dd></div>
        <div><dt>指标体系</dt><dd>待确定</dd></div>
        <div><dt>信号规则</dt><dd>待确定</dd></div>
        <div><dt>输出格式</dt><dd>待确定</dd></div>
      </dl>
    </section>`;
}

async function loadMacroWorkspaceData(force = false, usePreload = true) {
  const requestId = ++macroRequestId;
  const refreshButton = elements.signalDetail.querySelector("[data-refresh-macro]");
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = force ? "正在检查…" : "正在连接…";
  }
  try {
    let data = !force && usePreload && isSignalPayloadFresh(latestMacroPayload) ? latestMacroPayload : null;
    if (!data && !force && usePreload) {
      try { data = await getPreloadedSignalWorkspace("macro"); } catch { /* individual endpoint fallback */ }
      if (!isSignalPayloadFresh(data)) data = null;
    }
    if (!data) {
      const response = await fetch(`/api/macro${force ? "?refresh=1" : ""}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || "宏观数据读取失败");
      data = payload?.data;
    }
    const route = resolveWorkspaceRoute(window.location.hash);
    if (requestId !== macroRequestId || route.directory !== "macro") return;
    if (!Array.isArray(data?.markets)) throw new Error("宏观数据返回格式不正确");
    latestMacroPayload = data;
    elements.signalDetail.innerHTML = renderProfiledSignalWorkspace("macro", data, renderMacroWorkspace, { range: signalTimeRange, customStart: signalCustomStart });
    window.clearTimeout(macroRefreshTimer);
    const refreshDelay = Math.max(60, Number(data.refreshAfterSeconds) || 21600) * 1000;
    macroRefreshTimer = window.setTimeout(() => {
      if (resolveWorkspaceRoute(window.location.hash).directory === "macro") loadMacroWorkspaceData(false, false);
    }, refreshDelay);
  } catch (error) {
    const route = resolveWorkspaceRoute(window.location.hash);
    if (requestId !== macroRequestId || route.directory !== "macro") return;
    elements.signalDetail.innerHTML = renderMacroWorkspaceError(error.message || "数据源暂时不可用，请稍后重试", macroMarkets);
  }
}

async function loadMarketTimingWorkspaceData(force = false, usePreload = true) {
  const requestId = ++marketTimingRequestId;
  const status = elements.signalDetail.querySelector(".timing-header-actions .quality-status");
  if (status) status.textContent = force ? "正在刷新数据…" : "正在检查数据…";
  try {
    let data = !force && usePreload && isSignalPayloadFresh(latestMarketTimingPayload) ? latestMarketTimingPayload : null;
    if (!data && !force && usePreload) {
      try { data = await getPreloadedSignalWorkspace("marketTiming"); } catch { /* individual endpoint fallback */ }
      if (!isSignalPayloadFresh(data)) data = null;
    }
    if (!data) {
      const response = await fetch(marketTimingRequestPath(force));
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || "市场择时数据读取失败");
      data = payload?.data;
    }
    const route = resolveWorkspaceRoute(window.location.hash);
    if (requestId !== marketTimingRequestId || route.directory !== "market-timing") return;
    if (!Array.isArray(data?.markets)) throw new Error("市场择时数据返回格式不正确");
    latestMarketTimingPayload = data;
    elements.signalDetail.innerHTML = renderProfiledSignalWorkspace("market-timing", data, renderMarketTimingWorkspace, { range: signalTimeRange, customStart: signalCustomStart });
    window.clearTimeout(marketTimingRefreshTimer);
    marketTimingRefreshTimer = window.setTimeout(() => {
      if (resolveWorkspaceRoute(window.location.hash).directory === "market-timing") loadMarketTimingWorkspaceData(false, false);
    }, getMarketTimingRefreshDelay(data));
  } catch (error) {
    const route = resolveWorkspaceRoute(window.location.hash);
    if (requestId !== marketTimingRequestId || route.directory !== "market-timing") return;
    elements.signalDetail.innerHTML = renderMarketTimingWorkspaceError(error.message || "数据源暂时不可用，请稍后重试", marketTimingMarkets);
  }
}

async function loadSectorRotationWorkspaceData(force = false, usePreload = true) {
  const requestId = ++sectorRotationRequestId;
  const refreshButton = elements.signalDetail.querySelector("[data-refresh-sector-rotation]");
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = force ? "正在刷新…" : "正在检查…";
  }
  try {
    let data = !force && usePreload && isSignalPayloadFresh(latestSectorRotationPayload) ? latestSectorRotationPayload : null;
    if (!data && !force && usePreload) {
      try { data = await getPreloadedSignalWorkspace("sectorRotation"); } catch { /* individual endpoint fallback */ }
      if (!isSignalPayloadFresh(data)) data = null;
    }
    if (!data) {
      const response = await fetch(`/api/sector-rotation${force ? "?refresh=1" : ""}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || "板块轮动数据读取失败");
      data = payload?.data;
    }
    const route = resolveWorkspaceRoute(window.location.hash);
    if (requestId !== sectorRotationRequestId || route.directory !== "sector-rotation") return;
    if (!Array.isArray(data?.markets)) throw new Error("板块轮动数据返回格式不正确");
    latestSectorRotationPayload = data;
    for (const market of data.markets) {
      if (!activeSectorRotationSectors[market.id] && market.sectors?.length) {
        activeSectorRotationSectors[market.id] = market.sectors[0].id;
      }
    }
    elements.signalDetail.innerHTML = renderProfiledSignalWorkspace("sector-rotation", data, renderSectorRotationWorkspace, { range: signalTimeRange, customStart: signalCustomStart, activeSectors: activeSectorRotationSectors });
    window.clearTimeout(sectorRotationRefreshTimer);
    sectorRotationRefreshTimer = window.setTimeout(() => {
      if (resolveWorkspaceRoute(window.location.hash).directory === "sector-rotation") loadSectorRotationWorkspaceData(false, false);
    }, getSectorRotationRefreshDelay(data));
  } catch (error) {
    const route = resolveWorkspaceRoute(window.location.hash);
    if (requestId !== sectorRotationRequestId || route.directory !== "sector-rotation") return;
    elements.signalDetail.innerHTML = renderSectorRotationWorkspaceError(error.message || "免费数据源暂时不可用，请稍后重试");
  }
}

async function loadInvestorSentimentWorkspaceData(force = false, usePreload = true) {
  const requestId = ++investorSentimentRequestId;
  const status = elements.signalDetail.querySelector(".sentiment-header-status .quality-status");
  if (status) status.textContent = force ? "正在刷新数据…" : "正在检查数据…";
  try {
    let data = !force && usePreload && isSignalPayloadFresh(latestInvestorSentimentPayload) ? latestInvestorSentimentPayload : null;
    if (!data && !force && usePreload) {
      try { data = await getPreloadedSignalWorkspace("investorSentiment"); } catch { /* individual endpoint fallback */ }
      if (!isSignalPayloadFresh(data)) data = null;
    }
    if (!data) {
      const response = await fetch(`/api/investor-sentiment${force ? "?refresh=1" : ""}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || "投资者情绪数据读取失败");
      data = payload?.data;
    }
    const route = resolveWorkspaceRoute(window.location.hash);
    if (requestId !== investorSentimentRequestId || route.directory !== "investor-sentiment") return;
    if (!Array.isArray(data?.markets)) throw new Error("投资者情绪数据返回格式不正确");
    latestInvestorSentimentPayload = data;
    elements.signalDetail.innerHTML = renderProfiledSignalWorkspace("investor-sentiment", data, renderInvestorSentimentWorkspace, { range: signalTimeRange, customStart: signalCustomStart });
    window.clearTimeout(investorSentimentRefreshTimer);
    investorSentimentRefreshTimer = window.setTimeout(() => {
      if (resolveWorkspaceRoute(window.location.hash).directory === "investor-sentiment") loadInvestorSentimentWorkspaceData(false, false);
    }, getInvestorSentimentRefreshDelay(data));
  } catch (error) {
    const route = resolveWorkspaceRoute(window.location.hash);
    if (requestId !== investorSentimentRequestId || route.directory !== "investor-sentiment") return;
    elements.signalDetail.innerHTML = renderInvestorSentimentWorkspaceError(error.message || "共享免费行情暂时不可用，请稍后重试");
  }
}

async function loadCapitalFlowWorkspaceData(force = false, usePreload = true) {
  const requestId = ++capitalFlowRequestId;
  const refreshButton = elements.signalDetail.querySelector("[data-refresh-capital-flow]");
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = force ? "正在刷新…" : "正在检查…";
  }
  try {
    let data = !force && usePreload && isSignalPayloadFresh(latestCapitalFlowPayload) ? latestCapitalFlowPayload : null;
    if (!data && !force && usePreload) {
      try { data = await getPreloadedSignalWorkspace("capitalFlow"); } catch { /* individual endpoint fallback */ }
      if (!isSignalPayloadFresh(data)) data = null;
    }
    if (!data) {
      const response = await fetch(`/api/capital-flow${force ? "?refresh=1" : ""}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || "资金流数据读取失败");
      data = payload?.data;
    }
    const route = resolveWorkspaceRoute(window.location.hash);
    if (requestId !== capitalFlowRequestId || route.directory !== "capital-flow") return;
    if (!Array.isArray(data?.markets)) throw new Error("资金流数据返回格式不正确");
    latestCapitalFlowPayload = data;
    for (const market of data.markets) {
      if (!activeCapitalFlowSectors[market.id] && market.sectors?.length) activeCapitalFlowSectors[market.id] = market.sectors[0].id;
    }
    elements.signalDetail.innerHTML = renderProfiledSignalWorkspace("capital-flow", data, renderCapitalFlowWorkspace, { range: signalTimeRange, customStart: signalCustomStart, activeSectors: activeCapitalFlowSectors });
    prefetchActiveCapitalSectors();
    window.clearTimeout(capitalFlowRefreshTimer);
    capitalFlowRefreshTimer = window.setTimeout(() => {
      if (resolveWorkspaceRoute(window.location.hash).directory === "capital-flow") loadCapitalFlowWorkspaceData(false, false);
    }, getCapitalFlowRefreshDelay(data));
  } catch (error) {
    const route = resolveWorkspaceRoute(window.location.hash);
    if (requestId !== capitalFlowRequestId || route.directory !== "capital-flow") return;
    elements.signalDetail.innerHTML = renderCapitalFlowWorkspaceError(error.message || "免费数据源暂时不可用，请稍后重试");
  }
}

async function loadMicroWorkspaceData(force = false, focusSelector = "") {
  const requestId = ++microRequestId;
  if (!latestMicroPayload || force) elements.microWorkspace.innerHTML = renderMicroWorkspaceLoading();
  try {
    const response = await fetch(microMarketRequestPath(force));
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || "微观量价数据读取失败");
    const data = payload?.data;
    const route = resolveWorkspaceRoute(window.location.hash);
    if (requestId !== microRequestId || route.workspace !== "micro") return;
    if (!Array.isArray(data?.markets)) throw new Error("微观量价数据返回格式不正确");
    latestMicroPayload = data;
    elements.microWorkspace.innerHTML = renderMicroWorkspace(data, {
      range: signalTimeRange,
      customStart: signalCustomStart,
      selections: activeMicroInstruments,
    });
    if (focusSelector) elements.microWorkspace.querySelector(focusSelector)?.focus();
    window.clearTimeout(microRefreshTimer);
    microRefreshTimer = window.setTimeout(() => {
      if (resolveWorkspaceRoute(window.location.hash).workspace === "micro") loadMicroWorkspaceData(false);
    }, Math.max(60, Number(data.refreshAfterSeconds) || 300) * 1000);
  } catch (error) {
    const route = resolveWorkspaceRoute(window.location.hash);
    if (requestId !== microRequestId || route.workspace !== "micro") return;
    elements.microWorkspace.innerHTML = renderMicroWorkspaceError(error.message || "免费数据源暂时不可用，请稍后重试");
  }
}

function capitalConstituentKey(marketId, sectorId) {
  return `${marketId}:${sectorId}:${signalTimeRange}:${signalCustomStart}`;
}

function requestCapitalSectorConstituents(marketId, sectorId, force = false) {
  const key = capitalConstituentKey(marketId, sectorId);
  if (!force && capitalConstituentCache.has(key)) return Promise.resolve(capitalConstituentCache.get(key));
  if (!force && capitalConstituentRequests.has(key)) return capitalConstituentRequests.get(key);
  const params = new URLSearchParams({ market: marketId, sector: sectorId, range: signalTimeRange });
  if (signalTimeRange === "custom" && signalCustomStart) params.set("start", signalCustomStart);
  if (force) params.set("refresh", "1");
  const request = fetch(`/api/capital-flow/constituents?${params.toString()}`)
    .then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || "成分股数据读取失败");
      capitalConstituentCache.set(key, payload?.data);
      return payload?.data;
    })
    .finally(() => capitalConstituentRequests.delete(key));
  capitalConstituentRequests.set(key, request);
  return request;
}

function prefetchActiveCapitalSectors() {
  for (const [marketId, sectorId] of Object.entries(activeCapitalFlowSectors)) {
    if (sectorId) requestCapitalSectorConstituents(marketId, sectorId).catch(() => {});
  }
}

async function loadCapitalSectorConstituents(marketId, sectorId, force = false) {
  const host = elements.signalDetail.querySelector(`[data-capital-constituents-host="${marketId}:${sectorId}"]`);
  if (!host) return;
  const sector = latestCapitalFlowPayload?.markets?.find(({ id }) => id === marketId)?.sectors?.find(({ id }) => id === sectorId);
  host.innerHTML = renderCapitalConstituentsLoading(sector?.title || "该板块");
  try {
    const data = await requestCapitalSectorConstituents(marketId, sectorId, force);
    const currentHost = elements.signalDetail.querySelector(`[data-capital-constituents-host="${marketId}:${sectorId}"]`);
    if (currentHost) currentHost.innerHTML = renderCapitalConstituents(data);
  } catch (error) {
    const currentHost = elements.signalDetail.querySelector(`[data-capital-constituents-host="${marketId}:${sectorId}"]`);
    if (currentHost) currentHost.innerHTML = renderCapitalConstituentsError(error.message || "免费数据源暂时不可用");
  }
}

function rerenderSignalWorkspaceForRange(scope) {
  if (scope === "macro" && latestMacroPayload) {
    elements.signalDetail.innerHTML = renderProfiledSignalWorkspace("macro", latestMacroPayload, renderMacroWorkspace, { range: signalTimeRange, customStart: signalCustomStart });
  } else if (scope === "market-timing" && latestMarketTimingPayload) {
    elements.signalDetail.innerHTML = renderProfiledSignalWorkspace("market-timing", latestMarketTimingPayload, renderMarketTimingWorkspace, { range: signalTimeRange, customStart: signalCustomStart });
    loadMarketTimingWorkspaceData(false, false);
  } else if (scope === "sector-rotation" && latestSectorRotationPayload) {
    elements.signalDetail.innerHTML = renderProfiledSignalWorkspace("sector-rotation", latestSectorRotationPayload, renderSectorRotationWorkspace, { range: signalTimeRange, customStart: signalCustomStart, activeSectors: activeSectorRotationSectors });
  } else if (scope === "investor-sentiment" && latestInvestorSentimentPayload) {
    elements.signalDetail.innerHTML = renderProfiledSignalWorkspace("investor-sentiment", latestInvestorSentimentPayload, renderInvestorSentimentWorkspace, { range: signalTimeRange, customStart: signalCustomStart });
  } else if (scope === "capital-flow" && latestCapitalFlowPayload) {
    elements.signalDetail.innerHTML = renderProfiledSignalWorkspace("capital-flow", latestCapitalFlowPayload, renderCapitalFlowWorkspace, { range: signalTimeRange, customStart: signalCustomStart, activeSectors: activeCapitalFlowSectors });
    prefetchActiveCapitalSectors();
  } else if (scope === "micro-data") {
    elements.microWorkspace.innerHTML = renderMicroWorkspaceLoading();
    const focusSelector = signalTimeRange === "custom"
      ? "[data-signal-custom-start]"
      : `[data-signal-range="${signalTimeRange}"]`;
    loadMicroWorkspaceData(false, focusSelector);
  }
}

function renderDataSourcesWorkspace(focusSelector = "") {
  elements.dataSourcesWorkspace.innerHTML = renderDataSourceCenter({
    preferences: dataSourcePreferences,
    statuses: dataSourceStatuses,
    selectedSource: selectedDataSource,
    newsCredentials: newsCredentialStatuses,
  });
  if (focusSelector) queueMicrotask(() => elements.dataSourcesWorkspace.querySelector(focusSelector)?.focus());
}

async function refreshDataSourceHealth() {
  window.clearTimeout(dataSourceHealthTimer);
  try {
    const response = await fetch("/api/data-sources", { headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok || !payload?.data?.service) throw new Error(payload?.error?.message || "数据服务健康状态格式不正确");
    dataSourceStatuses.service = payload.data.service;
    Object.assign(dataSourceStatuses, payload.data.sourceStatus || {});
    newsCredentialStatuses = payload.data.newsCredentials || {};
  } catch (error) {
    const failure = dataSourceNetworkFailure(error);
    dataSourceStatuses.service = failure;
    dataSourceStatuses.free = { ...failure, sourceId: "free" };
  }
  if (resolveWorkspaceRoute(window.location.hash).workspace === "data-sources") {
    renderDataSourcesWorkspace();
    dataSourceHealthTimer = window.setTimeout(refreshDataSourceHealth, 30_000);
  }
}

async function saveNewsCredential(providerId, apiKey) {
  newsCredentialStatuses[providerId] = {
    providerId,
    configured: false,
    state: "checking",
    source: "none",
    message: "正在通过供应商官方接口检查 Key。",
  };
  renderDataSourcesWorkspace();
  try {
    const response = await fetch("/api/news-credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId, apiKey }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || "API Key 检查失败");
    newsCredentialStatuses[providerId] = payload.data;
    renderDataSourcesWorkspace(`[data-news-provider="${providerId}"] input`);
    showToast(payload.data.message);
  } catch (error) {
    newsCredentialStatuses[providerId] = {
      providerId,
      configured: false,
      state: "error",
      source: "none",
      message: error.message || "API Key 检查失败，请稍后重试。",
    };
    renderDataSourcesWorkspace(`[data-news-provider="${providerId}"] input`);
  }
}

async function checkDataSourceConnector(sourceId, config = {}) {
  dataSourceStatuses[sourceId] = {
    sourceId,
    state: "checking",
    readyForActivation: false,
    message: "正在检查本机环境与配置，请稍候。",
  };
  renderDataSourcesWorkspace();
  try {
    const response = await fetch("/api/data-sources/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId, config }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || "数据源检查失败");
    dataSourceStatuses[sourceId] = payload.data;
    if (!payload.data.readyForActivation) {
      for (const marketId of ["china", "united-states"]) {
        if (dataSourcePreferences[marketId] === sourceId) dataSourcePreferences[marketId] = "free";
      }
      saveDataSourcePreferences(window.localStorage, dataSourcePreferences);
    }
    renderDataSourcesWorkspace(`[data-source-card="${sourceId}"]`);
    showToast(payload.data.message);
  } catch (error) {
    const networkFailure = dataSourceNetworkFailure(error);
    dataSourceStatuses[sourceId] = networkFailure.state === "api_offline"
      ? { ...networkFailure, sourceId }
      : { sourceId, state: "error", readyForActivation: false, message: error.message || "数据源检查失败，请稍后重试。" };
    if (networkFailure.state === "api_offline") dataSourceStatuses.service = networkFailure;
    renderDataSourcesWorkspace(`[data-source-card="${sourceId}"]`);
  }
}

async function syncBrokerAccount(sourceId, config) {
  dataSourceStatuses[sourceId] = {
    sourceId,
    state: "checking",
    readyForActivation: false,
    message: "正在通过本机客户端读取持仓快照。",
  };
  renderDataSourcesWorkspace();
  try {
    const snapshot = await requestBrokerSnapshot(sourceId, config);
    installBrokerSnapshot(sourceId, snapshot);
    if (sourceId === "ibkr") saveIbkrAutoSyncConfig(window.localStorage, config);
    dataSourceStatuses[sourceId] = {
      sourceId,
      state: "ready",
      readyForActivation: false,
      message: `券商真实持仓已同步：${snapshot.meta.positionCount} 个标的。前往总览查看。`,
    };
    scheduleBrokerAutoRefresh();
    renderDataSourcesWorkspace(`[data-source-card="${sourceId}"]`);
    showToast(dataSourceStatuses[sourceId].message);
  } catch (error) {
    dataSourceStatuses[sourceId] = {
      sourceId,
      state: "error",
      readyForActivation: false,
      message: error.message || "券商持仓读取失败，请检查本机客户端。",
    };
    renderDataSourcesWorkspace(`[data-source-card="${sourceId}"]`);
  }
}

async function requestBrokerSnapshot(sourceId, config) {
  const response = await fetch("/api/broker-accounts/snapshot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceId, config }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(brokerConnectionErrorMessage(response.status, payload));
  return payload.data;
}

function brokerProviderSymbol(position) {
  const symbol = String(position.symbol || "").toUpperCase();
  if (String(position.currency || "").toUpperCase() !== "CNY" || !/^\d{6}$/.test(symbol)) return symbol;
  const suffix = /^[48]/.test(symbol) ? "BJ" : /^[569]/.test(symbol) ? "SS" : "SZ";
  return `${symbol}.${suffix}`;
}

async function enrichBrokerPositionSector(position) {
  const existing = stockBySymbol(position.symbol);
  if (existing?.sectorId || existing?.sector) {
    Object.assign(position, { sectorId: existing.sectorId || null, sector: existing.sector || null, industry: existing.industry || null });
    return;
  }
  const providerSymbol = brokerProviderSymbol(position);
  if (!brokerSectorRequests.has(providerSymbol)) {
    brokerSectorRequests.set(providerSymbol, fetch(`/api/instruments/search?q=${encodeURIComponent(providerSymbol)}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !Array.isArray(payload.data)) return null;
        return payload.data.find((item) => item.providerSymbol === providerSymbol || item.symbol === position.symbol) || null;
      })
      .catch(() => null));
  }
  const result = await brokerSectorRequests.get(providerSymbol);
  if (!result) return;
  Object.assign(position, {
    name: result.name || position.name,
    sectorId: result.sectorId || null,
    sector: result.sector || null,
    industry: result.industry || null,
  });
}

function installBrokerSnapshot(sourceId, snapshot) {
  snapshot.meta = { ...snapshot.meta, snapshotState: "live" };
  brokerAccountSnapshots[sourceId] = snapshot;
  if (sourceId === "ibkr") {
    for (const stock of stockCatalog) {
      const quote = preferBrokerQuote(stock, {
        price: stock.price,
        previousClose: stock.previousClose,
        changePercent: stock.change,
        timestamp: stock.quoteTimestamp,
        marketDate: stock.marketDate,
        source: stock.quoteSource,
      }, snapshot);
      if (quote.sourcePriority === "ibkr-position") applyQuoteToStock(stock, quote);
    }
  }
  if (sourceId === "ibkr") saveIbkrSnapshotCache(window.sessionStorage, snapshot);
  lastBrokerConnectionError = "";
  if (!brokerAutoSelected) {
    activePortfolioId = BROKER_PORTFOLIO_ID;
    brokerAutoSelected = true;
  }
  render();
  Promise.all((snapshot.positions || []).map(enrichBrokerPositionSector)).then(() => {
    renderPortfolioNav();
    renderBrokerAccountOverview();
  });
}

function scheduleBrokerAutoRefresh() {
  window.clearTimeout(brokerAutoRefreshTimer);
  const config = loadIbkrAutoSyncConfig(window.localStorage);
  if (!config || resolveWorkspaceRoute(window.location.hash).workspace !== "overview") return;
  brokerAutoRefreshTimer = window.setTimeout(() => refreshSavedIbkrSnapshot(), 180_000);
}

async function refreshSavedIbkrSnapshot(announce = false) {
  const config = loadIbkrAutoSyncConfig(window.localStorage);
  if (!config) {
    if (announce) showToast("请先在数据源中心同步一次 IBKR 只读账户。 ");
    return null;
  }
  if (brokerSnapshotRequest) return brokerSnapshotRequest;
  if (elements.refreshBrokerPositions) {
    elements.refreshBrokerPositions.disabled = true;
    elements.refreshBrokerPositions.textContent = "同步中…";
  }
  brokerSnapshotRequest = requestBrokerSnapshot("ibkr", config)
    .then((snapshot) => {
      installBrokerSnapshot("ibkr", snapshot);
      dataSourceStatuses.ibkr = {
        sourceId: "ibkr",
        state: "ready",
        readyForActivation: false,
        message: `券商真实持仓已同步：${snapshot.meta.positionCount} 个标的。`,
      };
      renderBrokerAccountOverview();
      if (announce) showToast(`IBKR 已刷新：${snapshot.meta.positionCount} 个真实持仓。`);
      return snapshot;
    })
    .catch((error) => {
      lastBrokerConnectionError = error.message || "IBKR 刷新失败";
      renderPortfolioNav();
      renderBrokerAccountOverview();
      if (announce) showToast(error.message || "IBKR 刷新失败，继续显示上次成功快照。");
      return null;
    })
    .finally(() => {
      brokerSnapshotRequest = null;
      if (elements.refreshBrokerPositions) {
        elements.refreshBrokerPositions.disabled = false;
        elements.refreshBrokerPositions.textContent = "刷新券商数据";
      }
      scheduleBrokerAutoRefresh();
    });
  return brokerSnapshotRequest;
}

function setNavigationDisclosure(button, panel, expanded) {
  button.setAttribute("aria-expanded", String(expanded));
  panel.setAttribute("aria-hidden", String(!expanded));
  panel.toggleAttribute("inert", !expanded);
  panel.classList.toggle("is-expanded", expanded);
}

function setPrimaryNavigation(workspace) {
  const isOverview = workspace === "overview";
  const isSignals = workspace === "signals";
  const isMicro = workspace === "micro";
  const isDataSources = workspace === "data-sources";
  const isComparison = workspace === "comparison";
  elements.navOverview.classList.toggle("active", isOverview);
  elements.navSignals.classList.toggle("active", isSignals);
  elements.navMicro.classList.toggle("active", isMicro);
  elements.navDataSources.classList.toggle("active", isDataSources);
  elements.navComparison.classList.toggle("active", isComparison);
  elements.navOverview.toggleAttribute("aria-current", isOverview);
  elements.navSignals.toggleAttribute("aria-current", isSignals);
  elements.navMicro.toggleAttribute("aria-current", isMicro);
  elements.navDataSources.toggleAttribute("aria-current", isDataSources);
  elements.navComparison.toggleAttribute("aria-current", isComparison);
  if (isOverview) setNavigationDisclosure(elements.navOverview, elements.overviewSubnav, true);
  if (isSignals) setNavigationDisclosure(elements.navSignals, elements.signalSubnav, true);
}

function renderWorkspaceRoute() {
  const route = resolveWorkspaceRoute(window.location.hash);
  const directory = signalDirectories.find((item) => item.id === route.directory) || null;
  const isOverview = route.workspace === "overview";
  const isSignals = route.workspace === "signals";
  const isMicro = route.workspace === "micro";
  const isDataSources = route.workspace === "data-sources";
  const isComparison = route.workspace === "comparison";

  elements.overviewWorkspace.hidden = !isOverview;
  elements.signalsWorkspace.hidden = !isSignals;
  elements.microWorkspace.hidden = !isMicro;
  elements.dataSourcesWorkspace.hidden = !isDataSources;
  elements.comparisonWorkspace.hidden = !isComparison;
  elements.signalsHub.hidden = Boolean(directory);
  elements.signalDetail.hidden = !directory;
  setPrimaryNavigation(route.workspace);
  renderSignalDirectoryStructure(directory?.id || null);
  if (directory?.id !== "market-timing") window.clearTimeout(marketTimingRefreshTimer);
  if (directory?.id !== "sector-rotation") window.clearTimeout(sectorRotationRefreshTimer);
  if (directory?.id !== "investor-sentiment") window.clearTimeout(investorSentimentRefreshTimer);
  if (directory?.id !== "capital-flow") window.clearTimeout(capitalFlowRefreshTimer);
  if (!isMicro) window.clearTimeout(microRefreshTimer);
  if (!isDataSources) window.clearTimeout(dataSourceHealthTimer);
  if (!isOverview) window.clearTimeout(brokerAutoRefreshTimer);

  if (isOverview) {
    const portfolio = activeCustomPortfolio();
    const brokerMode = isBrokerPortfolioMode();
    elements.portfolioTitle.textContent = brokerMode ? "真实数据组合" : portfolio?.name || "我的自建组合";
    elements.pageContextCurrent.textContent = brokerMode ? "IBKR 真实账户" : "自建组合";
    scheduleBrokerAutoRefresh();
    return;
  }

  if (isComparison) {
    elements.portfolioTitle.textContent = "组合对比";
    elements.pageContextCurrent.textContent = "组合对比";
    renderComparisonWorkspace();
    return;
  }

  if (isMicro) {
    elements.portfolioTitle.textContent = "微观数据";
    elements.pageContextCurrent.textContent = "微观数据";
    elements.microWorkspace.innerHTML = latestMicroPayload
      ? renderMicroWorkspace(latestMicroPayload, { range: signalTimeRange, customStart: signalCustomStart, selections: activeMicroInstruments })
      : renderMicroWorkspaceLoading();
    loadMicroWorkspaceData(false);
    return;
  }

  if (isDataSources) {
    elements.portfolioTitle.textContent = "数据源中心";
    elements.pageContextCurrent.textContent = "数据源中心";
    renderDataSourcesWorkspace();
    refreshDataSourceHealth();
    return;
  }

  elements.portfolioTitle.textContent = directory?.title || "宏观数据";
  elements.pageContextCurrent.textContent = directory ? `宏观数据 / ${directory.title}` : "宏观数据";
  if (directory) renderSignalDetail(directory);
}

function render() {
  renderPortfolioNav();
  renderActivePortfolio();
  renderWorkspaceRoute();
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => { elements.toast.hidden = true; }, 2400);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderSearchMessage(title, detail, state = "status") {
  elements.searchResults.innerHTML = `<div class="search-feedback" role="${state}"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></div>`;
  elements.searchResults.hidden = false;
}

function renderSearchOptions(results) {
  latestSearchResults = results;
  const portfolio = activeCustomPortfolio();
  elements.searchResults.innerHTML = results.length
    ? results.map((stock, index) => {
      const actions = getSearchResultActions(portfolio, stock);
      return `<div class="search-option" role="listitem">
        <button class="search-analysis-trigger" type="button" data-view-analysis="${index}" aria-label="查看${escapeHtml(stock.name)}分析">
          <span class="stock-avatar">${escapeHtml(stock.symbol.slice(0, 2))}</span>
          <span><strong>${escapeHtml(stock.name)}</strong><small><b class="search-market-label ${stock.currency === "CNY" ? "market-cn" : "market-us"}">${stock.currency === "CNY" ? "A股" : "美股"}</b> · ${escapeHtml(stock.symbol)} · ${escapeHtml(stock.market)} · ${escapeHtml(stock.source || "本地")}</small></span>
          <span class="view-analysis-label">查看分析 <span aria-hidden="true">→</span></span>
        </button>
        <button class="search-add-button" type="button" data-add-result="${index}" ${actions.canAdd ? "" : "disabled"}>${actions.addLabel}</button>
      </div>`;
    }).join("")
    : `<div class="search-feedback" role="status"><strong>没有找到匹配标的</strong><small>请检查代码，或尝试输入完整公司名称。</small></div>`;
  elements.searchResults.hidden = false;
}

function updateAnalysisAddButton() {
  if (!activeAnalysisResult) return;
  const portfolio = activeCustomPortfolio();
  const actions = getSearchResultActions(portfolio, activeAnalysisResult);
  elements.analysisAddButton.disabled = !actions.canAdd;
  elements.analysisAddButton.textContent = actions.canAdd ? `添加到 ${portfolio.name}` : `已在 ${portfolio.name}`;
}

function renderAnalysisLoading() {
  elements.analysisContent.innerHTML = `<div class="analysis-loading" role="status" aria-busy="true">
    <span class="loading-pulse" aria-hidden="true"></span>
    <strong>正在生成行情分析</strong>
    <small>读取历史价格并计算趋势指标…</small>
  </div>`;
}

function getStockDecisionContext(result) {
  const marketId = result?.currency === "CNY" || /\.(SS|SZ|BJ)$/i.test(result?.providerSymbol || "")
    ? "china"
    : "united-states";
  const macroMarket = latestMacroPayload?.markets?.find(({ id }) => id === marketId);
  const timingMarket = latestMarketTimingPayload?.markets?.find(({ id }) => id === marketId);
  const sectorMarket = latestSectorRotationPayload?.markets?.find(({ id }) => id === marketId);
  const sector = sectorMarket?.sectors?.find(({ id }) => id === result?.sectorId);
  const sectorRank = sector ? sectorMarket.sectors.findIndex(({ id }) => id === sector.id) + 1 : null;
  const sectorPhase = sector?.rotation?.phase?.label
    || (sector?.score >= 65 ? "领先" : sector?.score <= 40 ? "落后" : "中性轮动");
  const sentimentMarket = latestInvestorSentimentPayload?.markets?.find(({ id }) => id === marketId);
  const portfolio = activeCustomPortfolio();
  const brokerSnapshot = isBrokerPortfolioMode()
    ? Object.values(brokerAccountSnapshots).find(Boolean)
    : null;
  const customPosition = portfolio?.positions?.find(({ symbol }) => symbol === result?.symbol);
  const brokerPosition = brokerSnapshot?.positions?.find(({ symbol }) => symbol === result?.symbol);
  const position = brokerPosition || customPosition;
  let sizing;

  if (brokerSnapshot?.account) {
    const account = brokerSnapshot.account;
    const target = brokerTargetFromTiming(Object.values(brokerAccountSnapshots).filter(Boolean), latestMarketTimingPayload, {
      sectorRotationPayload: latestSectorRotationPayload,
      stockScores: stockDecisionScores,
    });
    const baseCurrency = String(account.currency || "USD").toUpperCase();
    const stockCurrency = String(result?.currency || baseCurrency).toUpperCase();
    let stockToBaseRate = stockCurrency === baseCurrency
      ? 1
      : Number(account.exchangeRates?.[stockCurrency]);
    if (!Number.isFinite(stockToBaseRate) || stockToBaseRate <= 0) {
      stockToBaseRate = baseCurrency === "CNY" && stockCurrency === "USD"
        ? usdCny
        : baseCurrency === "USD" && stockCurrency === "CNY"
          ? 1 / usdCny
          : 1;
    }
    const capital = Number(account.totalAsset || 0);
    sizing = {
      currency: baseCurrency,
      capital,
      cash: Number(account.cash || 0),
      currentExposurePct: capital > 0 ? Number(account.marketValue || 0) / capital * 100 : 0,
      targetExposurePct: target.targetExposurePct,
      stockToBaseRate,
      lotSize: stockCurrency === "CNY" ? 100 : 1,
      sourceLabel: "IBKR 真实账户",
    };
  } else {
    const snapshot = portfolioSnapshot(portfolio);
    const target = customPortfolioTarget(portfolio);
    const stockCurrency = String(result?.currency || "CNY").toUpperCase();
    sizing = {
      currency: "CNY",
      capital: snapshot.totalValue,
      cash: Number(portfolio?.cash || 0),
      currentExposurePct: snapshot.totalValue > 0 ? snapshot.investedValue / snapshot.totalValue * 100 : 0,
      targetExposurePct: target.value,
      stockToBaseRate: stockCurrency === "USD" ? usdCny : 1,
      lotSize: stockCurrency === "CNY" ? 100 : 1,
      sourceLabel: portfolio?.name || "当前组合",
    };
  }
  return {
    marketId,
    held: Boolean(position),
    position: position || null,
    portfolioName: brokerSnapshot ? "IBKR 真实账户" : portfolio?.name || "当前组合",
    managerId: resolvePortfolioManager(portfolio?.managerId).id,
    analysisPreferences: normalizeAnalysisPreferences(portfolio || {}),
    sizing,
    macro: macroMarket?.analysis || null,
    timing: timingMarket?.regime || null,
    companyProfile: {
      sectorId: result?.sectorId || null,
      sector: result?.sector || null,
      industry: result?.industry || null,
    },
    sector: sector ? {
      id: sector.id,
      title: sector.title,
      score: sector.score,
      rank: sector.rotation?.rank || sectorRank,
      phase: sectorPhase,
      action: sector.rotation?.action?.label,
      confidence: sector.confidence,
      flowScore: sector.capitalFlow?.score,
      flowState: sector.capitalFlow?.state?.label,
      flowTone: sector.capitalFlow?.state?.tone,
    } : null,
    sentiment: sentimentMarket?.score != null ? {
      score: sentimentMarket.score,
      impulse: sentimentMarket.impulse20d,
      phase: sentimentMarket.phase?.label,
      tone: sentimentMarket.phase?.tone,
      confidence: sentimentMarket.confidence,
    } : null,
  };
}

function renderStockAnalysis(payload) {
  const effectivePayload = preferBrokerQuote(activeAnalysisResult, payload, brokerAccountSnapshots.ibkr);
  activeAnalysisPayload = effectivePayload;
  const decisionContext = getStockDecisionContext(activeAnalysisResult);
  const managerInsight = activeCompanyResearch
    ? buildCompanyManagerInsight(activeCompanyResearch, decisionContext.managerId)
    : null;
  decisionContext.companyResearchInsight = managerInsight;
  const decision = buildStockDecision(effectivePayload, {
    ...decisionContext,
    holdingPeriod: analysisTimeRange,
    holdingDays: analysisHoldingDays,
  });
  if (activeAnalysisResult?.symbol) {
    stockDecisionScores.set(stockDecisionScoreKey(activeAnalysisResult.symbol, decisionContext.managerId, decisionContext.analysisPreferences), decision.composite.score);
  }
  const marketMarkup = renderStockAnalysisMarkup(effectivePayload, {
    holdingPeriod: analysisTimeRange,
    holdingDays: analysisHoldingDays,
    chartRange: analysisChartRange,
    context: decisionContext,
  });
  elements.analysisContent.innerHTML = renderCompanyAnalysisShell({
    marketMarkup,
    research: activeCompanyResearch,
    insight: managerInsight,
    activeTab: activeCompanyAnalysisTab,
    loading: !activeCompanyResearch,
  });

  const updatedAt = new Date(effectivePayload.timestamp).toLocaleString("zh-CN", { hour12: false });
  const dataType = effectivePayload.marketDataType === "account-valuation" ? " · 账户窗口估值" : "";
  elements.analysisSource.textContent = `数据源：${effectivePayload.source}${dataType} · 更新于 ${updatedAt}`;
}

function scheduleCompanyResearchRefresh(result, requestId, research) {
  window.clearTimeout(companyResearchRefreshTimer);
  companyResearchRefreshTimer = window.setTimeout(() => {
    if (!elements.analysisDialog.open || requestId !== analysisRequestId || activeAnalysisResult?.providerSymbol !== result.providerSymbol) return;
    loadCompanyResearch(result, requestId, { force: true }).catch(() => null);
  }, companyResearchRefreshDelay(research));
}

async function loadCompanyResearch(result, requestId, { force = false } = {}) {
  const cacheKey = result.providerSymbol;
  const cached = companyResearchCache.get(cacheKey);
  if (cached && !force) {
    activeCompanyResearch = cached;
    if (requestId === analysisRequestId && activeAnalysisPayload) renderStockAnalysis(activeAnalysisPayload);
    const nextRefreshAt = Date.parse(cached.meta?.nextRefreshAt || "");
    if (Number.isFinite(nextRefreshAt) && nextRefreshAt <= Date.now()) {
      loadCompanyResearch(result, requestId, { force: true }).catch(() => null);
      return;
    }
    scheduleCompanyResearchRefresh(result, requestId, cached);
    return;
  }
  const market = result.currency === "CNY" || /\.(SS|SZ|BJ)$/i.test(result.providerSymbol || "")
    ? "china"
    : "united-states";
  try {
    const params = new URLSearchParams({
      market,
      symbol: result.symbol,
      providerSymbol: result.providerSymbol,
      companyName: result.name || "",
    });
    if (force) params.set("refresh", "1");
    const response = await fetch(`/api/company-research?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || "公司研究读取失败");
    companyResearchCache.set(cacheKey, payload.data);
    if (requestId !== analysisRequestId || activeAnalysisResult?.providerSymbol !== result.providerSymbol) return;
    activeCompanyResearch = payload.data;
    if (activeAnalysisPayload) renderStockAnalysis(activeAnalysisPayload);
    scheduleCompanyResearchRefresh(result, requestId, payload.data);
  } catch {
    if (requestId !== analysisRequestId || activeAnalysisResult?.providerSymbol !== result.providerSymbol) return;
    activeCompanyResearch = companyResearchCache.get(cacheKey) || {
      market,
      symbol: result.symbol,
      companyName: result.name,
      fundamentals: { status: "unavailable", periods: [], reason: "公司事实源暂时不可用；行情分析仍可继续。" },
      news: [],
      providers: [],
      meta: { fetchedAt: new Date().toISOString(), refreshAfterSeconds: 600, dynamic: true },
    };
    if (activeAnalysisPayload) renderStockAnalysis(activeAnalysisPayload);
    scheduleCompanyResearchRefresh(result, requestId, activeCompanyResearch);
  }
}

function updateHoldingPeriodControls(control, days) {
  const profile = holdingProfileForDays(days);
  analysisHoldingDays = profile.days;
  analysisTimeRange = profile.dataRange;
  const host = control.closest(".holding-period-control");
  const slider = host?.querySelector("[data-holding-period-slider]");
  const numberInput = host?.querySelector("[data-holding-days-input]");
  const output = host?.querySelector("[data-holding-period-output]");
  const position = sliderPositionFromHoldingDays(profile.days);
  if (slider) {
    slider.value = String(position);
    slider.style.setProperty("--holding-progress", `${position}%`);
    slider.setAttribute("aria-valuetext", `${profile.label}，${profile.style}`);
  }
  if (numberInput) numberInput.value = String(profile.days);
  if (output) output.textContent = `${profile.label} · ${profile.style}`;
  return profile;
}

function renderHoldingPeriodDecision(profile) {
  const dynamic = elements.analysisContent.querySelector("[data-stock-decision-dynamic]");
  if (dynamic && activeAnalysisPayload) {
    dynamic.innerHTML = renderStockDecisionDynamicMarkup(activeAnalysisPayload, {
      holdingPeriod: profile.dataRange,
      holdingDays: profile.days,
      context: getStockDecisionContext(activeAnalysisResult),
    });
  }
}

function queueHoldingPeriodDecision(profile, immediate = false) {
  window.clearTimeout(holdingDecisionTimer);
  window.cancelAnimationFrame(holdingDecisionFrame);
  if (immediate) {
    renderHoldingPeriodDecision(profile);
    return;
  }
  holdingDecisionTimer = window.setTimeout(() => {
    holdingDecisionFrame = window.requestAnimationFrame(() => renderHoldingPeriodDecision(profile));
  }, 140);
}

async function openStockAnalysis(result, focusSelector = "", options = {}) {
  const requestId = ++analysisRequestId;
  window.clearTimeout(companyResearchRefreshTimer);
  const changedCompany = activeAnalysisResult?.providerSymbol !== result.providerSymbol;
  activeAnalysisResult = result;
  if (changedCompany) activeCompanyAnalysisTab = "market";
  activeCompanyResearch = companyResearchCache.get(result.providerSymbol) || null;
  elements.analysisName.textContent = result.name;
  elements.analysisAvatar.textContent = result.symbol.slice(0, 2);
  elements.analysisMarket.textContent = result.currency === "USD" ? "US" : "CN";
  elements.analysisMeta.textContent = `${result.symbol} · ${result.market}`;
  elements.analysisSource.textContent = `数据源：${result.source || "--"}`;
  updateAnalysisAddButton();
  const cacheKey = `${result.providerSymbol}|${analysisChartRange}`;
  const cachedPayload = analysisPayloadCache.get(cacheKey);
  if (cachedPayload) {
    renderStockAnalysis(cachedPayload);
  } else if (!options.preserveContent || !activeAnalysisPayload) {
    activeAnalysisPayload = null;
    renderAnalysisLoading();
  } else {
    elements.analysisContent.setAttribute("aria-busy", "true");
    elements.analysisSource.textContent = `数据源：${result.source || "免费延迟行情"} · 正在更新${formatHoldingDays(analysisHoldingDays)}结构`;
  }
  elements.searchResults.hidden = true;
  if (!elements.analysisDialog.open) elements.analysisDialog.showModal();

  loadCompanyResearch(result, requestId);

  const contextRefresh = signalPreloader.load()
    .then((bootstrap) => hydrateSignalWorkspaces(bootstrap.workspaces))
    .then(() => {
      if (requestId === analysisRequestId && activeAnalysisPayload) renderStockAnalysis(activeAnalysisPayload);
    })
    .catch(() => null);

  try {
    const params = new URLSearchParams({ symbol: result.providerSymbol, range: analysisChartRange });
    if (analysisChartRange === "custom" && analysisCustomStart) params.set("start", analysisCustomStart);
    const response = await fetch(`/api/analysis?${params.toString()}`);
    const payload = await response.json();
    if (requestId !== analysisRequestId) return;
    if (!response.ok) throw new Error(payload?.error?.message || "分析数据读取失败");
    analysisPayloadCache.set(cacheKey, payload.data);
    renderStockAnalysis(payload.data);
    if (result.currency === "USD" || !/\.(SS|SZ|BJ)$/i.test(result.providerSymbol || "")) {
      requestIbkrMarketQuotes([result.providerSymbol]).then(([quote]) => {
        if (!quote || requestId !== analysisRequestId || activeAnalysisResult?.providerSymbol !== result.providerSymbol) return;
        const ibkrPayload = {
          ...payload.data,
          ...quote,
          previousClose: quote.previousClose ?? payload.data.previousClose,
        };
        renderStockAnalysis(ibkrPayload);
        const matchedStock = stockBySymbol(result.symbol);
        if (matchedStock) applyQuoteToStock(matchedStock, ibkrPayload);
      }).catch(() => null);
    }
    if (focusSelector) elements.analysisContent.querySelector(focusSelector)?.focus();
    const existingStock = stockBySymbol(result.symbol);
    if (!existingStock) {
      const stock = {
        symbol: result.symbol,
        yahoo: result.providerSymbol,
        name: result.name,
        market: result.market,
        currency: payload.data.currency || result.currency,
        price: payload.data.price,
        change: 0,
        sectorId: result.sectorId || null,
        sector: result.sector || null,
        industry: result.industry || null,
      };
      applyQuoteToStock(stock, payload.data);
      stockCatalog.push(stock);
    } else {
      applyQuoteToStock(existingStock, {
        ...payload.data,
        changePercent: payload.data.previousClose
          ? (Number(payload.data.price) / Number(payload.data.previousClose) - 1) * 100
          : existingStock.change,
      });
      existingStock.sectorId = result.sectorId || existingStock.sectorId || null;
      existingStock.sector = result.sector || existingStock.sector || null;
      existingStock.industry = result.industry || existingStock.industry || null;
    }
    persistPortfolioState();
  } catch (error) {
    if (requestId !== analysisRequestId) return;
    if (options.preserveContent && activeAnalysisPayload) {
      elements.analysisSource.textContent = `免费延迟数据暂未更新 · 保留上一份分析`;
      showToast(error.message || "新持有期限的数据暂时不可用，已保留上一份分析");
    } else {
      elements.analysisContent.innerHTML = `<div class="analysis-error" role="alert"><strong>暂时无法生成分析</strong><p>${escapeHtml(error.message || "行情数据源暂时不可用，请稍后重试")}</p><button class="button secondary" type="button" data-retry-analysis>重新加载</button></div>`;
    }
  } finally {
    if (requestId === analysisRequestId) elements.analysisContent.removeAttribute("aria-busy");
  }
}

async function searchRemote(query) {
  const requestId = ++searchRequestId;
  renderSearchMessage("正在查询真实行情…", "正在连接A股与美股数据源");
  try {
    const response = await fetch(`/api/instruments/search?q=${encodeURIComponent(query)}`);
    const payload = await response.json();
    if (requestId !== searchRequestId) return;
    if (!response.ok) throw new Error(payload?.error?.message || "搜索请求失败");
    if (!Array.isArray(payload.data)) throw new Error("数据返回格式不正确");
    renderSearchOptions(payload.data);
  } catch (error) {
    if (requestId !== searchRequestId) return;
    renderSearchMessage("暂时无法搜索", error.message || "行情数据源暂时不可用，请稍后重试", "alert");
  }
}

function scheduleSearch(query) {
  window.clearTimeout(searchTimer);
  const normalized = query.trim();
  if (!normalized) {
    searchRequestId += 1;
    elements.searchResults.hidden = true;
    return;
  }
  searchTimer = window.setTimeout(() => searchRemote(normalized), 250);
}

elements.portfolioList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-portfolio-id]");
  if (!button) return;
  activePortfolioId = button.dataset.portfolioId;
  persistPortfolioState();
  if (resolveWorkspaceRoute(window.location.hash).workspace !== "overview") window.location.hash = "overview";
  render();
  updateAnalysisAddButton();
});

elements.todayActionPanel.addEventListener("click", (event) => {
  if (event.target.closest("[data-focus-stock-search]")) {
    elements.search.focus();
    elements.search.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (event.target.closest("[data-scroll-holdings]")) {
    const target = isBrokerPortfolioMode() ? elements.brokerPositionsPanel : elements.customPortfolioDashboard;
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

elements.portfolioManagerPanel.addEventListener("change", (event) => {
  const select = event.target.closest("[data-portfolio-manager-select]");
  if (!select) return;
  const portfolio = activeCustomPortfolio();
  if (!portfolio) return;
  Object.assign(portfolio, assignPortfolioManager(portfolio, select.value));
  persistPortfolioState();
  if (activeAnalysisPayload && elements.analysisDialog.open) renderStockAnalysis(activeAnalysisPayload);
  renderActivePortfolio();
  showToast(`已由 ${resolvePortfolioManager(portfolio.managerId).name} 接管 ${portfolio.name}`);
});

elements.portfolioManagerPanel.addEventListener("input", (event) => {
  const targetReturn = event.target.closest("[data-manager-target-return]");
  const riskCapacity = event.target.closest("[data-manager-risk-capacity]");
  if (!targetReturn && !riskCapacity) return;
  const portfolio = activeCustomPortfolio();
  if (!portfolio) return;
  const key = targetReturn ? "targetReturn" : "riskCapacity";
  const value = Math.min(100, Math.max(0, Number(event.target.value) || 0));
  portfolio[key] = value;
  event.target.style.setProperty("--manager-range", `${value}%`);
  const output = elements.portfolioManagerPanel.querySelector(targetReturn
    ? "[data-manager-target-return-output]"
    : "[data-manager-risk-capacity-output]");
  if (output) output.textContent = targetReturn ? `${value}%` : String(value);
  persistPortfolioState();
});

elements.portfolioManagerPanel.addEventListener("change", (event) => {
  if (!event.target.matches("[data-manager-target-return], [data-manager-risk-capacity]")) return;
  if (activeAnalysisPayload && elements.analysisDialog.open) renderStockAnalysis(activeAnalysisPayload);
  renderActivePortfolio();
  renderOverviewSignalDirectory();
  const route = resolveWorkspaceRoute(window.location.hash);
  if (route.workspace === "signals" && route.directory) rerenderSignalWorkspaceForRange(route.directory);
});

elements.search.addEventListener("input", (event) => scheduleSearch(event.target.value));
elements.search.addEventListener("keydown", (event) => {
  if (event.key === "Escape") elements.searchResults.hidden = true;
});
elements.searchResults.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view-analysis]");
  if (viewButton) {
    const result = latestSearchResults[Number(viewButton.dataset.viewAnalysis)];
    if (result) openStockAnalysis(result);
    return;
  }

  const addButton = event.target.closest("[data-add-result]");
  if (!addButton) return;
  const result = latestSearchResults[Number(addButton.dataset.addResult)];
  if (result) addSearchResultToPortfolio(result, addButton);
});

async function addSearchResultToPortfolio(result, button) {
  const portfolio = activeCustomPortfolio();
  if (portfolio.positions.some((position) => position.symbol === result.symbol)) {
    showToast(`${result.name} 已在当前组合中`);
    renderSearchOptions(latestSearchResults);
    updateAnalysisAddButton();
    return;
  }
  button.disabled = true;
  button.textContent = "读取中…";
  try {
    let stock = stockBySymbol(result.symbol);
    if (!stock) {
      const response = await fetch(`/api/quotes?symbol=${encodeURIComponent(result.providerSymbol)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || "行情读取失败");
      stock = {
        symbol: result.symbol,
        yahoo: result.providerSymbol,
        name: result.name,
        market: result.market,
        currency: payload.data.currency || result.currency,
        price: payload.data.price,
        change: payload.data.changePercent ?? 0,
        previousClose: payload.data.previousClose,
        marketDate: payload.data.marketDate,
        quoteTimestamp: payload.data.timestamp,
        quoteSource: payload.data.source,
        sectorId: result.sectorId || null,
        sector: result.sector || null,
        industry: result.industry || null,
      };
      stockCatalog.push(stock);
    }
    openAddPositionDialog(stock);
    button.disabled = false;
    if (button === elements.analysisAddButton) updateAnalysisAddButton();
    else renderSearchOptions(latestSearchResults);
  } catch (error) {
    showToast(error.message || "添加失败，请稍后重试");
    button.disabled = false;
    button.textContent = "重试添加";
  }
}

function selectedPurchaseMode() {
  return elements.addPositionForm.querySelector('input[name="purchase-mode"]:checked')?.value || "quantity";
}

function updatePurchaseMode() {
  const amountMode = selectedPurchaseMode() === "amount";
  elements.purchaseQuantity.hidden = amountMode;
  elements.purchaseQuantityField.hidden = amountMode;
  elements.purchaseQuantity.required = !amountMode;
  elements.purchaseAmount.hidden = !amountMode;
  elements.purchaseAmountField.hidden = !amountMode;
  elements.purchaseAmount.required = amountMode;
  updatePurchasePreview();
}

function updatePurchasePreview() {
  if (!pendingPositionStock) return;
  const cost = Number(elements.purchaseCost.value);
  const mode = selectedPurchaseMode();
  const quantity = mode === "amount"
    ? Number(elements.purchaseAmount.value) / cost
    : Number(elements.purchaseQuantity.value);
  if (!(cost > 0) || !(quantity > 0)) {
    elements.purchasePreview.textContent = mode === "amount" ? "请填写计划投入金额。" : "请填写计划购买股数。";
    return;
  }
  const amount = quantity * cost;
  elements.purchasePreview.textContent = `预计建立 ${quantity.toLocaleString("zh-CN", { maximumFractionDigits: 6 })} 股，持仓成本 ${formatPrice(amount, pendingPositionStock.currency)}。`;
}

function openAddPositionDialog(stock) {
  pendingPositionStock = stock;
  elements.addPositionForm.reset();
  elements.addPositionStock.textContent = `${stock.name} · ${stock.symbol} · ${stock.market}`;
  elements.purchaseCurrencyLabel.textContent = stock.currency === "USD" ? "美元" : "人民币";
  elements.purchaseCost.value = String(stock.price);
  elements.purchaseQuantity.value = "";
  elements.purchaseAmount.value = "";
  updatePurchaseMode();
  if (!elements.addPositionDialog.open) elements.addPositionDialog.showModal();
  elements.purchaseQuantity.focus();
}

elements.holdingsBody.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-symbol]");
  if (!button) return;
  const portfolio = activeCustomPortfolio();
  const stock = stockBySymbol(button.dataset.removeSymbol);
  portfolio.positions = portfolio.positions.filter((position) => position.symbol !== stock.symbol);
  persistPortfolioState();
  showToast(`已从当前组合移除 ${stock.name}`);
  render();
});

elements.addPositionForm.addEventListener("change", (event) => {
  if (event.target.matches('input[name="purchase-mode"]')) updatePurchaseMode();
});
elements.addPositionForm.addEventListener("input", (event) => {
  if (event.target.matches("#purchase-cost, #purchase-quantity, #purchase-amount")) updatePurchasePreview();
});
elements.addPositionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const portfolio = activeCustomPortfolio();
  if (!pendingPositionStock || !portfolio) return;
  try {
    const position = createPositionFromPurchase(pendingPositionStock, {
      mode: selectedPurchaseMode(),
      cost: elements.purchaseCost.value,
      quantity: elements.purchaseQuantity.value,
      amount: elements.purchaseAmount.value,
    });
    if (portfolio.positions.some(({ symbol }) => symbol === position.symbol)) {
      throw new Error(`${pendingPositionStock.name} 已在 ${portfolio.name} 中`);
    }
    portfolio.positions.push(position);
    persistPortfolioState();
    elements.addPositionDialog.close();
    showToast(`已将 ${pendingPositionStock.name} 按实际建仓信息加入 ${portfolio.name}`);
    pendingPositionStock = null;
    render();
    renderSearchOptions(latestSearchResults);
    updateAnalysisAddButton();
  } catch (error) {
    showToast(error.message || "建仓信息不完整");
  }
});
function closeAddPositionDialog() {
  elements.addPositionDialog.close();
  pendingPositionStock = null;
  updateAnalysisAddButton();
}
document.querySelector("#cancel-add-position").addEventListener("click", closeAddPositionDialog);
document.querySelector("#cancel-add-position-secondary").addEventListener("click", closeAddPositionDialog);
elements.addPositionDialog.addEventListener("click", (event) => {
  if (event.target === elements.addPositionDialog) closeAddPositionDialog();
});

document.querySelector("#focus-search").addEventListener("click", () => elements.search.focus());
elements.holdingsEmpty.querySelector("button").addEventListener("click", () => elements.search.focus());
document.querySelector("#open-create-dialog").addEventListener("click", () => elements.dialog.showModal());
document.querySelector("#cancel-create").addEventListener("click", () => elements.dialog.close());
elements.createForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(elements.createForm);
  const name = formData.get("portfolio-name").trim();
  if (!name) return;
  const newPortfolio = {
    id: `portfolio-${Date.now()}`,
    name,
    description: formData.get("portfolio-description").trim(),
    color: ["#39d98a", "#57b8ff", "#f2b84b", "#ff8f70"][portfolios.length % 4],
    managerId: activeCustomPortfolio()?.managerId || DEFAULT_PORTFOLIO_MANAGER_ID,
    cash: 0,
    positions: [],
  };
  portfolios.push(newPortfolio);
  activePortfolioId = newPortfolio.id;
  persistPortfolioState();
  elements.createForm.reset();
  elements.dialog.close();
  showToast(`已创建组合：${name}`);
  render();
});

document.querySelector("#open-allocation-dialog").addEventListener("click", openAllocationDialog);
document.querySelector("#cancel-allocation").addEventListener("click", () => elements.allocationDialog.close());
elements.allocationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const portfolio = activeCustomPortfolio();
  try {
    const positions = [...elements.allocationPositions.querySelectorAll("[data-allocation-symbol]")].map((row) => ({
      symbol: row.dataset.allocationSymbol,
      quantity: row.querySelector("[data-allocation-quantity]").value,
      cost: row.querySelector("[data-allocation-cost]").value,
    }));
    Object.assign(portfolio, updatePortfolioAllocation(portfolio, {
      cash: elements.allocationCash.value,
      positions,
    }));
    persistPortfolioState();
    elements.allocationDialog.close();
    render();
    showToast(`已保存 ${portfolio.name} 的仓位设置`);
  } catch (error) {
    showToast(error.message || "仓位设置保存失败");
  }
});
elements.allocationDialog.addEventListener("click", (event) => {
  if (event.target === elements.allocationDialog) elements.allocationDialog.close();
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    elements.search.focus();
  }
});

function marketTimingChartPoints(chart) {
  try {
    const points = JSON.parse(chart.dataset.chartPoints || "[]");
    return Array.isArray(points) ? points : [];
  } catch {
    return [];
  }
}

function showMarketTimingChartPoint(chart, ratio) {
  const points = marketTimingChartPoints(chart);
  const point = getMarketTimingChartPoint(points, ratio);
  if (!point) return;
  const shell = chart.closest(".timing-chart-shell");
  const tooltip = shell?.querySelector(".timing-chart-tooltip");
  const cursor = chart.querySelector(".timing-chart-cursor");
  const dot = chart.querySelector(".timing-chart-dot");
  if (!shell || !tooltip || !cursor || !dot) return;
  const values = points.map(({ value }) => Number(value)).filter(Number.isFinite);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum || 1;
  const x = points.length > 1 ? point.index / (points.length - 1) * 300 : 150;
  const y = 78 - (point.value - minimum) / span * 78;
  const percent = points.length > 1 ? point.index / (points.length - 1) * 100 : 50;
  cursor.setAttribute("x1", x.toFixed(2));
  cursor.setAttribute("x2", x.toFixed(2));
  dot.setAttribute("cx", x.toFixed(2));
  dot.setAttribute("cy", y.toFixed(2));
  tooltip.querySelector("strong").textContent = point.date;
  tooltip.querySelector("span").textContent = `点位 ${point.value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
  tooltip.querySelector("em").textContent = `较起点 ${point.changePercent >= 0 ? "+" : ""}${point.changePercent.toFixed(2)}%`;
  tooltip.hidden = false;
  tooltip.classList.toggle("is-flipped", percent > 64);
  shell.style.setProperty("--tooltip-x", `${percent}%`);
  shell.classList.add("is-active");
  chart.dataset.activeIndex = String(point.index);
}

function hideMarketTimingChartPoint(chart) {
  const shell = chart.closest(".timing-chart-shell");
  shell?.classList.remove("is-active");
  const tooltip = shell?.querySelector(".timing-chart-tooltip");
  if (tooltip) tooltip.hidden = true;
}

function showMacroChartPoint(chart, ratio) {
  const points = marketTimingChartPoints(chart);
  const point = getMacroChartPoint(points, ratio);
  if (!point) return;
  const shell = chart.closest(".macro-chart-shell");
  const tooltip = shell?.querySelector(".macro-chart-tooltip");
  const cursor = chart.querySelector(".macro-chart-cursor");
  const dot = chart.querySelector(".macro-chart-hover-dot");
  if (!shell || !tooltip || !cursor || !dot) return;
  const benchmark = Number(chart.dataset.chartBenchmark);
  const values = points.map(({ value }) => Number(value)).filter(Number.isFinite);
  if (chart.dataset.chartBenchmark !== "" && Number.isFinite(benchmark)) values.push(benchmark);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum || 1;
  const x = points.length > 1 ? 5 + point.index / (points.length - 1) * 350 : 180;
  const y = 5 + (maximum - point.value) / span * 62;
  const percent = x / 360 * 100;
  const unit = chart.dataset.chartUnit || "";
  const [year, month] = String(point.date).split("-");
  cursor.setAttribute("x1", x.toFixed(2));
  cursor.setAttribute("x2", x.toFixed(2));
  dot.setAttribute("cx", x.toFixed(2));
  dot.setAttribute("cy", y.toFixed(2));
  tooltip.querySelector("strong").textContent = month ? `${year}年${Number(month)}月` : String(point.date);
  tooltip.querySelector("span").textContent = `数值 ${point.value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}${unit}`;
  tooltip.querySelector("em").textContent = `较区间起点 ${point.change >= 0 ? "+" : ""}${point.change.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}${unit}`;
  tooltip.hidden = false;
  tooltip.classList.toggle("is-flipped", percent > 64);
  shell.style.setProperty("--tooltip-x", `${percent}%`);
  shell.classList.add("is-active");
  chart.dataset.activeIndex = String(point.index);
}

function hideMacroChartPoint(chart) {
  const shell = chart.closest(".macro-chart-shell");
  shell?.classList.remove("is-active");
  const tooltip = shell?.querySelector(".macro-chart-tooltip");
  if (tooltip) tooltip.hidden = true;
}

function showSectorRotationChartPoint(chart, ratio) {
  const points = marketTimingChartPoints(chart);
  const point = getSectorRotationChartPoint(points, ratio);
  if (!point) return;
  const shell = chart.closest(".sector-chart-shell");
  const tooltip = shell?.querySelector(".sector-chart-tooltip");
  const cursor = chart.querySelector(".sector-chart-cursor");
  const dot = chart.querySelector(".sector-chart-dot");
  if (!shell || !tooltip || !cursor || !dot) return;
  const values = points.map(({ value }) => Number(value)).filter(Number.isFinite);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum || 1;
  const x = points.length > 1 ? point.index / (points.length - 1) * 520 : 260;
  const y = 132 - (point.value - minimum) / span * 132;
  const percent = x / 520 * 100;
  cursor.setAttribute("x1", x.toFixed(2));
  cursor.setAttribute("x2", x.toFixed(2));
  dot.setAttribute("cx", x.toFixed(2));
  dot.setAttribute("cy", y.toFixed(2));
  tooltip.querySelector("strong").textContent = point.date;
  tooltip.querySelector("span").textContent = `指数 ${point.value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
  tooltip.querySelector("em").textContent = `较区间起点 ${point.changePercent >= 0 ? "+" : ""}${point.changePercent.toFixed(2)}%`;
  tooltip.hidden = false;
  tooltip.classList.toggle("is-flipped", percent > 64);
  shell.style.setProperty("--tooltip-x", `${percent}%`);
  shell.classList.add("is-active");
  chart.dataset.activeIndex = String(point.index);
}

function hideSectorRotationChartPoint(chart) {
  const shell = chart.closest(".sector-chart-shell");
  shell?.classList.remove("is-active");
  const tooltip = shell?.querySelector(".sector-chart-tooltip");
  if (tooltip) tooltip.hidden = true;
}

function showCapitalFlowChartPoint(chart, ratio) {
  const points = marketTimingChartPoints(chart);
  const point = getCapitalFlowChartPoint(points, ratio);
  if (!point) return;
  const shell = chart.closest(".capital-chart-shell");
  const tooltip = shell?.querySelector(".capital-chart-tooltip");
  const cursor = chart.querySelector(".capital-chart-cursor");
  const dot = chart.querySelector(".capital-chart-dot");
  if (!shell || !tooltip || !cursor || !dot) return;
  const x = points.length > 1 ? point.index / (points.length - 1) * 500 : 250;
  const y = 128 - Math.max(0, Math.min(100, point.value)) / 100 * 128;
  const percent = x / 500 * 100;
  cursor.setAttribute("x1", x.toFixed(2));
  cursor.setAttribute("x2", x.toFixed(2));
  dot.setAttribute("cx", x.toFixed(2));
  dot.setAttribute("cy", y.toFixed(2));
  tooltip.querySelector("strong").textContent = point.date;
  tooltip.querySelector("span").textContent = `方向压力 ${point.value.toFixed(2)}`;
  tooltip.querySelector("em").textContent = point.value >= 60 ? "流入占优" : point.value <= 40 ? "流出占优" : "中性区间";
  tooltip.hidden = false;
  tooltip.classList.toggle("is-flipped", percent > 64);
  shell.style.setProperty("--tooltip-x", `${percent}%`);
  shell.classList.add("is-active");
  chart.dataset.activeIndex = String(point.index);
}

function hideCapitalFlowChartPoint(chart) {
  const shell = chart.closest(".capital-chart-shell");
  shell?.classList.remove("is-active");
  const tooltip = shell?.querySelector(".capital-chart-tooltip");
  if (tooltip) tooltip.hidden = true;
}

function showSentimentChartPoint(chart, ratio) {
  const points = marketTimingChartPoints(chart);
  const point = getSentimentChartPoint(points, ratio);
  if (!point) return;
  const shell = chart.closest(".sentiment-chart-shell");
  const tooltip = shell?.querySelector(".sentiment-chart-tooltip");
  const cursor = chart.querySelector(".sentiment-chart-cursor");
  const dot = chart.querySelector(".sentiment-chart-dot");
  if (!shell || !tooltip || !cursor || !dot) return;
  const x = points.length > 1 ? point.index / (points.length - 1) * 620 : 310;
  const y = 176 - Math.max(0, Math.min(100, point.value)) / 100 * 176;
  const percent = x / 620 * 100;
  cursor.setAttribute("x1", x.toFixed(2));
  cursor.setAttribute("x2", x.toFixed(2));
  dot.setAttribute("cx", x.toFixed(2));
  dot.setAttribute("cy", y.toFixed(2));
  tooltip.querySelector("strong").textContent = point.date;
  tooltip.querySelector("span").textContent = `情绪水平 ${point.value.toFixed(1)}`;
  tooltip.querySelector("em").textContent = point.value >= 75 ? "贪婪区" : point.value <= 25 ? "恐慌区" : "平衡区";
  tooltip.hidden = false;
  tooltip.classList.toggle("is-flipped", percent > 64);
  shell.style.setProperty("--tooltip-x", `${percent}%`);
  shell.classList.add("is-active");
  chart.dataset.activeIndex = String(point.index);
}

function hideSentimentChartPoint(chart) {
  const shell = chart.closest(".sentiment-chart-shell");
  shell?.classList.remove("is-active");
  const tooltip = shell?.querySelector(".sentiment-chart-tooltip");
  if (tooltip) tooltip.hidden = true;
}

function microChartCandles(chart) {
  try {
    const candles = JSON.parse(chart.dataset.microCandles || "[]");
    return Array.isArray(candles) ? candles : [];
  } catch {
    return [];
  }
}

function compactChartVolume(value) {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value) || 0);
}

function showMicroChartPoint(chart, ratio) {
  const candles = microChartCandles(chart);
  const point = getMicroChartPoint(candles, ratio);
  if (!point) return;
  const shell = chart.closest(".micro-chart-shell");
  const tooltip = shell?.querySelector(".micro-chart-tooltip");
  const cursor = chart.querySelector(".micro-chart-cursor");
  if (!shell || !tooltip || !cursor) return;
  const formatValue = chart.dataset.valueUnit === "currency"
    ? (value) => formatPrice(Number(value) || 0, chart.dataset.currency || "USD")
    : formatIndexPoints;
  const percent = candles.length > 1 ? point.index / (candles.length - 1) * 100 : 50;
  const x = 44 + percent / 100 * (690 - 44);
  cursor.setAttribute("x1", x.toFixed(2));
  cursor.setAttribute("x2", x.toFixed(2));
  tooltip.querySelector("strong").textContent = formatMicroMarketTime(point.time);
  tooltip.querySelector("span").textContent = `开 ${formatValue(point.open)} · 高 ${formatValue(point.high)} · 低 ${formatValue(point.low)} · 收 ${formatValue(point.close)}`;
  tooltip.querySelector("em").textContent = `买方估算 ${compactChartVolume(point.buyVolume)} · 卖方估算 ${compactChartVolume(point.sellVolume)}`;
  tooltip.querySelector("small").textContent = `Delta ${Number(point.delta) >= 0 ? "+" : ""}${compactChartVolume(point.delta)} · 总量 ${compactChartVolume(point.volume)}`;
  const indicatorValues = tooltip.querySelector("[data-indicator-values]");
  if (indicatorValues) {
    const rsi = point.rsi14 == null ? "--" : Number(point.rsi14).toFixed(1);
    const macd = point.macd == null ? "--" : Number(point.macd).toFixed(3);
    const signal = point.macdSignal == null ? "--" : Number(point.macdSignal).toFixed(3);
    indicatorValues.textContent = `RSI ${rsi} · MACD ${macd} · 信号 ${signal}`;
  }
  const vwapValue = tooltip.querySelector("[data-vwap-value]");
  if (vwapValue) vwapValue.textContent = point.vwap == null ? "VWAP --" : `VWAP ${formatValue(point.vwap)} · 柱体 ${Number(point.macdHistogram || 0).toFixed(3)}`;
  tooltip.hidden = false;
  tooltip.classList.toggle("is-flipped", percent > 64);
  shell.style.setProperty("--tooltip-x", `${Math.max(2, Math.min(98, percent))}%`);
  shell.classList.add("is-active");
  chart.dataset.activeIndex = String(point.index);
}

function hideMicroChartPoint(chart) {
  const shell = chart.closest(".micro-chart-shell");
  shell?.classList.remove("is-active");
  const tooltip = shell?.querySelector(".micro-chart-tooltip");
  if (tooltip) tooltip.hidden = true;
}

document.addEventListener("click", (event) => {
  const companyTab = event.target.closest?.("[data-company-analysis-tab]");
  if (companyTab && activeAnalysisPayload) {
    activeCompanyAnalysisTab = companyTab.dataset.companyAnalysisTab || "market";
    renderStockAnalysis(activeAnalysisPayload);
    elements.analysisContent.querySelector(`[data-company-analysis-tab="${activeCompanyAnalysisTab}"]`)?.focus();
    return;
  }
  const dataSourceCard = event.target.closest?.("[data-source-card]");
  if (dataSourceCard) {
    selectedDataSource = dataSourceCard.dataset.sourceCard || "free";
    const focusTarget = selectedDataSource === "free"
      ? ".data-connector-layout button"
      : `[data-source-card="${selectedDataSource}"]`;
    renderDataSourcesWorkspace(focusTarget);
    return;
  }
  const dataSourceCheckButton = event.target.closest?.("[data-check-source]");
  if (dataSourceCheckButton) {
    checkDataSourceConnector(dataSourceCheckButton.dataset.checkSource || "free");
    return;
  }
  const marketTimingLink = event.target.closest?.('a[href="#signals/market-timing"]');
  if (marketTimingLink && shouldForceWorkspaceRefresh(window.location.hash, marketTimingLink.getAttribute("href"))) {
    event.preventDefault();
    loadMarketTimingWorkspaceData(true, false);
    return;
  }
  const signalRangeButton = event.target.closest("[data-signal-range][data-signal-scope]");
  if (signalRangeButton) {
    const scope = signalRangeButton.dataset.signalScope;
    if (scope === "stock-analysis") {
      analysisChartRange = signalRangeButton.dataset.signalRange || "3m";
      if (activeAnalysisResult) openStockAnalysis(activeAnalysisResult, `[data-signal-range="${analysisChartRange}"][data-signal-scope="stock-analysis"]`);
      return;
    }
    signalTimeRange = signalRangeButton.dataset.signalRange || "1m";
    rerenderSignalWorkspaceForRange(scope);
    const focusHost = scope === "micro-data" ? elements.microWorkspace : elements.signalDetail;
    focusHost.querySelector(`[data-signal-range="${signalTimeRange}"]`)?.focus();
    return;
  }
  const sectorSelectButton = event.target.closest("[data-sector-select][data-sector-market]");
  if (sectorSelectButton && latestSectorRotationPayload) {
    activeSectorRotationSectors[sectorSelectButton.dataset.sectorMarket] = sectorSelectButton.dataset.sectorSelect;
    elements.signalDetail.innerHTML = renderProfiledSignalWorkspace("sector-rotation", latestSectorRotationPayload, renderSectorRotationWorkspace, { range: signalTimeRange, customStart: signalCustomStart, activeSectors: activeSectorRotationSectors });
    elements.signalDetail.querySelector(`.sector-market-workspace.${sectorSelectButton.dataset.sectorMarket} .sector-evidence`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (event.target.closest("[data-refresh-sector-rotation]")) {
    loadSectorRotationWorkspaceData(true);
    return;
  }
  const capitalSelectButton = event.target.closest("[data-capital-select][data-capital-market]");
  if (capitalSelectButton && latestCapitalFlowPayload) {
    activeCapitalFlowSectors[capitalSelectButton.dataset.capitalMarket] = capitalSelectButton.dataset.capitalSelect;
    elements.signalDetail.innerHTML = renderProfiledSignalWorkspace("capital-flow", latestCapitalFlowPayload, renderCapitalFlowWorkspace, { range: signalTimeRange, customStart: signalCustomStart, activeSectors: activeCapitalFlowSectors });
    elements.signalDetail.querySelector(`.capital-market-workspace.${capitalSelectButton.dataset.capitalMarket} .capital-evidence`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    loadCapitalSectorConstituents(capitalSelectButton.dataset.capitalMarket, capitalSelectButton.dataset.capitalSelect);
    return;
  }
  const constituentButton = event.target.closest("[data-capital-constituents][data-capital-market][data-capital-sector]");
  if (constituentButton) {
    loadCapitalSectorConstituents(constituentButton.dataset.capitalMarket, constituentButton.dataset.capitalSector);
    return;
  }
  if (event.target.closest("[data-refresh-capital-flow]")) {
    loadCapitalFlowWorkspaceData(true);
    return;
  }
  if (event.target.closest("[data-refresh-macro]")) {
    loadMacroWorkspaceData(true);
    return;
  }
  if (!event.target.closest(".search-wrap")) elements.searchResults.hidden = true;
});
function prefetchCapitalSectorFromTarget(target) {
  const button = target.closest?.("[data-capital-select][data-capital-market]");
  if (!button || !latestCapitalFlowPayload) return;
  requestCapitalSectorConstituents(button.dataset.capitalMarket, button.dataset.capitalSelect).catch(() => {});
}
document.addEventListener("pointerover", (event) => prefetchCapitalSectorFromTarget(event.target));
document.addEventListener("focusin", (event) => prefetchCapitalSectorFromTarget(event.target));
document.addEventListener("keydown", (event) => {
  const tab = event.target.closest?.("[data-company-analysis-tab]");
  if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...tab.closest('[role="tablist"]')?.querySelectorAll('[role="tab"]') || []];
  if (!tabs.length) return;
  event.preventDefault();
  const index = tabs.indexOf(tab);
  const nextIndex = event.key === "Home" ? 0
    : event.key === "End" ? tabs.length - 1
      : event.key === "ArrowRight" ? (index + 1) % tabs.length
        : (index - 1 + tabs.length) % tabs.length;
  tabs[nextIndex].click();
});
document.addEventListener("input", (event) => {
  if (event.target.matches?.("[data-holding-period-slider]")) {
    const profile = updateHoldingPeriodControls(event.target, holdingDaysFromSliderPosition(event.target.value));
    queueHoldingPeriodDecision(profile);
    return;
  }
  if (event.target.matches?.("[data-holding-days-input]")) {
    if (event.target.value === "") return;
    const profile = updateHoldingPeriodControls(event.target, normalizeHoldingDays(event.target.value));
    queueHoldingPeriodDecision(profile);
  }
});
document.addEventListener("change", (event) => {
  if (event.target.matches("[data-holding-period-slider], [data-holding-days-input]")) {
    const days = event.target.matches("[data-holding-period-slider]")
      ? holdingDaysFromSliderPosition(event.target.value)
      : normalizeHoldingDays(event.target.value);
    const holdingPeriod = updateHoldingPeriodControls(event.target, days);
    queueHoldingPeriodDecision(holdingPeriod, true);
    return;
  }
  if (event.target.matches("[data-stock-chart-range]")) {
    analysisChartRange = event.target.value || "3m";
    if (activeAnalysisResult) openStockAnalysis(activeAnalysisResult, "[data-stock-chart-range]", { preserveContent: true });
    return;
  }
  if (event.target.matches("[data-source-routing]")) {
    const marketId = event.target.dataset.sourceRouting;
    const sourceId = event.target.value;
    const status = sourceId === "free" ? { readyForActivation: true } : dataSourceStatuses[sourceId];
    if (!status?.readyForActivation) {
      showToast("请先完成该数据源的连接检查");
      renderDataSourcesWorkspace();
      return;
    }
    dataSourcePreferences = normalizeDataSourcePreferences({ ...dataSourcePreferences, [marketId]: sourceId });
    saveDataSourcePreferences(window.localStorage, dataSourcePreferences);
    renderDataSourcesWorkspace(`[data-source-routing="${marketId}"][value="${sourceId}"]`);
    showToast(`${marketId === "china" ? "中国市场" : "美国市场"}首选来源已更新`);
    return;
  }
  if (event.target.matches("[data-micro-index][data-micro-market]")) {
    const marketId = event.target.dataset.microMarket;
    activeMicroInstruments[marketId] = event.target.value;
    elements.microWorkspace.innerHTML = renderMicroWorkspaceLoading();
    loadMicroWorkspaceData(false, `[data-micro-index][data-micro-market="${marketId}"]`);
    return;
  }
  if (event.target.matches("[data-signal-custom-start][data-signal-scope]")) {
    const scope = event.target.dataset.signalScope;
    if (scope === "stock-analysis") {
      analysisCustomStart = event.target.value;
      if (!analysisCustomStart) return;
      analysisChartRange = "custom";
      if (activeAnalysisResult) openStockAnalysis(activeAnalysisResult, '[data-signal-custom-start][data-signal-scope="stock-analysis"]');
      return;
    }
    signalCustomStart = event.target.value;
    if (!signalCustomStart) return;
    signalTimeRange = "custom";
    rerenderSignalWorkspaceForRange(scope);
    const focusHost = scope === "micro-data" ? elements.microWorkspace : elements.signalDetail;
    focusHost.querySelector("[data-signal-custom-start]")?.focus();
  }
});
document.addEventListener("submit", (event) => {
  const newsCredentialForm = event.target.closest?.("[data-news-credential-form]");
  if (newsCredentialForm) {
    event.preventDefault();
    const providerId = newsCredentialForm.dataset.newsCredentialForm;
    const apiKey = String(new FormData(newsCredentialForm).get("apiKey") || "");
    saveNewsCredential(providerId, apiKey);
    return;
  }
  const brokerForm = event.target.closest?.("[data-broker-form]");
  if (brokerForm) {
    event.preventDefault();
    const sourceId = brokerForm.dataset.brokerForm;
    const config = Object.fromEntries(new FormData(brokerForm).entries());
    syncBrokerAccount(sourceId, config);
    return;
  }
  const form = event.target.closest?.("[data-source-form]");
  if (!form) return;
  event.preventDefault();
  const sourceId = form.dataset.sourceForm;
  const config = Object.fromEntries(new FormData(form).entries());
  checkDataSourceConnector(sourceId, config);
});
document.addEventListener("pointermove", (event) => {
  const chart = event.target.closest?.("[data-market-timing-chart]");
  if (!chart) return;
  const bounds = chart.getBoundingClientRect();
  showMarketTimingChartPoint(chart, (event.clientX - bounds.left) / bounds.width);
});
document.addEventListener("pointermove", (event) => {
  const chart = event.target.closest?.("[data-macro-chart]");
  if (!chart) return;
  const bounds = chart.getBoundingClientRect();
  showMacroChartPoint(chart, (event.clientX - bounds.left) / bounds.width);
});
document.addEventListener("pointermove", (event) => {
  const chart = event.target.closest?.("[data-sector-chart]");
  if (!chart) return;
  const bounds = chart.getBoundingClientRect();
  showSectorRotationChartPoint(chart, (event.clientX - bounds.left) / bounds.width);
});
document.addEventListener("pointermove", (event) => {
  const chart = event.target.closest?.("[data-capital-flow-chart]");
  if (!chart) return;
  const bounds = chart.getBoundingClientRect();
  showCapitalFlowChartPoint(chart, (event.clientX - bounds.left) / bounds.width);
});
document.addEventListener("pointermove", (event) => {
  const chart = event.target.closest?.("[data-sentiment-chart]");
  if (!chart) return;
  const bounds = chart.getBoundingClientRect();
  showSentimentChartPoint(chart, (event.clientX - bounds.left) / bounds.width);
});
document.addEventListener("pointermove", (event) => {
  const chart = event.target.closest?.("[data-micro-chart]");
  if (!chart) return;
  const bounds = chart.getBoundingClientRect();
  const viewBoxX = (event.clientX - bounds.left) / bounds.width * 920;
  showMicroChartPoint(chart, (viewBoxX - 44) / (690 - 44));
});
document.addEventListener("pointerout", (event) => {
  const chart = event.target.closest?.("[data-market-timing-chart]");
  if (!chart || chart.contains(event.relatedTarget)) return;
  hideMarketTimingChartPoint(chart);
});
document.addEventListener("pointerout", (event) => {
  const chart = event.target.closest?.("[data-macro-chart]");
  if (!chart || chart.contains(event.relatedTarget)) return;
  hideMacroChartPoint(chart);
});
document.addEventListener("pointerout", (event) => {
  const chart = event.target.closest?.("[data-sector-chart]");
  if (!chart || chart.contains(event.relatedTarget)) return;
  hideSectorRotationChartPoint(chart);
});
document.addEventListener("pointerout", (event) => {
  const chart = event.target.closest?.("[data-capital-flow-chart]");
  if (!chart || chart.contains(event.relatedTarget)) return;
  hideCapitalFlowChartPoint(chart);
});
document.addEventListener("pointerout", (event) => {
  const chart = event.target.closest?.("[data-sentiment-chart]");
  if (!chart || chart.contains(event.relatedTarget)) return;
  hideSentimentChartPoint(chart);
});
document.addEventListener("pointerout", (event) => {
  const chart = event.target.closest?.("[data-micro-chart]");
  if (!chart || chart.contains(event.relatedTarget)) return;
  hideMicroChartPoint(chart);
});
document.addEventListener("focusin", (event) => {
  if (event.target.matches?.("[data-market-timing-chart]")) showMarketTimingChartPoint(event.target, 1);
});
document.addEventListener("focusin", (event) => {
  if (event.target.matches?.("[data-macro-chart]")) showMacroChartPoint(event.target, 1);
});
document.addEventListener("focusin", (event) => {
  if (event.target.matches?.("[data-sector-chart]")) showSectorRotationChartPoint(event.target, 1);
});
document.addEventListener("focusin", (event) => {
  if (event.target.matches?.("[data-capital-flow-chart]")) showCapitalFlowChartPoint(event.target, 1);
});
document.addEventListener("focusin", (event) => {
  if (event.target.matches?.("[data-sentiment-chart]")) showSentimentChartPoint(event.target, 1);
});
document.addEventListener("focusin", (event) => {
  if (event.target.matches?.("[data-micro-chart]")) showMicroChartPoint(event.target, 1);
});
document.addEventListener("focusout", (event) => {
  if (event.target.matches?.("[data-market-timing-chart]")) hideMarketTimingChartPoint(event.target);
});
document.addEventListener("focusout", (event) => {
  if (event.target.matches?.("[data-macro-chart]")) hideMacroChartPoint(event.target);
});
document.addEventListener("focusout", (event) => {
  if (event.target.matches?.("[data-sector-chart]")) hideSectorRotationChartPoint(event.target);
});
document.addEventListener("focusout", (event) => {
  if (event.target.matches?.("[data-capital-flow-chart]")) hideCapitalFlowChartPoint(event.target);
});
document.addEventListener("focusout", (event) => {
  if (event.target.matches?.("[data-sentiment-chart]")) hideSentimentChartPoint(event.target);
});
document.addEventListener("focusout", (event) => {
  if (event.target.matches?.("[data-micro-chart]")) hideMicroChartPoint(event.target);
});
document.addEventListener("keydown", (event) => {
  const chart = event.target.matches?.("[data-market-timing-chart]") ? event.target : null;
  if (!chart || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const points = marketTimingChartPoints(chart);
  if (!points.length) return;
  const current = Number(chart.dataset.activeIndex || points.length - 1);
  const index = event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, current + (event.key === "ArrowLeft" ? -1 : 1)));
  showMarketTimingChartPoint(chart, points.length > 1 ? index / (points.length - 1) : 0);
});
document.addEventListener("keydown", (event) => {
  const chart = event.target.matches?.("[data-macro-chart]") ? event.target : null;
  if (!chart || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const points = marketTimingChartPoints(chart);
  if (!points.length) return;
  const current = Number(chart.dataset.activeIndex || points.length - 1);
  const index = event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, current + (event.key === "ArrowLeft" ? -1 : 1)));
  showMacroChartPoint(chart, points.length > 1 ? index / (points.length - 1) : 0);
});
document.addEventListener("keydown", (event) => {
  const chart = event.target.matches?.("[data-sector-chart]") ? event.target : null;
  if (!chart || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const points = marketTimingChartPoints(chart);
  if (!points.length) return;
  const current = Number(chart.dataset.activeIndex || points.length - 1);
  const index = event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, current + (event.key === "ArrowLeft" ? -1 : 1)));
  showSectorRotationChartPoint(chart, points.length > 1 ? index / (points.length - 1) : 0);
});
document.addEventListener("keydown", (event) => {
  const chart = event.target.matches?.("[data-capital-flow-chart]") ? event.target : null;
  if (!chart || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const points = marketTimingChartPoints(chart);
  if (!points.length) return;
  const current = Number(chart.dataset.activeIndex || points.length - 1);
  const index = event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, current + (event.key === "ArrowLeft" ? -1 : 1)));
  showCapitalFlowChartPoint(chart, points.length > 1 ? index / (points.length - 1) : 0);
});
document.addEventListener("keydown", (event) => {
  const chart = event.target.matches?.("[data-sentiment-chart]") ? event.target : null;
  if (!chart || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const points = marketTimingChartPoints(chart);
  if (!points.length) return;
  const current = Number(chart.dataset.activeIndex || points.length - 1);
  const index = event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, current + (event.key === "ArrowLeft" ? -1 : 1)));
  showSentimentChartPoint(chart, points.length > 1 ? index / (points.length - 1) : 0);
});
document.addEventListener("keydown", (event) => {
  const chart = event.target.matches?.("[data-micro-chart]") ? event.target : null;
  if (!chart || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const candles = microChartCandles(chart);
  if (!candles.length) return;
  const current = Number(chart.dataset.activeIndex || candles.length - 1);
  const index = event.key === "Home" ? 0 : event.key === "End" ? candles.length - 1 : Math.max(0, Math.min(candles.length - 1, current + (event.key === "ArrowLeft" ? -1 : 1)));
  showMicroChartPoint(chart, candles.length > 1 ? index / (candles.length - 1) : 0);
});
window.addEventListener("hashchange", renderWorkspaceRoute);
window.addEventListener("focus", () => {
  if (resolveWorkspaceRoute(window.location.hash).workspace === "data-sources") refreshDataSourceHealth();
});
window.addEventListener("online", () => {
  if (resolveWorkspaceRoute(window.location.hash).workspace === "data-sources") refreshDataSourceHealth();
});

elements.navOverview.addEventListener("click", () => {
  const expanded = elements.navOverview.getAttribute("aria-expanded") !== "true";
  setNavigationDisclosure(elements.navOverview, elements.overviewSubnav, expanded);
});
elements.navSignals.addEventListener("click", () => {
  const expanded = elements.navSignals.getAttribute("aria-expanded") !== "true";
  setNavigationDisclosure(elements.navSignals, elements.signalSubnav, expanded);
});

document.querySelector("#close-analysis").addEventListener("click", () => {
  window.clearTimeout(companyResearchRefreshTimer);
  elements.analysisDialog.close();
});
elements.analysisAddButton.addEventListener("click", () => {
  if (activeAnalysisResult) addSearchResultToPortfolio(activeAnalysisResult, elements.analysisAddButton);
});
elements.analysisContent.addEventListener("click", (event) => {
  if (event.target.closest("[data-retry-analysis]") && activeAnalysisResult) openStockAnalysis(activeAnalysisResult);
});
elements.analysisDialog.addEventListener("click", (event) => {
  if (event.target === elements.analysisDialog) {
    window.clearTimeout(companyResearchRefreshTimer);
    elements.analysisDialog.close();
  }
});
elements.analysisDialog.addEventListener("close", () => window.clearTimeout(companyResearchRefreshTimer));

elements.themeToggle.addEventListener("click", () => {
  const isDark = document.documentElement.dataset.theme === "dark";
  document.documentElement.dataset.theme = isDark ? "light" : "dark";
  elements.themeToggle.setAttribute("aria-pressed", String(!isDark));
  elements.themeToggle.setAttribute("aria-label", isDark ? "切换到深色模式" : "切换到浅色模式");
  elements.themeToggle.querySelector("span").textContent = isDark ? "☾" : "☀";
});

elements.refreshBrokerPositions?.addEventListener("click", () => refreshSavedIbkrSnapshot(true));

render();
queueMicrotask(refreshDataSourceHealth);
refreshSavedIbkrSnapshot();
refreshPortfolioQuotes().catch(() => null);
signalPreloader.load().then((payload) => hydrateSignalWorkspaces(payload.workspaces)).catch(() => {
  // Direct workspace loaders retain their individual endpoint fallback.
});
