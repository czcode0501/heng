import { getTrendPresentation } from "../../search-flow.js";
import { renderTechnicalChart } from "../micro-data/view.js";
import {
  buildStockDecision,
  HOLDING_PERIODS,
  holdingProfileForDays,
  holdingPeriodIndex,
  sliderPositionFromHoldingDays,
} from "./decision.js";

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatPrice(value, currency) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(finite(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatZone(level, currency) {
  if (!level) return "暂无可靠结构";
  const low = formatPrice(level.low, currency);
  const high = formatPrice(level.high, currency);
  return Math.abs(level.high - level.low) < 0.0001 ? low : `${low}–${high}`;
}

function renderDecisionLevel(level, { label, role, currency, tone }) {
  return `<article class="stock-decision-level ${tone}">
    <span>${escapeHtml(role)}</span>
    <strong>${escapeHtml(label)}</strong>
    <em>${escapeHtml(formatZone(level, currency))}</em>
    <small>${level ? escapeHtml(level.source) : "当前范围没有足够的VRVP成交节点，不生成虚假价位"}</small>
  </article>`;
}

function renderDecisionEvidence(decision) {
  const items = (decision.evidence || []).map((item) => `<article class="stock-decision-evidence-item ${escapeHtml(item.tone)}">
    <span>${escapeHtml(item.title)}</span>
    <strong>${escapeHtml(item.label)}</strong>
    <small>${escapeHtml(item.detail)}</small>
  </article>`).join("");
  return `<section class="stock-decision-evidence" aria-labelledby="stock-evidence-title">
    <header>
      <div><span>WHY THIS ADVICE</span><h4 id="stock-evidence-title">五层决策证据</h4></div>
      <p><strong>综合 ${decision.composite.score.toFixed(1)}</strong><small>数据覆盖 ${decision.composite.coverage}% · 置信度 ${escapeHtml(decision.composite.confidence)}</small></p>
    </header>
    <div class="stock-decision-evidence-grid">${items}</div>
    <p class="stock-evidence-method">${escapeHtml(decision.weightMethod)}。权重会随持有期限改变；板块资金已包含在轮动模型中，只展示证据，不重复加权。</p>
  </section>`;
}

function renderHoldingPeriodRail(holdingPeriod, holdingDays) {
  const selected = holdingDays != null
    ? holdingProfileForDays(holdingDays)
    : HOLDING_PERIODS[holdingPeriodIndex(holdingPeriod)];
  const sliderPosition = sliderPositionFromHoldingDays(selected.days);
  return `<section class="holding-period-control" aria-labelledby="holding-period-title">
    <div class="holding-period-heading">
      <div><span>HOLDING HORIZON</span><strong id="holding-period-title">计划持有多久？</strong><small>1–365天连续可调；拖动时只更新期限，停下后再重算完整建议，减少卡顿。</small></div>
      <output for="holding-period-slider" data-holding-period-output>${escapeHtml(selected.label)} · ${escapeHtml(selected.style)}</output>
    </div>
    <div class="holding-period-inputs">
      <input id="holding-period-slider" type="range" min="0" max="100" step="1" value="${sliderPosition}" data-holding-period-slider style="--holding-progress:${sliderPosition}%" aria-label="选择计划持有期限" aria-valuetext="${escapeHtml(selected.label)}，${escapeHtml(selected.style)}">
      <label class="holding-days-field"><span>自定义</span><input type="number" min="1" max="365" step="1" value="${selected.days}" data-holding-days-input aria-label="自定义持有天数"><em>天</em></label>
    </div>
    <div class="holding-period-ticks" aria-hidden="true">${HOLDING_PERIODS.map(({ label, days }) => `<span style="--holding-tick:${sliderPositionFromHoldingDays(days)}%">${escapeHtml(label)}</span>`).join("")}</div>
  </section>`;
}

const STOCK_CHART_RANGES = [
  ["1d", "1日"],
  ["1w", "1周"],
  ["1m", "1月"],
  ["3m", "3月"],
  ["1y", "1年"],
];

function renderStockChartRangeControl(selectedRange) {
  const selected = STOCK_CHART_RANGES.some(([id]) => id === selectedRange) ? selectedRange : "3m";
  return `<label class="stock-chart-range-control"><span>图表周期</span><select data-stock-chart-range aria-label="选择技术图表时间范围">${STOCK_CHART_RANGES.map(([id, label]) => `<option value="${id}"${id === selected ? " selected" : ""}>${label}</option>`).join("")}</select></label>`;
}

function formatBaseMoney(value, currency) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: currency || "CNY",
    maximumFractionDigits: 0,
  }).format(Math.max(0, finite(value)));
}

