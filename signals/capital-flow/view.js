import { renderSignalTimeRangeControl, selectSignalTimeRange, signalTimeRangeLabel } from "../time-range.js";

const PERIODS = [
  { id: "1d", label: "1日" },
  { id: "5d", label: "5日" },
  { id: "20d", label: "20日" },
];

const INDICATORS = [
  { id: "priceChange", label: "价格变化", unit: "%", note: "价格结果，不作为资金流本身" },
  { id: "cmf", label: "CMF", unit: "", note: "收盘位置加权成交量" },
  { id: "estimatedNetFlow", label: "估算净流额", unit: "money", note: "方向性成交额估算，仅显示规模" },
  { id: "flowRatio", label: "Flow %", unit: "%", note: "估算流额占成交额比例" },
  { id: "upDownVolumeRatio", label: "涨跌量比", unit: "x", note: "上涨日与下跌日成交量之比" },
  { id: "rvol", label: "RVOL", unit: "x", note: "最新成交量相对历史均值" },
  { id: "closeLocation", label: "收盘位置", unit: "%", note: "收盘位于当日高低区间的位置" },
  { id: "mfi", label: "MFI", unit: "", note: "价格与成交量的资金强弱" },
  { id: "obvChange", label: "OBV Δ", unit: "%", note: "能量潮的区间变化" },
];

