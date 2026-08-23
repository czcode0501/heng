import test from "node:test";
import assert from "node:assert/strict";

import {
  DATA_SOURCE_CATALOG,
  DEFAULT_DATA_SOURCE_PREFERENCES,
  brokerConnectionErrorMessage,
  dataSourceNetworkFailure,
  loadIbkrAutoSyncConfig,
  loadIbkrSnapshotCache,
  normalizeDataSourcePreferences,
  saveIbkrSnapshotCache,
  saveIbkrAutoSyncConfig,
  serializeDataSourcePreferences,
} from "../data-sources/model.js";
import { renderDataSourceCenter } from "../data-sources/view.js";

test("data source catalog separates account connectors from market-data vendors", () => {
  assert.deepEqual(
    DATA_SOURCE_CATALOG.map(({ id }) => id),
    ["free", "ibkr", "qmt", "ifind", "databento", "custom"],
  );
  assert.equal(DATA_SOURCE_CATALOG.find(({ id }) => id === "free").availability, "active");
  assert.equal(DATA_SOURCE_CATALOG.find(({ id }) => id === "ibkr").capability, "positions-read-only");
  assert.equal(DATA_SOURCE_CATALOG.find(({ id }) => id === "qmt").capability, "positions-read-only");
  assert.equal(DATA_SOURCE_CATALOG.find(({ id }) => id === "ifind").capability, "market-data-only");
});

test("free mode is the default for both markets and remains the fallback", () => {
  assert.deepEqual(DEFAULT_DATA_SOURCE_PREFERENCES, {
    china: "free",
    "united-states": "free",
    fallbackToFree: true,
  });
});

test("preferences reject sources that do not support a market", () => {
  assert.deepEqual(
    normalizeDataSourcePreferences({ china: "ibkr", "united-states": "qmt" }),
    DEFAULT_DATA_SOURCE_PREFERENCES,
  );
});

test("serialized preferences never include credentials", () => {
  const serialized = serializeDataSourcePreferences({
    china: "qmt",
    "united-states": "databento",
    fallbackToFree: true,
    apiKey: "must-not-leak",
    password: "must-not-leak",
  });

  assert.doesNotMatch(serialized, /must-not-leak|apiKey|password/);
});

test("data source center makes the current free delayed stage unambiguous", () => {
  const html = renderDataSourceCenter({
    preferences: DEFAULT_DATA_SOURCE_PREFERENCES,
    statuses: {},
  });

  assert.match(html, /当前阶段：免费延迟数据/);
  assert.match(html, /延迟或收盘后更新/);
  assert.match(html, /IBKR/);
  assert.match(html, /QMT/);
  assert.match(html, /Databento/);
  assert.match(html, /直连交易所/);
  assert.match(html, /后续开放/);
  assert.doesNotMatch(html, /data-source-form="ibkr"|data-source-form="databento"/);
  assert.match(html, /data-source-card="free"/);
});

