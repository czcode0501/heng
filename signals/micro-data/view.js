import { renderSignalTimeRangeControl, signalTimeRangeLabel } from "../time-range.js";

const CHART_WIDTH = 920;
const CHART_HEIGHT = 640;
const CANDLE_LEFT = 44;
const CANDLE_RIGHT = 690;
const PRICE_TOP = 24;
const PRICE_BOTTOM = 250;
const FLOW_BASELINE = 314;
const FLOW_HEIGHT = 30;
const RSI_TOP = 370;
const RSI_BOTTOM = 450;
const MACD_TOP = 510;
const MACD_BOTTOM = 600;
const PROFILE_LEFT = 724;
const PROFILE_RIGHT = 902;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function formatIndexPoints(value) {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(finite(value)) + " 点";
}

function compactVolume(value) {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(finite(value));
}

function indicatorValue(item, key) {
  if (item?.[key] == null) return null;
  const value = Number(item[key]);
  return Number.isFinite(value) ? value : null;
}

function linePath(candles, key, x, y) {
  let started = false;
  return candles.map((item, index) => {
    const value = indicatorValue(item, key);
    if (value == null) return "";
    const command = started ? "L" : "M";
    started = true;
    return `${command}${x(index).toFixed(2)},${y(value).toFixed(2)}`;
  }).filter(Boolean).join(" ");
}

