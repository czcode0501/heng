import test from "node:test";
import assert from "node:assert/strict";

import {
  formatMicroMarketTime,
  getMicroChartPoint,
  renderMicroWorkspace,
} from "../signals/micro-data/view.js";

const payload = {
  generatedAt: "2026-08-14T16:00:00Z",
  refreshAfterSeconds: 300,
  selections: {
    china: [{ id: "csi300", title: "沪深300", priceLabel: "沪深300指数", carrier: "510300 沪深300ETF" }],
    "united-states": [{ id: "sp500", title: "标普500", priceLabel: "标普500指数", carrier: "SPY" }],
  },
  markets: [
    {
      id: "china",
      title: "中国市场",
      status: "live",
      instrument: { id: "csi300", title: "沪深300", priceLabel: "沪深300指数", priceSymbol: "000300", flowSymbol: "510300", carrier: "510300 沪深300ETF", unit: "POINTS" },
      source: { name: "BaoStock 指数 + ETF成交代理", access: "无需 API Key" },
      candles: [
        { time: "2026-08-14T09:35:00+08:00", open: 4770, high: 4792, low: 4760, close: 4780, volume: 1000, buyVolume: 650, sellVolume: 350, delta: 300, rsi14: 48, macd: -1.2, macdSignal: -1.5, macdHistogram: 0.3, vwap: 4776 },
        { time: "2026-08-14T09:40:00+08:00", open: 4780, high: 4795, low: 4775, close: 4785.76, volume: 1500, buyVolume: 900, sellVolume: 600, delta: 300, rsi14: 56, macd: 1.4, macdSignal: 0.8, macdHistogram: 0.6, vwap: 4780.4 },
      ],
      profile: {
        poc: 4780,
        valueAreaHigh: 4790,
        valueAreaLow: 4770,
        support: 4772.5,
        resistance: 4792.25,
        bins: [{ low: 4770, high: 4780, midpoint: 4775, buyVolume: 650, sellVolume: 350, totalVolume: 1000, share: 40 }],
        vacuumZones: [{ low: 4788, high: 4790, label: "低成交真空区" }],
      },
      summary: { close: 4785.76, changePercent: 0.33, buyShare: 62, sellShare: 38, delta: 600 },
      indicatorConfig: { rsi: 14, macd: [12, 26, 9], timeframe: "5分钟", vwapMode: "session", vwapEstimated: true },
      dataWindow: { start: "2026-08-14 09:35", end: "2026-08-14 09:40", interval: "5分钟", observations: 2 },
    },
  ],
};

test("micro chart pointer returns candle time and estimated buyer/seller flow", () => {
  const point = getMicroChartPoint(payload.markets[0].candles, 1);

  assert.equal(point.time, "2026-08-14T09:40:00+08:00");
  assert.equal(point.buyVolume, 900);
  assert.equal(point.sellVolume, 600);
});

test("micro chart keeps the exchange-local timestamp instead of converting browser timezone", () => {
  assert.equal(formatMicroMarketTime("2026-08-14T09:35:00+08:00"), "08/14 09:35");
  assert.equal(formatMicroMarketTime("2026-08-14T09:30:00-04:00"), "08/14 09:30");
});

test("micro workspace renders unified ranges, candlesticks, order flow, profile and honest labels", () => {
  const html = renderMicroWorkspace(payload, { range: "1d", customStart: "", selections: { china: "csi300" } });

  assert.match(html, /1日/);
  assert.match(html, /1周/);
  assert.match(html, /1月/);
  assert.match(html, /3月/);
  assert.match(html, /1年/);
  assert.match(html, /data-micro-chart/);
  assert.match(html, /订单流柱/);
  assert.match(html, /买方估算/);
  assert.match(html, /卖方估算/);
  assert.match(html, /成交量轮廓/);
  assert.match(html, /VWAP（估算）/);
  assert.match(html, /RSI 14 · 5分钟/);
  assert.match(html, /MACD 12,26,9/);
  assert.match(html, /micro-vwap-line/);
  assert.match(html, /micro-rsi-line/);
  assert.match(html, /micro-macd-line/);
  assert.match(html, /micro-macd-histogram/);
  assert.match(html, /data-indicator-values/);
  assert.match(html, /支撑位/);
  assert.match(html, /压力位/);
  assert.match(html, /低成交真空区/);
  assert.match(html, /不等同于 Level 2 挂单簿/);
  assert.match(html, /4,785\.76\s*点/);
  assert.doesNotMatch(html, /[¥$]4,785\.76/);
  assert.match(html, /价格：沪深300指数点位/);
  assert.match(html, /订单流代理：510300 沪深300ETF/);
});
