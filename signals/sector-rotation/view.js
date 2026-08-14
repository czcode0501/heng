const RANGE_OPTIONS = [
  { id: "1m", label: "1个月", points: 22 },
  { id: "3m", label: "3个月", points: 66 },
  { id: "6m", label: "6个月", points: 132 },
  { id: "1y", label: "1年", points: 260 },
];

const DIMENSIONS = [
  { id: "relativeMomentum", label: "相对动量", weight: 30, note: "相对基准的 5/20/60/120 日表现" },
  { id: "trendQuality", label: "趋势质量", weight: 25, note: "均线排列、斜率与价格位置" },
  { id: "breadth", label: "市场宽度", weight: 15, note: "上涨参与面与趋势一致性代理" },
  { id: "capitalFlow", label: "资金确认", weight: 15, note: "去重后的价格位置、方向与量能确认" },
  { id: "riskEfficiency", label: "风险效率", weight: 10, note: "收益、波动与回撤的性价比" },
  { id: "macroFit", label: "宏观适配", weight: 5, note: "首版为中性占位，后续连接宏观信号" },
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function marketMeta(id) {
  return id === "china"
    ? { code: "CN", english: "CHINA EQUITIES", className: "china" }
    : { code: "US", english: "UNITED STATES EQUITIES", className: "united-states" };
}

function signed(value, suffix = "") {
  const number = Number(value) || 0;
  return `${number > 0 ? "+" : ""}${number.toFixed(1)}${suffix}`;
}

function rangeName(range) {
  return RANGE_OPTIONS.find(({ id }) => id === range)?.label || "3个月";
}

export function selectSectorRange(history, range = "3m") {
  const points = (Array.isArray(history) ? history : [])
    .map(({ date, value }) => ({ date: String(date || "").slice(0, 10), value: Number(value) }))
    .filter(({ date, value }) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value))
    .sort((left, right) => left.date.localeCompare(right.date));
  const count = RANGE_OPTIONS.find(({ id }) => id === range)?.points || 66;
  return points.slice(-count);
}

export function getSectorRotationChartPoint(points, ratio) {
  if (!Array.isArray(points) || !points.length) return null;
  const safeRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
  const index = Math.round(safeRatio * (points.length - 1));
  const point = points[index];
  const base = Number(points[0].value);
  return {
    index,
    date: point.date,
    value: Number(point.value),
    changePercent: Number((base ? (Number(point.value) / base - 1) * 100 : 0).toFixed(2)),
  };
}

