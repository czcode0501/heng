import { calculatePortfolioTarget } from "./portfolio-target.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value, currency = "USD") {
  if (value == null || !Number.isFinite(Number(value))) return "券商未返回";
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function quantity(value) {
  return Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 6 });
}

function signedMoney(value, currency) {
  if (value == null || !Number.isFinite(Number(value))) return "不可用";
  return `${Number(value) >= 0 ? "+" : ""}${money(value, currency)}`;
}

function signedPercent(value) {
  if (value == null || !Number.isFinite(Number(value))) return "不可用";
  return `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(2)}%`;
}

const SECTOR_LABELS = {
  "communication-services": "通信服务",
  "consumer-discretionary": "可选消费",
  "consumer-staples": "日常消费",
  energy: "能源",
  financials: "金融",
  "health-care": "医疗保健",
  industrials: "工业",
  "information-technology": "信息技术",
  materials: "原材料",
  "real-estate": "房地产",
  utilities: "公用事业",
};

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function positionMarket(position) {
  const currency = String(position.currency || "").toUpperCase();
  const market = String(position.market || "").toUpperCase();
  return currency === "CNY" || /SSE|SZSE|SHANGHAI|SHENZHEN|BEIJING|中国|上海|深圳|北京/.test(market)
    ? { id: "cn", label: "A股" }
    : { id: "us", label: "美股" };
}

function positionBaseValue(position, account) {
  const value = finite(position.marketValue);
  const currency = String(position.currency || account?.currency || "").toUpperCase();
  const baseCurrency = String(account?.currency || "").toUpperCase();
  const rate = currency === baseCurrency ? 1 : finite(account?.exchangeRates?.[currency], 1);
  return value * rate;
}

function riskForExposure(current, target) {
  const gap = current - target;
  if (current > 100 || gap >= 20) return { id: "high", label: "高仓位风险", detail: `高于模型目标 ${Math.abs(gap).toFixed(1)} 个百分点` };
  if (gap >= 8) return { id: "elevated", label: "仓位偏高", detail: `高于模型目标 ${gap.toFixed(1)} 个百分点` };
  if (gap <= -15) return { id: "defensive", label: "仓位偏低", detail: `低于模型目标 ${Math.abs(gap).toFixed(1)} 个百分点` };
  return { id: "matched", label: "仓位匹配", detail: `与模型目标相差 ${Math.abs(gap).toFixed(1)} 个百分点` };
}

export function buildBrokerPortfolioAnalysis(snapshots = [], options = {}) {
  const validSnapshots = snapshots.filter(Boolean);
  const totalAsset = validSnapshots.reduce((sum, snapshot) => sum + finite(snapshot.account?.totalAsset), 0);
  const marketValue = validSnapshots.reduce((sum, snapshot) => sum + finite(snapshot.account?.marketValue), 0);
  const unrealizedPnl = validSnapshots.reduce((sum, snapshot) => sum + finite(snapshot.account?.unrealizedPnl), 0);
  const costBasis = marketValue - unrealizedPnl;
  const currentExposurePct = totalAsset > 0 ? marketValue / totalAsset * 100 : 0;
  const cumulativeReturnPct = costBasis > 0 ? unrealizedPnl / costBasis * 100 : 0;
  const targetExposurePct = Number.isFinite(Number(options.targetExposurePct))
    ? Number(options.targetExposurePct)
    : 50;
  const marketMap = new Map();
  for (const snapshot of validSnapshots) {
    for (const position of snapshot.positions || []) {
      const market = positionMarket(position);
      if (!marketMap.has(market.id)) marketMap.set(market.id, { ...market, value: 0, sectors: new Map() });
      const marketGroup = marketMap.get(market.id);
      const value = positionBaseValue(position, snapshot.account);
      const sectorId = position.sectorId || "unclassified";
      const sectorLabel = SECTOR_LABELS[sectorId] || position.sector || "未分类";
      marketGroup.value += value;
      marketGroup.sectors.set(sectorId, {
        id: sectorId,
        label: sectorLabel,
        value: finite(marketGroup.sectors.get(sectorId)?.value) + value,
      });
    }
  }
  const markets = [...marketMap.values()]
    .map((market) => ({
      id: market.id,
      label: market.label,
      value: market.value,
      assetPct: totalAsset > 0 ? market.value / totalAsset * 100 : 0,
      sectors: [...market.sectors.values()]
        .map((sector) => ({ ...sector, assetPct: totalAsset > 0 ? sector.value / totalAsset * 100 : 0 }))
        .sort((a, b) => b.value - a.value),
    }))
    .sort((a, b) => b.value - a.value);
  return {
    totalAsset,
    marketValue,
    unrealizedPnl,
    cumulativeReturnPct,
    currentExposurePct,
    targetExposurePct,
    exposureGapPct: currentExposurePct - targetExposurePct,
    targetLabel: options.targetLabel || "市场择时模型目标",
    targetDetailLabel: options.detailLabel || "",
    targetBreakdown: options.breakdown || null,
    risk: riskForExposure(currentExposurePct, targetExposurePct),
    markets,
  };
}

