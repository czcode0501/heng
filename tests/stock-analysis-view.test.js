import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { renderStockAnalysisMarkup } from "../signals/stock-analysis/view.js";
import {
  buildStockDecision,
  holdingDaysFromSliderPosition,
  holdingPeriodAt,
  holdingPeriodIndex,
  holdingProfileForDays,
  sliderPositionFromHoldingDays,
} from "../signals/stock-analysis/decision.js";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

const payload = {
  providerSymbol: "AAPL",
  price: 220,
  changePercent: 4.2,
  currency: "USD",
  range: "3m",
  customStart: "",
  analysis: {
    trend: "strong_up",
    ma20: 214,
    ma60: 205,
    rsi14: 61,
    volatility20: 22,
    periodHigh: 225,
    periodLow: 180,
    rangePosition: 88,
    sampleDays: 65,
    macd: 2.4,
    macdSignal: 1.8,
    macdHistogram: 0.6,
    vwap: 208,
    vwapDistancePercent: 5.77,
    buyShare: 57,
    sellShare: 43,
    atr14: 4,
  },
  chart: {
    candles: [
      { time: "2026-08-13T16:00:00-04:00", open: 210, high: 214, low: 208, close: 213, volume: 1000, buyVolume: 600, sellVolume: 400, delta: 200, rsi14: 55, macd: 1.8, macdSignal: 1.5, macdHistogram: 0.3, vwap: 207 },
      { time: "2026-08-14T16:00:00-04:00", open: 213, high: 222, low: 212, close: 220, volume: 1500, buyVolume: 900, sellVolume: 600, delta: 300, rsi14: 61, macd: 2.4, macdSignal: 1.8, macdHistogram: 0.6, vwap: 208 },
    ],
    profile: {
      poc: 214,
      support: 208,
      resistance: 222,
      supportLevels: [
        { low: 206, high: 210, midpoint: 208, share: 8.2, source: "VRVP高成交节点" },
        { low: 198, high: 202, midpoint: 200, share: 6.4, source: "VRVP高成交节点" },
      ],
      resistanceLevels: [
        { low: 221, high: 224, midpoint: 222.5, share: 7.8, source: "VRVP高成交节点" },
        { low: 230, high: 234, midpoint: 232, share: 5.9, source: "VRVP高成交节点" },
      ],
      bins: [{ low: 208, high: 214, midpoint: 211, buyVolume: 600, sellVolume: 400, totalVolume: 1000, density: 100 }],
      vacuumZones: [],
    },
    indicatorConfig: { rsi: 14, macd: [12, 26, 9], timeframe: "日线", vwapMode: "range-anchored", vwapEstimated: false },
    orderFlowEstimated: true,
    dataWindow: { interval: "日线", observations: 65 },
  },
};

test("beginner decision combines VRVP zones with macro and market-timing context", () => {
  const decision = buildStockDecision(payload, {
    held: false,
    macro: { regime: "结构性修复", stance: "中性偏进取", confidence: 82 },
    timing: { score: 62, label: "偏多", exposureBand: "60%–80%", confidence: "中" },
  });

  assert.equal(decision.levels.nearSupport.midpoint, 208);
  assert.equal(decision.levels.farSupport.midpoint, 200);
  assert.equal(decision.levels.nearResistance.midpoint, 222.5);
  assert.equal(decision.levels.farResistance.midpoint, 232);
  assert.match(decision.environment.label, /结构性修复/);
  assert.match(decision.environment.label, /偏多/);
  assert.match(decision.action.label, /等待回调|分批/);
  assert.ok(decision.invalidation < decision.levels.nearSupport.low);
});

test("beginner decision becomes conservative when macro context is unavailable", () => {
  const decision = buildStockDecision(payload, { held: false });

  assert.equal(decision.environment.dataState, "unavailable");
  assert.match(decision.action.label, /等待/);
  assert.match(decision.environment.guidance, /不提高仓位/);
});

test("held position can receive a conditional add-on suggestion near support", () => {
  const decision = buildStockDecision({ ...payload, price: 209 }, {
    held: true,
    macro: { regime: "扩张阶段", stance: "偏进取", confidence: 86 },
    timing: { score: 72, label: "进攻", exposureBand: "80%–100%", confidence: "高" },
  });

  assert.match(decision.action.label, /加仓/);
  assert.match(decision.action.summary, /企稳/);
  assert.match(decision.allocation, /20%–30%/);
});

