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

function renderTrendChart(indicator) {
  const chart = buildSparkline(indicator.points, { benchmark: indicator.benchmark });
  const first = indicator.points[0];
  const last = indicator.points.at(-1);
  const benchmark = chart.benchmarkY === null ? "" : `<line class="macro-chart-benchmark" x1="5" y1="${chart.benchmarkY.toFixed(2)}" x2="355" y2="${chart.benchmarkY.toFixed(2)}"></line>`;
  return `<figure class="macro-chart">
    <svg viewBox="0 0 360 72" role="img" aria-label="${escapeHtml(indicator.name)}从${escapeHtml(formatPeriod(first.date))}至${escapeHtml(formatPeriod(last.date))}的走势">
      ${benchmark}
      <path class="macro-chart-area" d="${chart.areaPath}"></path>
      <path class="macro-chart-line" d="${chart.path}"></path>
      <circle cx="${chart.lastX.toFixed(2)}" cy="${chart.lastY.toFixed(2)}" r="3"></circle>
    </svg>
    <figcaption><span>${escapeHtml(formatPeriod(first.date))}</span><span>${indicator.benchmark === null ? "" : `参考线 ${formatNumber(indicator.benchmark)}`}</span><span>${escapeHtml(formatPeriod(last.date))}</span></figcaption>
  </figure>`;
}

function renderIndicator(indicator) {
  const summary = indicator.summary;
  const change = summary.change === null ? "暂无上期比较" : `较上期 ${summary.change > 0 ? "+" : ""}${formatNumber(summary.change)}${indicator.unit}`;
  return `<article class="macro-metric-card ${escapeHtml(summary.direction)}">
    <header>
      <div><h4>${escapeHtml(indicator.name)}</h4><span>${escapeHtml(indicator.frequency)} · ${summary.observations}期</span></div>
      <em>${escapeHtml(summary.stage)}</em>
    </header>
    <div class="macro-current-value">
      <strong>${formatNumber(summary.value)}<small>${escapeHtml(indicator.unit)}</small></strong>
      <span>${escapeHtml(change)} · ${escapeHtml(formatPeriod(summary.date))}</span>
    </div>
    ${renderTrendChart(indicator)}
    <footer>
      <span>近24期分位 <strong>${summary.percentile}%</strong></span>
      <a href="${escapeHtml(indicator.source.url)}" target="_blank" rel="noreferrer">${escapeHtml(indicator.source.name)} · ${escapeHtml(indicator.source.original)}</a>
    </footer>
  </article>`;
}

function renderMarketPanel(market) {
  const statusText = market.status === "live" ? "真实数据已连接" : market.status === "stale" ? "显示上次成功数据" : "数据连接失败";
  const grouped = Map.groupBy(market.indicators || [], (indicator) => indicator.group);
  const body = market.status === "error"
    ? `<div class="macro-source-error" role="alert"><strong>暂时无法读取${escapeHtml(market.title)}数据</strong><p>${escapeHtml(market.error)}</p><button class="button secondary" type="button" data-refresh-macro>重新检查</button></div>`
    : [...grouped].map(([group, indicators]) => `<section class="macro-live-group"><header><h3>${escapeHtml(group)}</h3><span>${indicators.length} 项指标</span></header><div class="macro-metric-list">${indicators.map(renderIndicator).join("")}</div></section>`).join("");
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

function renderWorkspaceHeader(data) {
  const quality = data.quality?.status || "partial";
  const qualityText = quality === "passed" ? "全部数据通过" : quality === "loading" ? "正在连接数据" : "部分数据可用";
  return `<a class="back-link" href="#signals">← 返回模型信号目录</a>
    <header class="signal-detail-header macro-detail-header">
      <div><p class="eyebrow">MACRO SIGNALS</p><h2>宏观信号</h2><p>中美指标独立展示。走势图呈现最近24期变化，阶段标签来自明确阈值和最新值，不使用手工数据。</p></div>
      <div class="macro-toolbar"><span class="quality-status ${escapeHtml(quality)}">${qualityText}</span><button class="button secondary" type="button" data-refresh-macro>检查更新</button></div>
    </header>`;
}

export function renderMacroWorkspace(data) {
  const counts = Object.fromEntries(data.markets.map((market) => [market.id, market.indicators?.length || 0]));
  return `${renderWorkspaceHeader(data)}
    <section class="macro-separation-note" aria-label="宏观数据更新状态">
      <div><span>中国数据</span><strong>${counts.china || 0} 项已连接</strong></div><i aria-hidden="true"></i>
      <p>自动更新 · 6小时缓存 · 本次检查 ${escapeHtml(formatTimestamp(data.generatedAt))}</p><i aria-hidden="true"></i>
      <div><span>美国数据</span><strong>${counts["united-states"] || 0} 项已连接</strong></div>
    </section>
    <section class="macro-market-grid" aria-label="中国与美国宏观指标">${data.markets.map(renderMarketPanel).join("")}</section>`;
}

export function renderMacroWorkspaceLoading(markets) {
  return `${renderWorkspaceHeader({ quality: { status: "loading" } })}<div class="macro-loading" role="status" aria-busy="true"><span class="loading-pulse" aria-hidden="true"></span><strong>正在读取中美宏观数据</strong><p>首次加载将连接三个数据源，后续由6小时缓存自动更新。</p></div><section class="macro-market-grid" aria-hidden="true">${markets.map((market) => `<article class="macro-market-panel ${escapeHtml(market.id)} skeleton-panel"><div></div><div></div><div></div></article>`).join("")}</section>`;
}

export function renderMacroWorkspaceError(message, markets) {
  return `${renderWorkspaceHeader({ quality: { status: "error" } })}<div class="macro-source-error workspace-error" role="alert"><strong>宏观数据暂时无法加载</strong><p>${escapeHtml(message)}</p><button class="button secondary" type="button" data-refresh-macro>重新检查</button></div><section class="macro-market-grid" aria-hidden="true">${markets.map((market) => `<article class="macro-market-panel ${escapeHtml(market.id)} skeleton-panel"></article>`).join("")}</section>`;
}