export function brokerTargetFromTiming(snapshots = [], timingPayload = null, options = {}) {
  const scoreFor = (symbol) => options.stockScores instanceof Map
    ? options.stockScores.get(symbol)
    : options.stockScores?.[symbol];
  const positions = snapshots.filter(Boolean).flatMap((snapshot) => (snapshot.positions || []).map((position) => ({
    symbol: position.symbol,
    marketId: positionMarket(position).id === "cn" ? "china" : "united-states",
    sectorId: position.sectorId || null,
    value: positionBaseValue(position, snapshot.account),
    stockScore: scoreFor(position.symbol),
  })));
  return calculatePortfolioTarget({
    positions,
    timingPayload,
    sectorRotationPayload: options.sectorRotationPayload,
  });
}

function renderBrokerAllocation(analysis) {
  if (!analysis.markets.length) return `<section class="broker-allocation" aria-labelledby="broker-allocation-title"><h3 id="broker-allocation-title">市场与板块分布</h3><p class="broker-allocation-empty">当前没有可统计的股票持仓。</p></section>`;
  const groups = analysis.markets.map((market) => {
    const sectors = market.sectors.map((sector, index) => `<li>
      <span class="broker-sector-swatch" style="--sector-index:${index}" aria-hidden="true"></span>
      <span>${escapeHtml(sector.label)}</span>
      <strong>${sector.assetPct.toFixed(1)}%</strong>
      <small>占账户总资产</small>
    </li>`).join("");
    return `<article class="broker-market-allocation market-${market.id}">
      <header><span class="broker-market-badge">${escapeHtml(market.label)}</span><strong>${market.assetPct.toFixed(1)}%</strong><small>占账户总资产</small></header>
      <div class="broker-sector-bar" aria-label="${escapeHtml(market.label)}板块分布">${market.sectors.map((sector, index) => `<i style="--sector-index:${index};--sector-share:${market.value > 0 ? sector.value / market.value * 100 : 0}%"></i>`).join("")}</div>
      <ul>${sectors}</ul>
    </article>`;
  }).join("");
  return `<section class="broker-allocation" aria-labelledby="broker-allocation-title"><div class="broker-allocation-heading"><div><p class="eyebrow">MARKET → SECTOR</p><h3 id="broker-allocation-title">市场与板块分布</h3></div><p>每个比例均按账户基础币种换算后，占账户总资产计算。</p></div><div class="broker-allocation-grid">${groups}</div></section>`;
}

