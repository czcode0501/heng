function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value, digits = 2) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(value);
}

function formatPeriod(value) {
  const [year, month] = String(value).split("-");
  return month ? `${year}年${Number(month)}月` : String(value);
}

function formatTimestamp(value) {
  if (!value) return "更新时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function buildSparkline(points, { width = 360, height = 72, benchmark = null } = {}) {
  const padding = 5;
  const values = points.map(({ value }) => Number(value)).filter(Number.isFinite);
  const domainValues = benchmark === null || !Number.isFinite(Number(benchmark)) ? values : [...values, Number(benchmark)];
  const minimum = Math.min(...domainValues);
  const maximum = Math.max(...domainValues);
  const span = maximum - minimum || 1;
  const x = (index) => padding + (index / Math.max(1, values.length - 1)) * (width - padding * 2);
  const y = (value) => padding + ((maximum - value) / span) * (height - padding * 2);
  const coordinates = values.map((value, index) => [x(index), y(value)]);
  const path = coordinates.map(([pointX, pointY], index) => `${index ? "L" : "M"}${pointX.toFixed(2)},${pointY.toFixed(2)}`).join(" ");
  const first = coordinates[0] || [padding, height - padding];
  const last = coordinates.at(-1) || first;
  return {
    path,
    areaPath: `${path} L${last[0].toFixed(2)},${height - padding} L${first[0].toFixed(2)},${height - padding} Z`,
    benchmarkY: benchmark === null ? null : y(Number(benchmark)),
    lastX: last[0],
    lastY: last[1],
  };
}

export function selectRangePoints(points, range = "1m", customStart = "") {
  return selectSignalTimeRange(points, { range, customStart }).points;
}

export function summarizeMacroRange(points, range, customStart = "") {
  const selected = selectRangePoints(points, range, customStart);
  if (!selected.length) return null;
  const start = selected[0];
  const end = selected.at(-1);
  const values = selected.map(({ value }) => Number(value)).filter(Number.isFinite);
  return {
    startDate: start.date,
    endDate: end.date,
    startValue: Number(start.value),
    endValue: Number(end.value),
    change: Number((Number(end.value) - Number(start.value)).toFixed(4)),
    high: Math.max(...values),
    low: Math.min(...values),
    observations: selected.length,
  };
}

export function getMacroChartPoint(points, ratio) {
  if (!Array.isArray(points) || !points.length) return null;
  const safeRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
  const index = Math.round(safeRatio * (points.length - 1));
  const point = points[index];
  return {
    index,
    date: point.date,
    value: Number(point.value),
    change: Number((Number(point.value) - Number(points[0].value)).toFixed(4)),
  };
}

function renderTrendChart(indicator, points) {
  const chart = buildSparkline(points, { benchmark: indicator.benchmark });
  const first = points[0];
  const last = points.at(-1);
  const chartPoints = escapeHtml(JSON.stringify(points.map(({ date, value }) => ({ date, value: Number(value) }))));
  const benchmark = chart.benchmarkY === null ? "" : `<line class="macro-chart-benchmark" x1="5" y1="${chart.benchmarkY.toFixed(2)}" x2="355" y2="${chart.benchmarkY.toFixed(2)}"></line>`;
  return `<figure class="macro-chart">
    <div class="macro-chart-shell">
      <svg viewBox="0 0 360 72" preserveAspectRatio="none" role="application" tabindex="0" data-macro-chart data-chart-points="${chartPoints}" data-chart-benchmark="${indicator.benchmark ?? ""}" data-chart-unit="${escapeHtml(indicator.unit)}" aria-label="${escapeHtml(indicator.name)}交互式走势图。移动鼠标或使用左右方向键查看具体时间和数值。">
        ${benchmark}
        <path class="macro-chart-area" d="${chart.areaPath}"></path>
        <path class="macro-chart-line" d="${chart.path}"></path>
        <circle class="macro-chart-end-dot" cx="${chart.lastX.toFixed(2)}" cy="${chart.lastY.toFixed(2)}" r="3"></circle>
        <line class="macro-chart-cursor" x1="0" x2="0" y1="5" y2="67"></line>
        <circle class="macro-chart-hover-dot" cx="0" cy="0" r="3.5"></circle>
        <rect class="macro-chart-hit-zone" width="360" height="72"></rect>
      </svg>
      <div class="macro-chart-tooltip" role="status" aria-live="polite" hidden><strong>--</strong><span>--</span><em>--</em></div>
    </div>
    <figcaption class="chart-time-axis"><span>${escapeHtml(formatPeriod(first.date))}</span><span>${indicator.benchmark === null ? "" : `参考线 ${formatNumber(indicator.benchmark)}`}</span><span>${escapeHtml(formatPeriod(last.date))}</span></figcaption>
  </figure>`;
}

