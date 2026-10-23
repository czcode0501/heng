// 美元资产折算人民币使用实时参考汇率；不再在代码里写死一个汇率当作事实。
// 只有从未成功获取过汇率（全新安装且离线）时才用预设值，并在页面上明确标注。
export const PRESET_USD_CNY = 7.18;
export const FX_STORAGE_KEY = "hengce-usd-cny-v1";

function validRate(value) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 4 && rate < 12 ? rate : null;
}

export function loadCachedFxRate(storage) {
  try {
    const cached = JSON.parse(storage?.getItem(FX_STORAGE_KEY) || "null");
    const rate = validRate(cached?.rate);
    return rate ? { ...cached, rate, stale: true } : null;
  } catch {
    return null;
  }
}

export function saveFxRate(storage, fx) {
  if (!validRate(fx?.rate)) return;
  try {
    storage?.setItem(FX_STORAGE_KEY, JSON.stringify({ rate: fx.rate, asOf: fx.asOf, source: fx.source, fetchedAt: fx.fetchedAt }));
  } catch {
    // 浏览器存储不可用时只影响下次启动的初始值。
  }
}

export function usdCnyRate(fx) {
  return validRate(fx?.rate) ?? PRESET_USD_CNY;
}

export function fxRateLabel(fx) {
  if (!validRate(fx?.rate)) return `USD/CNY ${PRESET_USD_CNY.toFixed(2)} · 预设汇率，尚未更新，美股折算仅供参考`;
  const date = fx.asOf ? ` · ${fx.asOf}` : "";
  const freshness = fx.stale ? " · 上次成功值" : "";
  return `USD/CNY ${Number(fx.rate).toFixed(4)}${date} · ${fx.source || "参考汇率"}${freshness}`;
}