function floorToLot(value, lotSize) {
  const lot = Math.max(1, finite(lotSize, 1));
  return Math.max(0, Math.floor(finite(value) / lot) * lot);
}

function renderPositionSizing(decision, sizing = {}) {
  if (decision.action.verb !== "买入") {
    return `<section class="stock-position-plan is-waiting" aria-label="首笔建仓金额与股数">
      <div><span>买多少</span><strong>当前不新增仓位</strong><small>先等待动作转为“买入”，已有持仓继续按失效位管理。</small></div>
      <p>这是只读研究计划，不会自动提交券商订单。</p>
    </section>`;
  }

  const capital = finite(sizing.capital);
  const cash = finite(sizing.cash);
  const allocation = decision.allocationPlan;
  if (capital <= 0 || cash <= 0 || !allocation) {
    return `<section class="stock-position-plan is-pending" aria-label="首笔建仓金额与股数">
      <div><span>首笔计划金额</span><strong>暂不可计算</strong><small>填写现金余额或接入券商真实账户后，再换算金额和股数。</small></div>
      <p>不会猜测账户资金，也不会自动提交券商订单。</p>
    </section>`;
  }

  const baseCurrency = sizing.currency || "CNY";
  const rate = Math.max(0.000001, finite(sizing.stockToBaseRate, 1));
  const entryPrice = finite(decision.tradePlan.entry?.midpoint);
  const invalidation = decision.invalidation == null ? null : finite(decision.invalidation);
  const entryInBase = entryPrice * rate;
  const perShareRisk = invalidation == null ? 0 : Math.max(0, entryPrice - invalidation) * rate;
  const riskBudget = capital * finite(allocation.maxRiskPct) / 100;
  const riskLimitedAmount = perShareRisk > 0
    ? Math.floor(riskBudget / perShareRisk) * entryInBase
    : Number.POSITIVE_INFINITY;
  const exposureRoom = capital * Math.max(0, finite(sizing.targetExposurePct) - finite(sizing.currentExposurePct)) / 100;
  const singleStockCap = capital * 0.1;
  const executableRoom = Math.min(cash, exposureRoom, singleStockCap, riskLimitedAmount);

  if (entryInBase <= 0 || invalidation == null || perShareRisk <= 0 || executableRoom <= 0) {
    return `<section class="stock-position-plan is-pending" aria-label="首笔建仓金额与股数">
      <div><span>首笔计划金额</span><strong>当前没有可执行空间</strong><small>现金、目标仓位缺口或失效位风险已触及上限。</small></div>
      <p>调整资金与组合目标后再计算；不会自动提交券商订单。</p>
    </section>`;
  }

  const rawLowAmount = executableRoom * allocation.lowPct / 100;
  const rawHighAmount = executableRoom * allocation.highPct / 100;
  const lotSize = Math.max(1, finite(sizing.lotSize, 1));
  const highShares = floorToLot(rawHighAmount / entryInBase, lotSize);
  if (highShares < lotSize) {
    return `<section class="stock-position-plan is-pending" aria-label="首笔建仓金额与股数">
      <div><span>首笔计划金额</span><strong>低于最小交易单位</strong><small>当前风险预算不足以买入 ${lotSize} 股；先补充现金或等待更合适的买入价。</small></div>
      <p>不会用“0股”伪装成可执行计划，也不会自动提交券商订单。</p>
    </section>`;
  }
  const lowShares = Math.min(highShares, Math.max(lotSize, floorToLot(rawLowAmount / entryInBase, lotSize)));
  const lowAmount = lowShares * entryInBase;
  const highAmount = highShares * entryInBase;
  const source = escapeHtml(sizing.sourceLabel || "当前组合");

  return `<section class="stock-position-plan" aria-label="首笔建仓金额与股数">
    <div><span>首笔计划金额</span><strong>${escapeHtml(formatBaseMoney(lowAmount, baseCurrency))}–${escapeHtml(formatBaseMoney(highAmount, baseCurrency))}</strong><small>约 ${lowShares}–${Math.max(lowShares, highShares)} 股 · ${source} · 组合净值风险上限 ${allocation.maxRiskPct}%</small></div>
    <p>金额受现金、目标仓位缺口、单股上限与失效位风险共同约束；这是只读计划，不会自动提交券商订单。</p>
  </section>`;
}