function renderIndicator(indicator, range, customStart) {
  const summary = indicator.summary;
  const points = selectRangePoints(indicator.points, range, customStart);
  const period = summarizeMacroRange(indicator.points, range, customStart);
  const latestValue = Number(points.at(-1)?.value);
  const percentile = Math.round((points.filter(({ value }) => Number(value) <= latestValue).length / points.length) * 100);
  const change = summary.change === null ? "暂无上期比较" : `较上期 ${summary.change > 0 ? "+" : ""}${formatNumber(summary.change)}${indicator.unit}`;
  return `<article class="macro-metric-card ${escapeHtml(summary.direction)}">
    <header>
      <div><h4>${escapeHtml(indicator.name)}</h4><span>${escapeHtml(indicator.frequency)} · 当前显示${points.length}期</span></div>
      <em>${escapeHtml(summary.stage)}</em>
    </header>
    <div class="macro-current-value">
      <strong>${formatNumber(summary.value)}<small>${escapeHtml(indicator.unit)}</small></strong>
      <span>${escapeHtml(change)} · ${escapeHtml(formatPeriod(summary.date))}</span>
    </div>
    ${renderTrendChart(indicator, points)}
    <dl class="macro-period-stats">
      <div><dt>区间起点</dt><dd>${escapeHtml(formatPeriod(period.startDate))} · ${formatNumber(period.startValue)}${escapeHtml(indicator.unit)}</dd></div>
      <div><dt>区间变化</dt><dd class="${period.change >= 0 ? "positive" : "negative"}">${period.change >= 0 ? "+" : ""}${formatNumber(period.change)}${escapeHtml(indicator.unit)}</dd></div>
      <div><dt>区间高 / 低</dt><dd>${formatNumber(period.high)} / ${formatNumber(period.low)}${escapeHtml(indicator.unit)}</dd></div>
    </dl>
    <footer>
      <span>当前区间分位 <strong>${percentile}%</strong></span>
      <a href="${escapeHtml(indicator.source.url)}" target="_blank" rel="noreferrer">${escapeHtml(indicator.source.name)} · ${escapeHtml(indicator.source.original)}</a>
    </footer>
  </article>`;
}

function renderMarketPanel(market, range, customStart) {
  const statusText = market.status === "live" ? "真实数据已连接" : market.status === "stale" ? "显示上次成功数据" : "数据连接失败";
  const grouped = Map.groupBy(market.indicators || [], (indicator) => indicator.group);
  const body = market.status === "error"
    ? `<div class="macro-source-error" role="alert"><strong>暂时无法读取${escapeHtml(market.title)}数据</strong><p>${escapeHtml(market.error)}</p><button class="button secondary" type="button" data-refresh-macro>重新检查</button></div>`
    : [...grouped].map(([group, indicators]) => `<section class="macro-live-group"><header><h3>${escapeHtml(group)}</h3><span>${indicators.length} 项指标</span></header><div class="macro-metric-list">${indicators.map((indicator) => renderIndicator(indicator, range, customStart)).join("")}</div></section>`).join("");
  return `<article class="macro-market-panel ${escapeHtml(market.id)}" aria-labelledby="macro-${escapeHtml(market.id)}-title">
    <header class="macro-market-header">
      <span class="market-code" aria-hidden="true">${escapeHtml(market.code)}</span>
      <div><p>${market.id === "china" ? "CHINA MACRO" : "UNITED STATES MACRO"}</p><h2 id="macro-${escapeHtml(market.id)}-title">${escapeHtml(market.title)}</h2></div>
      <span class="data-status ${escapeHtml(market.status)}">${statusText}</span>
    </header>
    ${market.error && market.status === "stale" ? `<p class="macro-stale-note">${escapeHtml(market.error)}</p>` : ""}
    <div class="macro-live-groups">${body}</div>
  </article>`;
}