function chartGeometry(points, width = 520, height = 132) {
  if (points.length < 2) return { path: "", normalized: [] };
  const base = points[0].value || 1;
  const normalized = points.map(({ date, value }) => ({ date, value: Number((value / base * 100).toFixed(4)) }));
  const values = normalized.map(({ value }) => value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const path = normalized.map(({ value }, index) => {
    const x = index / (normalized.length - 1) * width;
    const y = height - (value - low) / span * height;
    return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  return { path, normalized };
}

function renderHeader(status, checkedAt) {
  return `<a class="back-link" href="#signals">← 返回模型信号目录</a>
    <header class="signal-detail-header sector-detail-header">
      <div><p class="eyebrow">SECTOR ROTATION</p><h2>板块轮动</h2><p>中国股票与美国股票独立排名。模型把相对强弱、趋势、资金确认和风险压缩成可追溯的轮动阶段、操作建议与目标权重。</p></div>
      <div class="sector-header-actions"><span class="quality-status ${status === "数据通过" ? "passed" : ""}">${escapeHtml(status)}</span><button class="button secondary" type="button" data-refresh-sector-rotation>刷新数据</button><small>${escapeHtml(checkedAt)}</small></div>
    </header>`;
}

function renderControls(range) {
  return `<section class="sector-control-bar" aria-label="板块轮动控制">
    <div><span>MODEL PROFILE</span><strong>平衡型 · 六维评分</strong><small>当前时间范围仅改变详情走势图；排名采用统一的 5/20/60/120 日模型。</small></div>
    <div class="sector-range-control" role="group" aria-label="走势图时间范围">${RANGE_OPTIONS.map(({ id, label }) => `<button type="button" data-sector-range="${id}" aria-pressed="${range === id}">${label}</button>`).join("")}</div>
  </section>`;
}

function renderSummary(market) {
  const meta = marketMeta(market.id);
  if (!market.summary || !market.timing) return renderUnavailable(market);
  const liveClass = market.status === "live" ? "live" : "stale";
  return `<article class="sector-summary-card ${meta.className}">
    <header><span class="market-code">${meta.code}</span><div><small>${meta.english}</small><h3>${escapeHtml(market.title)}</h3></div><em class="${liveClass}">${market.status === "live" ? "实时模型" : "缓存模型"}</em></header>
    <div class="sector-summary-score"><div><span>市场择时</span><strong>${Number(market.timing.score).toFixed(1)}</strong><em>${escapeHtml(market.timing.regime)}</em></div><dl><div><dt>最大风险仓位</dt><dd>${Number(market.timing.maxExposure).toFixed(0)}%</dd></div><div><dt>模型已分配</dt><dd>${Number(market.summary.allocated).toFixed(1)}%</dd></div><div><dt>保留现金</dt><dd>${Number(market.summary.cash).toFixed(1)}%</dd></div></dl></div>
    <p>${escapeHtml(market.summary.message)}</p>
    <footer><span><b>领跑</b>${escapeHtml(market.summary.leader || "--")}</span><span><b>修复</b>${escapeHtml(market.summary.repairing || "--")}</span><span><b>转弱</b>${escapeHtml(market.summary.weakening || "--")}</span></footer>
  </article>`;
}

function renderRotationMap(market) {
  const sectors = market.sectors || [];
  return `<section class="sector-rotation-map" aria-label="${escapeHtml(market.title)}当前轮动地图">
    <header><div><span>ROTATION MAP</span><h4>当前轮动地图</h4></div><p>横轴：相对动量 · 纵轴：得分变化</p></header>
    <div class="sector-map-canvas">
      <i class="sector-map-axis horizontal"></i><i class="sector-map-axis vertical"></i>
      <span class="quadrant top-left">修复</span><span class="quadrant top-right">领先</span><span class="quadrant bottom-left">落后</span><span class="quadrant bottom-right">转弱</span>
      ${sectors.map((sector) => {
        const x = Math.max(4, Math.min(96, Number(sector.dimensions?.relativeMomentum) || 50));
        const y = Math.max(7, Math.min(93, 50 - (Number(sector.scoreChange) || 0) * 8));
        return `<button type="button" class="sector-map-dot ${escapeHtml(sector.phase?.tone || "neutral")}" style="--map-x:${x}%;--map-y:${y}%" data-sector-select="${escapeHtml(sector.id)}" data-sector-market="${escapeHtml(market.id)}" title="${escapeHtml(sector.title)} · ${Number(sector.score).toFixed(1)}分"><span>${escapeHtml(sector.title)}</span></button>`;
      }).join("")}
    </div>
  </section>`;
}

function rankChange(sector) {
  const value = Number(sector.rankChange) || 0;
  if (!value) return `<span class="rank-flat">—</span>`;
  return `<span class="rank-${value > 0 ? "up" : "down"}">${value > 0 ? "↑" : "↓"}${Math.abs(value)}</span>`;
}

function renderRanking(market, activeId) {
  return `<section class="sector-ranking" aria-labelledby="sector-ranking-${escapeHtml(market.id)}">
    <header><div><span>RANKING</span><h4 id="sector-ranking-${escapeHtml(market.id)}">轮动排名</h4></div><p>点击任一板块查看走势与六维证据</p></header>
    <div class="sector-table-wrap"><table><thead><tr><th>排名</th><th>板块</th><th>综合分</th><th>20日</th><th>阶段</th><th>建议</th><th>目标权重</th><th></th></tr></thead><tbody>
      ${(market.sectors || []).map((sector) => `<tr class="${activeId === sector.id ? "active" : ""}">
        <td><strong class="rank-number">${sector.rank}</strong>${rankChange(sector)}</td>
        <td><b>${escapeHtml(sector.title)}</b><small>${escapeHtml(sector.symbol)}</small></td>
        <td><strong>${Number(sector.score).toFixed(1)}</strong><small class="${Number(sector.scoreChange) >= 0 ? "positive" : "negative"}">${signed(sector.scoreChange)}</small></td>
        <td class="${Number(sector.returns?.["20d"]) >= 0 ? "positive" : "negative"}">${signed(sector.returns?.["20d"], "%")}</td>
        <td><span class="sector-phase ${escapeHtml(sector.phase?.tone || "neutral")}">${escapeHtml(sector.phase?.label)}</span></td>
        <td><b>${escapeHtml(sector.action?.label)}</b></td>
        <td><strong>${Number(sector.targetWeight).toFixed(1)}%</strong></td>
        <td><button type="button" data-sector-select="${escapeHtml(sector.id)}" data-sector-market="${escapeHtml(market.id)}" aria-label="查看${escapeHtml(sector.title)}详情">查看</button></td>
      </tr>`).join("")}
    </tbody></table></div>
  </section>`;
}

function renderDetail(market, sector, range) {
  if (!sector) return "";
  const points = selectSectorRange(sector.history, range);
  const { path, normalized } = chartGeometry(points);
  const start = points[0];
  const end = points.at(-1);
  const periodChange = start?.value ? (end.value / start.value - 1) * 100 : 0;
  return `<section class="sector-evidence" aria-labelledby="sector-evidence-${escapeHtml(market.id)}">
    <header class="sector-evidence-header"><div><span>SECTOR EVIDENCE · ${rangeName(range)}</span><h4 id="sector-evidence-${escapeHtml(market.id)}">${escapeHtml(sector.title)} · 六维证据</h4><p>${escapeHtml(sector.instrument)} · ${escapeHtml(sector.symbol)} · 截至 ${escapeHtml(market.asOf)}</p></div><div><strong>${Number(sector.score).toFixed(1)}</strong><em>${escapeHtml(sector.phase?.label)} · ${escapeHtml(sector.action?.label)}</em><small>置信度 ${Number(sector.confidence).toFixed(0)}%</small></div></header>
    <div class="sector-evidence-grid">
      <figure class="sector-history-chart">
        <figcaption><div><span>区间走势（起点归一为 100）</span><strong class="${periodChange >= 0 ? "positive" : "negative"}">${signed(periodChange, "%")}</strong></div><small>鼠标移动或使用左右方向键查看具体日期</small></figcaption>
        <div class="sector-chart-shell"><svg viewBox="0 0 520 132" role="application" tabindex="0" data-sector-chart data-chart-points="${escapeHtml(JSON.stringify(points))}" aria-label="${escapeHtml(sector.title)}交互式走势图"><path class="sector-chart-line" d="${path}"></path><line class="sector-chart-cursor" x1="0" x2="0" y1="0" y2="132"></line><circle class="sector-chart-dot" cx="0" cy="0" r="4"></circle><rect class="sector-chart-hit-zone" width="520" height="132"></rect></svg><div class="sector-chart-tooltip" role="status" aria-live="polite" hidden><strong>--</strong><span>--</span><em>--</em></div></div>
        <footer><span>${escapeHtml(start?.date || "--")}</span><span>${normalized.length} 个交易日</span><span>${escapeHtml(end?.date || "--")}</span></footer>
      </figure>
      <div class="sector-dimension-list">${DIMENSIONS.map((dimension) => {
        const score = Number(sector.dimensions?.[dimension.id]) || 0;
        return `<article><header><span>${dimension.label}<small>${dimension.weight}%</small></span><strong>${score.toFixed(0)}</strong></header><div><i style="width:${Math.max(0, Math.min(100, score))}%"></i></div><p>${dimension.note}${dimension.id === "macroFit" ? " · 中性占位" : ""}</p></article>`;
      }).join("")}</div>
    </div>
    <footer class="sector-detail-facts"><span><b>5日</b>${signed(sector.returns?.["5d"], "%")}</span><span><b>20日</b>${signed(sector.returns?.["20d"], "%")}</span><span><b>60日</b>${signed(sector.returns?.["60d"], "%")}</span><span><b>120日</b>${signed(sector.returns?.["120d"], "%")}</span><span><b>目标权重</b>${Number(sector.targetWeight).toFixed(1)}%</span></footer>
  </section>`;
}

function renderChinaAuxiliary(market) {
  if (market.id !== "china") return "";
  const mappings = [
    ["financials", "券商 β", "金融板块作为风险偏好代理"],
    ["information-technology", "半导体主线", "信息技术作为成长主线代理"],
    ["health-care", "创新药分母", "医药卫生作为创新药景气代理"],
  ];
  return `<section class="sector-auxiliary"><header><div><span>AUXILIARY EVIDENCE</span><h4>中国市场三条辅助线索</h4></div><p>不单独决定排名，用于解释主模型</p></header><div>${mappings.map(([id, title, note]) => {
    const sector = market.sectors?.find((item) => item.id === id);
    return `<article><span>${title}</span><strong>${sector ? Number(sector.score).toFixed(1) : "--"}</strong><em>${escapeHtml(sector?.phase?.label || "等待数据")}</em><p>${note}</p></article>`;
  }).join("")}</div></section>`;
}

function renderUnavailable(market) {
  const meta = marketMeta(market.id);
  return `<article class="sector-summary-card ${meta.className} unavailable"><header><span class="market-code">${meta.code}</span><div><small>${meta.english}</small><h3>${escapeHtml(market.title)}</h3></div><em>连接失败</em></header><p>${escapeHtml(market.dataQuality?.issues?.[0] || "免费数据源暂时不可用，系统不会用演示数字替代真实行情。")}</p></article>`;
}

function renderMarketWorkspace(market, activeId, range) {
  if (!market?.sectors?.length) return "";
  const active = market.sectors.find(({ id }) => id === activeId) || market.sectors[0];
  const meta = marketMeta(market.id);
  return `<article class="sector-market-workspace ${meta.className}">
    <header class="sector-market-title"><div><span>${meta.code}</span><div><small>${meta.english}</small><h3>${escapeHtml(market.title)} · 完整轮动</h3></div></div><p>${escapeHtml(market.source?.name)} · ${escapeHtml(market.source?.access)} · ${escapeHtml(market.asOf)}</p></header>
    <div class="sector-market-overview">${renderRotationMap(market)}${renderRanking(market, active.id)}</div>
    ${renderDetail(market, active, range)}${renderChinaAuxiliary(market)}
    <p class="sector-source-note">数据说明：${escapeHtml(market.source?.notes || "公开收盘日线代理")} 板块轮动为研究模型，不构成投资建议。</p>
  </article>`;
}

export function getSectorRotationRefreshDelay(payload) {
  return Math.max(60, Number(payload?.refreshAfterSeconds) || 1800) * 1000;
}

export function renderSectorRotationWorkspaceLoading() {
  return `${renderHeader("正在连接免费数据源", "--")}<section class="sector-loading" aria-busy="true"><strong>正在构建中美板块轮动</strong><p>读取 22 个板块代理、计算六维得分、排名与目标仓位。</p></section>`;
}

export function renderSectorRotationWorkspaceError(message) {
  return `${renderHeader("数据连接失败", "--")}<section class="sector-page-error" role="alert"><strong>暂时无法构建板块轮动</strong><p>${escapeHtml(message)}</p><small>不会用随意编写的数字替代真实数据。点击“刷新数据”可再次检查。</small></section>`;
}

export function renderSectorRotationWorkspace(payload, options = {}) {
  const markets = Array.isArray(payload?.markets) ? payload.markets : [];
  const range = options.range || "3m";
  const activeSectors = options.activeSectors || {};
  const liveCount = markets.filter(({ status }) => status === "live").length;
  const status = liveCount === markets.length ? "数据通过" : liveCount ? "部分数据可用" : "等待可用数据";
  const generated = new Date(payload?.generatedAt);
  const checkedAt = Number.isNaN(generated.getTime()) ? "--" : `最近检查 ${generated.toLocaleString("zh-CN", { hour12: false })}`;
  return `${renderHeader(status, checkedAt)}${renderControls(range)}
    <section class="sector-summary-grid" aria-label="中美板块轮动摘要">${markets.map(renderSummary).join("")}</section>
    <section class="sector-method-note"><strong>模型顺序</strong><span>市场择时决定总风险仓位</span><i>→</i><span>六维模型排列板块强弱</span><i>→</i><span>最多配置前三名，单板块上限 30%</span></section>
    <section class="sector-workspace-list">${markets.map((market) => renderMarketWorkspace(market, activeSectors[market.id], range)).join("")}</section>
    <p class="sector-license-note">默认数据模式无需 API Key，适合本地研究与开源预览。Yahoo Finance 与 BaoStock 的公开接口可用性和授权边界可能变化，商业部署应替换为正式授权数据源。</p>`;
}
