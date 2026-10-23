import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { describeMarketSessions, getMarketSession } from "../market-session.js";

test("Beijing afternoon on a weekday is A-share trading but US overnight", () => {
  // 2026-10-23 14:17 Asia/Shanghai = 02:17 America/New_York
  const now = new Date("2026-10-23T06:17:00Z");
  assert.equal(getMarketSession("china", now).state, "open");
  assert.equal(getMarketSession("united-states", now).state, "closed");
  assert.equal(describeMarketSessions(now), "A股交易中 / 美股未开盘");
});

test("A-share midday break, pre-open and close are distinguished", () => {
  assert.equal(getMarketSession("china", new Date("2026-10-23T04:00:00Z")).state, "break");
  assert.equal(getMarketSession("china", new Date("2026-10-23T01:20:00Z")).state, "pre-open");
  assert.equal(getMarketSession("china", new Date("2026-10-23T07:00:00Z")).label, "A股已收盘");
});

test("US regular, pre-market and after-hours sessions follow New York time across DST", () => {
  // 夏令时：09:30 ET = 13:30 UTC；冬令时：09:30 ET = 14:30 UTC
  assert.equal(getMarketSession("united-states", new Date("2026-10-23T13:30:00Z")).state, "open");
  assert.equal(getMarketSession("united-states", new Date("2026-12-04T13:30:00Z")).state, "pre-open");
  assert.equal(getMarketSession("united-states", new Date("2026-12-04T14:30:00Z")).state, "open");
  assert.equal(getMarketSession("united-states", new Date("2026-10-23T21:00:00Z")).state, "after-hours");
});

test("weekends are closed in both markets", () => {
  assert.equal(describeMarketSessions(new Date("2026-10-24T06:00:00Z")), "A股休市 / 美股休市");
});

test("the market status label is no longer hardcoded as always open", () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(app, /A股盘中 \/ 美股交易时段/);
  assert.doesNotMatch(html, /A股盘中 \/ 美股交易时段/);
});
