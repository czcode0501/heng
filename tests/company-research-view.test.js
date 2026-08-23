import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCompanyManagerInsight,
  companyResearchRefreshDelay,
} from "../signals/stock-analysis/company-research.js";
import { renderCompanyAnalysisShell } from "../signals/stock-analysis/company-research-view.js";

const research = {
  market: "united-states",
  symbol: "EXM",
  companyName: "Example Inc.",
  fundamentals: {
    status: "live",
    periods: [
      { periodEnd: "2030-06-30", filedAt: "2030-07-25", form: "10-Q", revenue: 1400, netIncome: 180, operatingCashFlow: 260, capex: 60, freeCashFlow: 200, assets: 3600, liabilities: 1400, equity: 2200, epsDiluted: 1.8, currency: "USD" },
      { periodEnd: "2030-03-31", filedAt: "2030-04-25", form: "10-Q", revenue: 1100, netIncome: 160, operatingCashFlow: 240, capex: 40, freeCashFlow: 200, assets: 3400, liabilities: 1350, equity: 2050, epsDiluted: 1.6, currency: "USD" },
      { periodEnd: "2029-06-30", filedAt: "2029-07-25", form: "10-Q", revenue: 1200, netIncome: 150, operatingCashFlow: 220, capex: 50, freeCashFlow: 170, assets: 3200, liabilities: 1300, equity: 1900, epsDiluted: 1.5, currency: "USD" },
    ],
    source: { label: "SEC EDGAR", url: "https://www.sec.gov/edgar/search/", quality: "primary" },
  },
  news: [
    { title: "Example raises full-year outlook", publisher: "Example Wire", publishedAt: "2030-07-27T14:00:00Z", url: "https://example.com/news", summary: "Demand improved while management raised guidance.", category: "earnings" },
  ],
  filings: [],
  providers: [
    { id: "sec", label: "SEC EDGAR", channel: "财报与增长", status: "live", detail: "官方披露，随申报更新。", url: "https://www.sec.gov/" },
    { id: "finnhub", label: "Finnhub", channel: "公司新闻", status: "not-configured", detail: "设置 FINNHUB_API_KEY 后启用。", url: "https://www.finnhub.io/" },
  ],
  meta: {
    fetchedAt: "2030-07-27T14:05:00+00:00",
    nextRefreshAt: "2030-07-27T14:15:00+00:00",
    refreshAfterSeconds: 600,
    dynamic: true,
  },
};

test("manager interpretations materially differ while preserving the same source facts", () => {
  const before = structuredClone(research);
  const buffett = buildCompanyManagerInsight(research, "buffett");
  const soros = buildCompanyManagerInsight(research, "soros");

  assert.notEqual(buffett.score, soros.score);
  assert.notDeepEqual(buffett.focus, soros.focus);
  assert.notEqual(buffett.verdict, soros.verdict);
  assert.match(buffett.methodology, /现金流|生意质量|护城河/);
  assert.match(soros.methodology, /反身性|趋势|预期/);
  assert.notEqual(buffett.narrative.opening, soros.narrative.opening);
  assert.match(buffett.narrative.factRead, /16\.7%|14\.3%|38\.9%/);
  assert.match(soros.narrative.factRead, /16\.7%|指引|预期/);
  assert.equal(buffett.facts.revenueGrowth, soros.facts.revenueGrowth);
  assert.deepEqual(research, before);
});

test("all switchable managers produce a distinct company-reading voice over identical facts", () => {
  const managerIds = ["quant-balanced", "buffett", "munger", "graham", "lynch", "marks", "dalio", "soros"];
  const insights = managerIds.map((managerId) => buildCompanyManagerInsight(research, managerId));

  assert.equal(new Set(insights.map(({ narrative }) => narrative.opening)).size, managerIds.length);
  assert.equal(new Set(insights.map(({ narrative }) => narrative.action)).size, managerIds.length);
  assert.deepEqual(
    insights.map(({ facts }) => facts.revenueGrowth),
    Array(managerIds.length).fill(insights[0].facts.revenueGrowth),
  );
});

test("empty research never becomes a neutral score or a grey-area verdict", () => {
  const empty = {
    market: "china",
    symbol: "000001",
    fundamentals: { status: "not-configured", periods: [], reason: "接口待配置" },
    news: [],
    providers: [],
    meta: {},
  };

  for (const managerId of ["quant-balanced", "buffett", "marks", "dalio", "soros"]) {
    const insight = buildCompanyManagerInsight(empty, managerId);
    assert.equal(insight.score, null, managerId);
    assert.equal(insight.verdict, "关键事实不足，仅保留观察", managerId);
    assert.equal(insight.workflow.canBuy, false, managerId);
    assert.doesNotMatch(insight.narrative.opening, /50|灰色地带/, managerId);
  }

  const nullFields = {
    ...empty,
    fundamentals: {
      ...empty.fundamentals,
      periods: [{ periodEnd: "2030-06-30", revenue: null, netIncome: null, freeCashFlow: null, assets: null, liabilities: null }],
    },
  };
  const insight = buildCompanyManagerInsight(nullFields, "buffett");
  assert.equal(insight.score, null);
  assert.equal(insight.facts.revenueGrowth, null);
  assert.equal(insight.facts.freeCashFlowMargin, null);
  assert.doesNotMatch(insight.narrative.opening, /0\.0%/);
});