export function renderStockDecisionDynamicMarkup(payload, options = {}) {
  const decision = buildStockDecision(payload, {
    ...(options.context || {}),
    holdingPeriod: options.holdingPeriod || payload.range || "3m",
    holdingDays: options.holdingDays,
  });
  const currency = payload.currency;
  const nearSupport = decision.levels.nearSupport;
  const nearResistance = decision.levels.nearResistance;
  const target = decision.tradePlan.target;
  const buyCondition = nearSupport
    ? `价格进入 ${formatZone(nearSupport, currency)} 后不再创新低，并重新站回该区域上沿，再考虑分批。`
    : "当前没有可靠的下方成交密集区，先等待新的价格结构形成。";
  const sellCondition = nearResistance
    ? `价格进入 ${formatZone(nearResistance, currency)} 时观察量能；无法放量突破可分批止盈，放量站稳则继续观察远端压力。`
    : "上方暂无可靠压力节点，不预设虚假目标；使用移动止盈保护已有收益。";
  const invalidation = decision.invalidation == null ? "暂无可靠失效位" : formatPrice(decision.invalidation, currency);
  const riskReward = decision.tradePlan.riskReward == null ? "暂不可计算" : `${decision.tradePlan.riskReward.toFixed(2)} : 1`;
  const expectedReturn = decision.tradePlan.expectedReturnPercent == null ? "暂不可计算" : `+${decision.tradePlan.expectedReturnPercent.toFixed(1)}%`;
  const expectedDownside = decision.tradePlan.downsidePercent == null ? "风险待确认" : `失效风险 -${decision.tradePlan.downsidePercent.toFixed(1)}%`;

  const missing = decision.manager.missingLabels.length ? decision.manager.missingLabels.join("、") : "当前关键证据已覆盖";
  const insight = options.context?.companyResearchInsight;
  const symbol = payload.providerSymbol || payload.symbol || "该公司";
  const researchSummary = insight
    ? `${insight.methodology} 当前公司研究结论为“${insight.verdict}”，研究分 ${Number(insight.score).toFixed(1)}；证据等级 ${insight.evidence?.grade || "C"}。`
    : "公司财务与新闻事实仍在载入；在证据完成前，只把行情结构作为观察信号，不把缺失数据按中性分填充。";
  const challenge = insight?.challenge || "哪些事实会推翻当前判断？在答案明确前，不用价格上涨替代基本面核验。";
  const managerLens = `<details class="stock-manager-lens-details">
    <summary><span>基金经理方法论</span><strong>${escapeHtml(decision.manager.name)} · ${escapeHtml(decision.manager.school)}</strong><small>展开查看经理结论、反方问题和证据覆盖</small></summary>
    <section class="stock-manager-lens" aria-labelledby="stock-manager-lens-title">
      <span class="manager-avatar" aria-hidden="true">${escapeHtml(decision.manager.initials)}</span>
      <div><span>基金经理方法论</span><strong id="stock-manager-lens-title">${escapeHtml(decision.manager.name)} · ${escapeHtml(decision.manager.school)}</strong><p>${escapeHtml(decision.manager.mandate)} · 目标年化 ${decision.analysisProfile.targetReturn}% · 风险 ${decision.analysisProfile.riskCapacity}/100</p></div>
      <ul aria-label="经理关注点">${decision.manager.focus.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      <article class="stock-manager-commentary">
        <span>SELECTED MANAGER COMMENT</span>
        <strong>${escapeHtml(decision.manager.name)}对 ${escapeHtml(symbol)} 的经理结论：${escapeHtml(decision.action.verb)}</strong>
        <p>${escapeHtml(researchSummary)} ${escapeHtml(decision.action.summary)}</p>
        <small><b>反方问题：</b>${escapeHtml(challenge)} <b>失效边界：</b>${escapeHtml(invalidation)}。</small>
      </article>
      <p class="stock-manager-sector-fit ${decision.managerPreference.preferred === true ? "preferred" : decision.managerPreference.preferred === false ? "outside" : "unknown"}"><strong>${escapeHtml(decision.managerPreference.label)}</strong><small>${escapeHtml(decision.managerPreference.rationale)}${decision.managerPreference.example ? ` · ${escapeHtml(decision.managerPreference.marketLabel)}行业示例：${escapeHtml(decision.managerPreference.example.name)}（${escapeHtml(decision.managerPreference.example.symbol)}）` : ""}</small></p>
      <p class="stock-manager-coverage"><strong>数据覆盖 ${decision.manager.coverage}%</strong><small>${escapeHtml(missing)}</small></p>
      <small class="stock-manager-disclaimer">公开资料整理的方法论镜头，不代表本人观点。</small>
    </section>
  </details>`;
  return `<header class="stock-decision-heading">
      <div><span>QUANT MANAGER · BEGINNER MODE</span><h3 id="stock-decision-title">个股决策卡</h3><p>先看行动建议与风险边界，再查看下方技术证据。</p></div>
      <em class="stock-decision-status ${escapeHtml(decision.action.tone)}"><b>${escapeHtml(decision.action.verb)}</b><small>${escapeHtml(decision.action.horizon)}</small></em>
    </header>
    <div class="stock-trade-plan" aria-label="持有期限对应的买卖计划">
      <article class="trade-action ${escapeHtml(decision.action.tone)}"><span>当前动作</span><strong>${escapeHtml(decision.action.verb)}</strong><small>${escapeHtml(decision.action.label)}</small></article>
      <article class="trade-buy"><span>参考买入价</span><strong>${escapeHtml(formatZone(decision.tradePlan.entry, currency))}</strong><small>进入区间后仍需止跌确认</small></article>
      <article class="trade-sell"><span>参考卖出价</span><strong>${escapeHtml(formatZone(target, currency))}</strong><small>${decision.holdingPeriod.target === "far" ? "中长期优先观察远端压力" : "短周期优先观察近端压力"}</small></article>
      <article class="trade-return"><span>预期区间回报</span><strong>${escapeHtml(expectedReturn)}</strong><small>${escapeHtml(decision.tradePlan.hurdleLabel)} · ${escapeHtml(expectedDownside)} · 收益风险比 ${escapeHtml(riskReward)}</small></article>
    </div>
    ${renderPositionSizing(decision, options.context?.sizing)}
    ${renderHoldingPeriodRail(decision.holdingPeriod.id, decision.holdingPeriod.days)}
    <div class="stock-decision-summary">
      <article class="stock-action-summary ${escapeHtml(decision.action.tone)}">
        <span>现在怎么做</span>
        <strong>${escapeHtml(decision.action.label)}</strong>
        <p>${escapeHtml(decision.action.summary)}</p>
        <small>${escapeHtml(decision.allocation)}</small>
      </article>
      <article>
        <span>宏观与市场环境</span>
        <strong>${escapeHtml(decision.environment.label)}</strong>
        <p>${escapeHtml(decision.environment.guidance)}</p>
        <small>模型风险暴露参考 ${escapeHtml(decision.environment.exposureBand)} · 置信度 ${escapeHtml(decision.environment.confidence)}</small>
      </article>
      <article>
        <span>这只股票在哪里</span>
        <strong>${escapeHtml(decision.location.label)}</strong>
        <p>位于所选价格区间 ${decision.location.rangePosition.toFixed(0)}% 位置；越接近100%，追高风险通常越高。</p>
        <small>计划持有 ${escapeHtml(decision.holdingPeriod.label)} · 收益风险比 ${escapeHtml(riskReward)}</small>
      </article>
    </div>
    ${managerLens}
    ${renderDecisionEvidence(decision)}
    <div class="stock-decision-levels" aria-label="VRVP近端与远端关键价位">
      ${renderDecisionLevel(nearSupport, { label: "近端支撑", role: "优先观察买入区", currency, tone: "support" })}
      ${renderDecisionLevel(decision.levels.farSupport, { label: "远端支撑", role: "深度回调防守区", currency, tone: "support" })}
      ${renderDecisionLevel(nearResistance, { label: "近端压力", role: "第一止盈/减仓观察区", currency, tone: "resistance" })}
      ${renderDecisionLevel(decision.levels.farResistance, { label: "远端压力", role: "第二目标观察区", currency, tone: "resistance" })}
    </div>
    <div class="stock-decision-playbook" aria-label="新手行动步骤">
      <article><span>01 · 买入前</span><strong>等待价格进入观察区并企稳</strong><p>${escapeHtml(buyCondition)}</p></article>
      <article><span>02 · 持有中</span><strong>接近压力区分批处理</strong><p>${escapeHtml(sellCondition)}</p></article>
      <article><span>03 · 判断错了</span><strong>判断失效位 ${escapeHtml(invalidation)}</strong><p>收盘跌破失效位，代表原来的买入理由不再成立；不要用连续补仓代替止损纪律。</p></article>
    </div>
    <p class="stock-decision-caveat">关键价位来自对应持有期限内的OHLCV估算VRVP，不是交易所真实挂单墙；它们是参考区间，不是保证成交或保证盈利的精确点位。</p>`;
}