const COMPONENTS = [
  ["directionPressure", "方向压力", "35%"],
  ["persistence", "持续性", "20%"],
  ["participation", "参与广度", "20%"],
  ["priceLocationConfirmation", "价位确认", "15%"],
  ["intensity", "量能强度", "10%"],
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function marketMeta(id) {
  return id === "china"
    ? { code: "CN", english: "CHINA EQUITIES", className: "china" }
    : { code: "US", english: "UNITED STATES EQUITIES", className: "united-states" };
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function scoreTone(score) {
  return Number(score) >= 60 ? "positive" : Number(score) <= 40 ? "negative" : "neutral";
}

function formatMetric(value, unit) {
  const number = finite(value);
  if (number === null) return "—";
  if (unit === "money") {
    const absolute = Math.abs(number);
    const divisor = absolute >= 1e8 ? 1e8 : absolute >= 1e4 ? 1e4 : 1;
    const suffix = divisor === 1e8 ? "亿" : divisor === 1e4 ? "万" : "";
    return `${number > 0 ? "+" : ""}${(number / divisor).toFixed(2)}${suffix}`;
  }
  const prefix = unit === "%" && number > 0 ? "+" : "";
  return `${prefix}${number.toFixed(2)}${unit}`;
}

function cleanHistory(history) {
  return (Array.isArray(history) ? history : [])
    .map(({ date, value }) => ({ date: String(date || "").slice(0, 10), value: Number(value) }))
    .filter(({ date, value }) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value));
}

export function getCapitalFlowChartPoint(history, ratio) {
  const points = cleanHistory(history);
  if (!points.length) return null;
  const safeRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
  const index = Math.round(safeRatio * (points.length - 1));
  return { index, ...points[index] };
}

function chartPath(points, width = 500, height = 128) {
  if (points.length < 2) return "";
  return points.map(({ value }, index) => {
    const x = index / (points.length - 1) * width;
    const y = height - Math.max(0, Math.min(100, value)) / 100 * height;
    return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

export function summarizeCapitalFlowRange(history, options = {}) {
  const selection = selectSignalTimeRange(cleanHistory(history), options);
  const points = selection.points;
  if (!points.length) return null;
  const values = points.map(({ value }) => Number(value));
  const endValue = values.at(-1);
  const positive = endValue >= 50;
  let streak = 0;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if ((values[index] >= 50) !== positive) break;
    streak += 1;
  }
  const percentile = Math.round(values.filter((value) => value <= endValue).length / values.length * 100);
  const state = endValue >= 60
    ? { id: "strong-inflow", label: "资金明确流入", tone: "positive" }
    : endValue >= 50
      ? { id: "mild-inflow", label: "资金温和流入", tone: "positive" }
      : endValue <= 40
        ? { id: "strong-outflow", label: "资金明确流出", tone: "negative" }
        : { id: "mild-outflow", label: "资金偏弱 / 观察", tone: "neutral" };
  return {
    ...selection,
    startValue: values[0],
    endValue,
    change: Number((endValue - values[0]).toFixed(2)),
    high: Math.max(...values),
    low: Math.min(...values),
    percentile,
    inflowShare: Math.round(values.filter((value) => value >= 50).length / values.length * 100),
    streak,
    streakDirection: positive ? "流入" : "流出",
    state,
  };
}

function renderHeader(status, checkedAt) {
  return `<a class="back-link" href="#signals">← 返回模型信号目录</a>
    <header class="signal-detail-header capital-detail-header">
      <div><p class="eyebrow">CAPITAL FLOW</p><h2>资金流向</h2><p>继承 Sector Flow 的九项价格—成交量证据，并扩展为中国与美国两个独立市场。查看资金方向、持续性以及价格背离，不把估算值伪装成真实机构订单。</p></div>
      <div class="capital-header-actions"><span class="quality-status ${status === "数据通过" ? "passed" : ""}">${escapeHtml(status)}</span><button class="button secondary" type="button" data-refresh-capital-flow>刷新数据</button><small>${escapeHtml(checkedAt)}</small></div>
    </header>`;
}

function renderControls(options) {
  return `${renderSignalTimeRangeControl({ ...options, scope: "capital-flow" })}<p class="capital-window-note">观察窗口控制走势图、历史分位和“起点—今天”比较；下方九项证据固定使用 1 / 5 / 20 日模型窗口，便于审计。</p>`;
}

function renderSummary(market) {
  const meta = marketMeta(market.id);
  if (!market.summary) return `<article class="capital-summary-card ${meta.className} unavailable"><strong>${escapeHtml(market.title)}</strong><p>当前没有可用资金流数据。</p></article>`;
  const summary = market.summary;
  return `<article class="capital-summary-card ${meta.className}">
    <header><span>${meta.code}</span><div><small>${meta.english}</small><h3>${escapeHtml(market.title)}</h3></div><em class="${market.status === "live" ? "live" : ""}">${market.status === "live" ? "自动更新" : "缓存数据"}</em></header>
    <div class="capital-summary-score"><div><small>市场资金温度</small><strong>${Number(summary.averageScore).toFixed(1)}</strong><em>${escapeHtml(summary.stance)}</em></div>
      <dl><div><dt>流入板块</dt><dd>${summary.inflowSectors}</dd></div><div><dt>流出板块</dt><dd>${summary.outflowSectors}</dd></div><div><dt>价量背离</dt><dd>${summary.divergenceSectors}</dd></div></dl></div>
    <footer><span><b>最强</b>${escapeHtml(summary.strongest)}</span><span><b>最弱</b>${escapeHtml(summary.weakest)}</span><span><b>数据截止</b>${escapeHtml(market.asOf)}</span></footer>
  </article>`;
}

function renderRanking(market, activeId) {
  return `<section class="capital-ranking"><header><div><span>FLOW RANKING</span><h4>板块资金排名</h4></div><p>点击板块查看九项证据</p></header>
    <div class="capital-table-wrap"><table><thead><tr><th>排名</th><th>板块</th><th>综合资金分</th><th>20D Flow %</th><th>20D 价格</th><th>价量状态</th><th>轮动排名</th><th></th></tr></thead><tbody>
    ${(market.sectors || []).map((sector) => {
      const flow = sector.capitalFlow || {};
      const flowRatio = flow.metrics?.flowRatio?.["20d"];
      const price = flow.metrics?.priceChange?.["20d"];
      return `<tr class="${sector.id === activeId ? "active" : ""}"><td><strong>${sector.flowRank}</strong></td><td><b>${escapeHtml(sector.title)}</b><small>${escapeHtml(sector.symbol)}</small></td><td><strong class="${scoreTone(flow.score)}">${Number(flow.score).toFixed(1)}</strong></td><td class="${finite(flowRatio) >= 0 ? "positive" : "negative"}">${formatMetric(flowRatio, "%")}</td><td class="${finite(price) >= 0 ? "positive" : "negative"}">${formatMetric(price, "%")}</td><td><span class="capital-state ${escapeHtml(flow.state?.tone || "neutral")}">${escapeHtml(flow.state?.label)}</span></td><td>${sector.rotation?.rank || "—"}<small>${escapeHtml(sector.rotation?.phase?.label || "")}</small></td><td><button type="button" data-capital-select="${escapeHtml(sector.id)}" data-capital-market="${escapeHtml(market.id)}">查看</button></td></tr>`;
    }).join("")}</tbody></table></div>
  </section>`;
}

function renderFlowChart(flow, title, options) {
  const summary = summarizeCapitalFlowRange(flow.history, options);
  const points = summary?.points || [];
  const change = summary?.change || 0;
  return `<figure class="capital-flow-chart"><figcaption><div><span>资金到场证据 · ${escapeHtml(signalTimeRangeLabel(options.range, options.customStart))}</span><strong class="${scoreTone(summary?.endValue)}">${summary ? summary.endValue.toFixed(1) : "—"}</strong></div><small>${escapeHtml(summary?.state.label || "等待数据")}；固定 0–100 标尺，鼠标或方向键查看日期</small></figcaption>
    <div class="capital-chart-shell"><svg viewBox="0 0 500 128" preserveAspectRatio="none" role="application" tabindex="0" data-capital-flow-chart data-chart-points="${escapeHtml(JSON.stringify(points))}" aria-label="${escapeHtml(title)}资金压力走势图，固定零到一百分标尺"><rect class="capital-flow-zone inflow" x="0" y="0" width="500" height="51.2"></rect><rect class="capital-flow-zone neutral" x="0" y="51.2" width="500" height="25.6"></rect><rect class="capital-flow-zone outflow" x="0" y="76.8" width="500" height="51.2"></rect><line class="capital-chart-threshold" x1="0" x2="500" y1="51.2" y2="51.2"></line><line class="capital-chart-neutral" x1="0" x2="500" y1="64" y2="64"></line><line class="capital-chart-threshold" x1="0" x2="500" y1="76.8" y2="76.8"></line><path class="capital-chart-line" d="${chartPath(points)}"></path><line class="capital-chart-cursor" x1="0" x2="0" y1="0" y2="128"></line><circle class="capital-chart-dot" cx="0" cy="0" r="4"></circle><rect class="capital-chart-hit-zone" width="500" height="128"></rect></svg><div class="capital-chart-tooltip" role="status" aria-live="polite" hidden><strong>--</strong><span>--</span><em>--</em></div></div>
    <dl class="capital-range-facts"><div><dt>起点 → 最新</dt><dd>${escapeHtml(summary?.startDate || "—")} · ${summary?.startValue?.toFixed(1) || "—"} → ${summary?.endValue?.toFixed(1) || "—"}</dd></div><div><dt>区间变化</dt><dd class="${change >= 0 ? "positive" : "negative"}">${change >= 0 ? "+" : ""}${change.toFixed(1)}</dd></div><div><dt>历史分位</dt><dd>${summary?.percentile ?? "—"}%</dd></div><div><dt>流入占比</dt><dd>${summary?.inflowShare ?? "—"}%</dd></div><div><dt>连续状态</dt><dd>${summary?.streak || 0}期${escapeHtml(summary?.streakDirection || "")}</dd></div></dl>
    <footer class="chart-time-axis"><span>${escapeHtml(summary?.startDate || "—")}</span><span>≤40 流出 · 40–60 中性 · ≥60 流入</span><span>${escapeHtml(summary?.endDate || "—")}</span></footer></figure>`;
}

function renderComponents(flow) {
  return `<section class="capital-components"><header><span>COMPOSITE SCORE</span><h4>五组去重评分</h4></header><div>${COMPONENTS.map(([id, label, weight]) => {
    const score = finite(flow.components?.[id]) || 0;
    return `<article><header><span>${label}<small>${weight}</small></span><strong>${score.toFixed(0)}</strong></header><div><i style="width:${Math.max(0, Math.min(100, score))}%"></i></div></article>`;
  }).join("")}</div></section>`;
}

function renderMatrix(flow) {
  return `<section class="capital-matrix"><header><div><span>LEGACY METHOD · AUDITABLE</span><h4>九项资金证据</h4></div><p>固定 1 / 5 / 20 日模型窗口；绝对净流额仅展示，不进入跨板块排名</p></header><div class="capital-matrix-wrap"><table><thead><tr><th>指标</th>${PERIODS.map(({ label }) => `<th>${label}</th>`).join("")}<th>含义</th></tr></thead><tbody>
    ${INDICATORS.map((indicator) => `<tr><td><strong>${indicator.label}</strong></td>${PERIODS.map(({ id }) => { const value = flow.metrics?.[indicator.id]?.[id]; return `<td class="${finite(value) >= 0 ? "positive" : "negative"}">${formatMetric(value, indicator.unit)}</td>`; }).join("")}<td><small>${indicator.note}</small></td></tr>`).join("")}</tbody></table></div></section>`;
}

function renderFusion(sector) {
  const flow = sector.capitalFlow;
  return `<section class="capital-fusion"><div><span>PRICE × FLOW</span><h4>${escapeHtml(flow.state?.label)}</h4><p>价格告诉我们结果，资金证据用于判断这个结果是否获得成交量确认，或正在出现吸筹/派发背离。</p></div><div><span>FLOW × ROTATION</span><h4>资金确认 ${Number(flow.score).toFixed(1)} · 轮动 ${finite(sector.rotation?.score)?.toFixed(1) || "—"}</h4><p>资金流页面负责解释证据；板块轮动只接收一个 15% 的去重资金确认分。</p><a href="#signals/sector-rotation" data-reuse-sector-cache>打开板块轮动 →</a></div></section>`;
}

function renderDetail(sector, marketId, options) {
  if (!sector) return "";
  const flow = sector.capitalFlow || {};
  return `<section class="capital-evidence"><header class="capital-evidence-header"><div><span>SECTOR FLOW EVIDENCE</span><h3>${escapeHtml(sector.title)} · 资金证据</h3><p>${escapeHtml(sector.instrument)} · ${escapeHtml(sector.symbol)}</p></div><div><strong class="${scoreTone(flow.score)}">${Number(flow.score).toFixed(1)}</strong><em class="${escapeHtml(flow.state?.tone || "neutral")}">${escapeHtml(flow.state?.label)}</em><small>置信度 ${Number(flow.confidence).toFixed(0)}%</small></div></header>
    <div class="capital-evidence-grid">${renderFlowChart(flow, sector.title, options)}${renderComponents(flow)}</div>
    <button class="capital-constituents-trigger" type="button" data-capital-constituents data-capital-market="${escapeHtml(marketId)}" data-capital-sector="${escapeHtml(sector.id)}">查看 ${escapeHtml(sector.title)} 成分股与个股资金证据 <span aria-hidden="true">→</span></button>
    <div class="capital-constituents-host" data-capital-constituents-host="${escapeHtml(marketId)}:${escapeHtml(sector.id)}"></div>
    ${renderMatrix(flow)}${renderFusion(sector)}
    <p class="capital-methodology-note">${escapeHtml(flow.methodologyNote)}</p></section>`;
}

function renderMarket(market, activeId, options) {
  if (!market.sectors?.length) return "";
  const active = market.sectors.find(({ id }) => id === activeId) || market.sectors[0];
  const meta = marketMeta(market.id);
  return `<article class="capital-market-workspace ${meta.className}"><header class="capital-market-title"><div><span>${meta.code}</span><div><small>${meta.english}</small><h3>${escapeHtml(market.title)} · 板块资金流</h3></div></div><p>${escapeHtml(market.source?.name)} · 无需用户配置 API Key · ${escapeHtml(market.asOf)}</p></header>${renderRanking(market, active.id)}${renderDetail(active, market.id, options)}</article>`;
}

export function getCapitalFlowRefreshDelay(payload) {
  return Math.max(60, Number(payload?.refreshAfterSeconds) || 1800) * 1000;
}

export function renderCapitalFlowWorkspaceLoading() {
  return `${renderHeader("正在连接免费数据源", "—")}<section class="capital-loading" aria-busy="true"><strong>正在构建中美资金流证据</strong><p>复用板块轮动行情，计算 22 个板块的九项指标与价量状态。</p></section>`;
}

export function renderCapitalFlowWorkspaceError(message) {
  return `${renderHeader("数据连接失败", "—")}<section class="capital-page-error" role="alert"><strong>暂时无法生成资金流分析</strong><p>${escapeHtml(message)}</p><small>系统不会用演示数字替代真实行情。</small></section>`;
}

function renderConstituentCards(data, symbols, emptyMessage) {
  const stocks = new Map((data.stocks || []).map((stock) => [stock.symbol, stock]));
  const rows = (symbols || []).map((symbol) => stocks.get(symbol)).filter(Boolean);
  if (!rows.length) return `<p class="capital-constituent-empty">${escapeHtml(emptyMessage)}</p>`;
  return `<div class="capital-stock-grid">${rows.map((stock) => `<article class="capital-stock-card">
    <header><div><strong>${escapeHtml(stock.symbol)}</strong><small>${escapeHtml(stock.name === stock.symbol ? "成分股" : stock.name)}</small></div><span class="capital-state ${escapeHtml(stock.state?.tone || "neutral")}">${escapeHtml(stock.state?.label || "混合")}</span></header>
    <dl><div><dt>资金分</dt><dd class="${scoreTone(stock.flowScore)}">${Number(stock.flowScore).toFixed(1)}</dd></div><div><dt>20D Flow %</dt><dd class="${Number(stock.flowRatio) >= 0 ? "positive" : "negative"}">${formatMetric(stock.flowRatio, "%")}</dd></div><div><dt>所选区间</dt><dd class="${Number(stock.priceChange) >= 0 ? "positive" : "negative"}">${formatMetric(stock.priceChange, "%")}</dd></div></dl>
    <footer><span>${Number(stock.close).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</span><small>截至 ${escapeHtml(stock.asOf)}</small></footer>
  </article>`).join("")}</div>`;
}

export function renderCapitalConstituentsLoading(title = "该板块") {
  return `<section class="capital-constituents-panel" aria-busy="true"><header><div><span>SECTOR HOLDINGS</span><h4>${escapeHtml(title)} · 正在读取成分股证据</h4></div></header><p class="capital-constituent-empty">首次打开会批量读取这个板块的公开日线；同一数据源会复用缓存。</p></section>`;
}

export function renderCapitalConstituentsError(message) {
  return `<section class="capital-constituents-panel" role="alert"><header><div><span>SECTOR HOLDINGS</span><h4>成分股数据暂不可用</h4></div></header><p class="capital-constituent-empty">${escapeHtml(message)}</p></section>`;
}

export function renderCapitalConstituents(data) {
  const groups = [
    ["core", "核心成分", "沿用公开成分池顺序，观察驱动板块的核心公司"],
    ["strongestInflow", "资金流入最强", "资金压力分最高，判断资金是否正在集中"],
    ["strongestOutflow", "资金最弱 / 流出证据", "资金压力分最低，识别派发与风险来源；若均为流入，则表示相对最弱"],
    ["movers", "区间涨跌最大", "按所选时间范围绝对涨跌排序，核对价格与资金是否一致"],
  ];
  return `<section class="capital-constituents-panel"><header><div><span>SECTOR HOLDINGS · ${escapeHtml(data.marketId === "china" ? "CN" : "US")}</span><h4>${escapeHtml(data.title)} · 成分股资金证据</h4><p>所选窗口 ${escapeHtml(data.range?.id)} · ${escapeHtml(data.source?.name)} · ${escapeHtml(data.source?.access)}</p></div><em>${(data.stocks || []).length} 只股票</em></header>
    <p class="capital-pool-disclosure">成分范围：${escapeHtml(data.source?.constituentMode)}。美股池继承 sector-flow；A股为透明流动性代表股研究池，不冒充交易所实时官方权重。</p>
    <div class="capital-constituent-groups">${groups.map(([id, title, note]) => `<section><header><div><h5>${title}</h5><p>${note}</p></div><span>TOP 10</span></header>${renderConstituentCards(data, data.groups?.[id], "当前没有足够数据")}</section>`).join("")}</div>
  </section>`;
}

export function renderCapitalFlowWorkspace(payload, options = {}) {
  const markets = Array.isArray(payload?.markets) ? payload.markets : [];
  const rangeOptions = { range: options.range || "1m", customStart: options.customStart || "" };
  const activeSectors = options.activeSectors || {};
  const liveCount = markets.filter(({ status }) => status === "live").length;
  const status = liveCount === markets.length && markets.length ? "数据通过" : liveCount ? "部分数据可用" : "等待可用数据";
  const generated = new Date(payload?.generatedAt);
  const checkedAt = Number.isNaN(generated.getTime()) ? "—" : `最近检查 ${generated.toLocaleString("zh-CN", { hour12: false })}`;
  return `${renderHeader(status, checkedAt)}${renderControls(rangeOptions)}
    <section class="capital-summary-grid">${markets.map(renderSummary).join("")}</section>
    <section class="capital-method-strip"><strong>科学融合方式</strong><span>资金流独立解释方向与背离</span><i>→</i><span>压缩为一个资金确认分</span><i>→</i><span>以 15% 权重进入板块轮动</span></section>
    <section class="capital-workspace-list">${markets.map((market) => renderMarket(market, activeSectors[market.id], rangeOptions)).join("")}</section>
    <p class="capital-license-note">${escapeHtml(payload?.methodology?.disclaimer || "资金流为价格与成交量推算值，不代表真实机构订单。")} 默认使用公开收盘日线自动更新；免费数据源的授权与可用性可能变化。</p>`;
}
