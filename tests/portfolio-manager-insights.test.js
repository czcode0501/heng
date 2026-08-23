import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildManagerPortfolioInsight } from "../portfolio-manager-insights.js";
import { renderManagerHoldingsReview, renderPortfolioManagerPanel } from "../portfolio-manager-view.js";
import { profileSignalPayload } from "../portfolio-analysis-profile.js";

const portfolio = {
  id: "core",
  name: "核心组合",
  positions: [
    { symbol: "AAPL", quantity: 2, cost: 180 },
    { symbol: "000001", quantity: 100, cost: 12 },
  ],
};

const stocks = [
  { symbol: "AAPL", name: "Apple", currency: "USD", price: 220, previousClose: 216, change: 1.85, sectorId: "information-technology", sector: "信息技术" },
  { symbol: "000001", name: "平安银行", currency: "CNY", price: 10, previousClose: 10.2, change: -1.96, sectorId: "financials", sector: "金融" },
];

const signals = {
  macroPayload: { markets: [
    { id: "china", asOf: "2026-08-01", analysis: { regime: "结构性修复", stance: "选择性进攻", confidence: 81 } },
    { id: "united-states", asOf: "2026-08-01", analysis: { regime: "晚周期降温", stance: "均衡", confidence: 76 } },
  ] },
  timingPayload: { markets: [
    { id: "china", asOf: "2026-08-14", regime: { score: 61, label: "偏多", exposureBand: "60%–80%" } },
    { id: "united-states", asOf: "2026-08-14", regime: { score: 68, label: "偏多", exposureBand: "60%–80%" } },
  ] },
  sectorRotationPayload: { markets: [
    { id: "china", asOf: "2026-08-14", sectors: [{ id: "financials", title: "金融", score: 64 }, { id: "consumer-staples", title: "日常消费", score: 55 }] },
    { id: "united-states", asOf: "2026-08-14", sectors: [{ id: "information-technology", title: "信息技术", score: 85 }, { id: "energy", title: "能源", score: 52 }] },
  ] },
};

function insight(managerId) {
  return buildManagerPortfolioInsight({ managerId, portfolio, stocks, usdCny: 7.2, ...signals });
}

test("manager insight makes sector, watchlist, and macro lenses materially distinct", () => {
  const buffett = insight("buffett");
  const soros = insight("soros");
  const dalio = insight("dalio");

  assert.notDeepEqual(buffett.preferredSectors, soros.preferredSectors);
  assert.equal(buffett.preferredSectors.china.length, 3);
  assert.equal(buffett.preferredSectors["united-states"].length, 3);
  assert.ok(buffett.preferredSectors.china.every(({ example }) => example?.symbol && example?.name));
  assert.ok(buffett.preferredSectors["united-states"].every(({ example }) => example?.symbol && example?.name));
  assert.notDeepEqual(soros.watchlists, dalio.watchlists);
  assert.ok(buffett.watchlists.china.length >= 2);
  assert.ok(buffett.watchlists["united-states"].length >= 2);
  assert.notEqual(buffett.macro.headline, soros.macro.headline);
  assert.match(buffett.macro.summary, /结构性修复|晚周期降温/);
  assert.match(soros.macro.summary, /结构性修复|晚周期降温/);
  assert.equal(buffett.macro.asOf, "2026-08-14");
});

test("manager macro summary uses the same synchronized timing label and score as the signal workspace", () => {
  const buffett = insight("buffett");
  const profiled = profileSignalPayload("market-timing", signals.timingPayload, {
    managerId: "buffett",
    targetReturn: 12,
    riskCapacity: 50,
  });
  const china = profiled.markets.find(({ id }) => id === "china");

  assert.match(buffett.macro.summary, new RegExp(`${china.regime.label}（经理评分 ${china.regime.score.toFixed(1)}）`));
});

test("holding advice only includes positions inside each manager's preferred sector list", () => {
  const buffett = insight("buffett");
  const soros = insight("soros");
  const marks = insight("marks");

  assert.deepEqual(buffett.holdings.map(({ symbol }) => symbol).sort(), ["000001", "AAPL"]);
  assert.deepEqual(soros.holdings.map(({ symbol }) => symbol).sort(), ["000001", "AAPL"]);
  assert.deepEqual(marks.holdings.map(({ symbol }) => symbol), ["000001"]);
  assert.ok(buffett.holdings.every(({ preferred }) => preferred));
});

test("holding advice follows the portfolio return target and risk budget", () => {
  const cautious = buildManagerPortfolioInsight({
    managerId: "soros", portfolio, stocks, usdCny: 7.2, ...signals,
    targetReturn: 28, riskCapacity: 15,
  });
  const aggressive = buildManagerPortfolioInsight({
    managerId: "soros", portfolio, stocks, usdCny: 7.2, ...signals,
    targetReturn: 8, riskCapacity: 90,
  });

  const cautiousAdvice = cautious.holdings.find(({ symbol }) => symbol === "AAPL").advice;
  const aggressiveAdvice = aggressive.holdings.find(({ symbol }) => symbol === "AAPL").advice;
  assert.notEqual(cautiousAdvice, aggressiveAdvice);
  assert.match(cautiousAdvice, /目标年化 28%.*风险预算 15\/100/);
});

