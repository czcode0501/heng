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

function render() {
  renderPortfolioNav();
  renderActivePortfolio();
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
  elements.searchResults.innerHTML = results.length
    ? results.map((stock, index) => `<button class="search-option" type="button" role="option" data-result-index="${index}">
        <span class="stock-avatar">${escapeHtml(stock.symbol.slice(0, 2))}</span>
        <span><strong>${escapeHtml(stock.name)}</strong><small>${escapeHtml(stock.symbol)} · ${escapeHtml(stock.market)} · ${escapeHtml(stock.source || "本地")}</small></span>
        <span>添加</span>
      </button>`).join("")
    : `<div class="search-feedback" role="status"><strong>没有找到匹配标的</strong><small>请检查代码，或尝试输入完整公司名称。</small></div>`;
  elements.searchResults.hidden = false;
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
  render();
});

elements.search.addEventListener("input", (event) => scheduleSearch(event.target.value));
elements.search.addEventListener("keydown", (event) => {
  if (event.key === "Escape") elements.searchResults.hidden = true;
});
elements.searchResults.addEventListener("click", (event) => {
  const button = event.target.closest("[data-result-index]");
  if (!button) return;
  const result = latestSearchResults[Number(button.dataset.resultIndex)];
  if (!result) return;
  addSearchResultToPortfolio(result, button);
});

async function addSearchResultToPortfolio(result, button) {
  const portfolio = portfolios.find((item) => item.id === activePortfolioId);
  if (portfolio.positions.some((position) => position.symbol === result.symbol)) {
    showToast(`${result.name} 已在当前组合中`);
    return;
  }
  button.disabled = true;
  button.querySelector("span:last-child").textContent = "读取行情…";
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
    elements.search.value = "";
    elements.searchResults.hidden = true;
    render();
  } catch (error) {
    showToast(error.message || "添加失败，请稍后重试");
    button.disabled = false;
    button.querySelector("span:last-child").textContent = "重试";
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
  if (!event.target.closest(".search-wrap")) elements.searchResults.hidden = true;
});

elements.themeToggle.addEventListener("click", () => {
  const isDark = document.documentElement.dataset.theme === "dark";
  document.documentElement.dataset.theme = isDark ? "light" : "dark";
  elements.themeToggle.setAttribute("aria-pressed", String(!isDark));
  elements.themeToggle.setAttribute("aria-label", isDark ? "切换到深色模式" : "切换到浅色模式");
  elements.themeToggle.querySelector("span").textContent = isDark ? "☾" : "☀";
});

render();
