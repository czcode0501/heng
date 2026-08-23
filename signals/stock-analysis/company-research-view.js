function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value, currency = "USD") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "待补证";
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency, notation: "compact", maximumFractionDigits: 2 }).format(number);
}

function formatTimestamp(value) {
  if (!value) return "更新时间待确认";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false });
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function yearOverYearPeriod(periods) {
  const latest = periods[0];
  const latestDate = new Date(`${latest?.periodEnd || ""}T00:00:00Z`);
  if (Number.isNaN(latestDate.getTime())) return null;
  return periods.slice(1).find((period) => {
    const candidate = new Date(`${period?.periodEnd || ""}T00:00:00Z`);
    if (Number.isNaN(candidate.getTime()) || candidate.getUTCFullYear() !== latestDate.getUTCFullYear() - 1) return false;
    return Math.abs(candidate.getUTCMonth() - latestDate.getUTCMonth()) <= 1;
  }) || null;
}

function growthRate(current, previous) {
  const a = Number(current);
  const b = Number(previous);
  return Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? (a / b - 1) * 100 : null;
}

function growthMarkup(periods) {
  const latest = periods[0];
  const comparable = yearOverYearPeriod(periods);
  if (!latest || !comparable) return `<p class="company-growth-note">同比增长待补证：当前返回期间不足以匹配上年同期，系统不会用相邻季度冒充同比。</p>`;
  const metrics = [
    ["营收同比", growthRate(latest.revenue, comparable.revenue)],
    ["净利润同比", growthRate(latest.netIncome, comparable.netIncome)],
    ["自由现金流同比", growthRate(latest.freeCashFlow, comparable.freeCashFlow)],
  ];
  return `<section class="company-growth-strip" aria-label="同报告期增长比较">${metrics.map(([label, value]) => `<article><span>${label}</span><strong class="${value == null ? "" : value >= 0 ? "positive" : "negative"}">${value == null ? "待补证" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`}</strong><small>${escapeHtml(latest.periodEnd)} 对比 ${escapeHtml(comparable.periodEnd)}</small></article>`).join("")}</section>`;
}

function fundamentalsMarkup(research) {
  const fundamentals = research?.fundamentals;
  const periods = fundamentals?.periods || [];
  if (!periods.length) {
    return `<div class="company-research-empty"><strong>财务事实待补证</strong><p>${escapeHtml(fundamentals?.reason || "当前没有可验证的结构化财报，系统不会填入中性分或推测值。")}</p></div>`;
  }
  const rows = periods.map((period) => `<tr>
    <th scope="row">${escapeHtml(period.periodEnd || "期间待确认")}<small>${escapeHtml(period.form || "财报")} · 申报 ${escapeHtml(period.filedAt || "待确认")}</small></th>
    <td>${formatNumber(period.revenue, period.currency)}</td>
    <td>${formatNumber(period.netIncome, period.currency)}</td>
    <td>${formatNumber(period.freeCashFlow, period.currency)}</td>
    <td>${formatNumber(period.assets, period.currency)}</td>
    <td>${formatNumber(period.liabilities, period.currency)}</td>
  </tr>`).join("");
  const source = fundamentals.source || {};
  const sourceUrl = safeExternalUrl(source.url);
  return `<div class="table-wrap company-fundamentals-table"><table>
    <thead><tr><th scope="col">报告期</th><th scope="col">营收</th><th scope="col">净利润</th><th scope="col">自由现金流</th><th scope="col">资产</th><th scope="col">负债</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  ${growthMarkup(periods)}
  <p class="company-source-note">结构化事实来源：${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.label || "查看来源")}</a>` : escapeHtml(source.label || "来源待补证")}。当前仅展示已返回字段，空值不会被推算。</p>`;
}

