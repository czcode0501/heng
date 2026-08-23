const MARKET_ORDER = ["china", "united-states"];

const MARKET_META = {
  china: { label: "A股", className: "market-cn" },
  "united-states": { label: "美股", className: "market-us" },
};

const WORKSPACE_KEYS = {
  macro: "macro",
  "market-timing": "marketTiming",
  "sector-rotation": "sectorRotation",
  "investor-sentiment": "investorSentiment",
  "capital-flow": "capitalFlow",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function instrumentMarket(instrument = {}) {
  const currency = String(instrument.currency || "").toUpperCase();
  const exchange = String(instrument.market || instrument.exchange || "").toUpperCase();
  const symbol = String(instrument.providerSymbol || instrument.symbol || "").toUpperCase();
  if (currency === "CNY" || /SSE|SZSE|BSE|SHANGHAI|SHENZHEN|BEIJING|中国|上海|深圳|北京/.test(exchange) || /\.(SS|SZ|BJ)$/.test(symbol)) return "china";
  if (currency === "USD" || /NASDAQ|NYSE|ARCA|AMEX|UNITED STATES|美国/.test(exchange)) return "united-states";
  return null;
}

export function detectHeldMarkets({ brokerSnapshots = [], portfolio = null, stockCatalog = [] } = {}) {
  const held = new Set();
  if (brokerSnapshots.length) {
    for (const position of brokerSnapshots.flatMap((snapshot) => snapshot?.positions || [])) {
      const market = instrumentMarket(position);
      if (market) held.add(market);
    }
  } else {
    const stocks = new Map(stockCatalog.map((stock) => [stock.symbol, stock]));
    for (const position of portfolio?.positions || []) {
      const market = instrumentMarket({ ...stocks.get(position.symbol), ...position });
      if (market) held.add(market);
    }
  }
  return MARKET_ORDER.filter((market) => held.has(market));
}

export function overviewScoreForMarket(directoryId, workspace, marketId) {
  const market = workspace?.markets?.find((item) => item.id === marketId);
  if (!market) return null;
  if (directoryId === "macro") {
    const value = finite(market.analysis?.confidence);
    return value == null ? null : { value, metric: "信号清晰度", detail: market.analysis?.regime || "综合研判" };
  }
  if (directoryId === "market-timing") {
    const value = finite(market.regime?.score);
    return value == null ? null : { value, metric: "综合得分", detail: market.regime?.label || "择时研判" };
  }
  if (directoryId === "sector-rotation") {
    const leader = [...(market.sectors || [])]
      .filter((sector) => finite(sector.score) != null)
      .sort((left, right) => finite(right.score) - finite(left.score))[0];
    return leader ? { value: finite(leader.score), metric: "领先板块", detail: leader.title || "排名第一" } : null;
  }
  if (directoryId === "investor-sentiment") {
    const value = finite(market.score);
    return value == null ? null : { value, metric: "情绪水平", detail: market.phase?.label || "情绪研判" };
  }
  if (directoryId === "capital-flow") {
    const value = finite(market.summary?.averageScore);
    return value == null ? null : { value, metric: "资金温度", detail: market.summary?.stance || "资金研判" };
  }
  return null;
}

function scoreValue(value) {
  return Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

export function renderOverviewSignalLinks(directories, heldMarkets, workspaces = {}) {
  return directories.map((directory) => {
    const workspace = workspaces[WORKSPACE_KEYS[directory.id]];
    const scores = heldMarkets.map((marketId) => {
      const market = MARKET_META[marketId];
      const score = overviewScoreForMarket(directory.id, workspace, marketId);
      return `<div class="overview-market-score ${market.className}">
        <span>${market.label}</span>
        ${score
          ? `<strong>${scoreValue(score.value)}<small>分</small></strong><em>${escapeHtml(score.metric)} · ${escapeHtml(score.detail)}</em>`
          : `<strong>—</strong><em>数据待更新</em>`}
      </div>`;
    }).join("");
    const scoreContent = heldMarkets.length
      ? scores
      : '<p class="overview-score-empty">建立持仓后自动匹配市场评分</p>';
    return `<a class="overview-signal-link" href="#signals/${escapeHtml(directory.id)}" aria-label="查看${escapeHtml(directory.title)}评分详情">
      <header><span>${escapeHtml(directory.index)}</span><strong>${escapeHtml(directory.title)}</strong></header>
      <div class="overview-signal-scores">${scoreContent}</div>
      <small class="overview-signal-status">${escapeHtml(directory.status)}</small>
    </a>`;
  }).join("");
}
