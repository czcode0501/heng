import test from "node:test";
import assert from "node:assert/strict";

import {
  SIGNAL_TIME_RANGES,
  renderSignalTimeRangeControl,
  selectSignalTimeRange,
} from "../signals/time-range.js";

const history = Array.from({ length: 40 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 6, 1 + index));
  return { date: date.toISOString().slice(0, 10), value: 40 + index };
});

test("all signal workspaces share the exact six time range choices", () => {
  assert.deepEqual(SIGNAL_TIME_RANGES.map(({ id, label }) => [id, label]), [
    ["1d", "1日"], ["1w", "1周"], ["1m", "1月"],
    ["3m", "3月"], ["1y", "1年"], ["custom", "自定义起点"],
  ]);
});

test("time range selects the first valid observation through the latest", () => {
  assert.equal(selectSignalTimeRange(history, { range: "1d" }).points.length, 2);
  assert.equal(selectSignalTimeRange(history, { range: "1w" }).startDate, "2026-08-02");
  assert.equal(selectSignalTimeRange(history, { range: "custom", customStart: "2026-07-17" }).startDate, "2026-07-17");
  assert.equal(selectSignalTimeRange(history, { range: "custom", customStart: "2026-07-17" }).endDate, "2026-08-09");
});

test("shared control exposes presets and an accessible custom date", () => {
  const html = renderSignalTimeRangeControl({ range: "3m", customStart: "2026-05-01", scope: "capital-flow" });
  for (const label of ["1日", "1周", "1月", "3月", "1年", "自定义起点"]) assert.match(html, new RegExp(label));
  assert.match(html, /data-signal-range="3m"/);
  assert.match(html, /data-signal-custom-start/);
  assert.match(html, /data-signal-scope="capital-flow"/);
});
