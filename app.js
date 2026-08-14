import { getSearchResultActions, getTrendPresentation } from "./search-flow.js";
import { resolveWorkspaceRoute, signalDirectories } from "./signals/catalog.js";
import { macroMarkets } from "./signals/macro/catalog.js";
import { renderMacroWorkspace, renderMacroWorkspaceError, renderMacroWorkspaceLoading } from "./signals/macro/view.js";
import { marketTimingMarkets } from "./signals/market-timing/catalog.js";
import {
  getMarketTimingRefreshDelay,
  renderMarketTimingWorkspace,
  renderMarketTimingWorkspaceError,
  renderMarketTimingWorkspaceLoading,
} from "./signals/market-timing/view.js";

const stockCatalog = [
  { symbol: "600519", yahoo: "600519.SS", name: "贵州茅台", market: "A股 · 上海", currency: "CNY", price: 1341.99, change: -0.98 },
  { symbol: "000001", yahoo: "000001.SZ", name: "平安银行", market: "A股 · 深圳", currency: "CNY", price: 11.11, change: -1.24 },
  { symbol: "588170", yahoo: "588170.SS", name: "科创半导体ETF", market: "A股 · 上海", currency: "CNY", price: 1.021, change: 1.09 },
  { symbol: "588200", yahoo: "588200.SS", name: "科创芯片ETF", market: "A股 · 上海", currency: "CNY", price: 1.212, change: 0.66 },
  { symbol: "AAPL", yahoo: "AAPL", name: "Apple", market: "美股 · NASDAQ", currency: "USD", price: 305.3, change: 0.17 },
  { symbol: "MSFT", yahoo: "MSFT", name: "Microsoft", market: "美股 · NASDAQ", currency: "USD", price: 499.35, change: 0.7 },
  { symbol: "NVDA", yahoo: "NVDA", name: "NVIDIA", market: "美股 · NASDAQ", currency: "USD", price: 182.44, change: 1.86 },
  { symbol: "TSLA", yahoo: "TSLA", name: "Tesla", market: "美股 · NASDAQ", currency: "USD", price: 412.76, change: -0.62 },
];

const portfolios = [
  {
    id: "core",
    name: "核心长期组合",
    description: "高质量资产与科技成长",
    color: "#39d98a",
    cash: 186000,
    positions: [
      { symbol: "600519", quantity: 100, cost: 1280 },
      { symbol: "AAPL", quantity: 80, cost: 276 },
      { symbol: "MSFT", quantity: 35, cost: 472 },
    ],
  },
  {
    id: "ai-growth",
    name: "AI 成长实验",
    description: "半导体与AI基础设施",
    color: "#57b8ff",
    cash: 82000,
    positions: [
      { symbol: "NVDA", quantity: 120, cost: 168 },
      { symbol: "588170", quantity: 80000, cost: 0.96 },
      { symbol: "588200", quantity: 50000, cost: 1.16 },
    ],
  },
  {
    id: "defensive",
    name: "防守配置",
    description: "现金与低波动仓位",
    color: "#f2b84b",
    cash: 310000,
    positions: [{ symbol: "000001", quantity: 12000, cost: 10.72 }],
  },
];

let activePortfolioId = portfolios[0].id;
const usdCny = 7.18;
let latestSearchResults = [];
let searchTimer;
let searchRequestId = 0;
let analysisRequestId = 0;
let macroRequestId = 0;
let macroRefreshTimer;
let macroTimeRange = 24;
let latestMacroPayload = null;
let marketTimingRequestId = 0;
let marketTimingRefreshTimer;
let latestMarketTimingPayload = null;
let activeAnalysisResult = null;

