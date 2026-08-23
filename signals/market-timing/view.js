function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function marketDefinition(marketId) {
  return {
    china: { code: "CN", english: "CHINA EQUITIES" },
    "united-states": { code: "US", english: "UNITED STATES EQUITIES" },
  }[marketId] || { code: "--", english: "EQUITIES" };
}

function sparklinePath(points, width = 300, height = 78) {
  if (!Array.isArray(points) || points.length < 2) return "";
  const values = points.map(({ value }) => Number(value)).filter(Number.isFinite);
  if (values.length < 2) return "";
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum || 1;
  return values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - minimum) / span) * height;
    return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

export const marketTimingRanges = SIGNAL_TIME_RANGES.filter(({ id }) => id !== "custom");

function shiftDate(dateText, range) {
  const date = new Date(`${dateText}T00:00:00Z`);
  if (range === "1w") date.setUTCDate(date.getUTCDate() - 7);
  if (range === "1m") date.setUTCMonth(date.getUTCMonth() - 1);
  if (range === "3m") date.setUTCMonth(date.getUTCMonth() - 3);
  if (range === "1y") date.setUTCFullYear(date.getUTCFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

export function compareMarketTimingHistory(history, options = {}) {
  const points = (Array.isArray(history) ? history : [])
    .map(({ date, value }) => ({ date: String(date || "").slice(0, 10), value: Number(value) }))
    .filter(({ date, value }) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value))
    .sort((left, right) => left.date.localeCompare(right.date));
  if (!points.length) return null;

  const range = options.range || "1m";
  const latest = points.at(-1);
  let startIndex;
  if (range === "1d") {
    startIndex = Math.max(0, points.length - 2);
  } else {
    const targetDate = range === "custom" && /^\d{4}-\d{2}-\d{2}$/.test(options.customStart || "")
      ? options.customStart
      : shiftDate(latest.date, range);
    startIndex = points.findIndex(({ date }) => date >= targetDate);
    if (startIndex < 0) startIndex = points.length - 1;
  }

  const selected = points.slice(startIndex);
  const start = selected[0];
  const base = start.value || 1;
  const changePercent = start.value ? ((latest.value / start.value) - 1) * 100 : 0;
  return {
    startDate: start.date,
    endDate: latest.date,
    startValue: start.value,
    endValue: latest.value,
    changeValue: Number((latest.value - start.value).toFixed(4)),
    changePercent: Number(changePercent.toFixed(2)),
    high: Math.max(...selected.map(({ value }) => value)),
    low: Math.min(...selected.map(({ value }) => value)),
    observations: selected.length,
    points: selected,
    history: selected.map(({ date, value }) => ({ date, value: Number((value / base * 100).toFixed(4)) })),
  };
}

export function getMarketTimingChartPoint(points, ratio) {
  if (!Array.isArray(points) || !points.length) return null;
  const safeRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
  const index = Math.round(safeRatio * (points.length - 1));
  const point = points[index];
  const base = Number(points[0].value);
  const value = Number(point.value);
  return {
    index,
    date: point.date,
    value,
    changePercent: Number((base ? (value / base - 1) * 100 : 0).toFixed(2)),
  };
}

function qualityLabel(market) {
  if (market.status === "stale") return "缓存数据";
  if (market.status === "error") return "连接失败";
  return market.dataQuality?.label || "数据通过";
}

function renderMetric(metric) {
  return `<div class="timing-metric-row">
    <span>${escapeHtml(metric.label)}</span>
    <strong class="${escapeHtml(metric.tone || "neutral")}">${escapeHtml(metric.value)}</strong>
  </div>`;
}

function renderDimension(dimension) {
  return `<article class="timing-dimension-card">
    <header>
      <div><span>${escapeHtml(dimension.weight)}% WEIGHT</span><h5>${escapeHtml(dimension.title)}</h5></div>
      <div class="timing-dimension-score"><strong>${Number(dimension.score).toFixed(0)}</strong><em>${escapeHtml(dimension.state)}</em></div>
    </header>
    <div class="timing-score-track" aria-label="${escapeHtml(dimension.title)}得分 ${escapeHtml(dimension.score)}"><i style="--score:${Math.max(0, Math.min(100, Number(dimension.score) || 0))}%"></i></div>
    <p>${escapeHtml(dimension.summary)}</p>
    <div class="timing-metric-list">${(dimension.metrics || []).map(renderMetric).join("")}</div>
  </article>`;
}

function renderUnavailableMarket(market) {
  const definition = marketDefinition(market.id);
  const issue = market.dataQuality?.issues?.[0] || "默认免费数据源暂时不可用";
  return `<article class="timing-live-market ${escapeHtml(market.id)} is-error">
    <header class="timing-live-market-header">
      <span class="market-code" aria-hidden="true">${definition.code}</span>
      <div><p>${definition.english}</p><h3>${escapeHtml(market.title)}</h3></div>
      <em class="timing-data-state error">连接失败</em>
    </header>
    <div class="timing-source-error" role="alert"><strong>没有可安全展示的数据</strong><p>${escapeHtml(issue)}</p><small>系统不会用演示数字替代真实行情。稍后会自动重试，也可以再次点击左侧“市场择时”立即检查。</small></div>
  </article>`;
}

function formatIndex(value) {
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function rangeLabel(options) {
  return signalTimeRangeLabel(options.range, options.customStart);
}

function renderRangePanel(payload, options) {
  const histories = (payload.markets || []).map(({ benchmark }) => benchmark?.history || []).filter((history) => history.length);
  const starts = histories.map((history) => history[0].date).sort();
  const ends = histories.map((history) => history.at(-1).date).sort();
  const minimum = starts[0] || "";
  const maximum = ends.at(-1) || "";
  return renderSignalTimeRangeControl({ ...options, scope: "market-timing", minimum, maximum });
}

function renderMarket(market, options) {
  if (!market?.regime || !market?.benchmark) return renderUnavailableMarket(market);
  const definition = marketDefinition(market.id);
  const comparison = compareMarketTimingHistory(market.benchmark.history, options);
  const change = comparison?.changePercent || 0;
  const sourceSuffix = market.source?.isFallback ? " · 已启用备用源" : "";
  const historyPath = sparklinePath(comparison?.history);
  const chartPoints = escapeHtml(JSON.stringify(comparison?.points || []));
  return `<article class="timing-live-market ${escapeHtml(market.id)} ${market.status === "stale" ? "is-stale" : ""}" aria-labelledby="timing-${escapeHtml(market.id)}-title">
    <header class="timing-live-market-header">
      <span class="market-code" aria-hidden="true">${definition.code}</span>
      <div><p>${definition.english}</p><h3 id="timing-${escapeHtml(market.id)}-title">${escapeHtml(market.title)}</h3></div>
      <em class="timing-data-state ${escapeHtml(market.status)}">${qualityLabel(market)}</em>
    </header>
    <div class="timing-live-market-body">
      <section class="timing-regime-summary" aria-label="${escapeHtml(market.title)}综合择时结果">
        <div class="timing-regime-score ${escapeHtml(market.regime.tone)}"><span>综合得分</span><strong>${Number(market.regime.score).toFixed(1)}</strong><em>${escapeHtml(market.regime.label)}</em></div>
        <div class="timing-benchmark-block">
          <header><div><span>${escapeHtml(market.benchmark.name)} · ${escapeHtml(rangeLabel(options))}</span><strong>${formatIndex(comparison?.endValue ?? market.benchmark.close)}</strong></div><div class="timing-period-change"><span>区间变化</span><em class="${change >= 0 ? "positive" : "negative"}">${change >= 0 ? "+" : ""}${change.toFixed(2)}%</em></div></header>
          <div class="timing-chart-shell">
            <svg viewBox="0 0 300 78" preserveAspectRatio="none" role="application" tabindex="0" data-market-timing-chart data-chart-points="${chartPoints}" aria-label="${escapeHtml(market.benchmark.name)}交互式走势图。移动鼠标或使用左右方向键查看具体日期和点位。">
              <path d="${historyPath}" vector-effect="non-scaling-stroke"></path>
              <line class="timing-chart-cursor" x1="0" x2="0" y1="0" y2="78"></line>
              <circle class="timing-chart-dot" cx="0" cy="0" r="3.5"></circle>
              <rect class="timing-chart-hit-zone" width="300" height="78"></rect>
            </svg>
            <div class="timing-chart-tooltip" role="status" aria-live="polite" hidden><strong>--</strong><span>--</span><em>--</em></div>
          </div>
          <div class="chart-time-axis"><span>${escapeHtml(comparison?.startDate || "--")}</span><span>${escapeHtml(comparison?.observations || 0)} 个交易日</span><span>${escapeHtml(comparison?.endDate || "--")}</span></div>
          <dl class="timing-period-stats">
            <div><dt>起点</dt><dd>${escapeHtml(comparison?.startDate || "--")} · ${formatIndex(comparison?.startValue || 0)}</dd></div>
            <div><dt>最新</dt><dd>${escapeHtml(comparison?.endDate || "--")} · ${formatIndex(comparison?.endValue || 0)}</dd></div>
            <div><dt>区间高 / 低</dt><dd>${formatIndex(comparison?.high || 0)} / ${formatIndex(comparison?.low || 0)}</dd></div>
          </dl>
        </div>
        <dl class="timing-regime-facts">
          <div><dt>模型风险暴露</dt><dd>${escapeHtml(market.regime.exposureBand)}</dd></div>
          <div><dt>信心等级</dt><dd>${escapeHtml(market.regime.confidence)}</dd></div>
          <div><dt>有效观察值</dt><dd>${escapeHtml(comparison?.observations || 0)} 个交易日</dd></div>
        </dl>
      </section>
      <p class="timing-regime-explanation">${escapeHtml(market.regime.summary)}</p>
      <section aria-labelledby="timing-${escapeHtml(market.id)}-dimensions">
        <header class="timing-dimensions-heading"><div><span>SIGNAL STACK</span><h4 id="timing-${escapeHtml(market.id)}-dimensions">五维择时证据</h4></div><strong>五维证据随所选区间重新计算 · 总权重 100%</strong></header>
        <div class="timing-dimension-grid">${market.dimensions.map(renderDimension).join("")}</div>
      </section>
      <footer class="timing-market-source"><span>数据源：${escapeHtml(market.source?.name || "--")}${escapeHtml(sourceSuffix)}</span><span>${escapeHtml(market.source?.access || "无需 API Key")} · 自动更新</span></footer>
    </div>
  </article>`;
}

function workspaceHeader(statusText, statusClass = "") {
  return `<a class="back-link" href="#signals">← 返回模型信号目录</a>
    <header class="signal-detail-header timing-detail-header">
      <div><p class="eyebrow">MARKET TIMING</p><h2>市场择时</h2><p>中国股票与美国股票独立评分。模型整合趋势、广度、流动性、波动与风险偏好，输出可解释的市场阶段和风险暴露区间。</p></div>
      <div class="timing-header-actions"><span class="quality-status ${escapeHtml(statusClass)}">${escapeHtml(statusText)}</span></div>
    </header>`;
}

export function getMarketTimingRefreshDelay(payload) {
  const seconds = Number(payload?.refreshAfterSeconds);
  return Math.max(60, Number.isFinite(seconds) && seconds > 0 ? seconds : 1800) * 1000;
}

export function renderMarketTimingWorkspaceLoading(markets) {
  return `${workspaceHeader("正在连接免费数据源")}
    <section class="timing-auto-note" aria-label="自动更新说明"><strong>零配置数据模式</strong><p>BaoStock 与 yfinance 由服务端自动读取；无需填写 API Key，完成后将展示数据日期和质量状态。</p><span>正在检查 ${markets.length} 个市场…</span></section>
    <section class="timing-market-grid" aria-busy="true">${markets.map((market) => `<article class="timing-live-market ${market.id} timing-skeleton"><div></div><div></div><div></div></article>`).join("")}</section>`;
}

export function renderMarketTimingWorkspaceError(message, markets) {
  return `${workspaceHeader("数据连接失败", "error")}
    <section class="timing-page-error" role="alert"><strong>暂时无法读取市场择时数据</strong><p>${escapeHtml(message)}</p><small>系统没有展示缓存之外的虚构数据。默认源会继续自动重试；再次点击左侧“市场择时”可以立即重新检查。</small></section>
    <section class="timing-market-grid timing-unavailable-grid">${markets.map((market) => renderUnavailableMarket({ ...market, status: "error", dataQuality: { issues: ["等待默认数据源恢复"] } })).join("")}</section>`;
}

export function renderMarketTimingWorkspace(payload, options = {}) {
  const activeOptions = { range: options.range || "1m", customStart: options.customStart || "" };
  const markets = Array.isArray(payload?.markets) ? payload.markets : [];
  const liveCount = markets.filter(({ status }) => status === "live").length;
  const statusText = liveCount === markets.length ? "数据通过" : liveCount ? "部分数据可用" : "使用缓存或等待数据";
  const generatedAt = new Date(payload.generatedAt);
  const checkedAt = Number.isNaN(generatedAt.getTime()) ? "--" : generatedAt.toLocaleString("zh-CN", { hour12: false });
  const hasIntraday = markets.some(({ updateMode }) => updateMode === "automatic-intraday");
  return `${workspaceHeader(statusText, liveCount === markets.length ? "passed" : "")}
    ${renderRangePanel(payload, activeOptions)}
    <section class="timing-auto-note" aria-label="自动更新说明">
      <div><strong>自动更新 · ${hasIntraday ? "A股盘中动态日线" : "最新交易日线"}</strong><p>当前比较 ${escapeHtml(rangeLabel(activeOptions))}；每 ${Math.round(getMarketTimingRefreshDelay(payload) / 60000)} 分钟自动检查一次。再次点击左侧“市场择时”可立即刷新。</p></div>
      <dl><div><dt>接口配置</dt><dd>无需 API Key</dd></div><div><dt>最近检查</dt><dd>${escapeHtml(checkedAt)}</dd></div><div><dt>方法版本</dt><dd>${escapeHtml(payload.methodologyVersion || "1.0.0")}</dd></div></dl>
    </section>
    <section class="timing-market-grid" aria-label="中国股票与美国股票市场择时">${markets.map((market) => renderMarket(market, activeOptions)).join("")}</section>
    <p class="timing-license-note">默认免费源适合本地研究和个人使用。开源项目若进行商业化公开数据再分发，应按部署场景接入获得授权的数据供应商。</p>`;
}
import { SIGNAL_TIME_RANGES, renderSignalTimeRangeControl, signalTimeRangeLabel } from "../time-range.js";
