import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the default development command starts the web app and local data API together", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const launcher = await readFile(new URL("../scripts/dev-stack.mjs", import.meta.url), "utf8");
  assert.equal(packageJson.scripts.dev, "node scripts/dev-stack.mjs");
  assert.match(packageJson.scripts["dev:web"], /vite/);
  assert.match(launcher, /dev:api/);
  assert.match(launcher, /dev:web/);
});

test("Python launchers validate a virtual environment before selecting it", async () => {
  const runtime = await readFile(new URL("../scripts/python-runtime.mjs", import.meta.url), "utf8");
  const runner = await readFile(new URL("../run-python.mjs", import.meta.url), "utf8");
  const scanner = await readFile(new URL("../scripts/scan-stock-decisions.mjs", import.meta.url), "utf8");
  assert.match(runtime, /spawnSync\(executable, \["--version"\]/);
  assert.match(runtime, /QUANT_DESK_PYTHON/);
  assert.match(runner, /No working Python interpreter was found/);
  assert.match(scanner, /resolvePythonExecutable/);
});