test("fundamental managers disclose missing hard evidence instead of overstating conviction", () => {
  for (const managerId of ["buffett", "graham"]) {
    const symbol = managerId === "buffett" ? "AAPL" : "000001";
    const view = insight(managerId).holdings.find((holding) => holding.symbol === symbol);
    assert.match(view.evidence, /公司研究尚未载入|财务、增长与估值硬证据/);
    assert.doesNotMatch(view.verdict, /持有候选|折价候选|故事成立/);
  }
});

test("holding review consumes company research instead of reporting a permanent data disconnect", () => {
  const companyResearchBySymbol = {
    AAPL: {
      market: "united-states",
      symbol: "AAPL",
      fundamentals: {
        status: "live",
        periods: [
          { periodEnd: "2030-06-30", revenue: 1400, netIncome: 180, freeCashFlow: 200, assets: 3600, liabilities: 1400 },
          { periodEnd: "2029-06-30", revenue: 1200, netIncome: 150, freeCashFlow: 170, assets: 3200, liabilities: 1300 },
        ],
        source: { label: "SEC EDGAR", quality: "primary" },
      },
      companyProfile: {
        products: [{ name: "iPhone", source: { label: "10-K", authority: "primary" } }],
      },
      news: [],
    },
  };
  const data = buildManagerPortfolioInsight({
    managerId: "buffett", portfolio, stocks, usdCny: 7.2, ...signals, companyResearchBySymbol,
  });
  const apple = data.holdings.find(({ symbol }) => symbol === "AAPL");

  assert.equal(apple.researchConnected, true);
  assert.equal(apple.evidenceGrade, "B");
  assert.match(apple.evidence, /SEC EDGAR|营收同比|自由现金流/);
  assert.doesNotMatch(apple.evidence, /组合接口尚无财务/);
  assert.ok(apple.researchCoverage.completed > 0);
});

test("holding review never renders absent company facts as zero percent", () => {
  const data = buildManagerPortfolioInsight({
    managerId: "buffett",
    portfolio,
    stocks,
    usdCny: 7.2,
    ...signals,
    companyResearchBySymbol: {
      AAPL: {
        market: "united-states",
        symbol: "AAPL",
        fundamentals: { status: "unavailable", periods: [], source: { label: "SEC EDGAR" } },
        companyProfile: {},
        news: [],
      },
    },
  });
  const apple = data.holdings.find(({ symbol }) => symbol === "AAPL");

  assert.match(apple.evidence, /营收同比 待补证、自由现金流率 待补证/);
  assert.doesNotMatch(apple.evidence, /0\.0%/);
});

test("Dalio watchlist and contract explicitly represent a multi-asset portfolio", () => {
  const dalio = insight("dalio");
  const panel = renderPortfolioManagerPanel("dalio", { insight: dalio });

  assert.match(panel, /跨资产|多资产/);
  assert.match(panel, /股票.*债券.*黄金|增长.*通胀/s);
  assert.match(panel, /不用于孤立单股定仓/);
});

test("manager views disclose methodology mapping and show the live evidence", () => {
  const data = insight("buffett");
  const panel = renderPortfolioManagerPanel("buffett", {
    portfolioName: portfolio.name,
    insight: data,
    targetReturn: 18,
    riskCapacity: 62,
  });
  const reviews = renderManagerHoldingsReview(data);

  assert.match(panel, /方法论优先研究行业/);
  assert.match(panel, /A股偏好/);
  assert.match(panel, /美股偏好/);
  assert.match(panel, /行业示例/);
  assert.match(panel, /方法论观察标的/);
  assert.match(panel, /A股观察池/);
  assert.match(panel, /美股观察池/);
  assert.match(panel, /data-manager-target-return/);
  assert.match(panel, /data-manager-risk-capacity/);
  assert.match(panel, /min="0" max="100"/);
  assert.match(panel, /当前宏观判断/);
  assert.match(panel, /2026-08-14/);
  assert.match(panel, /方法论映射/);
  assert.match(panel, /查看统一决策契约/);
  assert.match(panel, /五层因子贡献/);
  assert.match(panel, /差异 &gt;1% 阻断买入/);
  assert.match(panel, /筛选[\s\S]*研究[\s\S]*反方挑战[\s\S]*决策[\s\S]*监控/);
  assert.match(panel, /berkshirehathaway\.com/);
  assert.match(reviews, /巴菲特对当前持仓的评价/);
  assert.match(reviews, /Apple/);
  assert.match(reviews, /建仓收益/);
  assert.match(reviews, /论文基线/);
  assert.match(reviews, /尚未建立论文基线/);
  assert.match(reviews, /机会成本/);
});

test("methodology watchlists use concrete stock or official ETF names", () => {
  const quant = insight("quant-balanced");
  const marks = insight("marks");
  const dalio = insight("dalio");

  assert.equal(quant.watchlists.china.find(({ symbol }) => symbol === "588170").name, "华夏上证科创板半导体材料设备主题ETF");
  assert.equal(marks.watchlists["united-states"].find(({ symbol }) => symbol === "HYG").name, "iShares iBoxx $ High Yield Corporate Bond ETF");
  assert.equal(dalio.watchlists["united-states"].find(({ symbol }) => symbol === "TLT").name, "iShares 20+ Year Treasury Bond ETF");
});

test("overview provides purchase price, holding profit, and a manager review region", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

  assert.match(html, /买入均价/);
  assert.match(html, /建仓盈亏/);
  assert.match(html, /id="manager-holdings-review"/);
  assert.match(app, /calculatePositionSnapshot/);
  assert.match(app, /buildManagerPortfolioInsight/);
});