function renderDimension(dimension) {
  const score = Math.max(-100, Math.min(100, Number(dimension.score) || 0));
  const position = (score + 100) / 2;
  return `<article class="macro-dimension">
    <header><span>${escapeHtml(dimension.name)}</span><strong>${score > 0 ? "+" : ""}${score}</strong></header>
    <div class="macro-score-track" role="img" aria-label="${escapeHtml(dimension.name)}评分${score}，状态${escapeHtml(dimension.state)}"><i style="--score-position:${position}%"></i></div>
    <p><b>${escapeHtml(dimension.state)}</b>${escapeHtml(dimension.explanation)}</p>
  </article>`;
}

function renderStrategy(strategy) {
  return `<li class="macro-strategy-item">
    <div><span>${escapeHtml(strategy.asset)}</span><em>${escapeHtml(strategy.stance)}</em></div>
    <strong>${escapeHtml(strategy.title)}</strong>
    <p>${escapeHtml(strategy.rationale)}</p>
    <small><b>失效风险</b>${escapeHtml(strategy.risk)}</small>
  </li>`;
}

function renderMarketAnalysis(market) {
  const analysis = market.analysis;
  if (!analysis || market.status === "error") {
    return `<article class="macro-analysis-panel ${escapeHtml(market.id)} unavailable"><span>MODEL VIEW</span><h2>${escapeHtml(market.title)}研判暂不可用</h2><p>需要该市场全部核心指标成功更新后才能形成综合判断。</p></article>`;
  }
  return `<article class="macro-analysis-panel ${escapeHtml(market.id)} ${escapeHtml(analysis.regimeCode)}" aria-labelledby="analysis-${escapeHtml(market.id)}-title">
    <header class="macro-analysis-heading">
      <div><span>MODEL VIEW · ${escapeHtml(market.code)} · ${escapeHtml(analysis.modelVersion || "V1")}</span><p>宏观环境综合研判</p><h2 id="analysis-${escapeHtml(market.id)}-title">${escapeHtml(analysis.regime)}</h2></div>
      <div class="macro-conviction"><em>${escapeHtml(analysis.stance)}</em><label>信号清晰度 <strong>${analysis.confidence}%</strong><progress max="100" value="${analysis.confidence}">${analysis.confidence}%</progress></label></div>
    </header>
    <p class="macro-analysis-summary">${escapeHtml(analysis.summary)}</p>
    <p class="macro-score-note">标准化评分范围 −100 至 +100，0 代表中性；分数绝对值越大，信号越明确。</p>
    <section class="macro-dimension-grid" aria-label="${escapeHtml(market.title)}模型维度">${analysis.dimensions.map(renderDimension).join("")}</section>
    <section class="macro-driver-section">
      <header><h3>判断依据</h3><span>截至 ${escapeHtml(formatPeriod(analysis.asOf))}</span></header>
      <ul>${analysis.drivers.map((driver) => `<li><span>${escapeHtml(driver.indicator)} <b>${escapeHtml(driver.value)}</b></span><em>${escapeHtml(driver.signal)}</em><p>${escapeHtml(driver.explanation)}</p></li>`).join("")}</ul>
    </section>
    <section class="macro-strategy-section">
      <header><h3>策略倾向</h3><span>资产风格，不是个股指令</span></header>
      <ul>${analysis.strategies.map(renderStrategy).join("")}</ul>
    </section>
    <p class="macro-model-disclaimer">${escapeHtml(analysis.disclaimer)}</p>
  </article>`;
}

