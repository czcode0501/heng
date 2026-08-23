export const DATA_SOURCE_STORAGE_KEY = "quant-desk-data-source-preferences-v1";
export const IBKR_AUTO_SYNC_STORAGE_KEY = "quant-desk-ibkr-auto-sync-v1";
export const IBKR_SNAPSHOT_SESSION_KEY = "quant-desk-ibkr-snapshot-session-v1";

export const DATA_SOURCE_CATALOG = Object.freeze([
  {
    id: "free",
    name: "免费模式",
    label: "当前可用",
    quality: "延迟 / 收盘后 + 估算",
    availability: "active",
    markets: ["china", "united-states"],
    description: "中国 A 股与美股使用公开延迟行情；订单流由 OHLCV 与 ETF 成交量代理估算，并明确标记数据时间。",
  },
  {
    id: "ibkr",
    name: "IBKR",
    label: "本机网关",
    quality: "券商行情",
    availability: "read-only",
    capability: "positions-read-only",
    markets: ["united-states"],
    description: "连接本机 TWS 或 IB Gateway，适合已有 IBKR 账户与行情订阅的用户。",
  },
  {
    id: "qmt",
    name: "QMT",
    label: "国内券商",
    quality: "券商行情",
    availability: "read-only",
    capability: "positions-read-only",
    markets: ["china"],
    description: "连接券商提供的 QMT / miniQMT 与 xtquant 环境，读取有权限的中国市场数据。",
  },
  {
    id: "ifind",
    name: "同花顺 iFinD",
    label: "行情研究",
    quality: "QuantAPI 行情数据",
    availability: "data-only",
    capability: "market-data-only",
    markets: ["china"],
    description: "官方 QuantAPI 可提供行情与研究数据；不读取普通同花顺客户端的券商账户持仓。",
  },
  {
    id: "databento",
    name: "Databento",
    label: "专业数据",
    quality: "逐笔 / MBO",
    availability: "planned",
    capability: "market-data-professional",
    markets: ["united-states"],
    description: "为专业用户预留逐笔成交、盘口与 MBO 数据通道，具体权限取决于订阅。",
  },
  {
    id: "custom",
    name: "直连交易所",
    label: "专用适配器",
    quality: "按授权定义",
    availability: "planned",
    capability: "custom-adapter",
    markets: ["china", "united-states"],
    description: "登记 FIX、WebSocket 或 REST 适配器。必须先完成代码审查与交易所授权，不能直接请求任意网址。",
  },
]);

export const DEFAULT_DATA_SOURCE_PREFERENCES = Object.freeze({
  china: "free",
  "united-states": "free",
  fallbackToFree: true,
});

export function dataSourceOptionsForMarket(marketId) {
  return DATA_SOURCE_CATALOG.filter(({ markets }) => markets.includes(marketId));
}

export function normalizeDataSourcePreferences(value = {}) {
  const requested = value && typeof value === "object" ? value : {};
  const normalized = { ...DEFAULT_DATA_SOURCE_PREFERENCES };
  for (const marketId of ["china", "united-states"]) {
    const sourceId = String(requested[marketId] || "free");
    if (dataSourceOptionsForMarket(marketId).some(({ id, availability }) => id === sourceId && availability === "active")) {
      normalized[marketId] = sourceId;
    }
  }
  normalized.fallbackToFree = true;
  return normalized;
}

export function serializeDataSourcePreferences(value) {
  return JSON.stringify(normalizeDataSourcePreferences(value));
}

export function loadDataSourcePreferences(storage) {
  try {
    return normalizeDataSourcePreferences(JSON.parse(storage?.getItem(DATA_SOURCE_STORAGE_KEY) || "{}"));
  } catch {
    return { ...DEFAULT_DATA_SOURCE_PREFERENCES };
  }
}

export function saveDataSourcePreferences(storage, value) {
  storage?.setItem(DATA_SOURCE_STORAGE_KEY, serializeDataSourcePreferences(value));
}

export function brokerConnectionErrorMessage(status, payload = {}) {
  if (Number(status) === 404) {
    return "本机数据 API 版本过旧，请关闭旧服务后重新运行 npm run dev:api";
  }
  return payload?.error?.message || "券商持仓读取失败，请检查本机客户端。";
}

export function dataSourceNetworkFailure(error) {
  const detail = String(error?.message || "").trim();
  const offline = error instanceof TypeError || /failed to fetch|networkerror|network request failed/i.test(detail);
  if (offline) {
    return {
      sourceId: "service",
      state: "api_offline",
      readyForActivation: false,
      checkedAt: new Date().toISOString(),
      message: "本地数据服务未连接。请使用 npm run dev 启动完整应用；页面会自动重试，不会把旧数据冒充最新数据。",
    };
  }
  return {
    sourceId: "service",
    state: "degraded",
    readyForActivation: false,
    checkedAt: new Date().toISOString(),
    message: detail || "数据服务暂时降级；保留最后有效数据并等待自动恢复。",
  };
}

export function loadIbkrAutoSyncConfig(storage) {
  try {
    const value = JSON.parse(storage?.getItem(IBKR_AUTO_SYNC_STORAGE_KEY) || "null");
    const port = Number(value?.port);
    const clientId = Number(value?.clientId);
    if (value?.host !== "127.0.0.1" || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    if (!Number.isInteger(clientId) || clientId < 0 || clientId > 999999) return null;
    return { host: "127.0.0.1", port, clientId };
  } catch {
    return null;
  }
}

export function saveIbkrAutoSyncConfig(storage, config = {}) {
  const safe = {
    host: "127.0.0.1",
    port: Number(config.port),
    clientId: Number(config.clientId),
  };
  if (!Number.isInteger(safe.port) || safe.port < 1 || safe.port > 65535) return;
  if (!Number.isInteger(safe.clientId) || safe.clientId < 0 || safe.clientId > 999999) return;
  storage?.setItem(IBKR_AUTO_SYNC_STORAGE_KEY, JSON.stringify(safe));
}

export function loadIbkrSnapshotCache(storage) {
  try {
    const snapshot = JSON.parse(storage?.getItem(IBKR_SNAPSHOT_SESSION_KEY) || "null");
    if (snapshot?.sourceId !== "ibkr" || !snapshot.account || !Array.isArray(snapshot.positions) || !snapshot.meta) return null;
    return {
      ...snapshot,
      state: "stale",
      meta: { ...snapshot.meta, snapshotState: "cached" },
    };
  } catch {
    return null;
  }
}

export function saveIbkrSnapshotCache(storage, snapshot) {
  if (snapshot?.sourceId !== "ibkr" || !snapshot.account || !Array.isArray(snapshot.positions) || !snapshot.meta) return false;
  try {
    storage?.setItem(IBKR_SNAPSHOT_SESSION_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}
