export const PORTFOLIO_STORAGE_KEY = "quant-desk.portfolios.v1";
const LEGACY_DEMO_PORTFOLIO_IDS = new Set(["core", "ai-growth", "defensive"]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isFiniteNonNegative(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

function isValidPosition(position) {
  return Boolean(position)
    && typeof position.symbol === "string"
    && position.symbol.length > 0
    && isFiniteNonNegative(position.quantity)
    && isFiniteNonNegative(position.cost);
}

function isValidPortfolio(portfolio) {
  return Boolean(portfolio)
    && typeof portfolio.id === "string"
    && typeof portfolio.name === "string"
    && isFiniteNonNegative(portfolio.cash)
    && Array.isArray(portfolio.positions)
    && portfolio.positions.every(isValidPosition);
}

function isValidStock(stock) {
  return Boolean(stock)
    && typeof stock.symbol === "string"
    && typeof stock.currency === "string"
    && Number.isFinite(Number(stock.price));
}

export function loadPortfolioState(storage, defaults) {
  const fallback = {
    portfolios: clone(defaults),
    activePortfolioId: defaults[0]?.id || null,
    customStocks: [],
  };
  if (!storage?.getItem) return fallback;
  try {
    const saved = JSON.parse(storage.getItem(PORTFOLIO_STORAGE_KEY) || "null");
    if (!saved || !Array.isArray(saved.portfolios) || !saved.portfolios.length) return fallback;
    if (!saved.portfolios.every(isValidPortfolio)) return fallback;
    const activeExists = saved.portfolios.some(({ id }) => id === saved.activePortfolioId);
    return {
      portfolios: clone(saved.portfolios),
      activePortfolioId: activeExists ? saved.activePortfolioId : saved.portfolios[0].id,
      customStocks: Array.isArray(saved.customStocks)
        ? clone(saved.customStocks.filter(isValidStock).map((stock) => ({ ...stock, name: stock.name || stock.symbol })))
        : [],
    };
  } catch {
    return fallback;
  }
}

export function savePortfolioState(storage, state) {
  if (!storage?.setItem) return false;
  try {
    storage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify({
      portfolios: state.portfolios,
      activePortfolioId: state.activePortfolioId,
      customStocks: state.customStocks || [],
    }));
    return true;
  } catch {
    return false;
  }
}

export function migrateLegacyDemoPortfolios(portfolios, fallback) {
  const retained = (Array.isArray(portfolios) ? portfolios : [])
    .filter((portfolio) => !LEGACY_DEMO_PORTFOLIO_IDS.has(portfolio?.id));
  return retained.length ? clone(retained) : clone(fallback);
}

export function createPositionFromPurchase(stock, purchase = {}) {
  if (!stock?.symbol) throw new Error("股票信息不完整");
  const cost = Number(purchase.cost);
  if (!Number.isFinite(cost) || cost <= 0) throw new Error("买入价格必须大于 0");
  const mode = purchase.mode === "amount" ? "amount" : "quantity";
  let quantity;
  if (mode === "amount") {
    const amount = Number(purchase.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("投入金额必须大于 0");
    quantity = Number((amount / cost).toFixed(8));
  } else {
    quantity = Number(purchase.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("购买股数必须大于 0");
  }
  return { symbol: stock.symbol, quantity, cost };
}

export function updatePortfolioAllocation(portfolio, edits) {
  const cash = Number(edits.cash);
  if (!isFiniteNonNegative(cash)) throw new Error("现金余额必须是大于或等于 0 的数字");
  if (!Array.isArray(edits.positions)) throw new Error("持仓数据格式不正确");
  const existing = new Map((portfolio.positions || []).map((position) => [position.symbol, position]));
  const positions = edits.positions.map((position) => {
    const quantity = Number(position.quantity);
    const cost = Number(position.cost);
    if (!position.symbol || !isFiniteNonNegative(quantity) || !isFiniteNonNegative(cost)) {
      throw new Error("持仓数量和成本必须是大于或等于 0 的数字");
    }
    return { ...existing.get(position.symbol), symbol: position.symbol, quantity, cost };
  });
  return { ...portfolio, cash, positions };
}

export function calculatePositionSnapshot(position, stock, usdCny = 1) {
  if (!position || !stock) return null;
  const quantity = Number(position.quantity) || 0;
  const currentPrice = Number(stock.price) || 0;
  const purchasePrice = Number(position.cost) || 0;
  const rate = stock.currency === "USD" ? Number(usdCny) || 1 : 1;
  const marketValue = currentPrice * quantity * rate;
  const costValue = purchasePrice * quantity * rate;
  const profit = marketValue - costValue;
  const previousClose = Number(stock.previousClose);
  const changeRate = Number(stock.change || 0) / 100;
  const fallbackPreviousPrice = 1 + changeRate ? currentPrice / (1 + changeRate) : currentPrice;
  const previousPrice = Number.isFinite(previousClose) && previousClose > 0 ? previousClose : fallbackPreviousPrice;
  const previousMarketValue = previousPrice * quantity * rate;
  const dailyProfit = marketValue - previousMarketValue;
  return {
    purchasePrice,
    currentPrice,
    quantity,
    currency: stock.currency,
    rate,
    costValue,
    marketValue,
    profit,
    returnRate: costValue ? profit / costValue * 100 : 0,
    previousMarketValue,
    dailyProfit,
    dailyReturnRate: previousMarketValue ? dailyProfit / previousMarketValue * 100 : 0,
  };
}

export function calculatePortfolioSnapshot(portfolio, stocks, usdCny = 1) {
  const stockMap = new Map(stocks.map((stock) => [stock.symbol, stock]));
  const marketValues = { cn: 0, us: 0 };
  let investedValue = 0;
  let totalCost = 0;
  let dailyChange = 0;
  let previousInvestedValue = 0;
  for (const position of portfolio.positions || []) {
    const stock = stockMap.get(position.symbol) || position.stock;
    if (!stock) continue;
    const result = calculatePositionSnapshot(position, stock, usdCny);
    investedValue += result.marketValue;
    totalCost += result.costValue;
    previousInvestedValue += result.previousMarketValue;
    dailyChange += result.dailyProfit;
    marketValues[stock.currency === "USD" ? "us" : "cn"] += result.marketValue;
  }
  const profit = investedValue - totalCost;
  const totalValue = investedValue + Number(portfolio.cash || 0);
  return {
    investedValue,
    totalCost,
    totalValue,
    profit,
    returnRate: totalCost ? profit / totalCost * 100 : 0,
    dailyChange,
    dailyReturnRate: previousInvestedValue ? dailyChange / previousInvestedValue * 100 : 0,
    marketValues,
  };
}
