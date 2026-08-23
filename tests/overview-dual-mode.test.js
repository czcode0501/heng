import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("overview provides separate broker and custom portfolio surfaces", () => {
  assert.match(html, /id="today-action-panel"/);
  assert.ok(html.indexOf('id="today-action-panel"') < html.indexOf('id="portfolio-manager-panel"'));
  assert.ok(html.indexOf('id="custom-portfolio-dashboard"') < html.indexOf('id="portfolio-manager-panel"'));
  assert.match(html, /href="#data-sources"[^>]*>.*券商与数据源/s);
  assert.match(html, /id="broker-allocation"/);
  assert.match(html, /id="research-metrics"/);
  assert.match(html, /id="custom-portfolio-dashboard"/);
  assert.match(html, /id="custom-holdings-table-wrap"/);
  assert.match(app, /BROKER_PORTFOLIO_ID/);
  assert.match(app, /hasBrokerWorkspace/);
  assert.match(app, /loadIbkrSnapshotCache\(window\.sessionStorage\)/);
  assert.match(app, /renderOverviewActionPanel/);
  assert.match(styles, /@media \(max-width:\s*760px\)[\s\S]*\.today-action-grid/s);
  assert.doesNotMatch(app, /document\.querySelector\("\.table-wrap"\)\.hidden/);
});

test("adding a custom holding requires an explicit quantity or investment amount", () => {
  assert.match(html, /id="add-position-dialog"/);
  assert.match(html, /name="purchase-mode"[^>]*value="quantity"/);
  assert.match(html, /name="purchase-mode"[^>]*value="amount"/);
  assert.match(html, /id="purchase-quantity"/);
  assert.match(html, /id="purchase-amount"/);
  assert.match(html, /id="purchase-cost"/);
});

test("legacy demonstration portfolios are no longer hardcoded as defaults", () => {
  assert.doesNotMatch(app, /name:\s*"核心长期组合"/);
  assert.doesNotMatch(app, /name:\s*"AI 成长实验"/);
  assert.doesNotMatch(app, /name:\s*"防守配置"/);
});