const elements = {
  portfolioList: document.querySelector("#portfolio-list"),
  portfolioTitle: document.querySelector("#portfolio-title"),
  holdingsBody: document.querySelector("#holdings-body"),
  holdingsEmpty: document.querySelector("#holdings-empty"),
  totalValue: document.querySelector("#total-value"),
  totalChange: document.querySelector("#total-change"),
  totalReturn: document.querySelector("#total-return"),
  profitValue: document.querySelector("#profit-value"),
  allocationRing: document.querySelector("#allocation-ring"),
  investedPercent: document.querySelector("#invested-percent"),
  allocationLegend: document.querySelector("#allocation-legend"),
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
  signalsWorkspace: document.querySelector("#signals-workspace"),
  signalsHub: document.querySelector("#signals-hub"),
  signalDetail: document.querySelector("#signal-detail"),
  signalSubnav: document.querySelector("#signal-subnav"),
  signalDirectoryGrid: document.querySelector("#signal-directory-grid"),
  overviewSignalLinks: document.querySelector("#overview-signal-links"),
  navOverview: document.querySelector("#nav-overview"),
  navSignals: document.querySelector("#nav-signals"),
  pageContextCurrent: document.querySelector("#page-context-current"),
};

function stockBySymbol(symbol) {
  return stockCatalog.find((stock) => stock.symbol === symbol);
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

function renderPortfolioNav() {
  elements.portfolioList.innerHTML = portfolios
    .map((portfolio) => {
      const active = portfolio.id === activePortfolioId;
      return `<button class="portfolio-button${active ? " active" : ""}" type="button" data-portfolio-id="${portfolio.id}" style="--portfolio-color:${portfolio.color}" ${active ? 'aria-current="true"' : ""}>
        <span class="portfolio-color" aria-hidden="true"></span>
        <span><strong>${portfolio.name}</strong><small>${portfolio.positions.length} 个标的</small></span>
        <span>›</span>
      </button>`;
    })
    .join("");
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
  elements.allocationRing.style.background = `conic-gradient(var(--accent) 0 ${aShare}%, var(--cyan) ${aShare}% ${aShare + usShare}%, var(--cash) ${aShare + usShare}% 100%)`;
  elements.allocationRing.setAttribute("aria-label", `A股 ${aShare.toFixed(1)}%，美股 ${usShare.toFixed(1)}%，现金 ${cash.toFixed(1)}%`);
  const items = [
    ["A股", aShare, "var(--accent)"],
    ["美股", usShare, "var(--cyan)"],
    ["现金", cash, "var(--cash)"],
  ];
  elements.allocationLegend.innerHTML = items
    .map(([label, value, color]) => `<div><span class="legend-dot" style="--legend-color:${color}" aria-hidden="true"></span><dt>${label}</dt><dd>${value.toFixed(1)}%</dd></div>`)
    .join("");
}

function renderActivePortfolio() {
  const portfolio = portfolios.find((item) => item.id === activePortfolioId);
  elements.portfolioTitle.textContent = portfolio.name;
  const investedValue = portfolio.positions.reduce((sum, position) => sum + valueInCny(position), 0);
  const totalCost = portfolio.positions.reduce((sum, position) => sum + costInCny(position), 0);
  const totalValue = investedValue + portfolio.cash;
  const profit = investedValue - totalCost;
  const returnRate = totalCost ? (profit / totalCost) * 100 : 0;
  const dailyChange = portfolio.positions.reduce((sum, position) => {
    const stock = stockBySymbol(position.symbol);
    return sum + valueInCny(position) * (stock.change / 100);
  }, 0);

  elements.totalValue.textContent = formatMoney(totalValue);
  elements.totalChange.textContent = `${dailyChange >= 0 ? "+" : ""}${formatMoney(dailyChange)}`;
  elements.totalChange.className = dailyChange >= 0 ? "gain" : "loss";
  elements.totalReturn.textContent = `${returnRate >= 0 ? "+" : ""}${returnRate.toFixed(2)}%`;
  elements.totalReturn.className = returnRate >= 0 ? "gain" : "loss";
  elements.profitValue.textContent = `${profit >= 0 ? "+" : ""}${formatMoney(profit)}`;

  elements.holdingsBody.innerHTML = portfolio.positions
    .map((position) => {
      const stock = stockBySymbol(position.symbol);
      const value = valueInCny(position);
      const weight = totalValue ? (value / totalValue) * 100 : 0;
      const changeClass = stock.change >= 0 ? "gain" : "loss";
      const marketName = stock.currency === "USD" ? "US" : "CN";
      return `<tr>
        <td><div class="stock-cell"><span class="stock-avatar">${stock.symbol.slice(0, 2)}</span><span><strong>${stock.name}</strong><small>${stock.symbol}</small></span></div></td>
        <td><span class="market-badge">${marketName}</span></td>
        <td>${formatPrice(stock.price, stock.currency)}</td>
        <td class="${changeClass}">${stock.change >= 0 ? "+" : ""}${stock.change.toFixed(2)}%</td>
        <td>${formatMoney(value)}</td>
        <td><span class="weight-bar"><i style="--weight:${Math.min(weight, 100)}%"></i>${weight.toFixed(1)}%</span></td>
        <td><button class="remove-button" type="button" data-remove-symbol="${stock.symbol}" aria-label="从${portfolio.name}移除${stock.name}">×</button></td>
      </tr>`;
    })
    .join("");
  elements.holdingsEmpty.hidden = portfolio.positions.length > 0;
  document.querySelector(".table-wrap").hidden = portfolio.positions.length === 0;
  renderAllocation(portfolio, investedValue, totalValue);
}

function renderSignalDirectoryStructure(activeDirectory = null) {
  elements.signalSubnav.innerHTML = signalDirectories
    .map((directory) => `<a class="signal-subnav-link${directory.id === activeDirectory ? " active" : ""}" href="#signals/${directory.id}" ${directory.id === activeDirectory ? 'aria-current="page"' : ""}>
      <span>${directory.index}</span>${escapeHtml(directory.title)}
    </a>`)
    .join("");

  elements.overviewSignalLinks.innerHTML = signalDirectories
    .map((directory) => `<a class="overview-signal-link" href="#signals/${directory.id}">
      <span>${directory.index}</span><strong>${escapeHtml(directory.title)}</strong><small>待定义</small>
    </a>`)
    .join("");

  elements.signalDirectoryGrid.innerHTML = signalDirectories
    .map((directory) => `<a class="signal-directory-card" href="#signals/${directory.id}" aria-label="进入${escapeHtml(directory.title)}目录">
      <span class="directory-index">${directory.index}</span>
      <div class="directory-name"><small>${directory.english}</small><h3>${escapeHtml(directory.title)}</h3></div>
      <p>${escapeHtml(directory.description)}</p>
      <em class="directory-status">等待定义</em>
      <strong>打开目录 <span aria-hidden="true">→</span></strong>
    </a>`)
    .join("");
}

function renderSignalDetail(directory) {
  if (directory.id === "macro") {
    elements.signalDetail.innerHTML = renderMacroWorkspaceLoading(macroMarkets);
    loadMacroWorkspaceData();
    return;
  }

  if (directory.id === "market-timing") {
    elements.signalDetail.innerHTML = latestMarketTimingPayload
      ? renderMarketTimingWorkspace(latestMarketTimingPayload)
      : renderMarketTimingWorkspaceLoading(marketTimingMarkets);
    loadMarketTimingWorkspaceData();
    return;
  }

  elements.signalDetail.innerHTML = `<a class="back-link" href="#signals">← 返回模型信号目录</a>
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

async function loadMacroWorkspaceData(force = false) {
  const requestId = ++macroRequestId;
  const refreshButton = elements.signalDetail.querySelector("[data-refresh-macro]");
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = force ? "正在检查…" : "正在连接…";
  }
  try {
    const response = await fetch(`/api/macro${force ? "?refresh=1" : ""}`);
    const payload = await response.json();
    const route = resolveWorkspaceRoute(window.location.hash);
    if (requestId !== macroRequestId || route.directory !== "macro") return;
    if (!response.ok) throw new Error(payload?.error?.message || "宏观数据读取失败");
    if (!Array.isArray(payload?.data?.markets)) throw new Error("宏观数据返回格式不正确");
    latestMacroPayload = payload.data;
    elements.signalDetail.innerHTML = renderMacroWorkspace(payload.data, { range: macroTimeRange });
    window.clearTimeout(macroRefreshTimer);
    const refreshDelay = Math.max(60, Number(payload.data.refreshAfterSeconds) || 21600) * 1000;
    macroRefreshTimer = window.setTimeout(() => {
      if (resolveWorkspaceRoute(window.location.hash).directory === "macro") loadMacroWorkspaceData();
    }, refreshDelay);
  } catch (error) {
    const route = resolveWorkspaceRoute(window.location.hash);
    if (requestId !== macroRequestId || route.directory !== "macro") return;
    elements.signalDetail.innerHTML = renderMacroWorkspaceError(error.message || "数据源暂时不可用，请稍后重试", macroMarkets);
  }
}

async function loadMarketTimingWorkspaceData(force = false) {
  const requestId = ++marketTimingRequestId;
  const refreshButton = elements.signalDetail.querySelector("[data-refresh-market-timing]");
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = force ? "正在重新检查…" : "正在检查…";
  }
  try {
    const response = await fetch(`/api/market-timing${force ? "?refresh=1" : ""}`);
    const payload = await response.json();
    const route = resolveWorkspaceRoute(window.location.hash);
    if (requestId !== marketTimingRequestId || route.directory !== "market-timing") return;
    if (!response.ok) throw new Error(payload?.error?.message || "市场择时数据读取失败");
    if (!Array.isArray(payload?.data?.markets)) throw new Error("市场择时数据返回格式不正确");
    latestMarketTimingPayload = payload.data;
    elements.signalDetail.innerHTML = renderMarketTimingWorkspace(payload.data);
    window.clearTimeout(marketTimingRefreshTimer);
    marketTimingRefreshTimer = window.setTimeout(() => {
      if (resolveWorkspaceRoute(window.location.hash).directory === "market-timing") loadMarketTimingWorkspaceData();
    }, getMarketTimingRefreshDelay(payload.data));
  } catch (error) {
    const route = resolveWorkspaceRoute(window.location.hash);
    if (requestId !== marketTimingRequestId || route.directory !== "market-timing") return;
    elements.signalDetail.innerHTML = renderMarketTimingWorkspaceError(error.message || "数据源暂时不可用，请稍后重试", marketTimingMarkets);
  }
}

function setPrimaryNavigation(workspace) {
  const isOverview = workspace === "overview";
  elements.navOverview.classList.toggle("active", isOverview);
  elements.navSignals.classList.toggle("active", !isOverview);
  elements.navOverview.toggleAttribute("aria-current", isOverview);
  elements.navSignals.toggleAttribute("aria-current", !isOverview);
}

function renderWorkspaceRoute() {
  const route = resolveWorkspaceRoute(window.location.hash);
  const directory = signalDirectories.find((item) => item.id === route.directory) || null;
  const isOverview = route.workspace === "overview";

  elements.overviewWorkspace.hidden = !isOverview;
  elements.signalsWorkspace.hidden = isOverview;
  elements.signalsHub.hidden = Boolean(directory);
  elements.signalDetail.hidden = !directory;
  setPrimaryNavigation(route.workspace);
  renderSignalDirectoryStructure(directory?.id || null);
  if (directory?.id !== "market-timing") window.clearTimeout(marketTimingRefreshTimer);

  if (isOverview) {
    const portfolio = portfolios.find((item) => item.id === activePortfolioId);
    elements.portfolioTitle.textContent = portfolio.name;
    elements.pageContextCurrent.textContent = "组合总览";
    return;
  }

  elements.portfolioTitle.textContent = directory?.title || "模型信号";
  elements.pageContextCurrent.textContent = directory ? `模型信号 / ${directory.title}` : "模型信号";
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
  const portfolio = portfolios.find((item) => item.id === activePortfolioId);
  elements.searchResults.innerHTML = results.length
    ? results.map((stock, index) => {
      const actions = getSearchResultActions(portfolio, stock);
      return `<div class="search-option" role="listitem">
        <button class="search-analysis-trigger" type="button" data-view-analysis="${index}" aria-label="查看${escapeHtml(stock.name)}分析">
          <span class="stock-avatar">${escapeHtml(stock.symbol.slice(0, 2))}</span>
          <span><strong>${escapeHtml(stock.name)}</strong><small>${escapeHtml(stock.symbol)} · ${escapeHtml(stock.market)} · ${escapeHtml(stock.source || "本地")}</small></span>
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
  const portfolio = portfolios.find((item) => item.id === activePortfolioId);
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

function renderStockAnalysis(payload) {
  const metrics = payload.analysis;
  const trend = getTrendPresentation(metrics.trend);
  const dailyChange = payload.changePercent ?? 0;
  const changeTone = dailyChange >= 0 ? "positive" : "negative";
  const ma20Distance = metrics.ma20 ? ((payload.price / metrics.ma20) - 1) * 100 : 0;
  const rsiState = metrics.rsi14 >= 70 ? "偏热" : metrics.rsi14 <= 30 ? "偏冷" : "中性";
  const rangePosition = Math.min(100, Math.max(0, metrics.rangePosition));

  elements.analysisContent.innerHTML = `<section class="analysis-overview" aria-label="行情概览">
    <div class="analysis-price-block">
      <span>最新收盘价</span>
      <strong>${formatPrice(payload.price, payload.currency)}</strong>
      <em class="analysis-change ${changeTone}">${dailyChange >= 0 ? "+" : ""}${dailyChange.toFixed(2)}% 今日</em>
    </div>
    <div class="trend-summary ${trend.tone}">
      <span>趋势判断</span>
      <strong>${trend.label}</strong>
      <p>${trend.summary}</p>
    </div>
  </section>
  <section class="analysis-metrics" aria-label="技术指标">
    <article><span>20日均线</span><strong>${formatPrice(metrics.ma20, payload.currency)}</strong><small class="${ma20Distance >= 0 ? "positive" : "negative"}">现价 ${ma20Distance >= 0 ? "高于" : "低于"} ${Math.abs(ma20Distance).toFixed(2)}%</small></article>
    <article><span>60日均线</span><strong>${metrics.ma60 == null ? "数据不足" : formatPrice(metrics.ma60, payload.currency)}</strong><small>中期趋势参考</small></article>
    <article><span>RSI（14日）</span><strong>${metrics.rsi14.toFixed(1)}</strong><small>${rsiState}区间</small></article>
    <article><span>20日年化波动</span><strong>${metrics.volatility20.toFixed(1)}%</strong><small>历史波动指标</small></article>
  </section>
  <section class="range-card" aria-labelledby="price-range-title">
    <div class="range-heading"><div><span>近一年收盘区间</span><strong id="price-range-title">当前位于区间 ${rangePosition.toFixed(0)}%</strong></div><small>${metrics.sampleDays} 个交易日</small></div>
    <div class="range-track" aria-hidden="true"><i style="--range-position:${rangePosition}%"></i></div>
    <div class="range-values"><span>低 ${formatPrice(metrics.periodLow, payload.currency)}</span><span>高 ${formatPrice(metrics.periodHigh, payload.currency)}</span></div>
  </section>`;

  const updatedAt = new Date(payload.timestamp).toLocaleString("zh-CN", { hour12: false });
  elements.analysisSource.textContent = `数据源：${payload.source} · 更新于 ${updatedAt}`;
}

async function openStockAnalysis(result) {
  const requestId = ++analysisRequestId;
  activeAnalysisResult = result;
  elements.analysisName.textContent = result.name;
  elements.analysisAvatar.textContent = result.symbol.slice(0, 2);
  elements.analysisMarket.textContent = result.currency === "USD" ? "US" : "CN";
  elements.analysisMeta.textContent = `${result.symbol} · ${result.market}`;
  elements.analysisSource.textContent = `数据源：${result.source || "--"}`;
  updateAnalysisAddButton();
  renderAnalysisLoading();
  elements.searchResults.hidden = true;
  if (!elements.analysisDialog.open) elements.analysisDialog.showModal();

  try {
    const response = await fetch(`/api/analysis?symbol=${encodeURIComponent(result.providerSymbol)}`);
    const payload = await response.json();
    if (requestId !== analysisRequestId) return;
    if (!response.ok) throw new Error(payload?.error?.message || "分析数据读取失败");
    renderStockAnalysis(payload.data);
    if (!stockBySymbol(result.symbol)) {
      stockCatalog.push({
        symbol: result.symbol,
        yahoo: result.providerSymbol,
        name: result.name,
        market: result.market,
        currency: payload.data.currency || result.currency,
        price: payload.data.price,
        change: payload.data.changePercent ?? 0,
      });
    }
  } catch (error) {
    if (requestId !== analysisRequestId) return;
    elements.analysisContent.innerHTML = `<div class="analysis-error" role="alert"><strong>暂时无法生成分析</strong><p>${escapeHtml(error.message || "行情数据源暂时不可用，请稍后重试")}</p><button class="button secondary" type="button" data-retry-analysis>重新加载</button></div>`;
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
  if (resolveWorkspaceRoute(window.location.hash).workspace !== "overview") window.location.hash = "overview";
  render();
  updateAnalysisAddButton();
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
  const portfolio = portfolios.find((item) => item.id === activePortfolioId);
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
      };
      stockCatalog.push(stock);
    }
    portfolio.positions.push({ symbol: stock.symbol, quantity: stock.currency === "USD" ? 10 : 1000, cost: stock.price });
    showToast(`已将 ${stock.name} 加入 ${portfolio.name}`);
    render();
    renderSearchOptions(latestSearchResults);
    updateAnalysisAddButton();
  } catch (error) {
    showToast(error.message || "添加失败，请稍后重试");
    button.disabled = false;
    button.textContent = "重试添加";
  }
}

