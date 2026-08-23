import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("mobile navigation hides expanded desktop subdirectories and keeps icon links compact", () => {
  const mobileRules = styles.slice(styles.lastIndexOf("@media (max-width: 760px)"));
  assert.match(mobileRules, /\.nav-disclosure-panel\s*\{[^}]*display:\s*none\s*!important/s);
  assert.match(mobileRules, /\.nav-disclosure-label[^}]*\.nav-chevron\s*\{[^}]*display:\s*none/s);
  assert.match(mobileRules, /\.brand\s*>\s*div\s*\{[^}]*display:\s*none/s);
  assert.match(mobileRules, /\.workspace-nav\s*\{[^}]*flex-direction:\s*row[^}]*flex-wrap:\s*nowrap/s);
});
