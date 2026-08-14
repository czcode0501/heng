import test from "node:test";
import assert from "node:assert/strict";

import { resolveWorkspaceRoute, signalDirectories } from "../signals/catalog.js";

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
});

test("unknown signal directories fall back to the signal hub", () => {
  assert.deepEqual(resolveWorkspaceRoute("#signals/not-defined"), {
    workspace: "signals",
    directory: null,
  });
});