test("missing far VRVP nodes stay unavailable instead of becoming a zero price", () => {
  const profile = { ...payload.chart.profile, supportLevels: payload.chart.profile.supportLevels.slice(0, 1), resistanceLevels: payload.chart.profile.resistanceLevels.slice(0, 1) };
  const decision = buildStockDecision({ ...payload, chart: { ...payload.chart, profile } }, {});

  assert.equal(decision.levels.farSupport, null);
  assert.equal(decision.levels.farResistance, null);
});

test("partial context keeps a live timing signal visible when macro data is stale", () => {
  const decision = buildStockDecision(payload, {
    timing: { score: 67.8, label: "偏多", exposureBand: "60%–80%", confidence: "中" },
    sector: { title: "信息技术", score: 79.5, rank: 3, phase: "领先", flowScore: 44.6, flowState: "价格与资金混合" },
    sentiment: { score: 81.1, phase: "狂热加速", tone: "warning", confidence: 72 },
  });

  assert.equal(decision.environment.dataState, "partial");
  assert.match(decision.environment.label, /宏观数据待恢复/);
  assert.match(decision.environment.label, /市场偏多/);
  assert.match(decision.environment.guidance, /67\.8|68/);
  assert.match(decision.action.label, /回调|压力|等待/);
  assert.equal(decision.evidence.find(({ id }) => id === "sector").label, "信息技术 · 领先");
  assert.equal(decision.evidence.find(({ id }) => id === "sentiment").label, "狂热加速");
});

test("two stocks with the same market and technical setup receive different sector-aware advice", () => {
  const shared = {
    held: false,
    timing: { score: 67.8, label: "偏多", exposureBand: "60%–80%", confidence: "中" },
    sentiment: { score: 63, phase: "健康风险偏好", tone: "positive", confidence: 76 },
  };
  const nearSupportPayload = { ...payload, price: 209, analysis: { ...payload.analysis, rangePosition: 42, rsi14: 54 } };
  const leading = buildStockDecision(nearSupportPayload, {
    ...shared,
    sector: { title: "金融", score: 84.8, rank: 1, phase: "领先", flowScore: 60.9, flowState: "上涨获资金确认" },
  });
  const lagging = buildStockDecision(nearSupportPayload, {
    ...shared,
    sector: { title: "公用事业", score: 18.3, rank: 11, phase: "落后", flowScore: 35, flowState: "下跌获资金确认" },
  });

  assert.notEqual(leading.action.label, lagging.action.label);
  assert.match(leading.action.label, /板块|支撑|分批/);
  assert.match(lagging.action.label, /板块偏弱|暂不|等待/);
  assert.ok(leading.composite.score > lagging.composite.score);
});

test("moderate macro caution and crowded sentiment reduce position size without vetoing a strong support entry", () => {
  const supportPayload = {
    ...payload,
    price: 209,
    analysis: { ...payload.analysis, trend: "up", rangePosition: 42, rsi14: 54, macdHistogram: 0.4 },
  };
  const decision = buildStockDecision(supportPayload, {
    held: false,
    macro: { regime: "晚周期降温", stance: "中性偏防守", confidence: 72 },
    timing: { score: 67, label: "偏多", exposureBand: "60%–80%", confidence: "中" },
    sector: { title: "信息技术", score: 80.5, rank: 3, phase: "领先", flowScore: 44.6, flowState: "价格与资金混合" },
    sentiment: { score: 81.1, phase: "狂热加速", tone: "warning", confidence: 72 },
  });

  assert.equal(decision.action.verb, "买入");
  assert.match(decision.action.label, /支撑|小仓/);
  assert.match(decision.allocation, /5%–10%/);
});

test("extreme market risk still blocks a new position at technical support", () => {
  const supportPayload = {
    ...payload,
    price: 209,
    analysis: { ...payload.analysis, trend: "up", rangePosition: 42, rsi14: 54, macdHistogram: 0.4 },
  };
  const decision = buildStockDecision(supportPayload, {
    held: false,
    macro: { regime: "衰退风险上升", stance: "风险规避", confidence: 80 },
    timing: { score: 20, label: "防守", exposureBand: "0%–20%", confidence: "高" },
    sector: { title: "信息技术", score: 80.5, rank: 1, phase: "领先", flowScore: 60, flowState: "资金流入" },
    sentiment: { score: 58, phase: "中性", tone: "neutral", confidence: 70 },
  });

  assert.equal(decision.action.verb, "等待");
  assert.equal(decision.action.code, "wait-stabilization");
});

