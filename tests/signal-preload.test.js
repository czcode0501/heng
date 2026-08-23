import test from "node:test";
import assert from "node:assert/strict";

import { createSignalPreloader, isSignalPayloadFresh } from "../signals/data-preload.js";


function response(data, ok = true) {
  return {
    ok,
    async json() {
      return ok ? { data } : { error: { message: "预加载失败" } };
    },
  };
}


test("concurrent workspace requests share one preload request and reuse its in-memory result", async () => {
  let requestCount = 0;
  const workspaces = {
    macro: { id: "macro" },
    marketTiming: { id: "market-timing" },
    sectorRotation: { id: "sector-rotation" },
    capitalFlow: { id: "capital-flow" },
  };
  const preloader = createSignalPreloader(async (url) => {
    requestCount += 1;
    assert.equal(url, "/api/signals");
    return response({ workspaces, preloaded: true });
  });

  const [macro, rotation, capital] = await Promise.all([
    preloader.getWorkspace("macro"),
    preloader.getWorkspace("sectorRotation"),
    preloader.getWorkspace("capitalFlow"),
  ]);
  const macroAgain = await preloader.getWorkspace("macro");

  assert.equal(requestCount, 1);
  assert.equal(macro, workspaces.macro);
  assert.equal(rotation, workspaces.sectorRotation);
  assert.equal(capital, workspaces.capitalFlow);
  assert.equal(macroAgain, workspaces.macro);
  assert.equal(preloader.isReady(), true);
});

test("a failed preload can be retried and does not poison individual endpoint fallback", async () => {
  let requestCount = 0;
  const preloader = createSignalPreloader(async () => {
    requestCount += 1;
    if (requestCount === 1) return response(null, false);
    return response({ workspaces: { macro: { id: "macro" } }, preloaded: true });
  });

  await assert.rejects(() => preloader.getWorkspace("macro"), /预加载失败/);
  assert.deepEqual(await preloader.getWorkspace("macro"), { id: "macro" });
  assert.equal(requestCount, 2);
});

test("signal payload freshness expires at the server refresh contract", () => {
  const now = Date.parse("2026-08-17T02:10:00Z");
  const fresh = { generatedAt: "2026-08-17T02:09:01Z", refreshAfterSeconds: 60 };
  const stale = { generatedAt: "2026-08-17T02:08:59Z", refreshAfterSeconds: 60 };

  assert.equal(isSignalPayloadFresh(fresh, now), true);
  assert.equal(isSignalPayloadFresh(stale, now), false);
  assert.equal(isSignalPayloadFresh({}, now), false);
});
