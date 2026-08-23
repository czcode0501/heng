import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const contract = readFileSync(new URL("../docs/design-system/market-colors.md", import.meta.url), "utf8");
const dataSourceView = readFileSync(new URL("../data-sources/view.js", import.meta.url), "utf8");
const microView = readFileSync(new URL("../signals/micro-data/view.js", import.meta.url), "utf8");

test("project defines stable semantic market-color tokens", () => {
  assert.match(styles, /--market-us:\s*#[0-9a-f]{6}/i);
  assert.match(styles, /--market-cn:\s*#[0-9a-f]{6}/i);
  assert.match(styles, /--us-accent:\s*var\(--market-us\)/);
  assert.match(styles, /--china-accent:\s*var\(--market-cn\)/);
  assert.match(styles, /\.market-us\b[^}]*--market-color:\s*var\(--market-us\)/s);
  assert.match(styles, /\.market-cn\b[^}]*--market-color:\s*var\(--market-cn\)/s);
  assert.match(styles, /\.comparison-allocation\s+\.cn\s*\{[^}]*var\(--market-cn\)/s);
  assert.match(styles, /\.comparison-allocation\s+\.us\s*\{[^}]*var\(--market-us\)/s);
});

test("gain and loss colors remain independent of market identity", () => {
  const gainRule = styles.match(/\.gain\s*\{[^}]+\}/s)?.[0] || "";
  const lossRule = styles.match(/\.loss\s*\{[^}]+\}/s)?.[0] || "";
  assert.doesNotMatch(`${gainRule}${lossRule}`, /--market-(?:us|cn)/);
  assert.match(gainRule, /var\(--accent\)/);
  assert.match(lossRule, /var\(--danger\)/);
});

test("the market color rule is documented for future project changes", () => {
  assert.match(contract, /美股.*蓝色/s);
  assert.match(contract, /A股.*红色/s);
  assert.match(contract, /涨跌|盈亏/);
  assert.match(contract, /文字标签/);
});

test("market-specific workspaces carry an explicit market class", () => {
  assert.match(dataSourceView, /data-routing-market market-\$\{marketId === "china" \? "cn" : "us"\}/);
  assert.match(microView, /micro-market-panel \$\{escapeHtml\(market\.id\)\} is-error/);
});