test("company dossier separates products, moat, market position, management, outlook, valuation, catalysts and risks", () => {
  const enriched = {
    ...research,
    companyProfile: {
      products: [{ name: "Enterprise platform", source: { label: "Annual report", authority: "primary" } }],
      marketPosition: [{ statement: "Category leader", asOf: "FY2030", source: { label: "Industry filing", authority: "independent" } }],
      management: [{ name: "Example CEO", role: "CEO", source: { label: "Proxy statement", authority: "primary" } }],
    },
  };
  const buffett = buildCompanyManagerInsight(enriched, "buffett");
  const soros = buildCompanyManagerInsight(enriched, "soros");

  assert.deepEqual(
    buffett.dossier.sections.map(({ id }) => id),
    ["products", "moat", "marketPosition", "management", "growthOutlook", "valuation", "catalysts", "risks"],
  );
  assert.notDeepEqual(
    buffett.dossier.managerPriorities.map(({ id }) => id),
    soros.dossier.managerPriorities.map(({ id }) => id),
  );
  assert.equal(buffett.dossier.sections.find(({ id }) => id === "products").status, "partial");
  assert.equal(buffett.dossier.sections.find(({ id }) => id === "moat").status, "missing");
  assert.match(buffett.dossier.sections.find(({ id }) => id === "moat").missingReason, /护城河/);
});

test("partial financial rows do not falsely unlock complete research capabilities", () => {
  const partial = {
    ...research,
    fundamentals: {
      ...research.fundamentals,
      periods: [{ periodEnd: "2030-06-30", revenue: 1400, currency: "USD" }],
    },
  };
  const insight = buildCompanyManagerInsight(partial, "lynch");

  assert.deepEqual(insight.capabilities, []);
  assert.equal(insight.workflow.canBuy, false);
  assert.match(insight.verdict, /关键事实不足/);
});

test("company research accepts a real second financial source and blocks conflicts above one percent", () => {
  const ids = ["revenue", "netIncome", "freeCashFlow", "assets", "liabilities"];
  const latest = research.fundamentals.periods[0];
  const verified = {
    ...research,
    financialEvidence: Object.fromEntries(ids.map((id) => [id, { sources: [
      { provider: "SEC EDGAR", authority: "primary", value: latest[id] },
      { provider: "Independent Statements", authority: "independent", value: latest[id] * 1.005 },
    ] }])),
  };
  const conflict = {
    ...verified,
    financialEvidence: {
      ...verified.financialEvidence,
      revenue: { sources: [
        { provider: "SEC EDGAR", authority: "primary", value: latest.revenue },
        { provider: "Independent Statements", authority: "independent", value: latest.revenue * 1.02 },
      ] },
    },
  };

  assert.equal(buildCompanyManagerInsight(verified, "lynch").evidence.status, "verified");
  const blocked = buildCompanyManagerInsight(conflict, "lynch");
  assert.equal(blocked.evidence.status, "conflict");
  assert.equal(blocked.workflow.canBuy, false);
  assert.match(blocked.verdict, /数据冲突/);
});

test("Dalio company reading stays a portfolio risk input instead of a single-stock allocation", () => {
  const insight = buildCompanyManagerInsight(research, "dalio");

  assert.equal(insight.decisionScope, "portfolio-risk-input");
  assert.equal(insight.workflow.canBuy, false);
  assert.match(insight.verdict, /组合风险输入/);
  assert.match(insight.narrative.action, /相关性|风险贡献/);
});

test("manager tab speaks with the selected methodology and hides internal workflow templates", () => {
  const marks = buildCompanyManagerInsight(research, "marks");
  const markup = renderCompanyAnalysisShell({ marketMarkup: "MARKET", research, insight: marks, activeTab: "manager" });

  assert.match(markup, /方法论模拟口吻/);
  assert.match(markup, /非本人原话/);
  assert.match(markup, /我会怎么做/);
  assert.match(markup, /什么会让我改判/);
  assert.match(markup, /营收同比/);
  assert.match(markup, /负债\/资产/);
  assert.match(markup, /产品与客户价值/);
  assert.match(markup, /护城河证据/);
  assert.match(markup, /市场地位\/份额/);
  assert.match(markup, /未来预期/);
  assert.doesNotMatch(markup, /双源规则/);
  assert.doesNotMatch(markup, />ready<|>waiting<|>pending</);
  assert.doesNotMatch(markup, /五步投资评判流程/);
});