function renderRangeControl(range, customStart) {
  return `${renderSignalTimeRangeControl({ range, customStart, scope: "macro" })}<p class="macro-window-note">控制下方全部原始指标：切换后重新计算区间起点、变化、高低值和分位；低频月度数据在短窗口内使用最近两次发布值。</p>`;
}

function renderWorkspaceHeader(data) {
  const quality = data.quality?.status || "partial";
  const qualityText = quality === "passed" ? "全部数据通过" : quality === "loading" ? "正在连接数据" : "部分数据可用";
  return `<a class="back-link" href="#signals">← 返回模型信号目录</a>
    <header class="signal-detail-header macro-detail-header">
      <div><p class="eyebrow">MACRO SIGNALS</p><h2>宏观信号</h2><p>中美指标独立展示。走势图呈现最近24期变化，阶段标签来自明确阈值和最新值，不使用手工数据。</p></div>
      <div class="macro-toolbar"><span class="quality-status ${escapeHtml(quality)}">${qualityText}</span><button class="button secondary" type="button" data-refresh-macro>检查更新</button></div>
    </header>`;
}

export function renderMacroWorkspace(data, { range = "1m", customStart = "" } = {}) {
  const counts = Object.fromEntries(data.markets.map((market) => [market.id, market.indicators?.length || 0]));
  const periods = Object.fromEntries(data.markets.map((market) => [market.id, market.analysis?.asOf || "--"]));
  return `${renderWorkspaceHeader(data)}
    <section class="macro-separation-note" aria-label="宏观数据更新状态">
      <div><span>中国数据</span><strong>${counts.china || 0} 项 · 截至 ${escapeHtml(formatPeriod(periods.china))}</strong></div><i aria-hidden="true"></i>
      <p>自动更新 · 6小时缓存 · 本次检查 ${escapeHtml(formatTimestamp(data.generatedAt))}</p><i aria-hidden="true"></i>
      <div><span>美国数据</span><strong>${counts["united-states"] || 0} 项 · 截至 ${escapeHtml(formatPeriod(periods["united-states"]))}</strong></div>
    </section>
    <section class="macro-analysis-grid" aria-label="中国与美国宏观环境综合研判">${data.markets.map(renderMarketAnalysis).join("")}</section>
    ${renderRangeControl(range, customStart)}
    <header class="macro-raw-data-heading"><div><span>RAW INDICATORS</span><h2>原始指标与走势</h2></div><p>模型结论来自下列最新已发布指标；系统每6小时检查各数据源，不会用当天日期伪造尚未发布的月度数据。</p></header>
    <section class="macro-market-grid" aria-label="中国与美国宏观指标">${data.markets.map((market) => renderMarketPanel(market, range, customStart)).join("")}</section>`;
}

export function renderMacroWorkspaceLoading(markets) {
  return `${renderWorkspaceHeader({ quality: { status: "loading" } })}<div class="macro-loading" role="status" aria-busy="true"><span class="loading-pulse" aria-hidden="true"></span><strong>正在读取中美宏观数据</strong><p>首次加载将连接三个数据源，后续由6小时缓存自动更新。</p></div><section class="macro-market-grid" aria-hidden="true">${markets.map((market) => `<article class="macro-market-panel ${escapeHtml(market.id)} skeleton-panel"><div></div><div></div><div></div></article>`).join("")}</section>`;
}

export function renderMacroWorkspaceError(message, markets) {
  return `${renderWorkspaceHeader({ quality: { status: "error" } })}<div class="macro-source-error workspace-error" role="alert"><strong>宏观数据暂时无法加载</strong><p>${escapeHtml(message)}</p><button class="button secondary" type="button" data-refresh-macro>重新检查</button></div><section class="macro-market-grid" aria-hidden="true">${markets.map((market) => `<article class="macro-market-panel ${escapeHtml(market.id)} skeleton-panel"></article>`).join("")}</section>`;
}
import { renderSignalTimeRangeControl, selectSignalTimeRange } from "../time-range.js";
