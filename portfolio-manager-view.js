import { PORTFOLIO_MANAGERS, resolvePortfolioManager } from "./portfolio-managers.js";
import { normalizeAnalysisPreferences } from "./portfolio-analysis-profile.js";
import { buildManagerDecisionGeometry, managerContractFor, managerFactorContributions } from "./portfolio-manager-contract.js";

const RESEARCH_LABELS = Object.freeze({
  products: "产品与客户价值", moat: "护城河证据", marketPosition: "市场地位/份额", management: "管理层与资本配置",
  growthOutlook: "未来预期", valuation: "估值与回报前提", catalysts: "催化与里程碑", risks: "失败情景与风险",
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderManagerAvatar(manager) {
  if (manager.avatarSrc) {
    return `<img class="manager-avatar" width="48" height="48" src="${escapeHtml(manager.avatarSrc)}" alt="${escapeHtml(`${manager.name}头像`)}">`;
  }
  return `<span class="manager-avatar" aria-hidden="true">${escapeHtml(manager.initials)}</span>`;
}

export function renderPortfolioManagerPanel(managerId, options = {}) {
  const manager = resolvePortfolioManager(managerId);
  const contract = managerContractFor(manager.id);
  const geometry = buildManagerDecisionGeometry(manager.id);
  const insight = options.insight || null;
  const preferences = normalizeAnalysisPreferences(options);
  const factorContributions = managerFactorContributions(
    { macro: 20, timing: 20, sector: 20, sentiment: 20, technical: 20 },
    manager.id,
    preferences,
  );
  const optionsMarkup = PORTFOLIO_MANAGERS.map((candidate) => (
    `<option value="${escapeHtml(candidate.id)}"${candidate.id === manager.id ? " selected" : ""}>${escapeHtml(candidate.name)} · ${escapeHtml(candidate.methodName)}</option>`
  )).join("");
  const focus = manager.focus.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const renderSectors = (marketId) => insight?.preferredSectors?.[marketId]?.map((sector) => (
    `<li><strong>${escapeHtml(sector.label)}</strong><span>${sector.liveScore == null ? "轮动待更新" : `经理轮动 ${Number(sector.liveScore).toFixed(0)} 分`}</span>${sector.example ? `<small>行业示例 · ${escapeHtml(sector.example.name)}（${escapeHtml(sector.example.symbol)}）</small>` : ""}</li>`
  )).join("") || '<li class="manager-data-empty">载入行业偏好…</li>';
  const renderWatchlist = (marketId) => insight?.watchlists?.[marketId]?.map((item) => (
    `<li><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.symbol)}</span></li>`
  )).join("") || '<li class="manager-data-empty">载入观察标的…</li>';
  const sources = (manager.sources || []).map((source, index) => (
    `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">来源 ${index + 1} · ${escapeHtml(source.title)} · ${escapeHtml(source.authority || "待分类")}</a>`
  )).join("");
  const geometryRows = geometry.dataAxis.map((layer) => {
    const cells = geometry.decisionAxis.map((stage) => {
      const cell = geometry.cells.find((item) => item.dataLayer === layer.id && item.decisionStage === stage.id);
      const labels = { primary: "主证据", supporting: "辅助", context: "背景" };
      return `<td class="is-${escapeHtml(cell?.emphasis || "context")}"><span>${escapeHtml(labels[cell?.emphasis] || "背景")}</span></td>`;
    }).join("");
    return `<tr><th scope="row">${escapeHtml(layer.label)}</th>${cells}</tr>`;
  }).join("");
  return `<div class="manager-panel-top">
      <div class="manager-identity">
        ${renderManagerAvatar(manager)}
        <div>
          <span>当前投资经理 · ${escapeHtml(options.portfolioName || "当前组合")}</span>
          <strong>${escapeHtml(manager.name)}</strong>
          <small>${escapeHtml(manager.methodName)} · ${escapeHtml(manager.horizon)}</small>
        </div>
      </div>
      <div class="method-fit"><strong>为什么可能适合你的目标与风险</strong><p>${escapeHtml(manager.fit)}</p><small>这是研究偏好匹配，不是适当性建议。</small></div>
      <div class="manager-preference-controls" aria-label="组合分析偏好">
        <label for="manager-target-return"><span>目标年化回报</span><output for="manager-target-return" data-manager-target-return-output>${preferences.targetReturn}%</output><input id="manager-target-return" data-manager-target-return type="range" min="0" max="100" step="1" value="${preferences.targetReturn}" style="--manager-range:${preferences.targetReturn}%"${options.disabled ? " disabled" : ""}></label>
        <label for="manager-risk-capacity"><span>风险承担能力</span><output for="manager-risk-capacity" data-manager-risk-capacity-output>${preferences.riskCapacity}</output><input id="manager-risk-capacity" data-manager-risk-capacity type="range" min="0" max="100" step="1" value="${preferences.riskCapacity}" style="--manager-range:${preferences.riskCapacity}%"${options.disabled ? " disabled" : ""}></label>
      </div>
      <label class="manager-select-field" for="portfolio-manager-select">
        <span>切换投资经理</span>
        <select id="portfolio-manager-select" data-portfolio-manager-select aria-describedby="portfolio-manager-method"${options.disabled ? " disabled" : ""}>${optionsMarkup}</select>
      </label>
    </div>
    <section class="method-onboarding" aria-labelledby="method-onboarding-title">
      <div><span>第一次选择？</span><strong id="method-onboarding-title">遇到市场下跌，你更自然的反应是什么？</strong><small>用生活化偏好缩小研究方法范围；不判断你是否适合买卖任何证券。</small></div>
      <div class="method-onboarding-options">
        <button type="button" data-method-recommendation="marks">先少犯错，等风险回报更划算</button>
        <button type="button" data-method-recommendation="buffett">重看生意，价格越低越想深入研究</button>
        <button type="button" data-method-recommendation="lynch">检查成长故事有没有被数字证伪</button>
        <button type="button" data-method-recommendation="soros">承认趋势变了，先缩仓再复盘</button>
      </div>
    </section>
    <p class="method-standing-boundary"><strong>${escapeHtml(manager.methodName)}</strong> · ${escapeHtml(manager.sourceLabel)} · 公开方法论映射 · 非本人观点 · 非授权 · 非真实持仓 · 非收益承诺</p>
    <details class="manager-workbench-details">
      <summary><span>专业研究层</span><strong>查看完整方法、行业偏好与观察池</strong><small>人物仅作为公开方法论来源</small></summary>
      <div class="manager-difference-grid">
      <section aria-labelledby="manager-style-heading">
        <span class="manager-section-kicker">INVESTMENT DNA</span>
        <h3 id="manager-style-heading">${escapeHtml(manager.methodName)}怎么投</h3>
        <p class="manager-method" id="portfolio-manager-method">${escapeHtml(manager.mandate)}</p>
        <ul class="manager-focus" aria-label="经理核心关注点">${focus}</ul>
        <details class="manager-contract-details">
          <summary>查看统一决策契约</summary>
          <dl>
            <div><dt>投资范围</dt><dd>${contract.universe.assetClasses.map(escapeHtml).join("、")} · ${contract.universe.markets.map(escapeHtml).join(" / ")}</dd></div>
            ${contract.methodologyBoundary ? `<div><dt>适用边界</dt><dd>${escapeHtml(contract.methodologyBoundary)}</dd></div>` : ""}
            <div><dt>决策节奏</dt><dd>${escapeHtml(contract.decisionCadence)}</dd></div>
            <div><dt>证据闸门</dt><dd>关键财务字段一手来源 + 双源核验；差异 &gt;1% 阻断买入</dd></div>
            <div><dt>复核节奏</dt><dd>${escapeHtml(contract.monitoringPolicy.reviewCadence)}</dd></div>
          </dl>
          <h4>五层因子贡献</h4>
          <ul class="manager-factor-contributions">${factorContributions.map((factor) => `<li><span>${escapeHtml(factor.label)}</span><i aria-hidden="true"><b style="--manager-factor:${factor.weight}%"></b></i><strong>${factor.weight.toFixed(1)}%</strong><small>基础 ${factor.baseWeight}% × 偏置 ${factor.bias.toFixed(2)}</small></li>`).join("")}</ul>
          <ol class="manager-process-rail" aria-label="基金经理五步评判流程">${contract.decisionProcess.map((step) => `<li><strong>${escapeHtml(step.label)}</strong><span>${escapeHtml(step.description)}</span></li>`).join("")}</ol>
          <h4>完整公司研究问题</h4>
          <ol class="manager-company-questions">${contract.researchQuestions.map(({ id, question }) => `<li><strong>${escapeHtml(RESEARCH_LABELS[id] || id)}</strong><span>${escapeHtml(question)}</span></li>`).join("")}</ol>
          <section class="manager-geometry" aria-labelledby="manager-geometry-heading">
            <h4 id="manager-geometry-heading">三源融合研究矩阵</h4>
            <p>InvestorSkills 定义人物骨架；Augur 解释因子差异；AI Berkshire 执行证据闸门。</p>
            <div class="manager-geometry-scroll"><table><thead><tr><th scope="col">数据纵轴</th>${geometry.decisionAxis.map((stage) => `<th scope="col">${escapeHtml(stage.label)}</th>`).join("")}</tr></thead><tbody>${geometryRows}</tbody></table></div>
            <small>主证据决定该经理的核心判断，辅助证据用于校验，背景数据保持为真实事实且不因切换经理而改变。</small>
          </section>
        </details>
      </section>
      <section aria-labelledby="manager-sector-heading">
        <span class="manager-section-kicker">SECTOR BIAS</span>
        <h3 id="manager-sector-heading">方法论优先研究行业</h3>
        <div class="manager-sector-market-grid">
          <div><h4>A股偏好</h4><ul class="manager-preference-list">${renderSectors("china")}</ul></div>
          <div><h4>美股偏好</h4><ul class="manager-preference-list">${renderSectors("united-states")}</ul></div>
        </div>
      </section>
      <section aria-labelledby="manager-watchlist-heading">
        <span class="manager-section-kicker">METHODOLOGY WATCHLIST</span>
        <h3 id="manager-watchlist-heading">方法论观察标的</h3>
        <div class="manager-watchlist-grid">
          <div><h4>A股观察池</h4><ul class="manager-preference-list">${renderWatchlist("china")}</ul></div>
          <div><h4>美股观察池</h4><ul class="manager-preference-list">${renderWatchlist("united-states")}</ul></div>
        </div>
      </section>
      <section class="manager-macro-card" aria-labelledby="manager-macro-heading">
        <span class="manager-section-kicker">LIVE MACRO LENS · ${escapeHtml(insight?.macro?.asOf || "数据待更新")}</span>
        <h3 id="manager-macro-heading">当前宏观判断 · ${escapeHtml(insight?.macro?.headline || "等待宏观数据")}</h3>
        <p>${escapeHtml(insight?.macro?.summary || "宏观与市场择时数据载入后，将按该经理的方法论生成判断。")}</p>
      </section>
      </div>
      <footer class="manager-panel-footer">
        <p class="manager-disclaimer"><strong>边界：</strong>以上行业、标的与判断是基于公开资料和当前数据的系统方法论映射，不是本人实时观点、真实持仓或投资承诺。</p>
        ${sources ? `<nav class="manager-source-links" aria-label="${escapeHtml(manager.name)}方法论来源">${sources}</nav>` : ""}
      </footer>
    </details>`;
}

export function renderManagerHoldingsReview(insight) {
  const manager = insight?.manager;
  const holdings = insight?.holdings || [];
  if (!manager || !holdings.length) return "";
  const cards = holdings.map((holding) => {
    const tone = holding.profit > 0 ? "gain" : holding.profit < 0 ? "loss" : "neutral";
    const sign = holding.profit > 0 ? "+" : "";
    const money = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(holding.profit);
    return `<article class="manager-holding-card">
      <header><div><strong>${escapeHtml(holding.name)}</strong><span>${escapeHtml(holding.symbol)} · ${escapeHtml(holding.sector)}</span></div><em>${escapeHtml(holding.verdict)}</em></header>
      <p>${escapeHtml(holding.evidence)}</p>
      <dl><div><dt>建仓收益</dt><dd class="${tone}">${sign}${money} · ${sign}${Number(holding.returnRate).toFixed(2)}%</dd></div><div><dt>证据等级</dt><dd>${escapeHtml(holding.evidenceGrade)}级</dd></div><div><dt>公司研究</dt><dd>${Number(holding.researchCoverage?.completed || 0)}/${Number(holding.researchCoverage?.total || 8)} 维${holding.researchConnected ? "已连接" : "载入中"}</dd></div><div><dt>投资论文</dt><dd>${holding.thesisHealth.score == null ? escapeHtml(holding.thesisHealth.label) : `${holding.thesisHealth.score}/10 · ${escapeHtml(holding.thesisHealth.label)}`}</dd></div></dl>
      <footer><strong>${escapeHtml(manager.name)}的建议</strong><span>${escapeHtml(holding.advice)}</span></footer>
    </article>`;
  }).join("");
  const review = insight.portfolioReview || {};
  const topWeight = review.topPositionWeight == null ? "待建仓" : `${Number(review.topPositionWeight).toFixed(1)}%`;
  return `<div class="manager-review-heading"><div><span>MANAGER HOLDINGS REVIEW</span><h3>${escapeHtml(manager.name)}对当前持仓的评价</h3></div><small>评价随经理与最新宏观、择时、板块和行情数据更新</small></div>
    <dl class="manager-portfolio-review"><div><dt>复核节奏</dt><dd>${escapeHtml(review.reviewCadence || manager.monitoringPolicy.reviewCadence)}</dd></div><div><dt>论文基线</dt><dd>${Number(review.thesisBaselineCount || 0)}/${Number(review.positionCount || 0)} 个持仓已建立</dd></div><div><dt>最大持仓</dt><dd>${escapeHtml(review.topPositionSymbol || "--")} · ${escapeHtml(topWeight)} · ${escapeHtml(review.concentrationLabel || "待检查")}</dd></div><div><dt>机会成本</dt><dd>${escapeHtml(review.opportunityCostPrompt || "比较现金与最高确信度候选")}</dd></div></dl>
    <div class="manager-holding-grid">${cards}</div>
    <p class="manager-review-disclaimer">系统方法论映射，仅用于研究；不代表该投资人物本人观点，不构成个性化投资建议。</p>`;
}
