import test from "node:test";
import assert from "node:assert/strict";
import { buildManagerOpportunityModel, renderManagerFirstStep, renderManagerOpportunities } from "../market-opportunities.js";

const payload = {
  status: "ready", generatedAt: new Date().toISOString(), scanDate: "2030-01-01",
  rows: [
    { symbol: "TECH", name: "Tech", market: "US", sectorId: "information-technology", score: 70, action: "等待", riskReward: 2, entry: 10, invalidation: 8 },
    { symbol: "UTIL", name: "Utility", market: "US", sectorId: "utilities", score: 73, action: "等待", riskReward: 2, entry: 10, invalidation: 8 },
    { symbol: "BAD", error: "no data" },
  ],
};

test("manager choice leads with names, keeps explanations secondary, and reuses available portraits", () => {
  const html = renderManagerFirstStep("soros");
  assert.match(html, /选择投资经理/);
  assert.match(html, /先选择你想采用的投资经理/);
  assert.equal((html.match(/data-manager-first-choice=/g) || []).length, 8);
  assert.ok(html.indexOf("乔治·索罗斯") < html.indexOf("趋势反馈"));
  assert.match(html, /warren-buffett-avatar/);
  assert.match(html, /ray-dalio-avatar/);
  assert.match(html, /george-soros-avatar/);
  assert.equal((html.match(/<img /g) || []).length, 7);
  assert.match(html, /alt="沃伦·巴菲特头像"/);
  assert.match(html, /alt="瑞·达利欧头像"/);
  assert.match(html, /alt="乔治·索罗斯头像"/);
  assert.match(html, /选择这位经理/);
  assert.match(html, /趋势反馈/);
  assert.match(html, /不代表本人授权/);
});

test("scanner candidates are re-ranked by the selected method without inventing failed rows", () => {
  const soros = buildManagerOpportunityModel(payload, "soros");
  const marks = buildManagerOpportunityModel(payload, "marks");
  assert.equal(soros.rows[0].symbol, "TECH");
  assert.equal(marks.rows[0].symbol, "UTIL");
  assert.doesNotMatch(renderManagerOpportunities(soros), /BAD/);
  assert.match(renderManagerOpportunities(soros), /研究候选/);
  assert.match(renderManagerOpportunities(soros), /候选不等于买入建议/);
});

test("missing scan stays unavailable instead of using the built-in stock catalog", () => {
  const model = buildManagerOpportunityModel({ status: "unavailable", rows: [] }, "buffett");
  const html = renderManagerOpportunities(model, "unavailable");
  assert.match(html, /不生成假名单/);
  assert.match(html, /npm run scan:market/);
  assert.doesNotMatch(html, /Apple|贵州茅台/);
});
