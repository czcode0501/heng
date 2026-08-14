import test from "node:test";
import assert from "node:assert/strict";

import { marketTimingMarkets } from "../signals/market-timing/catalog.js";
import { renderMarketTimingWorkspace } from "../signals/market-timing/view.js";

test("market timing separates China equities and United States equities", () => {
  assert.deepEqual(
    marketTimingMarkets.map(({ id, title, scope }) => ({ id, title, scope })),
    [
      { id: "china", title: "中国股票", scope: "A股" },
      { id: "united-states", title: "美国股票", scope: "美股" },
    ],
  );
});

test("China keeps the original timing framework while the US side stays explicitly undefined", () => {
  const china = marketTimingMarkets.find(({ id }) => id === "china");
  const unitedStates = marketTimingMarkets.find(({ id }) => id === "united-states");

  assert.deepEqual(china.methods.map(({ name }) => name), ["指数环境", "均线趋势", "成交量比", "K线形态", "20日动量"]);
  assert.ok(china.methods.every(({ status }) => status === "inherited"));
  assert.ok(unitedStates.methods.every(({ status }) => status === "pending"));
});

test("market timing workspace renders two independent structures without invented live signals", () => {
  const html = renderMarketTimingWorkspace(marketTimingMarkets);

  assert.match(html, /中国股票/);
  assert.match(html, /美国股票/);
  assert.match(html, /原模型框架/);
  assert.match(html, /等待定义/);
  assert.match(html, /量比 \+ K线形态 \+ 均线系统/);
  assert.doesNotMatch(html, /强势做多|偏空-5%|实时数据已连接/);
});
