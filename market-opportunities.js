import { PORTFOLIO_MANAGERS, resolvePortfolioManager } from "./portfolio-managers.js";
import { managerLens } from "./portfolio-manager-methodology.js";

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function finite(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
const SECTOR_IDS = { 信息技术: "information-technology", 日常消费: "consumer-staples", 可选消费: "consumer-discretionary", 金融: "financials", 医疗保健: "health-care", 工业: "industrials", 公用事业: "utilities", 能源: "energy", 原材料: "materials" };

export function buildManagerOpportunityModel(payload, managerId) {
  const manager = resolvePortfolioManager(managerId);
  const lens = managerLens(manager.id);
  const generatedAt = Date.parse(payload?.generatedAt || "");
  const ageHours = Number.isFinite(generatedAt) ? Math.max(0, (Date.now() - generatedAt) / 3_600_000) : null;
  const rows = (Array.isArray(payload?.rows) ? payload.rows : []).filter((row) => !row.error && Number.isFinite(Number(row.score)));
  const ranked = rows.map((row) => {
    const preferred = lens.preferredSectorIds.includes(row.sectorId || SECTOR_IDS[row.sector] || row.sector);
    const actionBoost = row.action === "买入" ? 8 : row.action === "持有" ? 4 : row.action === "等待" ? 0 : -5;
    const riskBoost = Math.min(6, Math.max(-4, finite(row.riskReward) - 1) * 2);
    return { ...row, preferred, fitScore: finite(row.score) + actionBoost + (preferred ? 9 : 0) + riskBoost };
  }).sort((a, b) => b.fitScore - a.fitScore).slice(0, 6);
  return { manager, lens, generatedAt: payload?.generatedAt || null, scanDate: payload?.scanDate || null, ageHours, stale: ageHours == null || ageHours > 36, rows: ranked };
}

export function renderManagerFirstStep(managerId) {
  const selected = resolvePortfolioManager(managerId);
  const cards = PORTFOLIO_MANAGERS.map((manager) => {
    const avatar = manager.avatarSrc
      ? `<img src="${escapeHtml(manager.avatarSrc)}" alt="${escapeHtml(`${manager.name}头像`)}" width="56" height="56">`
      : `<span aria-hidden="true">${escapeHtml(manager.initials)}</span>`;
    return `<button class="manager-choice-card${manager.id === selected.id ? " is-selected" : ""}" type="button" data-manager-first-choice="${escapeHtml(manager.id)}" aria-pressed="${manager.id === selected.id}" aria-label="选择${escapeHtml(manager.name)}，${escapeHtml(manager.methodName)}">${avatar}<strong>${escapeHtml(manager.name)}</strong><small>${escapeHtml(manager.methodName)} · ${escapeHtml(manager.horizon)}</small><p>${escapeHtml(manager.fit)}</p><em>${manager.id === selected.id ? "当前选择" : "选择这位经理"}</em></button>`;
  }).join("");
  return `<div class="manager-first-heading"><div><p class="eyebrow">选择投资经理</p><h2>先选择你想采用的投资经理</h2><p>姓名是选择入口，投资方法和适合人群作为解释。切换经理会改变候选排序、等待条件与风险约束，但不会改变原始市场事实。</p></div><span>当前：${escapeHtml(selected.name)}</span></div><div class="manager-choice-grid">${cards}</div><p class="manager-choice-boundary">人物头像与姓名用于标识基于公开资料构建的方法论映射，不代表本人授权、真实持仓或实时推荐。</p>`;
}

export function renderManagerOpportunities(model, state = "ready") {
  const title = `${model.manager.methodName}方法 · 当前市场研究候选`;
  if (state === "loading") return `<div class="opportunity-heading"><div><p class="eyebrow">STEP 2 · MARKET SCAN</p><h2>正在读取市场扫描</h2></div></div><p class="opportunity-empty">正在检查最近一次全市场扫描结果…</p>`;
  if (state === "unavailable" || !model.generatedAt) return `<div class="opportunity-heading"><div><p class="eyebrow">STEP 2 · MARKET SCAN</p><h2>${escapeHtml(title)}</h2><p>当前没有可验证的全市场扫描结果，因此不生成假名单。</p></div><span class="opportunity-state is-missing">待扫描</span></div><div class="opportunity-empty"><strong>先生成一次真实扫描</strong><p>运行 <code>npm run scan:market</code>。完成后刷新本页，系统会按当前方法重新排序。</p></div>`;
  const cards = model.rows.map((row, index) => `<article class="opportunity-card"><header><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(row.name || row.symbol)}</strong><small>${escapeHtml(row.symbol)} · ${escapeHtml(row.market === "CN" ? "A股" : "美股")} · ${escapeHtml(row.sector || "行业待识别")}</small></div><em>${escapeHtml(row.action || "研究")}</em></header><p>${row.preferred ? `符合${escapeHtml(model.manager.methodName)}优先研究行业；` : "不属于该方法优先行业；"}${escapeHtml(row.label || "需继续核验公司事实与风险边界")}</p><dl><div><dt>扫描分</dt><dd>${finite(row.score).toFixed(1)}</dd></div><div><dt>参考买入</dt><dd>${row.entry == null ? "待形成" : finite(row.entry).toFixed(2)}</dd></div><div><dt>失效位</dt><dd>${row.invalidation == null ? "待形成" : finite(row.invalidation).toFixed(2)}</dd></div></dl><button class="text-link" type="button" data-opportunity-symbol="${escapeHtml(row.providerSymbol || row.symbol)}" data-opportunity-name="${escapeHtml(row.name || row.symbol)}" data-opportunity-market="${escapeHtml(row.market || "")}">查看完整分析 →</button></article>`).join("");
  return `<div class="opportunity-heading"><div><p class="eyebrow">STEP 2 · MARKET SCAN</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(model.lens.signature)}。候选先经过真实全市场初筛，再按方法偏好重排。</p></div><span class="opportunity-state ${model.stale ? "is-stale" : "is-fresh"}">${model.stale ? "扫描已过期" : "扫描可用"}</span></div>${cards ? `<div class="opportunity-grid">${cards}</div>` : '<p class="opportunity-empty">扫描完成，但没有满足当前研究条件的候选。</p>'}<footer class="opportunity-boundary">扫描日期 ${escapeHtml(model.scanDate || "待确认")} · ${model.rows.length} 项研究候选。候选不等于买入建议，仍需打开个股完成公司事实与证据闸门。</footer>`;
}