test("data source center provides secure Finnhub and GNews credential forms", () => {
  const html = renderDataSourceCenter({
    preferences: DEFAULT_DATA_SOURCE_PREFERENCES,
    statuses: {},
    newsCredentials: {
      finnhub: { configured: false, state: "not-configured", message: "尚未配置" },
      gnews: { configured: true, state: "ready", source: "environment", message: "已配置" },
    },
  });

  assert.match(html, /媒体新闻 API/);
  assert.match(html, /data-news-credential-form="finnhub"/);
  assert.match(html, /data-news-credential-form="gnews"/);
  assert.match(html, /name="apiKey"[^>]*type="password"/);
  assert.match(html, /FINNHUB_API_KEY/);
  assert.match(html, /GNEWS_API_KEY/);
  assert.match(html, /保存并检查/);
  assert.match(html, /环境变量/);
  assert.doesNotMatch(html, /value="[^\"]*secret/i);
});

test("a professional preference falls back visibly after readiness expires", () => {
  const html = renderDataSourceCenter({
    preferences: { china: "qmt", "united-states": "databento", fallbackToFree: true },
    statuses: {},
  });

  assert.match(html, /value="free" data-source-routing="china" checked/);
  assert.match(html, /value="free" data-source-routing="united-states" checked/);
  assert.doesNotMatch(html, /value="databento" data-source-routing="united-states" checked/);
});

test("broker sources expose read-only connection forms without asking for passwords", () => {
  const html = renderDataSourceCenter({
    preferences: DEFAULT_DATA_SOURCE_PREFERENCES,
    statuses: { ibkr: { state: "ready", readyForActivation: true, message: "ready" } },
    selectedSource: "ibkr",
  });

  assert.match(html, /data-source-form="ibkr"/);
  assert.match(html, /同步只读持仓/);
  assert.match(html, /127\.0\.0\.1/);
  const brokerForm = html.match(/<form[^>]*data-broker-form="ibkr"[\s\S]*?<\/form>/)?.[0] || "";
  assert.doesNotMatch(brokerForm, /type="password"|name="password"|提交订单/i);
});

test("Tonghuashun is presented honestly as market data rather than a retail position connector", () => {
  const html = renderDataSourceCenter({
    preferences: DEFAULT_DATA_SOURCE_PREFERENCES,
    statuses: {},
    selectedSource: "ifind",
  });

  assert.match(html, /同花顺 iFinD/);
  assert.match(html, /不读取普通同花顺客户端的券商账户持仓/);
  assert.doesNotMatch(html, /data-source-form="ifind"/);
});

test("a stale backend 404 is explained as a restart problem", () => {
  assert.match(brokerConnectionErrorMessage(404, { error: { message: "接口不存在" } }), /版本过旧/);
  assert.match(brokerConnectionErrorMessage(502, { error: { message: "TWS API 未安装" } }), /TWS API 未安装/);
});

test("network failures distinguish the local API lifecycle from an upstream outage", () => {
  const failure = dataSourceNetworkFailure(new TypeError("Failed to fetch"));
  assert.equal(failure.state, "api_offline");
  assert.match(failure.message, /本地数据服务未连接/);
  assert.doesNotMatch(failure.message, /免费数据源失败/);
});

test("data source center renders continuous health and explicit service states", () => {
  const html = renderDataSourceCenter({
    preferences: DEFAULT_DATA_SOURCE_PREFERENCES,
    statuses: {
      service: { state: "online", checkedAt: "2026-08-21T15:30:00.000Z", continuousRefresh: true },
      free: { sourceId: "free", state: "degraded", readyForActivation: true, message: "上游暂时降级，继续使用最后有效数据。" },
    },
  });
  assert.match(html, /持续健康检查/);
  assert.match(html, /上游降级/);
  assert.match(html, /最后有效数据/);
});

test("IBKR auto sync persists only loopback connection settings", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };

  saveIbkrAutoSyncConfig(storage, {
    host: "127.0.0.1",
    port: 7497,
    clientId: 18,
    accountId: "U1234567",
    password: "must-not-persist",
  });

  const serialized = [...values.values()].join("");
  assert.doesNotMatch(serialized, /U1234567|must-not-persist|password|accountId/);
  assert.deepEqual(loadIbkrAutoSyncConfig(storage), {
    host: "127.0.0.1",
    port: 7497,
    clientId: 18,
  });
});

test("the last successful IBKR snapshot survives a page reload in session storage", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const snapshot = {
    sourceId: "ibkr",
    fetchedAt: "2026-08-16T13:00:00.000Z",
    account: { maskedId: "U1•••74", currency: "USD", totalAsset: 1000 },
    positions: [{ symbol: "AAPL", marketValue: 600 }],
    meta: { positionCount: 1, priceSource: "IBKR TWS Account Window" },
  };

  saveIbkrSnapshotCache(storage, snapshot);
  const restored = loadIbkrSnapshotCache(storage);

  assert.equal(restored.positions[0].symbol, "AAPL");
  assert.equal(restored.meta.snapshotState, "cached");
  assert.equal(restored.meta.positionCount, 1);
});

test("IBKR session snapshot cache rejects malformed or non-IBKR data", () => {
  const storage = { getItem: () => JSON.stringify({ sourceId: "qmt", positions: [] }) };
  assert.equal(loadIbkrSnapshotCache(storage), null);
});
