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
