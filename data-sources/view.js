import { DATA_SOURCE_CATALOG, dataSourceOptionsForMarket } from "./model.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const STATE_PRESENTATION = {
  online: ["本地服务在线", "is-ready"],
  ready: ["已就绪", "is-ready"],
  gateway_reachable: ["网关可达 · 待握手", "is-warning"],
  client_ready: ["客户端可用 · 待授权", "is-warning"],
  credential_ready: ["Key 格式通过 · 待验权", "is-warning"],
  adapter_required: ["需要开发适配器", "is-warning"],
  unavailable: ["尚未连接", "is-error"],
  api_offline: ["本地服务离线", "is-error"],
  degraded: ["上游降级", "is-warning"],
  checking: ["正在检查", "is-checking"],
  error: ["检查失败", "is-error"],
  planned: ["后续开放", "is-planned"],
  data_only: ["仅行情数据", "is-warning"],
  pending: ["等待连接", "is-pending"],
  "not-configured": ["尚未配置", "is-pending"],
};

function statusFor(sourceId, statuses) {
  const source = DATA_SOURCE_CATALOG.find(({ id }) => id === sourceId);
  if (source?.availability === "planned") {
    return {
      sourceId,
      state: "planned",
      readyForActivation: false,
      message: "券商连接与自动交易仍在搭建；当前版本不会要求账户授权或发送订单。",
    };
  }
  if (source?.availability === "data-only") {
    return { sourceId, state: "data_only", readyForActivation: false, message: "这是行情研究接口，不是普通同花顺券商账户持仓接口。" };
  }
  if (sourceId === "free" && !statuses[sourceId]) {
    return {
      sourceId: "free",
      state: "ready",
      readyForActivation: true,
      message: "免费数据源默认启用，无需登录或填写 API Key。",
    };
  }
  return statuses[sourceId] || {
    sourceId,
    state: "pending",
    readyForActivation: false,
    message: "尚未进行本机环境检查。",
  };
}

function statusBadge(status) {
  const [label, className] = STATE_PRESENTATION[status.state] || ["等待配置", "is-pending"];
  return `<span class="data-source-status ${className}"><i aria-hidden="true"></i>${label}</span>`;
}

function renderSourceCards(statuses, selectedSource) {
  return DATA_SOURCE_CATALOG.map((source) => {
    const status = statusFor(source.id, statuses);
    const markets = source.markets.map((market) => market === "china" ? "中国市场" : "美国市场").join(" · ");
    return `<button class="data-source-card ${source.availability === "planned" || source.availability === "data-only" ? "is-planned" : ""} ${selectedSource === source.id ? "is-selected" : ""}" type="button" data-source-card="${source.id}" aria-pressed="${selectedSource === source.id}">
      <span class="data-source-card-top"><span class="source-monogram" aria-hidden="true">${escapeHtml(source.name.slice(0, 2).toUpperCase())}</span>${statusBadge(status)}</span>
      <strong>${escapeHtml(source.name)}</strong>
      <span>${escapeHtml(source.description)}</span>
      <small>${escapeHtml(markets)} · ${escapeHtml(source.quality)}</small>
    </button>`;
  }).join("");
}

function renderRoutingMarket(marketId, title, preferences, statuses) {
  const options = dataSourceOptionsForMarket(marketId);
  const planned = options.filter(({ availability }) => availability === "planned").map(({ name }) => name).join("、");
  return `<fieldset class="data-routing-market market-${marketId === "china" ? "cn" : "us"}">
    <legend><span>${marketId === "china" ? "CN" : "US"}</span>${escapeHtml(title)}</legend>
    <div class="data-routing-options"><label class="data-routing-option">
      <input type="radio" name="routing-${marketId}" value="free" data-source-routing="${marketId}" checked>
      <span><strong>免费延迟模式</strong><small>当前唯一启用来源 · 无需账户或 Key</small></span>
    </label></div>
    <p class="data-routing-roadmap">后续开放：${escapeHtml(planned)}</p>
  </fieldset>`;
}