test("news tab distinguishes official filings from optional media news", () => {
  const markup = renderCompanyAnalysisShell({
    marketMarkup: "MARKET",
    research: {
      ...research,
      news: [
        { title: "8-K · Current report", publisher: "SEC EDGAR · 官方公司披露", publishedAt: "2030-07-28T12:00:00Z", url: "https://www.sec.gov/Archives/example.htm", summary: "重大事项披露", category: "company", sourceType: "official-filing" },
        ...research.news,
      ],
    },
    activeTab: "news",
  });

  assert.match(markup, /官方披露/);
  assert.match(markup, /媒体新闻/);
  assert.match(markup, /8-K · Current report/);
});

test("news tab presents current media coverage and official disclosures as separate groups", () => {
  const official = { title: "8-K · Current report", publisher: "SEC EDGAR", publishedAt: "2030-07-28T12:00:00Z", url: "https://www.sec.gov/Archives/example.htm", summary: "重大事项披露", category: "company", sourceType: "official-filing" };
  const media = { title: "Apple supplier outlook improves", publisher: "Example Business", publishedAt: "2030-07-29T12:00:00Z", url: "https://example.com/apple", summary: "Analysts raised estimates.", category: "company", sourceType: "media-news", providerId: "gnews" };
  const markup = renderCompanyAnalysisShell({
    marketMarkup: "MARKET",
    research: { ...research, news: [media, official], mediaNews: [media], officialEvents: [official] },
    activeTab: "news",
  });

  assert.match(markup, /最新媒体新闻/);
  assert.match(markup, /官方披露与公告/);
  assert.match(markup, /Apple supplier outlook improves/);
  assert.match(markup, /8-K · Current report/);
  assert.match(markup, /Example Business/);
});

test("company research refresh delay follows response metadata instead of a calendar date", () => {
  assert.equal(companyResearchRefreshDelay(research), 600_000);
  assert.equal(companyResearchRefreshDelay({ meta: { refreshAfterSeconds: 2 } }), 30_000);
  assert.equal(companyResearchRefreshDelay({}), 600_000);
});

test("company analysis shell exposes four accessible tabs and dynamic source timestamps", () => {
  const insight = buildCompanyManagerInsight(research, "buffett");
  const markup = renderCompanyAnalysisShell({
    marketMarkup: "<section>MARKET FACTS</section>",
    research,
    insight,
    activeTab: "fundamentals",
  });

  assert.match(markup, /role="tablist"/);
  assert.equal((markup.match(/role="tab"/g) || []).length, 4);
  assert.match(markup, /行情分析/);
  assert.match(markup, /财报与增长/);
  assert.match(markup, /公司新闻/);
  assert.match(markup, /经理解读/);
  assert.match(markup, /aria-selected="true"[^>]*>财报与增长/);
  assert.match(markup, /2030-06-30/);
  assert.match(markup, /营收同比/);
  assert.match(markup, /净利润同比/);
  assert.match(markup, /SEC EDGAR/);
  assert.match(markup, /公司研究数据源状态/);
  assert.match(markup, /Finnhub/);
  assert.match(markup, /待配置/);
  assert.match(markup, /Example raises full-year outlook/);
  assert.match(markup, /事实数据不会因基金经理切换而改变/);
});

test("market decision renders before collapsible provider diagnostics", () => {
  const markup = renderCompanyAnalysisShell({
    marketMarkup: '<section id="decision-first">DECISION FIRST</section>',
    research,
    activeTab: "market",
  });

  assert.ok(markup.indexOf("decision-first") < markup.indexOf("company-provider-details"));
  assert.match(markup, /<details class="company-provider-details">/);
  assert.match(markup, /<summary>数据来源与连接状态/);
  assert.match(markup, /公司研究数据源状态/);
});

test("company research treats provider URLs as untrusted and labels stale fallback", () => {
  const markup = renderCompanyAnalysisShell({
    marketMarkup: "MARKET",
    research: {
      ...research,
      news: [{ title: "Unsafe item", url: "javascript:alert(1)", publisher: "Unknown" }],
      meta: { ...research.meta, stale: true, refreshError: "TimeoutError" },
    },
    activeTab: "news",
  });

  assert.doesNotMatch(markup, /javascript:/i);
  assert.match(markup, /刷新失败，使用上次成功快照/);
  assert.match(markup, /Unsafe item/);
});

test("new company research production files do not contain a fixed YYYY-MM-DD date", () => {
  for (const file of [
    "../company_research.py",
    "../signals/stock-analysis/company-research.js",
    "../signals/stock-analysis/company-research-view.js",
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /20\d{2}-\d{2}-\d{2}/, file);
  }
});