test("a selective A-share support entry remains possible in defensive but non-extreme timing", () => {
  const supportPayload = {
    ...payload,
    providerSymbol: "603986.SS",
    price: 209,
    analysis: { ...payload.analysis, trend: "up", rangePosition: 42, rsi14: 54, macdHistogram: 0.4 },
  };
  const decision = buildStockDecision(supportPayload, {
    held: false,
    macro: { regime: "结构性修复", stance: "中性偏进取", confidence: 74 },
    timing: { score: 32.2, label: "防守", exposureBand: "20%–40%", confidence: "中" },
    sector: { title: "信息技术", score: 60.7, rank: 4, phase: "改善", flowScore: 45, flowState: "资金改善" },
    sentiment: { score: 68.1, phase: "健康风险偏好", tone: "positive", confidence: 76 },
  });

  assert.equal(decision.action.verb, "买入");
  assert.match(decision.allocation, /10%–20%/);
});

test("rendered beginner card explains every layer of the stock-specific decision", () => {
  const html = renderStockAnalysisMarkup(payload, {
    context: {
      macro: { regime: "结构性修复", stance: "中性偏进取", confidence: 76 },
      timing: { score: 67.8, label: "偏多", exposureBand: "60%–80%", confidence: "中" },
      sector: { title: "信息技术", score: 79.5, rank: 3, phase: "领先", flowScore: 44.6, flowState: "价格与资金混合" },
      sentiment: { score: 81.1, phase: "狂热加速", tone: "warning", confidence: 72 },
    },
  });

  assert.match(html, /五层决策证据/);
  assert.match(html, /宏观环境/);
  assert.match(html, /市场择时/);
  assert.match(html, /所属板块/);
  assert.match(html, /板块资金/);
  assert.match(html, /投资者情绪/);
  assert.match(html, /个股技术/);
  assert.match(html, /信息技术/);
  assert.match(html, /狂热加速/);
});

test("searched stock analysis explicitly evaluates the selected manager's sector preference", () => {
  const sharedContext = {
    held: false,
    marketId: "united-states",
    macro: { regime: "扩张阶段", stance: "偏进取", confidence: 86 },
    timing: { score: 72, label: "进攻", exposureBand: "80%–100%", confidence: "高" },
    sector: { id: "information-technology", title: "信息技术", score: 82, phase: "领先", flowScore: 60, flowState: "资金确认" },
    companyProfile: { sectorId: "information-technology", sector: "信息技术" },
    sentiment: { score: 60, phase: "健康风险偏好", tone: "positive" },
  };
  const buffett = buildStockDecision({ ...payload, price: 209 }, { ...sharedContext, managerId: "buffett" });
  const marks = buildStockDecision({ ...payload, price: 209 }, { ...sharedContext, managerId: "marks" });
  const rendered = renderStockAnalysisMarkup({ ...payload, price: 209 }, {
    context: { ...sharedContext, managerId: "marks" },
  });

  assert.equal(buffett.managerPreference.preferred, true);
  assert.equal(marks.managerPreference.preferred, false);
  assert.match(buffett.managerPreference.label, /符合.*方法论优先研究行业/);
  assert.match(marks.managerPreference.label, /不在.*方法论优先研究行业/);
  assert.match(rendered, /不在霍华德·马克斯方法论优先研究行业/);
});

test("top manager lens gives a company-specific, evidence-aware manager comment", () => {
  const html = renderStockAnalysisMarkup(payload, {
    chartRange: "3m",
    context: {
      managerId: "marks",
      marketId: "united-states",
      companyProfile: { sectorId: "information-technology", sector: "信息技术" },
      companyResearchInsight: {
        score: 41.5,
        verdict: "待补关键证据",
        methodology: "先问下行风险是否被充分定价，再判断当前周期是否值得承担风险。",
        challenge: "如果风险溢价继续收窄，当前价格是否仍然补偿永久损失风险？",
        evidence: { grade: "C" },
      },
    },
  });

  assert.match(html, /霍华德·马克斯对 AAPL 的经理结论/);
  assert.match(html, /待补关键证据/);
  assert.match(html, /研究分 41\.5/);
  assert.match(html, /下行风险是否被充分定价/);
  assert.match(html, /风险溢价继续收窄/);
});

