function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderMethod(method, index) {
  const statusText = method.status === "inherited" ? "已继承" : "待定义";
  return `<li class="timing-method-item">
    <span class="timing-method-index">${String(index + 1).padStart(2, "0")}</span>
    <div><h3>${escapeHtml(method.name)}</h3><p>${escapeHtml(method.detail)}</p></div>
    <em class="${escapeHtml(method.status)}">${statusText}</em>
  </li>`;
}

function renderMarket(market) {
  return `<article class="timing-market-panel ${escapeHtml(market.id)}" aria-labelledby="timing-${escapeHtml(market.id)}-title">
    <header class="timing-market-header">
      <span class="market-code" aria-hidden="true">${escapeHtml(market.code)}</span>
      <div><p>${escapeHtml(market.english)}</p><h2 id="timing-${escapeHtml(market.id)}-title">${escapeHtml(market.title)}</h2></div>
      <em class="timing-structure-status ${escapeHtml(market.status)}">${escapeHtml(market.statusLabel)}</em>
    </header>
    <div class="timing-market-body">
      <p class="timing-market-description">${escapeHtml(market.description)}</p>
      <section aria-labelledby="timing-${escapeHtml(market.id)}-methods">
        <header class="timing-section-heading"><div><span>METHOD STACK</span><h3 id="timing-${escapeHtml(market.id)}-methods">择时方法结构</h3></div><strong>${market.methods.length} 个模块</strong></header>
        <ol class="timing-method-list">${market.methods.map(renderMethod).join("")}</ol>
      </section>
      <section class="timing-next-steps" aria-labelledby="timing-${escapeHtml(market.id)}-next">
        <header><span>NEXT</span><h3 id="timing-${escapeHtml(market.id)}-next">下一步需要定义</h3></header>
        <ul>${market.nextSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ul>
      </section>
    </div>
  </article>`;
}

export function renderMarketTimingWorkspace(markets) {
  const china = markets.find(({ id }) => id === "china");
  const unitedStates = markets.find(({ id }) => id === "united-states");
  return `<a class="back-link" href="#signals">← 返回模型信号目录</a>
    <header class="signal-detail-header timing-detail-header">
      <div><p class="eyebrow">MARKET TIMING</p><h2>市场择时</h2><p>最新版本拆分为中国股票与美国股票两个独立系统。两侧分别定义市场基准、数据源、指标阈值和最终择时输出。</p></div>
      <span class="structure-status">双市场结构已创建</span>
    </header>
    <section class="timing-separation-note" aria-label="市场择时结构说明">
      <div><span>中国股票 · ${escapeHtml(china?.scope || "A股")}</span><strong>量比 + K线形态 + 均线系统</strong></div>
      <p>中美两套规则独立计算，不直接共用阈值，也不展示未经数据验证的实时信号。</p>
      <div><span>美国股票 · ${escapeHtml(unitedStates?.scope || "美股")}</span><strong>指标与阈值等待定义</strong></div>
    </section>
    <section class="timing-market-grid" aria-label="中国股票与美国股票市场择时">${markets.map(renderMarket).join("")}</section>`;
}
