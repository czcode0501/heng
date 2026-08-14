import test from "node:test";
import assert from "node:assert/strict";

import { macroMarkets } from "../signals/macro/catalog.js";

test("macro signals separate China and United States into independent market sections", () => {
  assert.deepEqual(
    macroMarkets.map(({ id, code, title }) => ({ id, code, title })),
    [
      { id: "china", code: "CN", title: "中国宏观环境" },
      { id: "united-states", code: "US", title: "美国宏观环境" },
    ],
  );
});

test("each market owns its country-specific indicator groups", () => {
  const [china, unitedStates] = macroMarkets;

  assert.deepEqual(china.groups.map(({ title }) => title), ["货币与信用", "增长周期", "通胀与盈利"]);
  assert.deepEqual(unitedStates.groups.map(({ title }) => title), ["通胀与美联储", "增长与就业", "金融条件"]);

  assert.ok(china.groups.some(({ indicators }) => indicators.some(({ name }) => name === "社会融资规模存量同比")));
  assert.ok(unitedStates.groups.some(({ indicators }) => indicators.some(({ name }) => name === "核心PCE同比")));
});

test("macro catalog uses pending states instead of invented data", () => {
  const indicators = macroMarkets.flatMap(({ groups }) => groups.flatMap(({ indicators }) => indicators));

  assert.ok(indicators.length > 0);
  assert.ok(indicators.every(({ status, value }) => status === "pending" && value === undefined));
});