function renderBeginnerDecision(payload, options) {
  return `<section class="stock-decision-card" aria-labelledby="stock-decision-title">
    <div data-stock-decision-dynamic>${renderStockDecisionDynamicMarkup(payload, options)}</div>
  </section>`;
}

export function renderStockAnalysisMarkup(payload, options = {}) {
  const metrics = payload.analysis || {};
  const chart = payload.chart || {};
  const holdingPeriod = options.holdingPeriod || options.range || payload.range || "3m";
  const holdingProfile = options.holdingDays != null
    ? holdingProfileForDays(options.holdingDays)
    : HOLDING_PERIODS[holdingPeriodIndex(holdingPeriod)];
  const trend = getTrendPresentation(metrics.trend);
  const periodChange = finite(payload.changePercent);
  const ma20Distance = metrics.ma20 ? (payload.price / metrics.ma20 - 1) * 100 : 0;
  const rsi = metrics.rsi14 == null ? null : finite(metrics.rsi14);
  const rsiState = rsi == null ? "数据预热中" : rsi >= 70 ? "偏热" : rsi <= 30 ? "偏冷" : rsi >= 50 ? "中性偏强" : "中性偏弱";
  const rangePosition = Math.min(100, Math.max(0, finite(metrics.rangePosition, 50)));
  const histogram = metrics.macdHistogram == null ? null : finite(metrics.macdHistogram);
  const vwapDistance = metrics.vwapDistancePercent == null ? null : finite(metrics.vwapDistancePercent);
  const technicalModel = {
    candles: chart.candles || [],
    profile: chart.profile || { bins: [], vacuumZones: [] },
    indicatorConfig: chart.indicatorConfig || {},
    dataWindow: chart.dataWindow || {},
  };
  return `${renderBeginnerDecision(payload, { ...options, holdingPeriod })}
  <section class="analysis-overview" aria-label="行情概览">
    <div class="analysis-price-block">
      <span>最新价格</span>
      <strong>${formatPrice(payload.price, payload.currency)}</strong>
      <em class="analysis-change ${periodChange >= 0 ? "positive" : "negative"}">${periodChange >= 0 ? "+" : ""}${periodChange.toFixed(2)}% · 持有参考 ${escapeHtml(holdingProfile.label)}</em>
    </div>
    <div class="trend-summary ${trend.tone}">
      <span>趋势判断</span>
      <strong>${trend.label}</strong>
      <p>${trend.summary}</p>
    </div>
  </section>
  <section class="analysis-metrics" aria-label="技术指标快照">
    <article><span>20周期均线</span><strong>${formatPrice(metrics.ma20, payload.currency)}</strong><small class="${ma20Distance >= 0 ? "positive" : "negative"}">现价${ma20Distance >= 0 ? "高于" : "低于"} ${Math.abs(ma20Distance).toFixed(2)}%</small></article>
    <article><span>60周期均线</span><strong>${metrics.ma60 == null ? "数据不足" : formatPrice(metrics.ma60, payload.currency)}</strong><small>中期趋势参考</small></article>
    <article><span>RSI（14根）</span><strong>${rsi == null ? "--" : rsi.toFixed(1)}</strong><small>${rsiState}</small></article>
    <article><span>MACD 柱体</span><strong class="${histogram != null && histogram >= 0 ? "positive" : "negative"}">${histogram == null ? "--" : `${histogram >= 0 ? "+" : ""}${histogram.toFixed(3)}`}</strong><small>动量加速/减速</small></article>
    <article><span>VWAP 偏离</span><strong>${vwapDistance == null ? "--" : `${vwapDistance >= 0 ? "+" : ""}${vwapDistance.toFixed(2)}%`}</strong><small>使用股票自身成交量</small></article>
    <article><span>订单流估算</span><strong>${finite(metrics.buyShare).toFixed(1)}% 买方</strong><small>OHLCV估算，并非逐笔成交</small></article>
  </section>
  ${renderTechnicalChart(technicalModel, {
    className: "analysis-technical-chart",
    eyebrow: "SINGLE STOCK TECHNICAL EVIDENCE",
    title: "单股K线、VWAP、订单流、RSI与MACD",
    valueUnit: "currency",
    currency: payload.currency,
    headerActions: renderStockChartRangeControl(options.chartRange || payload.range || "3m"),
    ariaLabel: "单只股票价格、VWAP、估算订单流、RSI与MACD走势图。移动鼠标或使用左右方向键查看具体时间和指标值。",
  })}
  <section class="range-card" aria-labelledby="price-range-title">
    <div class="range-heading"><div><span>所选数据样本收盘区间</span><strong id="price-range-title">当前位于区间 ${rangePosition.toFixed(0)}%</strong></div><small>${finite(metrics.sampleDays)} 根K线</small></div>
    <div class="range-track" aria-hidden="true"><i style="--range-position:${rangePosition}%"></i></div>
    <div class="range-values"><span>低 ${formatPrice(metrics.periodLow, payload.currency)}</span><span>高 ${formatPrice(metrics.periodHigh, payload.currency)}</span></div>
  </section>
  <p class="analysis-method-note">VWAP使用该股票自身价格与成交量；订单流仍由K线收盘位置和实体方向估算，不等同于交易所逐笔主动买卖数据。</p>`;
}