function newsMarkup(research) {
  const news = research?.news || [];
  const mediaNews = research?.mediaNews || news.filter((item) => item.sourceType === "media-news");
  const officialEvents = research?.officialEvents || news.filter((item) => item.sourceType !== "media-news");
  const cards = (items) => `<div class="company-news-list">${items.map((item) => { const itemUrl = safeExternalUrl(item.url); const sourceLabel = item.sourceType === "official-filing" || item.sourceType === "official-announcement" ? "官方披露" : "媒体新闻"; return `<article data-source-type="${escapeHtml(item.sourceType || "media-news")}">
    <div><span>${escapeHtml(sourceLabel)} · ${escapeHtml(item.category === "earnings" ? "财报/指引" : "公司事件")}</span><time>${escapeHtml(formatTimestamp(item.publishedAt))}</time></div>
    <h4>${itemUrl ? `<a href="${escapeHtml(itemUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>` : escapeHtml(item.title)}</h4>
    <p>${escapeHtml(item.summary || "来源未提供摘要，请打开原文核验。")}</p>
    <small>${escapeHtml(item.publisher || "来源待核验")} · 事件相关性需由事实与价格共同验证</small>
  </article>`; }).join("")}</div>`;
  const mediaProviders = (research?.providers || []).filter(({ channel, id }) => channel === "媒体新闻" || ["finnhub", "gnews", "tushare-news"].includes(id));
  const mediaEmptyTitle = mediaProviders.some(({ status }) => status === "not-configured") ? "媒体新闻接口待配置" : "当前窗口暂无相关媒体报道";
  const mediaEmptyDetail = mediaProviders.map(({ label, detail }) => `${label}：${detail}`).join(" ") || "媒体新闻连接尚未返回数据；系统不会把空结果解释为公司没有新闻。";
  const officialProvider = (research?.providers || []).find(({ channel }) => /公告|披露/.test(channel));
  return `<section class="company-news-source-legend" aria-label="事件来源说明">
    <div><strong>官方披露</strong><span>监管申报或交易所公告，作为可核验事实来源</span></div>
    <div><strong>媒体新闻</strong><span>补充市场叙事与催化，需要独立核验</span></div>
  </section>
  <section class="company-news-group" aria-labelledby="company-media-news-title">
    <header><div><span>MEDIA COVERAGE</span><h3 id="company-media-news-title">最新媒体新闻</h3></div><em>${mediaNews.length} 条</em></header>
    ${mediaNews.length ? cards(mediaNews) : `<div class="company-research-empty"><strong>${escapeHtml(mediaEmptyTitle)}</strong><p>${escapeHtml(mediaEmptyDetail)}</p></div>`}
  </section>
  <section class="company-news-group" aria-labelledby="company-official-news-title">
    <header><div><span>OFFICIAL FILINGS</span><h3 id="company-official-news-title">官方披露与公告</h3></div><em>${officialEvents.length} 条</em></header>
    ${officialEvents.length ? cards(officialEvents) : `<div class="company-research-empty"><strong>官方披露暂不可用</strong><p>${escapeHtml(officialProvider?.detail || "官方披露链路尚未返回数据，系统会在下一刷新周期重试。")}</p></div>`}
  </section>`;
}

function providerMarkup(research) {
  const providers = research?.providers || [];
  if (!providers.length) return "";
  const labels = {
    live: "已连接",
    "live-official-only": "官方披露已连接",
    "live-media-only": "媒体新闻已连接",
    empty: "已连接 · 当前窗口无结果",
    "not-configured": "待配置",
    unavailable: "暂不可用",
    error: "检查失败",
    stale: "使用上次成功数据",
  };
  const issueCount = providers.filter(({ status }) => !["live", "live-official-only", "live-media-only", "empty"].includes(status)).length;
  return `<details class="company-provider-details">
    <summary>数据来源与连接状态 <span>${issueCount ? `${issueCount} 项待处理` : "全部可用"}</span></summary>
    <aside class="company-provider-status" aria-label="公司研究数据源状态">${providers.map((provider) => { const providerUrl = safeExternalUrl(provider.url); return `<article data-status="${escapeHtml(provider.status)}"><div><span>${escapeHtml(provider.channel)}</span><strong>${escapeHtml(provider.label)}</strong></div><em>${escapeHtml(labels[provider.status] || provider.status)}</em><p>${escapeHtml(provider.detail)}</p>${providerUrl ? `<a href="${escapeHtml(providerUrl)}" target="_blank" rel="noopener noreferrer">接口说明</a>` : ""}</article>`; }).join("")}</aside>
  </details>`;
}

