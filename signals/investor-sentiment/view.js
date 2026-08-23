import { renderSignalTimeRangeControl, signalTimeRangeLabel } from "../time-range.js";
import { getSentimentChartPoint, summarizeSentimentRange } from "./model.js";

export { getSentimentChartPoint, summarizeSentimentRange } from "./model.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function signed(value, digits = 1) {
  const number = finite(value);
  if (number === null) return "—";
  return `${number > 0 ? "+" : ""}${number.toFixed(digits)}`;
}

function scoreTone(score) {
  return Number(score) >= 60 ? "positive" : Number(score) <= 40 ? "negative" : "neutral";
}

function marketMeta(id) {
  return id === "china"
    ? { code: "CN", english: "CHINA EQUITIES", className: "china" }
    : { code: "US", english: "UNITED STATES EQUITIES", className: "united-states" };
}

function chartPath(points, width = 620, height = 176) {
  if (points.length < 2) return "";
  return points.map(({ value }, index) => {
    const x = index / (points.length - 1) * width;
    const y = height - Math.max(0, Math.min(100, value)) / 100 * height;
    return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function renderHeader(payload) {
  const markets = payload?.markets || [];
  const live = markets.filter(({ status }) => status === "live").length;
  const status = live === markets.length && markets.length ? "数据通过" : live ? "部分数据可用" : "等待可用数据";
  const generated = new Date(payload?.generatedAt);
  const checkedAt = Number.isNaN(generated.getTime()) ? "—" : `最近检查 ${generated.toLocaleString("zh-CN", { hour12: false })}`;
  return `<a class="back-link" href="#signals">← 返回模型信号目录</a>
    <header class="signal-detail-header sentiment-detail-header">
      <div><p class="eyebrow">市场情绪</p><h2>投资者情绪</h2><p>看市场是否过度恐慌或过度乐观，以及情绪是在改善还是恶化。它能提醒拥挤风险，但不能单独决定买卖。</p></div>
      <div class="sentiment-header-status"><span class="quality-status ${status === "数据通过" ? "passed" : ""}">${status}</span><small>${escapeHtml(checkedAt)}</small></div>
    </header>`;
}

function renderSummaryCard(market, options) {
  const meta = marketMeta(market.id);
  const summary = summarizeSentimentRange(market, options);
  if (!summary) return `<article class="sentiment-summary-card ${meta.className} unavailable"><strong>${escapeHtml(market.title)}</strong><p>当前没有足够数据计算情绪阶段。</p></article>`;
  return `<article class="sentiment-summary-card ${meta.className}">
    <header><span>${meta.code}</span><div><small>${meta.english}</small><h3>${escapeHtml(market.title)}</h3></div><em>${market.status === "live" ? "自动更新" : "共享缓存"}</em></header>
    <div class="sentiment-summary-body"><div class="sentiment-score"><small>情绪水平</small><strong>${summary.endValue.toFixed(0)}</strong><span>0 恐慌 · 100 贪婪</span></div>
      <div class="sentiment-summary-phase"><span class="sentiment-phase ${summary.phase.tone}">${escapeHtml(summary.phase.label)}</span><strong class="${summary.impulse >= 0 ? "positive" : "negative"}">情绪变化速度 ${signed(summary.impulse)}</strong><p>${escapeHtml(summary.phase.summary)} ${summary.impulse >= 0 ? "情绪正在改善，但仍需价格和市场环境确认。" : "情绪正在恶化，先减少追高并等待企稳。"}</p></div></div>
    <footer><span><b>区间</b>${escapeHtml(summary.startDate)} → ${escapeHtml(summary.endDate)}</span><span><b>可信度</b>${Number(market.confidence || 0).toFixed(0)}%</span><span><b>数据截止</b>${escapeHtml(market.asOf)}</span></footer>
  </article>`;
}

function renderChart(market, summary, options) {
  const points = summary.points;
  return `<figure class="sentiment-history-chart"><figcaption><div><span>SENTIMENT LEVEL · ${escapeHtml(signalTimeRangeLabel(options.range, options.customStart))}</span><h4>情绪水平与阶段走势</h4></div><p>鼠标、触控或方向键查看具体日期与点位</p></figcaption>
    <div class="sentiment-chart-shell"><svg viewBox="0 0 620 176" preserveAspectRatio="none" role="application" tabindex="0" data-sentiment-chart data-chart-points="${escapeHtml(JSON.stringify(points))}" aria-label="${escapeHtml(market.title)}投资者情绪走势图，零代表极度恐慌，一百代表极度贪婪">
      <rect class="sentiment-chart-zone fear" x="0" y="132" width="620" height="44"></rect><rect class="sentiment-chart-zone balanced" x="0" y="44" width="620" height="88"></rect><rect class="sentiment-chart-zone greed" x="0" y="0" width="620" height="44"></rect>
      <line class="sentiment-chart-threshold" x1="0" x2="620" y1="44" y2="44"></line><line class="sentiment-chart-midline" x1="0" x2="620" y1="88" y2="88"></line><line class="sentiment-chart-threshold" x1="0" x2="620" y1="132" y2="132"></line>
      <path class="sentiment-chart-line" d="${chartPath(points)}"></path><line class="sentiment-chart-cursor" x1="0" x2="0" y1="0" y2="176"></line><circle class="sentiment-chart-dot" cx="0" cy="0" r="4"></circle><rect class="sentiment-chart-hit-zone" width="620" height="176"></rect>
    </svg><div class="sentiment-chart-tooltip" role="status" aria-live="polite" hidden><strong>--</strong><span>--</span><em>--</em></div></div>
    <dl class="sentiment-range-facts"><div><dt>起点 → 最新</dt><dd>${summary.startValue.toFixed(1)} → ${summary.endValue.toFixed(1)}</dd></div><div><dt>情绪动量</dt><dd class="${summary.impulse >= 0 ? "positive" : "negative"}">${signed(summary.impulse)}</dd></div><div><dt>区间高 / 低</dt><dd>${summary.high.toFixed(1)} / ${summary.low.toFixed(1)}</dd></div><div><dt>区间分位</dt><dd>${summary.percentile}%</dd></div></dl>
    <footer class="chart-time-axis"><span>${escapeHtml(summary.startDate)}</span><span>≤25 恐慌 · 25–75 平衡 · ≥75 贪婪</span><span>${escapeHtml(summary.endDate)}</span></footer></figure>`;
}

function renderDimensions(summary) {
  return `<section class="sentiment-dimensions" aria-labelledby="sentiment-dimensions-title"><header><div><span>FOUR-DIMENSION EVIDENCE</span><h4 id="sentiment-dimensions-title">四维情绪证据</h4></div><p>每一维都随所选时间范围比较起点与最新值</p></header><div class="sentiment-dimension-grid">${summary.dimensions.map((dimension) => `<article>
    <header><div><span>${dimension.weight}%</span><h5>${escapeHtml(dimension.title)}</h5></div><strong class="${scoreTone(dimension.score)}">${Number(dimension.score).toFixed(0)}</strong></header>
    <div class="sentiment-dimension-bar" aria-label="${escapeHtml(dimension.title)}得分 ${Number(dimension.score).toFixed(0)}"><i style="width:${Math.max(0, Math.min(100, Number(dimension.score)))}%"></i></div>
    <p>${escapeHtml(dimension.summary)}</p><dl><div><dt>区间变化</dt><dd class="${dimension.change >= 0 ? "positive" : "negative"}">${signed(dimension.change)}</dd></div>${(dimension.metrics || []).slice(0, 2).map((metric) => `<div><dt>${escapeHtml(metric.label)}</dt><dd class="${escapeHtml(metric.tone || "neutral")}">${escapeHtml(metric.value)}</dd></div>`).join("")}</dl>
  </article>`).join("")}</div></section>`;
}

function renderLegacyMethods(market) {
  return `<section class="sentiment-legacy"><header><div><span>LEGACY METHOD · PRESERVED</span><h4>旧版两种方法</h4></div><p>保留为“投机与拥挤”的可审计子信号，不再单独决定仓位</p></header><div>${(market.legacyMethods || []).map((method) => `<article class="${method.id}"><header><span>${method.id === "ground-volume" ? "01" : "02"}</span><div><h5>${escapeHtml(method.title)}</h5><strong>${escapeHtml(method.state)}</strong></div></header><dl><div><dt>当前量比</dt><dd>${Number(method.volumeRatio).toFixed(2)}×</dd></div>${finite(method.fiveDayReturn) === null ? "" : `<div><dt>5日价格</dt><dd>${signed(method.fiveDayReturn, 2)}%</dd></div>`}<div><dt>判断阈值</dt><dd>${escapeHtml(method.threshold)}</dd></div></dl><p>${escapeHtml(method.interpretation)}</p></article>`).join("")}</div></section>`;
}

function renderMarket(market, options) {
  const summary = summarizeSentimentRange(market, options);
  const meta = marketMeta(market.id);
  if (!summary) return "";
  return `<article class="sentiment-market-workspace ${meta.className}"><header class="sentiment-market-title"><div><span>${meta.code}</span><div><small>${meta.english}</small><h3>${escapeHtml(market.title)} · 情绪证据</h3></div></div><p>${escapeHtml(market.source?.name)} · 无需用户配置 API Key · 复用共享缓存</p></header>
    <section class="sentiment-market-overview"><div class="sentiment-level-panel"><span>情绪水平</span><strong>${summary.endValue.toFixed(0)}</strong><small>越高越乐观</small></div><div class="sentiment-impulse-panel"><span>变化速度（Impulse）</span><strong class="${summary.impulse >= 0 ? "positive" : "negative"}">${signed(summary.impulse)}</strong><small>正数改善，负数恶化</small></div><div class="sentiment-phase-panel"><span>当前阶段（Regime）</span><strong>${escapeHtml(summary.phase.label)}</strong><p>${escapeHtml(summary.phase.summary)}</p></div><div class="sentiment-confidence-panel"><span>结果可信度</span><strong>${Number(market.confidence || 0).toFixed(0)}%</strong><small>${escapeHtml(market.dataQuality?.label || "数据检查中，请等待完成后再行动")}</small></div></section>
    <div class="sentiment-evidence-grid">${renderChart(market, summary, options)}${renderDimensions(summary)}</div>${renderLegacyMethods(market)}
    <footer class="sentiment-source-note"><span>数据口径</span><p>恐慌、参与、仓位代理与投机行为先在各维度内去重，再合成为情绪水平；高分表示贪婪，低分表示恐慌。${escapeHtml(market.dataQuality?.reusedSharedMarketCache ? "行情来自已加载的共享缓存，本页面不会重复请求同一数据源。" : "")}</p></footer>
  </article>`;
}

export function getInvestorSentimentRefreshDelay(payload) {
  return Math.max(60, Number(payload?.refreshAfterSeconds) || 1800) * 1000;
}

export function renderInvestorSentimentWorkspaceLoading() {
  return `${renderHeader({ markets: [] })}<section class="sentiment-loading" aria-busy="true"><strong>正在构建中美投资者情绪证据</strong><p>复用已预载的中美行情，计算四维得分、情绪动量与阶段状态。</p></section>`;
}

export function renderInvestorSentimentWorkspaceError(message) {
  return `${renderHeader({ markets: [] })}<section class="sentiment-page-error" role="alert"><strong>暂时无法生成投资者情绪分析</strong><p>${escapeHtml(message)}</p><small>先不要用情绪决定买卖，请稍后重新进入本页。系统不会用演示数字替代真实行情。</small></section>`;
}

export function renderInvestorSentimentWorkspace(payload, options = {}) {
  const markets = Array.isArray(payload?.markets) ? payload.markets : [];
  const rangeOptions = { range: options.range || "1m", customStart: options.customStart || "" };
  return `${renderHeader(payload)}${renderSignalTimeRangeControl({ ...rangeOptions, scope: "investor-sentiment" })}
    <p class="sentiment-window-note">统一观察窗口同时控制情绪走势图、情绪动量和下方四维证据；所有变化均为所选起点与最新有效交易日的比较。</p>
    <section class="sentiment-summary-grid">${markets.map((market) => renderSummaryCard(market, rangeOptions)).join("")}</section>
    <section class="sentiment-axis-explainer"><div><span>情绪水平</span><strong>恐慌 ← 0—100 → 贪婪</strong></div><i aria-hidden="true">×</i><div><span>情绪动量</span><strong>恶化 ← 起点差值 → 改善</strong></div><p>两个轴共同决定六个阶段，避免把“极度恐慌”直接误判为买入信号。</p></section>
    <section class="sentiment-workspace-list">${markets.map((market) => renderMarket(market, rangeOptions)).join("")}</section>
    <p class="sentiment-license-note">${escapeHtml(payload?.methodology?.disclaimer || "情绪模型只用于识别市场阶段，不构成单独买卖依据。")}</p>`;
}