elements.holdingsBody.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-symbol]");
  if (!button) return;
  const portfolio = portfolios.find((item) => item.id === activePortfolioId);
  const stock = stockBySymbol(button.dataset.removeSymbol);
  portfolio.positions = portfolio.positions.filter((position) => position.symbol !== stock.symbol);
  showToast(`已从当前组合移除 ${stock.name}`);
  render();
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
    cash: 100000,
    positions: [],
  };
  portfolios.push(newPortfolio);
  activePortfolioId = newPortfolio.id;
  elements.createForm.reset();
  elements.dialog.close();
  showToast(`已创建组合：${name}`);
  render();
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    elements.search.focus();
  }
});
document.addEventListener("click", (event) => {
  const rangeButton = event.target.closest("[data-macro-range]");
  if (rangeButton && latestMacroPayload) {
    macroTimeRange = Number(rangeButton.dataset.macroRange) || 24;
    elements.signalDetail.innerHTML = renderMacroWorkspace(latestMacroPayload, { range: macroTimeRange });
    elements.signalDetail.querySelector(`[data-macro-range="${macroTimeRange}"]`)?.focus();
    return;
  }
  if (event.target.closest("[data-refresh-macro]")) {
    loadMacroWorkspaceData(true);
    return;
  }
  if (event.target.closest("[data-refresh-market-timing]")) {
    loadMarketTimingWorkspaceData(true);
    return;
  }
  if (!event.target.closest(".search-wrap")) elements.searchResults.hidden = true;
});
window.addEventListener("hashchange", renderWorkspaceRoute);

document.querySelector("#close-analysis").addEventListener("click", () => elements.analysisDialog.close());
elements.analysisAddButton.addEventListener("click", () => {
  if (activeAnalysisResult) addSearchResultToPortfolio(activeAnalysisResult, elements.analysisAddButton);
});
elements.analysisContent.addEventListener("click", (event) => {
  if (event.target.closest("[data-retry-analysis]") && activeAnalysisResult) openStockAnalysis(activeAnalysisResult);
});
elements.analysisDialog.addEventListener("click", (event) => {
  if (event.target === elements.analysisDialog) elements.analysisDialog.close();
});

elements.themeToggle.addEventListener("click", () => {
  const isDark = document.documentElement.dataset.theme === "dark";
  document.documentElement.dataset.theme = isDark ? "light" : "dark";
  elements.themeToggle.setAttribute("aria-pressed", String(!isDark));
  elements.themeToggle.setAttribute("aria-label", isDark ? "切换到深色模式" : "切换到浅色模式");
  elements.themeToggle.querySelector("span").textContent = isDark ? "☾" : "☀";
});

render();
