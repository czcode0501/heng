function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderIndicatorGroup(group) {
  return `<section class="macro-indicator-group">
    <header>
      <h3>${escapeHtml(group.title)}</h3>
      <p>${escapeHtml(group.description)}</p>
    </header>
    <ul class="macro-indicator-list">
      ${group.indicators.map((indicator) => `<li>
        <span>${escapeHtml(indicator.name)}</span>
        <em>${indicator.status === "pending" ? "待接入" : escapeHtml(indicator.status)}</em>
      </li>`).join("")}
    </ul>
  </section>`;
}

function renderMarketPanel(market) {
  return `<article class="macro-market-panel ${escapeHtml(market.id)}" aria-labelledby="macro-${escapeHtml(market.id)}-title">
    <header class="macro-market-header">
      <span class="market-code" aria-hidden="true">${escapeHtml(market.code)}</span>
      <div>
        <p>${escapeHtml(market.english)}</p>
        <h2 id="macro-${escapeHtml(market.id)}-title">${escapeHtml(market.title)}</h2>
      </div>
      <span class="data-status">数据待接入</span>
    </header>
    <p class="macro-market-description">${escapeHtml(market.description)}</p>
    <div class="macro-indicator-groups">
      ${market.groups.map(renderIndicatorGroup).join("")}
    </div>
    <footer class="macro-market-footer">
      <span>后续呈现</span>
      <strong>当前值 · 动量 · 历史分位 · 趋势图</strong>
    </footer>
  </article>`;
}

export function renderMacroWorkspace(macroMarkets) {
  return `<a class="back-link" href="#signals">← 返回模型信号目录</a>
    <header class="signal-detail-header macro-detail-header">
      <div>
        <p class="eyebrow">MACRO SIGNALS</p>
        <h2>宏观信号</h2>
        <p>中美指标独立展示、独立计算，避免不同经济周期与政策体系相互混淆。</p>
      </div>
      <span class="structure-status">双市场结构已建立</span>
    </header>
    <section class="macro-separation-note" aria-label="宏观信号计算边界">
      <div><span>中国宏观评分</span><strong>待建立</strong></div>
      <i aria-hidden="true"></i>
      <p>同一页面对照观察，但不把中美指标直接混合为一个未经解释的分数。</p>
      <i aria-hidden="true"></i>
      <div><span>美国宏观评分</span><strong>待建立</strong></div>
    </section>
    <section class="macro-market-grid" aria-label="中国与美国宏观指标">
      ${macroMarkets.map(renderMarketPanel).join("")}
    </section>`;
}
