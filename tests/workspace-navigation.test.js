import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolveWorkspaceRoute, shouldForceWorkspaceRefresh, signalDirectories } from "../signals/catalog.js";

const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("model signals exposes the five requested analysis directories", () => {
  assert.deepEqual(
    signalDirectories.map(({ id, title }) => ({ id, title })),
    [
      { id: "macro", title: "宏观信号" },
      { id: "market-timing", title: "市场择时" },
      { id: "sector-rotation", title: "板块轮动" },
      { id: "investor-sentiment", title: "投资者情绪" },
      { id: "capital-flow", title: "资金流向" },
    ],
  );
});

test("workspace routes distinguish overview, signal hub, and a signal directory", () => {
  assert.deepEqual(resolveWorkspaceRoute("#overview"), { workspace: "overview", directory: null });
  assert.deepEqual(resolveWorkspaceRoute("#signals"), { workspace: "signals", directory: null });
  assert.deepEqual(resolveWorkspaceRoute("#signals/capital-flow"), {
    workspace: "signals",
    directory: "capital-flow",
  });
  assert.deepEqual(resolveWorkspaceRoute("#analysis"), { workspace: "comparison", directory: null });
  assert.deepEqual(resolveWorkspaceRoute("#micro-data"), { workspace: "micro", directory: null });
  assert.deepEqual(resolveWorkspaceRoute("#data-sources"), { workspace: "data-sources", directory: null });
});

test("primary navigation presents macro data and an independent micro data workspace", () => {
  assert.match(indexHtml, /<button[^>]*id="nav-overview"[^>]*aria-controls="overview-subnav"[^>]*aria-expanded="true"/s);
  assert.match(indexHtml, /id="overview-subnav"[^>]*>[\s\S]*href="#overview"[^>]*>[\s\S]*我的组合/s);
  assert.match(indexHtml, /<button[^>]*id="nav-signals"[^>]*aria-controls="signal-subnav"[^>]*aria-expanded="false"/s);
  assert.match(indexHtml, /id="signal-subnav"[^>]*aria-hidden="true"[^>]*inert/s);
  assert.match(indexHtml, /id="nav-micro"[^>]*href="#micro-data"[^>]*>.*?微观数据<\/a>/s);
  assert.match(indexHtml, /id="micro-workspace"/);
  assert.match(indexHtml, /id="nav-data-sources"[^>]*href="#data-sources"[^>]*>.*?券商与数据源<\/a>/s);
  assert.match(indexHtml, /id="data-sources-workspace"/);
});

test("clicking the active market-timing navigation requests a fresh data check", () => {
  assert.equal(shouldForceWorkspaceRefresh("#signals/market-timing", "#signals/market-timing"), true);
  assert.equal(shouldForceWorkspaceRefresh("#signals/macro", "#signals/market-timing"), false);
  assert.equal(shouldForceWorkspaceRefresh("#signals/market-timing", "#signals/macro"), false);
});

test("unknown signal directories fall back to the signal hub", () => {
  assert.deepEqual(resolveWorkspaceRoute("#signals/not-defined"), {
    workspace: "signals",
    directory: null,
  });
});
