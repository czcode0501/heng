import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("Windows setup installs project dependencies and creates a machine-local shortcut", () => {
  const setup = read("Setup-QuantDesk.ps1");
  const wrapper = read("setup-windows.cmd");

  assert.match(setup, /-m\s+venv/i);
  assert.match(setup, /pip[^\r\n]*--requirement\s+\$RequirementsPath/i);
  assert.match(setup, /npm[^\r\n]*ci/i);
  assert.match(setup, /CreateShortcut/i);
  assert.match(setup, /Start-QuantDesk\.ps1/i);
  assert.doesNotMatch(setup + wrapper, /C:\\Users\\jtywh/i);
  assert.match(wrapper, /Setup-QuantDesk\.ps1/i);
});

test("runtime dependencies and open-source credential behavior are documented", () => {
  const requirements = read("requirements.txt");
  const readme = read("README.md");

  assert.match(requirements, /baostock/i);
  assert.match(requirements, /yfinance/i);
  assert.match(readme, /setup-windows\.cmd/i);
  assert.match(readme, /每位用户.*自己的.*API Key/s);
  assert.match(readme, /快捷方式.*本机/s);
});