function configurationForm(sourceId, status) {
  const message = `<div class="data-connector-feedback ${["error", "unavailable", "api_offline"].includes(status.state) ? "is-error" : ""}" role="status" aria-live="polite">${statusBadge(status)}<p>${escapeHtml(status.message)}</p>${status.checkedAt ? `<small>检查时间 · ${escapeHtml(status.checkedAt)}</small>` : ""}</div>`;
  if (sourceId === "free") {
    return `<div class="data-connector-copy"><h4>免费延迟模式检查</h4><p>无需账户、API Key 或行情订阅。检查按钮只确认公开数据服务是否正常，不会把延迟行情标记为实时行情。</p></div>${message}<button class="button primary" type="button" data-check-source="free">检查免费数据</button>`;
  }
  if (sourceId === "ibkr") {
    return `<div class="data-connector-copy"><h4>IBKR · TWS / IB Gateway</h4><p>先在本机客户端启用只读接口。网页只提交本机地址、端口和连接编号（Client ID）；不接收 IBKR 用户名或密码。</p><p><a class="text-link" href="https://www.interactivebrokers.com/campus/ibkr-api-page/twsapi-doc/" target="_blank" rel="noopener noreferrer">安装官方 TWS API Python 客户端 →</a></p></div>${message}
      <form class="data-connector-form" data-broker-form="ibkr" data-source-form="ibkr">
        <label>本机地址<input name="host" value="127.0.0.1" readonly></label>
        <label>Socket 端口<input name="port" type="number" min="1" max="65535" value="7497" required><small>纸面账户通常为7497；实盘TWS通常为7496，以客户端设置为准。</small></label>
        <label>连接编号（Client ID）<input name="clientId" type="number" min="0" max="999999" value="18" required aria-describedby="ibkr-client-id-help"><small id="ibkr-client-id-help">用于区分同一台电脑上的多个接口连接；如果没有冲突，保留默认值 18。</small></label>
        <label>指定账户（可选）<input name="accountId" autocomplete="off" placeholder="多账户时填写，例如 U1234567"><small>留空时只接受单一账户；检测到多个账户会要求你指定。</small></label>
        <button class="button primary" type="submit">同步只读持仓</button>
      </form>`;
  }
  if (sourceId === "qmt") {
    return `<div class="data-connector-copy"><h4>QMT / miniQMT · xtquant</h4><p>适用于已向国内券商开通 QMT 权限的账户。先以极简模式登录 miniQMT，再填写本机 userdata_mini 路径与资金账号。</p></div>${message}
      <form class="data-connector-form" data-broker-form="qmt" data-source-form="qmt">
        <label>userdata_mini 目录<input name="qmtPath" placeholder="D:\\券商QMT\\userdata_mini" required></label>
        <label>资金账号<input name="accountId" autocomplete="off" required><small>只用于本次本机查询；前端不持久化账号。</small></label>
        <label>账户类型<select name="accountType"><option value="STOCK">普通股票</option><option value="CREDIT">信用账户</option></select></label>
        <button class="button primary" type="submit">同步只读持仓</button>
      </form>`;
  }
  if (sourceId === "ifind") {
    return `<div class="data-connector-copy"><h4>同花顺 iFinD / QuantAPI</h4><p>官方公开接口适合行情、历史数据和研究数据。它不读取普通同花顺客户端的券商账户持仓，因此这里不提供“连接账户”按钮；国内持仓请使用券商QMT通道。</p></div>${message}`;
  }
  const source = DATA_SOURCE_CATALOG.find(({ id }) => id === sourceId);
  return `<div class="data-connector-copy"><h4>${escapeHtml(source?.name)} · 后续开放</h4><p>券商连接与自动交易仍在搭建。当前版本只展示接入路线，不收集账户、端口、API Key，也不会发送任何交易指令。</p></div>${message}<div class="data-roadmap-steps"><span>01 · 行情只读</span><span>02 · 模拟订单</span><span>03 · 用户确认下单</span><span>04 · 风控后有限自动化</span></div>`;
}

function renderNewsCredentialCard(providerId, title, environmentName, description, documentationUrl, status = {}) {
  const normalizedStatus = status?.state ? status : {
    providerId,
    configured: false,
    state: "not-configured",
    source: "none",
    message: `尚未配置 ${environmentName}。`,
  };
  const sourceLabel = normalizedStatus.source === "environment"
    ? "环境变量"
    : normalizedStatus.source === "local-user-config"
      ? "本机用户配置"
      : "未保存";
  return `<article class="news-credential-card" data-news-provider="${providerId}">
    <header><div><p class="eyebrow">${escapeHtml(environmentName)}</p><h4>${escapeHtml(title)}</h4></div>${statusBadge(normalizedStatus)}</header>
    <p>${escapeHtml(description)}</p>
    <div class="news-credential-source"><span>凭证来源</span><strong>${escapeHtml(sourceLabel)}</strong></div>
    <p class="news-credential-message" role="status">${escapeHtml(normalizedStatus.message)}</p>
    <form class="data-connector-form news-credential-form" data-news-credential-form="${providerId}">
      <label class="news-credential-username sr-only">供应商标识<input name="credentialProvider" type="text" autocomplete="username" value="${providerId}" readonly tabindex="-1" aria-hidden="true"></label>
      <label>API Key<input name="apiKey" type="password" autocomplete="new-password" spellcheck="false" required minlength="8" maxlength="512" placeholder="粘贴 ${escapeHtml(environmentName)}"></label>
      <button class="button primary" type="submit">保存并检查</button>
    </form>
    <a class="text-link" href="${escapeHtml(documentationUrl)}" target="_blank" rel="noopener noreferrer">查看官方接口说明 →</a>
  </article>`;
}

