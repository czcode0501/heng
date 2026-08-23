import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("dashboard typography exposes a readable 13/14/16px scale", () => {
  assert.match(styles, /--font-size-xs:\s*0\.8125rem/);
  assert.match(styles, /--font-size-sm:\s*0\.875rem/);
  assert.match(styles, /--font-size-base:\s*1rem/);
});

test("signal workspaces enforce readable body, metadata, and table text", () => {
  assert.match(styles, /\.signal-detail\s+p\s*\{[^}]*font-size:\s*var\(--font-size-sm\)/s);
  assert.match(styles, /\.signal-detail\s+small\s*\{[^}]*font-size:\s*var\(--font-size-xs\)/s);
  assert.match(styles, /\.signal-detail\s+table\s*\{[^}]*font-size:\s*var\(--font-size-sm\)/s);
  assert.match(styles, /\.capital-stock-card\s+dt\s*\{[^}]*font-size:\s*var\(--font-size-xs\)/s);
  assert.match(styles, /\.chart-time-axis\s*\{[^}]*font-size:\s*var\(--font-size-xs\)/s);
  assert.match(styles, /\.timing-chart-tooltip\s+strong[^}]*font-size:\s*var\(--font-size-sm\)/s);
  assert.match(styles, /\.capital-chart-tooltip\s+strong[^}]*font-size:\s*var\(--font-size-sm\)/s);
});

test("responsive navigation rules remain later than the readability uplift", () => {
  const readabilityStart = styles.indexOf("Readability uplift");
  const responsiveOverride = styles.lastIndexOf("@media (max-width: 1100px)");

  assert.ok(readabilityStart >= 0);
  assert.ok(responsiveOverride > readabilityStart);
  assert.match(styles.slice(responsiveOverride), /\.nav-link\s*\{\s*font-size:\s*0/);
});