export function renderBrokerOverview(snapshots = [], options = {}) {
  const validSnapshots = snapshots.filter(Boolean);
  const analysis = buildBrokerPortfolioAnalysis(validSnapshots, options);
  const positions = validSnapshots.flatMap((snapshot) => (snapshot.positions || []).map((position) => ({
    ...position,
    sourceId: snapshot.sourceId,
    account: snapshot.account,
  })));
  const latestTimes = validSnapshots
    .map(({ fetchedAt }) => new Date(fetchedAt).getTime())
    .filter(Number.isFinite);
  const latestText = latestTimes.length
    ? new Date(Math.max(...latestTimes)).toLocaleString("zh-CN", { hour12: false })
    : "尚未同步";
  const sources = [...new Set(validSnapshots.map((snapshot) => snapshot.meta?.priceSource).filter(Boolean))];
  const cadence = validSnapshots.some((snapshot) => Number(snapshot.meta?.updateCadenceSeconds) === 180)
    ? "官方账户窗口约 3 分钟更新"
    : "以券商返回节奏为准";

  const summary = validSnapshots.map((snapshot) => {
    const account = snapshot.account || {};
    const currency = account.currency || "USD";
    const unrealized = account.unrealizedPnl;
    const unrealizedClass = unrealized == null ? "" : Number(unrealized) >= 0 ? "gain" : "loss";
    return `<article class="broker-account-card">
      <div class="broker-account-identity"><span class="broker-live-dot" aria-hidden="true"></span><div><strong>IBKR 真实账户</strong><small>${escapeHtml(account.maskedId || "已连接")}</small></div></div>
      <dl class="broker-account-kpis">
        <div><dt>账户净资产</dt><dd>${escapeHtml(money(account.totalAsset, currency))}</dd></div>
        <div><dt>股票持仓市值</dt><dd>${escapeHtml(money(account.marketValue, currency))}</dd></div>
        <div><dt>现金余额</dt><dd>${escapeHtml(money(account.cash, currency))}</dd></div>
        <div><dt>当前持仓累计收益</dt><dd class="${unrealizedClass}">${escapeHtml(signedMoney(unrealized, currency))}<small>${escapeHtml(signedPercent(analysis.cumulativeReturnPct))} · 未实现</small></dd></div>
        <div><dt>当前仓位</dt><dd>${analysis.currentExposurePct.toFixed(1)}%<small>股票市值 ÷ 净资产</small></dd></div>
        <div><dt>目标仓位</dt><dd>${analysis.targetExposurePct.toFixed(0)}%<small>${escapeHtml(analysis.targetLabel)}</small>${analysis.targetDetailLabel ? `<small>${escapeHtml(analysis.targetDetailLabel)}</small>` : ""}</dd></div>
        <div><dt>仓位偏差</dt><dd>${analysis.exposureGapPct >= 0 ? "+" : ""}${analysis.exposureGapPct.toFixed(1)}<small>个百分点 · 当前减目标</small></dd></div>
        <div><dt>风险状态</dt><dd class="risk-${escapeHtml(analysis.risk.id)}">${escapeHtml(analysis.risk.label)}<small>${escapeHtml(analysis.risk.detail)}</small></dd></div>
      </dl>
      <p>IBKR 账户更新时间 ${escapeHtml(account.updatedAt || latestText)}</p>
    </article>`;
  }).join("");

  const rows = positions.length ? positions.map((position) => {
    const currency = position.currency || position.account?.currency || "USD";
    const pnlClass = position.unrealizedPnl == null ? "" : Number(position.unrealizedPnl) >= 0 ? "gain" : "loss";
    const name = position.name || position.symbol;
    const market = positionMarket(position);
    return `<tr>
      <td><strong>${escapeHtml(name)}</strong><small>${escapeHtml(position.sourceId?.toUpperCase() || "IBKR")} · ${escapeHtml(position.account?.maskedId || "")} · ${escapeHtml(position.symbol)}</small></td>
      <td><span class="market-badge market-${market.id}">${escapeHtml(market.label)}</span><small>${escapeHtml(position.market || "不可用")}</small></td>
      <td>${escapeHtml(quantity(position.quantity))}</td>
      <td>${escapeHtml(position.marketPrice == null ? "不可用" : money(position.marketPrice, currency))}</td>
      <td>${escapeHtml(position.averageCost == null ? "不可用" : money(position.averageCost, currency))}</td>
      <td>${escapeHtml(position.costBasis == null ? "不可用" : money(position.costBasis, currency))}</td>
      <td>${escapeHtml(position.marketValue == null ? "不可用" : money(position.marketValue, currency))}</td>
      <td class="${pnlClass}"><strong>${escapeHtml(signedMoney(position.unrealizedPnl, currency))}</strong><small>${escapeHtml(signedPercent(position.unrealizedPnlPct))}</small></td>
    </tr>`;
  }).join("") : `<tr><td colspan="8">账户已连接，当前没有持仓。</td></tr>`;

  const usingCachedSnapshot = validSnapshots.some((snapshot) => snapshot.meta?.snapshotState === "cached");
  return {
    summary,
    rows,
    allocation: renderBrokerAllocation(analysis),
    analysis,
    meta: `${usingCachedSnapshot ? "上次成功快照 · 当前连接待恢复" : `${validSnapshots.length} 个只读账户`} · ${positions.length} 个真实持仓 · 数据源 ${sources.join("、") || "券商账户"} · ${cadence} · 最近同步 ${latestText}`,
    positionCount: positions.length,
    snapshotCount: validSnapshots.length,
  };
}

export function renderBrokerUnavailable(message = "当前无法读取 IBKR TWS") {
  const safeMessage = escapeHtml(message);
  return {
    summary: `<article class="broker-account-card broker-account-unavailable" role="status"><div class="broker-account-identity"><span class="broker-live-dot" aria-hidden="true"></span><div><strong>连接暂时中断</strong><small>真实数据组合仍会保留</small></div></div><p>${safeMessage}。请确认 TWS / IB Gateway 已登录并启用 Socket API，然后点击“刷新券商数据”。</p></article>`,
    rows: `<tr><td colspan="8">暂时无法读取券商持仓；重新连接后自动恢复，不会改成模拟数据。</td></tr>`,
    allocation: `<section class="broker-allocation"><p class="broker-allocation-empty">等待 IBKR 恢复连接后计算真实市场与板块分布。</p></section>`,
    meta: `真实数据组合已保留 · ${safeMessage}`,
    positionCount: 0,
    snapshotCount: 0,
  };
}