export function formatMicroMarketTime(value) {
  const text = String(value || "");
  const match = text.match(/^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return match ? `${match[1]}/${match[2]} ${match[3]}:${match[4]}` : text.replace("T", " ").slice(0, 16);
}

export function getMicroChartPoint(candles, ratio) {
  if (!Array.isArray(candles) || !candles.length) return null;
  const safeRatio = Math.max(0, Math.min(1, finite(ratio)));
  const index = Math.round(safeRatio * (candles.length - 1));
  return { index, ...candles[index] };
}

function chartGeometry(market) {
  const candles = Array.isArray(market.candles) ? market.candles : [];
  const bins = Array.isArray(market.profile?.bins) ? market.profile.bins : [];
  const priceValues = candles.flatMap((item) => [finite(item.high), finite(item.low), indicatorValue(item, "vwap")]).filter((value) => value != null);
  const profileValues = bins.flatMap((item) => [finite(item.high), finite(item.low)]);
  const minimum = Math.min(...priceValues, ...profileValues);
  const maximum = Math.max(...priceValues, ...profileValues);
  const span = maximum - minimum || 1;
  const y = (value) => PRICE_BOTTOM - ((finite(value) - minimum) / span) * (PRICE_BOTTOM - PRICE_TOP);
  const slot = (CANDLE_RIGHT - CANDLE_LEFT) / Math.max(1, candles.length);
  const x = (index) => CANDLE_LEFT + slot * index + slot / 2;
  const bodyWidth = Math.max(1.2, Math.min(7, slot * 0.62));
  const orderedVolumes = candles.map(({ volume }) => finite(volume)).sort((left, right) => left - right);
  const maxVolume = Math.max(orderedVolumes[Math.floor((orderedVolumes.length - 1) * 0.95)] || 0, 1);
  const candleMarkup = candles.map((item, index) => {
    const candleX = x(index);
    const openY = y(item.open);
    const closeY = y(item.close);
    const top = Math.min(openY, closeY);
    const height = Math.max(1.5, Math.abs(closeY - openY));
    const direction = finite(item.close) >= finite(item.open) ? "is-up" : "is-down";
    return `<g class="micro-candle ${direction}" aria-hidden="true"><line x1="${candleX.toFixed(2)}" x2="${candleX.toFixed(2)}" y1="${y(item.high).toFixed(2)}" y2="${y(item.low).toFixed(2)}"></line><rect x="${(candleX - bodyWidth / 2).toFixed(2)}" y="${top.toFixed(2)}" width="${bodyWidth.toFixed(2)}" height="${height.toFixed(2)}"></rect></g>`;
  }).join("");
  const flowMarkup = candles.map((item, index) => {
    const candleX = x(index);
    const buyHeight = Math.min(FLOW_HEIGHT, finite(item.buyVolume) / maxVolume * FLOW_HEIGHT);
    const sellHeight = Math.min(FLOW_HEIGHT, finite(item.sellVolume) / maxVolume * FLOW_HEIGHT);
    const width = Math.max(1.2, Math.min(7, slot * 0.7));
    return `<g class="micro-flow-bar" aria-hidden="true"><rect class="buyer" x="${(candleX - width / 2).toFixed(2)}" y="${(FLOW_BASELINE - buyHeight).toFixed(2)}" width="${width.toFixed(2)}" height="${buyHeight.toFixed(2)}"></rect><rect class="seller" x="${(candleX - width / 2).toFixed(2)}" y="${FLOW_BASELINE.toFixed(2)}" width="${width.toFixed(2)}" height="${sellHeight.toFixed(2)}"></rect></g>`;
  }).join("");
  const profileMarkup = bins.map((item) => {
    const top = y(item.high);
    const bottom = y(item.low);
    const height = Math.max(1, bottom - top);
    const totalWidth = finite(item.density) / 100 * (PROFILE_RIGHT - PROFILE_LEFT);
    const total = finite(item.totalVolume) || 1;
    const buyWidth = totalWidth * finite(item.buyVolume) / total;
    const sellWidth = Math.max(0, totalWidth - buyWidth);
    return `<g class="micro-profile-bin" aria-hidden="true"><rect class="seller" x="${PROFILE_LEFT}" y="${top.toFixed(2)}" width="${sellWidth.toFixed(2)}" height="${height.toFixed(2)}"></rect><rect class="buyer" x="${(PROFILE_LEFT + sellWidth).toFixed(2)}" y="${top.toFixed(2)}" width="${buyWidth.toFixed(2)}" height="${height.toFixed(2)}"></rect></g>`;
  }).join("");
  const vacuumMarkup = (market.profile?.vacuumZones || []).map((zone) => {
    const top = y(zone.high);
    const bottom = y(zone.low);
    return `<rect class="micro-vacuum-zone" x="${CANDLE_LEFT}" y="${top.toFixed(2)}" width="${CANDLE_RIGHT - CANDLE_LEFT}" height="${Math.max(2, bottom - top).toFixed(2)}" aria-hidden="true"></rect>`;
  }).join("");
  const levels = [
    { className: "support", label: "支撑", value: market.profile?.support },
    { className: "poc", label: "POC", value: market.profile?.poc },
    { className: "resistance", label: "压力", value: market.profile?.resistance },
  ].filter(({ value }) => Number.isFinite(Number(value))).map((level) => {
    const levelY = y(level.value);
    const alignRight = level.className === "resistance";
    const labelX = alignRight ? CANDLE_RIGHT - 4 : CANDLE_LEFT + 4;
    return `<g class="micro-level ${level.className}" aria-hidden="true"><line x1="${CANDLE_LEFT}" x2="${PROFILE_RIGHT}" y1="${levelY.toFixed(2)}" y2="${levelY.toFixed(2)}"></line><text x="${labelX}" text-anchor="${alignRight ? "end" : "start"}" y="${Math.max(12, levelY - 4).toFixed(2)}">${level.label} ${finite(level.value).toFixed(2)}</text></g>`;
  }).join("");
  const vwapPath = linePath(candles, "vwap", x, y);
  const vwapMarkup = vwapPath ? `<path class="micro-vwap-line" d="${vwapPath}" aria-hidden="true"></path>` : "";

  const rsiY = (value) => RSI_BOTTOM - Math.max(0, Math.min(100, value)) / 100 * (RSI_BOTTOM - RSI_TOP);
  const rsiPath = linePath(candles, "rsi14", x, rsiY);
  const rsiMarkup = `<rect class="micro-rsi-zone is-hot" x="${CANDLE_LEFT}" y="${RSI_TOP}" width="${CANDLE_RIGHT - CANDLE_LEFT}" height="${rsiY(70) - RSI_TOP}"></rect>
    <rect class="micro-rsi-zone is-cold" x="${CANDLE_LEFT}" y="${rsiY(30)}" width="${CANDLE_RIGHT - CANDLE_LEFT}" height="${RSI_BOTTOM - rsiY(30)}"></rect>
    <line class="micro-indicator-threshold" x1="${CANDLE_LEFT}" x2="${CANDLE_RIGHT}" y1="${rsiY(70)}" y2="${rsiY(70)}"></line>
    <line class="micro-indicator-midline" x1="${CANDLE_LEFT}" x2="${CANDLE_RIGHT}" y1="${rsiY(50)}" y2="${rsiY(50)}"></line>
    <line class="micro-indicator-threshold" x1="${CANDLE_LEFT}" x2="${CANDLE_RIGHT}" y1="${rsiY(30)}" y2="${rsiY(30)}"></line>
    ${rsiPath ? `<path class="micro-rsi-line" d="${rsiPath}"></path>` : ""}`;

  const macdValues = candles.flatMap((item) => [indicatorValue(item, "macd"), indicatorValue(item, "macdSignal"), indicatorValue(item, "macdHistogram")]).filter((value) => value != null);
  const macdExtent = Math.max(...macdValues.map(Math.abs), 1e-9);
  const macdY = (value) => (MACD_TOP + MACD_BOTTOM) / 2 - value / macdExtent * (MACD_BOTTOM - MACD_TOP) * 0.45;
  const macdZero = macdY(0);
  const macdBars = candles.map((item, index) => {
    const value = indicatorValue(item, "macdHistogram");
    if (value == null) return "";
    const valueY = macdY(value);
    const width = Math.max(1.2, Math.min(7, slot * 0.68));
    return `<rect class="micro-macd-histogram ${value >= 0 ? "positive" : "negative"}" x="${(x(index) - width / 2).toFixed(2)}" y="${Math.min(valueY, macdZero).toFixed(2)}" width="${width.toFixed(2)}" height="${Math.max(1, Math.abs(macdZero - valueY)).toFixed(2)}"></rect>`;
  }).join("");
  const macdPath = linePath(candles, "macd", x, macdY);
  const signalPath = linePath(candles, "macdSignal", x, macdY);
  const macdMarkup = `<line class="micro-indicator-midline" x1="${CANDLE_LEFT}" x2="${CANDLE_RIGHT}" y1="${macdZero.toFixed(2)}" y2="${macdZero.toFixed(2)}"></line>${macdBars}${macdPath ? `<path class="micro-macd-line" d="${macdPath}"></path>` : ""}${signalPath ? `<path class="micro-macd-signal" d="${signalPath}"></path>` : ""}`;
  return { candleMarkup, flowMarkup, profileMarkup, vacuumMarkup, levels, vwapMarkup, rsiMarkup, macdMarkup };
}

function renderIndexSelect(market, selections, activeId) {
  const options = selections || [];
  return `<label class="micro-index-select"><span>观察指数</span><select data-micro-index data-micro-market="${escapeHtml(market.id)}" aria-label="选择${escapeHtml(market.title)}观察指数">${options.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === (activeId || market.instrument?.id) ? "selected" : ""}>${escapeHtml(item.title)} · ${escapeHtml(item.carrier)}</option>`).join("")}</select></label>`;
}

function renderUnavailableMarket(market, selections, activeId) {
  return `<article class="micro-market-panel ${escapeHtml(market.id)} is-error"><header class="micro-market-heading"><div><span>${market.id === "china" ? "CN" : "US"}</span><div><small>${market.id === "china" ? "CHINA MARKET" : "UNITED STATES"}</small><h3>${escapeHtml(market.title)}</h3></div></div>${renderIndexSelect(market, selections, activeId)}</header><div class="micro-error" role="alert"><strong>暂时无法读取该指数数据</strong><p>${escapeHtml(market.issue || "免费数据源暂时不可用，请稍后重新检查。")}</p></div></article>`;
}

function formatChartValue(value, unit, currency) {
  if (unit === "currency") {
    return new Intl.NumberFormat("zh-CN", { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(finite(value));
  }
  return formatIndexPoints(value);
}

export function renderTechnicalChart(market, options = {}) {
  const geometry = chartGeometry(market);
  const candles = Array.isArray(market.candles) ? market.candles : [];
  const latest = candles.at(-1) || {};
  const config = market.indicatorConfig || {};
  const timeframe = config.timeframe || market.dataWindow?.interval || "当前周期";
  const valueUnit = options.valueUnit || "points";
  const currency = options.currency || "";
  const vwapEstimated = config.vwapEstimated !== false;
  const vwapMode = config.vwapMode === "session" ? "当日重置" : "区间锚定";
  const rsi = indicatorValue(latest, "rsi14");
  const histogram = indicatorValue(latest, "macdHistogram");
  const vwap = indicatorValue(latest, "vwap");
  const close = finite(latest.close);
  const vwapDistance = vwap ? (close / vwap - 1) * 100 : null;
  const candlesJson = escapeHtml(JSON.stringify(candles));
  const headerActions = options.headerActions || "";
  return `<section class="micro-chart-card ${escapeHtml(options.className || "")}">
    <header><div><span>${escapeHtml(options.eyebrow || "价格与量价证据")}</span><h4>${escapeHtml(options.title || "价格、成交方向与动量")}</h4></div><div class="micro-chart-header-actions">${headerActions}<div class="micro-chart-legend" aria-label="图例：成交均价、买卖方向估算和低成交区域"><span class="vwap"><i></i>${vwapEstimated ? "成交均价（估算）" : "成交均价"}</span><span class="buyer"><i></i>买方估算</span><span class="seller"><i></i>卖方估算</span><span class="vacuum"><i></i>低成交区</span></div></div></header>
    <div class="micro-indicator-config" aria-label="专业参数"><span>强弱指标（RSI 14）· ${escapeHtml(timeframe)}</span><span>趋势动量（MACD 12,26,9）</span><span>成交均价（VWAP）· ${vwapMode}</span></div>
    <div class="micro-chart-shell">
      <svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="application" tabindex="0" data-micro-chart data-micro-candles="${candlesJson}" data-value-unit="${escapeHtml(valueUnit)}" data-currency="${escapeHtml(currency)}" aria-label="${escapeHtml(options.ariaLabel || "K线、VWAP、估算订单流、RSI与MACD走势图。移动鼠标或使用左右方向键查看具体时间和指标值。")}">
        <line class="micro-flow-baseline" x1="${CANDLE_LEFT}" x2="${CANDLE_RIGHT}" y1="${FLOW_BASELINE}" y2="${FLOW_BASELINE}"></line>
        <text class="micro-axis-label" x="${CANDLE_LEFT}" y="274">成交方向估算 · 上方买方 / 下方卖方</text><text class="micro-axis-label" x="${PROFILE_LEFT}" y="16">历史成交密集区（VRVP）</text>
        <text class="micro-axis-label" x="${CANDLE_LEFT}" y="360">价格强弱（RSI 14）· 70偏热 / 30偏冷</text><text class="micro-axis-label" x="${CANDLE_LEFT}" y="498">趋势动量（MACD 12,26,9）</text>
        ${geometry.vacuumMarkup}${geometry.candleMarkup}${geometry.vwapMarkup}${geometry.flowMarkup}${geometry.profileMarkup}${geometry.levels}${geometry.rsiMarkup}${geometry.macdMarkup}
        <line class="micro-chart-cursor" x1="0" x2="0" y1="${PRICE_TOP}" y2="618"></line>
        <rect class="micro-chart-hit-zone" x="${CANDLE_LEFT}" y="${PRICE_TOP}" width="${CANDLE_RIGHT - CANDLE_LEFT}" height="594"></rect>
      </svg>
      <div class="micro-chart-tooltip" role="status" aria-live="polite" hidden><strong>--</strong><span>--</span><em>--</em><small>--</small><small data-indicator-values>--</small><small data-vwap-value>--</small></div>
    </div>
    <div class="micro-indicator-readout" aria-label="最新技术指标判断">
      <article><span>价格强弱（RSI）</span><strong>${rsi == null ? "还不能判断" : rsi.toFixed(1)}</strong><small>${rsi == null ? "至少需要14根K线，请等待更多数据" : rsi >= 70 ? "价格偏热，先别追高" : rsi <= 30 ? "价格偏冷，等待止跌确认" : rsi >= 50 ? "买方略占优势，可继续观察" : "卖方略占优势，暂缓行动"}</small></article>
      <article><span>趋势动量（MACD）</span><strong class="${histogram != null && histogram >= 0 ? "positive" : "negative"}">${histogram == null ? "还不能判断" : `${histogram >= 0 ? "+" : ""}${histogram.toFixed(3)}`}</strong><small>${histogram == null ? "有效K线不足，请等待更新" : histogram >= 0 ? "上涨动力占优，但仍需价格确认" : "下跌动力占优，先控制仓位"}</small></article>
      <article><span>成交均价（VWAP）</span><strong>${vwap == null ? "还不能计算" : formatChartValue(vwap, valueUnit, currency)}</strong><small>${vwapDistance == null ? "缺少成交量，请等待数据恢复" : `现价${vwapDistance >= 0 ? "高于" : "低于"}成交均价 ${Math.abs(vwapDistance).toFixed(2)}%`}</small></article>
    </div>
  </section>`;
}

function renderMarket(market, selections, activeId, range) {
  if (market.status !== "live" || !market.candles?.length) return renderUnavailableMarket(market, selections, activeId);
  const summary = market.summary || {};
  const change = finite(summary.changePercent);
  const vacuum = market.profile?.vacuumZones?.[0];
  return `<article class="micro-market-panel ${escapeHtml(market.id)}" aria-labelledby="micro-${escapeHtml(market.id)}-title">
    <header class="micro-market-heading"><div><span>${market.id === "china" ? "CN" : "US"}</span><div><small>${market.id === "china" ? "CHINA MARKET" : "UNITED STATES"}</small><h3 id="micro-${escapeHtml(market.id)}-title">${escapeHtml(market.instrument.title)}</h3><p>价格：${escapeHtml(market.instrument.priceLabel)}点位 · 订单流代理：${escapeHtml(market.instrument.carrier)}</p></div></div>${renderIndexSelect(market, selections, activeId)}</header>
    <section class="micro-summary-strip" aria-label="${escapeHtml(market.instrument.title)}区间摘要">
      <div><span>最新点位</span><strong>${formatIndexPoints(summary.close)}</strong><small class="${change >= 0 ? "positive" : "negative"}">${change >= 0 ? "+" : ""}${change.toFixed(2)}% · ${escapeHtml(signalTimeRangeLabel(range))}</small></div>
      <div><span>买方估算</span><strong>${finite(summary.buyShare).toFixed(1)}%</strong><small>主动成交代理</small></div>
      <div><span>卖方估算</span><strong>${finite(summary.sellShare).toFixed(1)}%</strong><small>主动成交代理</small></div>
      <div><span>净量差 Delta</span><strong class="${finite(summary.delta) >= 0 ? "positive" : "negative"}">${finite(summary.delta) >= 0 ? "+" : ""}${compactVolume(summary.delta)}</strong><small>买方估算 − 卖方估算</small></div>
    </section>
    ${renderTechnicalChart(market, { title: "价格、成交密集区与动量", eyebrow: "价格与估算成交方向", valueUnit: "points", ariaLabel: `${market.instrument.title}价格、ETF成交方向估算、历史成交密集区、价格强弱、趋势动量和成交均价走势图。移动鼠标或使用左右方向键查看具体时间。` })}
    <section class="micro-level-grid" aria-label="关键点位结构">
      <article><span>支撑位</span><strong>${formatIndexPoints(market.profile.support)}</strong><p>当前指数点位下方最近的ETF成交密集映射区。</p></article>
      <article><span>成交最密集价位（POC）</span><strong>${formatIndexPoints(market.profile.poc)}</strong><p>这个区间成交最多，价格回到附近时重点观察能否站稳，再决定是否行动。</p></article>
      <article><span>压力位</span><strong>${formatIndexPoints(market.profile.resistance)}</strong><p>当前指数点位上方最近的ETF成交密集映射区。</p></article>
      <article><span>低成交真空区</span><strong>${vacuum ? `${formatIndexPoints(vacuum.low)} – ${formatIndexPoints(vacuum.high)}` : "未识别"}</strong><p>代理成交接受度较低，指数点位穿越时可能加速。</p></article>
    </section>
    <footer class="micro-data-footnote"><span>价格：${escapeHtml(market.source?.price || market.instrument.priceLabel)} · 订单流代理：${escapeHtml(market.source?.flow || market.instrument.carrier)}</span><span>${escapeHtml(market.source?.name)} · ${escapeHtml(market.source?.access)} · ${escapeHtml(market.dataWindow?.interval)} · 对齐${escapeHtml(market.dataWindow?.observations)}根</span></footer>
  </article>`;
}

function header(status = "正在连接数据") {
  return `<header class="workspace-intro micro-workspace-intro"><div><p class="eyebrow">价格与成交结构</p><h2>微观数据 · 指数量价结构</h2><p>这里看价格走到哪里、哪些区间成交最密集，以及上涨或下跌动力是否跟得上；成交方向由高流动性ETF估算。</p></div><span class="structure-status">${escapeHtml(status)}</span></header>`;
}

export function renderMicroWorkspaceLoading() {
  return `${header("正在读取分钟数据")}<section class="micro-loading" aria-busy="true"><strong>正在构建中美指数量价结构</strong><p>读取分钟K线，并计算估算订单流与可见范围成交量轮廓。</p></section>`;
}

export function renderMicroWorkspaceError(message) {
  return `${header("数据连接失败")}<section class="micro-error" role="alert"><strong>暂时无法生成微观量价分析</strong><p>${escapeHtml(message)}</p><small>先不要依据本页行动。请稍后重新进入本页；系统不会用虚构数据替代真实行情。</small></section>`;
}

export function renderMicroWorkspace(payload, options = {}) {
  const range = options.range || "1m";
  const customStart = options.customStart || "";
  const markets = Array.isArray(payload?.markets) ? payload.markets : [];
  const live = markets.filter(({ status }) => status === "live").length;
  const selections = options.selections || {};
  return `${header(live === markets.length && markets.length ? "数据通过" : live ? "部分数据可用" : "等待数据")}
    ${renderSignalTimeRangeControl({ range, customStart, scope: "micro-data" })}
    <section class="micro-method-note"><div><strong>指数点位 + ETF订单流代理</strong><p>指数本身不可直接成交。K线、支撑和压力使用指数点位；买卖量由同一时刻ETF的收盘位置与实体方向估算，并映射到指数点位区间。</p></div><span>不等同于 Level 2 挂单簿</span></section>
    <section class="micro-market-stack" aria-label="中国与美国代表性指数量价结构">${markets.map((market) => renderMarket(market, payload.selections?.[market.id], selections[market.id], range)).join("")}</section>
    <p class="micro-license-note">${escapeHtml(payload?.methodology?.disclaimer || "当前为OHLCV估算订单流，不构成单独买卖依据。")}</p>`;
}