function managerDossierMarkup(dossier) {
  const priorities = dossier?.managerPriorities || [];
  if (!priorities.length) return "";
  const labels = { supported: "多源覆盖", partial: "单源/部分覆盖", missing: "待补证" };
  const cards = priorities.map((section) => {
    const facts = (section.items || []).slice(0, 3).map((item) => {
      const sourceUrl = safeExternalUrl(item?.source?.url);
      const sourceLabel = item?.source?.label || "来源待标记";
      return `<li><span>${escapeHtml(item.text)}</span><small>${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sourceLabel)}</a>` : escapeHtml(sourceLabel)}</small></li>`;
    }).join("");
    return `<details class="company-dossier-card" data-status="${escapeHtml(section.status)}"${section.priority <= 3 ? " open" : ""}>
      <summary><span><b>${section.priority}</b>${escapeHtml(section.label)}</span><em>${escapeHtml(labels[section.status] || section.status)}</em></summary>
      ${facts ? `<ul>${facts}</ul>` : `<p>${escapeHtml(section.missingReason)}</p>`}
    </details>`;
  }).join("");
  return `<section class="company-manager-dossier" aria-labelledby="company-manager-dossier-title">
    <header><div><span>COMPANY RESEARCH DOSSIER</span><h4 id="company-manager-dossier-title">完整公司研究 · 按当前经理排序</h4></div><strong>${Number(dossier.coverage?.completed || 0)}/${Number(dossier.coverage?.total || priorities.length)} 维有证据</strong></header>
    <p>历史财务只回答经营结果；产品、护城河、市场份额、管理层、未来预期与估值必须分别取证，缺失项不会获得默认分。</p>
    <div class="company-dossier-grid">${cards}</div>
  </section>`;
}

function managerMarkup(insight) {
  if (!insight) return `<div class="company-research-empty"><strong>经理解读正在等待公司事实</strong><p>事实载入前不生成方法论结论。</p></div>`;
  const evidenceLabels = { A: "A级 · 已核验", B: "B级 · 待双源核验", C: insight.evidence.status === "conflict" ? "冲突 · 决策阻断" : "C级 · 事实不足" };
  const factValue = (value, { signed = false } = {}) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "待补证";
    return `${signed && number > 0 ? "+" : ""}${number.toFixed(1)}%`;
  };
  const facts = insight.facts || {};
  const narrative = insight.narrative || {};
  return `<div class="company-manager-interpretation">
    <header><div><span>同一事实，不同经理镜头</span><h3>${escapeHtml(insight.manager.name)} · ${escapeHtml(insight.verdict)}</h3></div><div class="company-manager-badges"><em>研究分 ${Number.isFinite(Number(insight.score)) ? Number(insight.score).toFixed(1) : "—"}</em><small>方法论模拟口吻 · 非本人原话</small></div></header>
    <ul aria-label="经理公司研究重点">${insight.focus.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    <section class="company-manager-voice" aria-labelledby="company-manager-reading-title">
      <h4 id="company-manager-reading-title">站在这位经理的方法论里，我会这样读</h4>
      <p>${escapeHtml(narrative.opening || insight.methodology)}</p>
      <p>${escapeHtml(narrative.factRead || "公司事实仍不足以形成具体解读。")}</p>
      <p>${escapeHtml(narrative.businessRead || "产品、护城河、市场地位、管理层、未来预期、估值、催化与风险仍需逐项核验。")}</p>
    </section>
    <dl class="company-manager-facts" aria-label="经理解读使用的公司事实">
      <div><dt>营收同比</dt><dd>${escapeHtml(factValue(facts.revenueGrowth, { signed: true }))}</dd></div>
      <div><dt>净利润同比</dt><dd>${escapeHtml(factValue(facts.earningsGrowth, { signed: true }))}</dd></div>
      <div><dt>自由现金流率</dt><dd>${escapeHtml(factValue(facts.freeCashFlowMargin))}</dd></div>
      <div><dt>负债/资产</dt><dd>${escapeHtml(factValue(facts.liabilityRatio))}</dd></div>
      <div><dt>近期事件</dt><dd>${facts.eventCount || 0} 条</dd></div>
      <div><dt>证据等级</dt><dd>${escapeHtml(evidenceLabels[insight.evidence.grade])}</dd></div>
    </dl>
    ${managerDossierMarkup(insight.dossier)}
    <section class="company-manager-decision-grid">
      <article><h4>我会怎么做</h4><p>${escapeHtml(narrative.action || insight.methodology)}</p></article>
      <article><h4>什么会让我改判</h4><p>${escapeHtml(narrative.changeMind || insight.challenge)}</p></article>
    </section>
    <p class="company-evidence-boundary">${escapeHtml(narrative.evidenceBoundary || "证据边界待确认。")}</p>
    <p class="company-fact-boundary"><strong>事实数据不会因基金经理切换而改变。</strong>切换的是对同一组事实的关注顺序、解释方法、决策门槛与退出条件。</p>
  </div>`;
}

export function renderCompanyAnalysisShell({ marketMarkup, research = null, insight = null, activeTab = "market", loading = false } = {}) {
  const tabs = [
    ["market", "行情分析"],
    ["fundamentals", "财报与增长"],
    ["news", "公司新闻"],
    ["manager", "经理解读"],
  ];
  const selected = tabs.some(([id]) => id === activeTab) ? activeTab : "market";
  const tabMarkup = tabs.map(([id, label]) => `<button id="company-tab-${id}" type="button" role="tab" aria-selected="${id === selected}" aria-controls="company-panel-${id}" tabindex="${id === selected ? 0 : -1}" data-company-analysis-tab="${id}">${label}</button>`).join("");
  const researchStatus = loading
    ? "公司事实正在后台载入，不阻塞行情分析"
    : research?.meta?.stale ? `刷新失败，使用上次成功快照（${formatTimestamp(research.meta.fetchedAt)}）`
    : research?.meta?.partialStale ? `部分来源刷新失败，已保留上次成功数据（${(research.meta.staleChannels || []).join("、")}）`
    : research?.meta?.fetchedAt ? `公司事实更新于 ${formatTimestamp(research.meta.fetchedAt)}` : "公司事实尚未载入";
  return `<section class="company-analysis-shell">
    <header class="company-analysis-nav"><div role="tablist" aria-label="个股分析分类">${tabMarkup}</div><small role="status">${escapeHtml(researchStatus)}</small></header>
    <section id="company-panel-market" role="tabpanel" aria-labelledby="company-tab-market"${selected === "market" ? "" : " hidden"}>${marketMarkup || ""}</section>
    <section id="company-panel-fundamentals" role="tabpanel" aria-labelledby="company-tab-fundamentals"${selected === "fundamentals" ? "" : " hidden"}>${fundamentalsMarkup(research)}</section>
    <section id="company-panel-news" role="tabpanel" aria-labelledby="company-tab-news"${selected === "news" ? "" : " hidden"}>${newsMarkup(research)}</section>
    <section id="company-panel-manager" role="tabpanel" aria-labelledby="company-tab-manager"${selected === "manager" ? "" : " hidden"}>${managerMarkup(insight)}</section>
    ${providerMarkup(research)}
  </section>`;
}
