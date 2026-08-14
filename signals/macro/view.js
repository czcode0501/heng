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

export function selectRangePoints(points, range) {
  const safeRange = [12, 24, 60].includes(Number(range)) ? Number(range) : 24;
  return (points || []).slice(-safeRange);
}

function renderTrendChart(indicator, points) {
  const chart = buildSparkline(points, { benchmark: indicator.benchmark });
  const first = points[0];
  const last = points.at(-1);
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

function renderIndicator(indicator, range) {
  const summary = indicator.summary;
  const points = selectRangePoints(indicator.points, range);
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
    <footer>
      <span>当前区间分位 <strong>${percentile}%</strong></span>
      <a href="${escapeHtml(indicator.source.url)}" target="_blank" rel="noreferrer">${escapeHtml(indicator.source.name)} · ${escapeHtml(indicator.source.original)}</a>
    </footer>
  </article>`;
}

function renderMarketPanel(market, range) {
  const statusText = market.status === "live" ? "真实数据已连接" : market.status === "stale" ? "显示上次成功数据" : "数据连接失败";
  const grouped = Map.groupBy(market.indicators || [], (indicator) => indicator.group);
  const body = market.status === "error"
    ? `<div class="macro-source-error" role="alert"><strong>暂时无法读取${escapeHtml(market.title)}数据</strong><p>${escapeHtml(market.error)}</p><button class="button secondary" type="button" data-refresh-macro>重新检查</button></div>`
    : [...grouped].map(([group, indicators]) => `<section class="macro-live-group"><header><h3>${escapeHtml(group)}</h3><span>${indicators.length} 项指标</span></header><div class="macro-metric-list">${indicators.map((indicator) => renderIndicator(indicator, range)).join("")}</div></section>`).join("");
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

function renderRangeControl(range) {
  const options = [{ value: 12, label: "1年" }, { value: 24, label: "2年" }, { value: 60, label: "5年" }];
  return `<section class="macro-range-bar" aria-label="走势图显示设置">
    <div><span>走势图范围</span><strong>统一观察窗口</strong></div>
    <div class="macro-range-control" role="group" aria-label="选择走势图时间范围">
      ${options.map((option) => `<button type="button" data-macro-range="${option.value}" aria-pressed="${Number(range) === option.value}">${option.label}</button>`).join("")}
    </div>
    <p>切换后更新全部走势图和区间分位；最新值与模型阶段不变。</p>
  </section>`;
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

export function renderMacroWorkspace(data, { range = 24 } = {}) {
  const counts = Object.fromEntries(data.markets.map((market) => [market.id, market.indicators?.length || 0]));
  return `${renderWorkspaceHeader(data)}
    <section class="macro-separation-note" aria-label="宏观数据更新状态">
      <div><span>中国数据</span><strong>${counts.china || 0} 项已连接</strong></div><i aria-hidden="true"></i>
      <p>自动更新 · 6小时缓存 · 本次检查 ${escapeHtml(formatTimestamp(data.generatedAt))}</p><i aria-hidden="true"></i>
      <div><span>美国数据</span><strong>${counts["united-states"] || 0} 项已连接</strong></div>
    </section>
    ${renderRangeControl(range)}
    <section class="macro-analysis-grid" aria-label="中国与美国宏观环境综合研判">${data.markets.map(renderMarketAnalysis).join("")}</section>
    <header class="macro-raw-data-heading"><div><span>RAW INDICATORS</span><h2>原始指标与走势</h2></div><p>模型结论来自下列实时指标；保留原始数据便于逐项核验。</p></header>
    <section class="macro-market-grid" aria-label="中国与美国宏观指标">${data.markets.map((market) => renderMarketPanel(market, range)).join("")}</section>`;
}

export function renderMacroWorkspaceLoading(markets) {
  return `${renderWorkspaceHeader({ quality: { status: "loading" } })}<div class="macro-loading" role="status" aria-busy="true"><span class="loading-pulse" aria-hidden="true"></span><strong>正在读取中美宏观数据</strong><p>首次加载将连接三个数据源，后续由6小时缓存自动更新。</p></div><section class="macro-market-grid" aria-hidden="true">${markets.map((market) => `<article class="macro-market-panel ${escapeHtml(market.id)} skeleton-panel"><div></div><div></div><div></div></article>`).join("")}</section>`;
}

export function renderMacroWorkspaceError(message, markets) {
  return `${renderWorkspaceHeader({ quality: { status: "error" } })}<div class="macro-source-error workspace-error" role="alert"><strong>宏观数据暂时无法加载</strong><p>${escapeHtml(message)}</p><button class="button secondary" type="button" data-refresh-macro>重新检查</button></div><section class="macro-market-grid" aria-hidden="true">${markets.map((market) => `<article class="macro-market-panel ${escapeHtml(market.id)} skeleton-panel"></article>`).join("")}</section>`;
}