function renderNewsCredentialCenter(newsCredentials = {}) {
  return `<section class="news-credential-center" aria-labelledby="news-credential-title">
    <div class="data-source-section-heading"><div><p class="eyebrow">OPTIONAL MEDIA SOURCES</p><h3 id="news-credential-title">媒体新闻 API</h3></div><p>可选媒体源由每位用户填写自己的 Key。密钥提交到本机服务并保存在当前操作系统用户目录，不写入浏览器或开源仓库。</p></div>
    <div class="news-credential-grid">
      ${renderNewsCredentialCard("finnhub", "Finnhub · 美股公司新闻", "FINNHUB_API_KEY", "补充北美上市公司的公司级媒体新闻；未配置时 SEC 官方披露仍可独立更新。", "https://www.finnhub.io/docs/api/company-news", newsCredentials.finnhub)}
      ${renderNewsCredentialCard("gnews", "GNews · 中美媒体搜索", "GNEWS_API_KEY", "按公司名称补充中国与美国市场媒体报道；公开发布或商业使用需匹配相应订阅方案。", "https://docs.gnews.io/endpoints/search-endpoint", newsCredentials.gnews)}
    </div>
  </section>`;
}

export function renderDataSourceCenter({ preferences, statuses = {}, selectedSource = "free", newsCredentials = {} } = {}) {
  const selected = DATA_SOURCE_CATALOG.some(({ id }) => id === selectedSource) ? selectedSource : "free";
  const status = statusFor(selected, statuses);
  const serviceStatus = statuses.service || { state: "pending", message: "等待本地数据服务健康检查。" };
  return `<header class="workspace-intro data-source-intro">
    <div><p class="eyebrow">数据与账户连接</p><h2>数据源中心</h2><p>行情默认继续使用免费延迟数据；IBKR与QMT只读取账户持仓，不会下单。</p></div>
    <span class="structure-status">当前阶段：免费延迟数据 + 券商只读持仓</span>
  </header>
  <section class="data-service-health" aria-label="数据服务持续健康状态">
    <div><p class="eyebrow">CONTINUOUS HEALTH</p><h3>持续健康检查</h3></div>
    ${statusBadge(serviceStatus)}
    <p>${escapeHtml(serviceStatus.message || "每30秒检查本地服务，窗口重新获得焦点时立即复核。")}</p>
  </section>
  <section class="data-current-contract" aria-label="当前免费数据说明">
    <article><span>中国 A 股</span><strong>公开历史与延迟行情</strong><small>以交易日数据为主，延迟或收盘后更新</small></article>
    <article><span>美国股票</span><strong>公开延迟行情</strong><small>不承诺交易所全市场实时覆盖</small></article>
    <article><span>成交方向与密集区</span><strong>日常行情估算（OHLCV）</strong><small>只用于观察价格结构，不是真实逐笔成交或挂单墙</small></article>
  </section>
  ${renderNewsCredentialCenter(newsCredentials)}
  <section class="data-source-overview" aria-labelledby="data-source-overview-title">
    <div class="data-source-section-heading"><div><p class="eyebrow">SOURCE ROADMAP</p><h3 id="data-source-overview-title">行情与券商账户连接</h3></div><p>免费行情开箱即用；IBKR与QMT连接只读取持仓快照，并显示到总览。</p></div>
    <div class="data-source-grid">${renderSourceCards(statuses, selected)}</div>
  </section>
  <section class="data-routing" aria-labelledby="data-routing-title">
    <div class="data-source-section-heading"><div><p class="eyebrow">ACTIVE ROUTING</p><h3 id="data-routing-title">当前中美市场路由</h3></div><p>当前版本固定使用免费延迟模式，避免未完成的连接选项造成误解。</p></div>
    <div class="data-routing-grid">${renderRoutingMarket("china", "中国市场", preferences, statuses)}${renderRoutingMarket("united-states", "美国市场", preferences, statuses)}</div>
    <div class="free-fallback-note"><span aria-hidden="true">✓</span><div><strong>免费延迟模式已锁定</strong><p>数据暂时失败时显示最后更新时间和不可用状态，不用虚构数字补位，也不把估算订单流写成真实订单流。</p></div></div>
  </section>
  <section class="data-connector-panel" aria-labelledby="data-connector-title" data-active-source="${selected}">
    <div class="data-connector-heading"><p class="eyebrow">STAGE DETAILS</p><h3 id="data-connector-title">${escapeHtml(DATA_SOURCE_CATALOG.find(({ id }) => id === selected)?.name)}阶段说明</h3></div>
    <div class="data-connector-layout">${configurationForm(selected, status)}</div>
  </section>
  <aside class="data-security-note" aria-label="当前阶段边界"><strong>安全边界</strong><p>只读持仓同步；不接收券商密码、不保存资金账号、不提供下单端点。账户连接只允许本机 TWS / IB Gateway 或本机 QMT 客户端。</p></aside>`;
}