test("stock analysis dialog uses a shrinkable grid track on narrow screens", () => {
  assert.match(styles, /\.analysis-shell\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(styles, /\.analysis-header,\s*\.analysis-content,\s*\.analysis-footer\s*\{[^}]*min-width:\s*0/s);
});

test("single stock analysis renders unified time controls and all technical evidence", () => {
  const html = renderStockAnalysisMarkup(payload, { holdingPeriod: "3m", chartRange: "3m" });

  assert.match(html, /data-holding-period-slider/);
  assert.match(html, /type="range"/);
  assert.match(html, /1日/);
  assert.match(html, /1周/);
  assert.match(html, /1月/);
  assert.match(html, /3月/);
  assert.match(html, /1年/);
  assert.match(html, /VWAP/);
  assert.match(html, /RSI 14 · 日线/);
  assert.match(html, /MACD 12,26,9/);
  assert.match(html, /订单流估算/);
  assert.match(html, /data-micro-chart/);
  assert.match(html, /data-value-unit="currency"/);
  assert.match(html, /data-stock-chart-range/);
  assert.match(html, /图表周期/);
  assert.match(html, /value="3m" selected/);
  assert.match(html, /个股决策卡/);
  assert.match(html, /近端支撑/);
  assert.match(html, /远端压力/);
  assert.match(html, /优先观察买入区/);
  assert.match(html, /判断失效位/);
  assert.match(html, /参考买入价/);
  assert.match(html, /参考卖出价/);
  assert.match(html, /预期区间回报/);
  assert.ok(html.indexOf("01 · 行动") < html.indexOf("02 · 买卖区间"));
  assert.ok(html.indexOf("02 · 买卖区间") < html.indexOf("03 · 买多少"));
  assert.ok(html.indexOf("03 · 买多少") < html.indexOf("04 · 等待条件"));
  assert.ok(html.indexOf("04 · 等待条件") < html.indexOf("05 · 失效位"));
  assert.ok(html.indexOf("个股决策卡") < html.indexOf("计划持有多久"));
  assert.ok(html.indexOf("个股决策卡") < html.indexOf("基金经理方法论"));
  assert.match(html, /<details class="stock-manager-lens-details">/);
  assert.ok(html.indexOf("个股决策卡") < html.indexOf("单股K线"));
});

test("chart range is an independent accessible control in the technical chart header", () => {
  const html = renderStockAnalysisMarkup(payload, { holdingPeriod: "1y", chartRange: "1m" });

  assert.match(html, /<label class="stock-chart-range-control">/);
  assert.match(html, /<select[^>]*data-stock-chart-range[^>]*aria-label="选择技术图表时间范围"/);
  assert.match(html, /value="1m" selected/);
  assert.match(styles, /\.stock-chart-range-control select\s*\{[^}]*min-height:\s*44px/s);
});

test("holding-period rail uses the shared five investment horizons", () => {
  assert.equal(holdingPeriodAt(0).id, "1d");
  assert.equal(holdingPeriodAt(2).id, "1m");
  assert.equal(holdingPeriodAt(99).id, "1y");
  assert.equal(holdingPeriodIndex("3m"), 3);
  assert.equal(holdingPeriodIndex("unknown"), 3);
});

test("holding-period rail supports a continuous custom day range", () => {
  assert.equal(holdingDaysFromSliderPosition(0), 1);
  assert.equal(holdingDaysFromSliderPosition(100), 365);
  assert.ok(Math.abs(sliderPositionFromHoldingDays(30) - 57.65) < 0.2);

  const custom = holdingProfileForDays(45);
  assert.equal(custom.days, 45);
  assert.equal(custom.dataRange, "3m");
  assert.equal(Object.values(custom.weights).reduce((sum, value) => sum + value, 0), 100);

  const html = renderStockAnalysisMarkup(payload, { holdingDays: 45 });
  assert.match(html, /min="0" max="100" step="1"/);
  assert.match(html, /data-holding-days-input/);
  assert.match(html, /value="45"/);
  assert.match(html, /45天/);
});

test("holding horizon changes factor weights and the planned exit level", () => {
  const context = {
    macro: { regime: "扩张阶段", stance: "偏进取", confidence: 86 },
    timing: { score: 72, label: "进攻", exposureBand: "80%–100%", confidence: "高" },
    sector: { title: "信息技术", score: 78, rank: 2, phase: "领先", flowScore: 58, flowState: "资金确认" },
    sentiment: { score: 63, phase: "健康风险偏好", tone: "positive", confidence: 76 },
  };
  const shortTerm = buildStockDecision(payload, { ...context, holdingPeriod: "1w" });
  const longTerm = buildStockDecision(payload, { ...context, holdingPeriod: "1y" });

  assert.equal(shortTerm.holdingPeriod.id, "1w");
  assert.equal(shortTerm.tradePlan.target.midpoint, payload.chart.profile.resistanceLevels[0].midpoint);
  assert.equal(longTerm.tradePlan.target.midpoint, payload.chart.profile.resistanceLevels[1].midpoint);
  assert.notEqual(shortTerm.composite.score, longTerm.composite.score);
  assert.ok(longTerm.tradePlan.expectedReturnPercent > shortTerm.tradePlan.expectedReturnPercent);
  assert.match(longTerm.tradePlan.returnLabel, /预期/);
});

test("decision exposes one beginner-friendly action verb", () => {
  const decision = buildStockDecision({ ...payload, price: 209 }, {
    holdingPeriod: "3m",
    macro: { regime: "扩张阶段", stance: "偏进取", confidence: 86 },
    timing: { score: 72, label: "进攻", exposureBand: "80%–100%", confidence: "高" },
    sector: { title: "信息技术", score: 82, phase: "领先", flowScore: 60 },
    sentiment: { score: 60, phase: "健康风险偏好", tone: "positive" },
  });

  assert.ok(["等待", "买入", "持有", "卖出/减仓"].includes(decision.action.verb));
  assert.equal(decision.action.verb, "买入");
});

test("buy action converts portfolio risk room into an executable first amount and share range", () => {
  const html = renderStockAnalysisMarkup({ ...payload, price: 209 }, {
    context: {
      marketId: "united-states",
      managerId: "quant-balanced",
      macro: { regime: "扩张阶段", stance: "偏进取", confidence: 86 },
      timing: { score: 72, label: "进攻", exposureBand: "80%–100%", confidence: "高" },
      sector: { id: "information-technology", title: "信息技术", score: 82, phase: "领先", flowScore: 60 },
      sentiment: { score: 60, phase: "健康风险偏好", tone: "positive" },
      sizing: {
        currency: "CNY",
        capital: 100_000,
        cash: 30_000,
        currentExposurePct: 40,
        targetExposurePct: 70,
        stockToBaseRate: 7.18,
        lotSize: 1,
        sourceLabel: "自建组合",
      },
    },
  });

  assert.match(html, /首笔计划金额/);
  assert.match(html, /约 \d+–\d+ 股/);
  assert.match(html, /现金、目标仓位缺口、单股上限与失效位风险/);
  assert.match(html, /不会自动提交券商订单/);
});

test("position sizing stays unavailable when no cash or broker capital is known", () => {
  const html = renderStockAnalysisMarkup({ ...payload, price: 209 }, {
    context: {
      macro: { regime: "扩张阶段", stance: "偏进取", confidence: 86 },
      timing: { score: 72, label: "进攻", exposureBand: "80%–100%", confidence: "高" },
      sector: { title: "信息技术", score: 82, phase: "领先", flowScore: 60 },
      sentiment: { score: 60, phase: "健康风险偏好", tone: "positive" },
      sizing: { currency: "CNY", capital: 0, cash: 0 },
    },
  });

  assert.match(html, /填写现金余额或接入券商真实账户/);
});

test("position sizing never presents zero shares as an executable order", () => {
  const html = renderStockAnalysisMarkup({ ...payload, price: 209 }, {
    context: {
      marketId: "united-states",
      managerId: "quant-balanced",
      macro: { regime: "扩张阶段", stance: "偏进取", confidence: 86 },
      timing: { score: 72, label: "进攻", exposureBand: "80%–100%", confidence: "高" },
      sector: { id: "information-technology", title: "信息技术", score: 82, phase: "领先", flowScore: 60 },
      sentiment: { score: 60, phase: "健康风险偏好", tone: "positive" },
      sizing: {
        currency: "CNY",
        capital: 7_000,
        cash: 7_000,
        currentExposurePct: 0,
        targetExposurePct: 100,
        stockToBaseRate: 7.18,
        lotSize: 1,
      },
    },
  });

  assert.match(html, /低于最小交易单位/);
  assert.match(html, /不会用“0股”伪装成可执行计划/);
  assert.doesNotMatch(html, />0 股</);
});
