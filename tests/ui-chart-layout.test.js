import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const views = [
  "market-timing",
  "macro",
  "sector-rotation",
  "capital-flow",
  "investor-sentiment",
].map((name) => readFileSync(new URL(`../signals/${name}/view.js`, import.meta.url), "utf8"));

test("analytical SVG charts fill their available plot width", () => {
  for (const view of views) {
    assert.match(view, /preserveAspectRatio="none"/, "each signal chart should fill its plot region");
  }
  assert.match(styles, /\.timing-benchmark-block\s+svg\s*\{[^}]*height:\s*clamp\(9rem,\s*11vw,\s*10\.5rem\)/s);
  assert.match(styles, /\.capital-chart-shell\s+svg\s*\{[^}]*height:\s*10\.5rem/s);
});

test("all three-point chart axes share an exact start-center-end grid", () => {
  for (const view of views) {
    assert.match(view, /class="chart-time-axis"/, "each signal view should use the shared time axis");
  }
  assert.match(styles, /\.chart-time-axis\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\)/s);
  assert.match(styles, /\.chart-time-axis\s*>\s*:\s*last-child\s*\{[^}]*text-align:\s*right/s);
});

test("dense analytical table headers and values use matching column alignment", () => {
  assert.match(styles, /\.capital-matrix\s+:is\(th,\s*td\):nth-child\(n\+2\):nth-child\(-n\+4\)[^}]*text-align:\s*center/s);
  assert.match(styles, /\.capital-matrix\s+:is\(th,\s*td\):last-child[^}]*text-align:\s*left/s);
  assert.match(styles, /\.sector-ranking\s+:is\(th,\s*td\):nth-child\(3\)[^}]*text-align:\s*right/s);
  assert.match(styles, /\.capital-ranking\s+:is\(th,\s*td\):nth-child\(3\)[^}]*text-align:\s*right/s);
});

test("analytical evidence grids stack before larger type becomes cramped", () => {
  const start = styles.indexOf("@media (max-width: 1500px)");
  const end = styles.indexOf("@media (max-width: 1100px)", start);
  const breakpoint = styles.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(breakpoint, /\.timing-market-grid/);
  assert.match(breakpoint, /\.capital-evidence-grid/);
  assert.match(breakpoint, /\.sector-evidence-grid/);
  assert.match(breakpoint, /\.sentiment-evidence-grid/);
});
