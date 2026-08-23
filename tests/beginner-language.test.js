import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("new-user copy keeps technical terms secondary and explains user action", () => {
  const micro = read("signals/micro-data/view.js");
  const timing = read("signals/market-timing/view.js");
  const sentiment = read("signals/investor-sentiment/view.js");
  const sources = read("data-sources/view.js");
  const stock = read("signals/stock-analysis/view.js");

  assert.match(micro, /历史成交密集区（VRVP）/);
  assert.match(micro, /价格偏热，先别追高/);
  assert.match(timing, /最多投入风险资产/);
  assert.match(timing, /其余保留现金；若信心不足，取区间下限/);
  assert.match(sentiment, /情绪正在恶化，先减少追高并等待企稳/);
  assert.match(sources, /连接编号（Client ID）/);
  assert.match(sources, /如果没有冲突，保留默认值 18/);
  assert.match(stock, /收盘跌破代表原买入理由不再成立/);
  assert.match(stock, /日常行情数据（OHLCV）估算历史成交密集区（VRVP）/);
});

test("core beginner headings do not use English eyebrow copy", () => {
  const visibleSources = [
    read("signals/micro-data/view.js"),
    read("signals/market-timing/view.js"),
    read("signals/investor-sentiment/view.js"),
    read("data-sources/view.js"),
    read("signals/stock-analysis/view.js"),
  ].join("\n");

  for (const eyebrow of ["MICROSTRUCTURE DESK", "MARKET TIMING", "INVESTOR SENTIMENT", "DATA SOURCE CENTER", "SINGLE STOCK TECHNICAL EVIDENCE"]) {
    assert.doesNotMatch(visibleSources, new RegExp(`eyebrow[^\\n]*${eyebrow}`));
  }
});

test("dictionary covers required terminology and preserves risk qualifiers", () => {
  const dictionary = read("docs/beginner-language-dictionary.md");
  for (const term of ["VRVP", "VWAP", "RSI", "MACD", "OHLCV", "POC", "Regime", "Impulse", "风险暴露", "回撤", "流动性", "资金背离", "证据闸门", "Client ID"]) {
    assert.match(dictionary, new RegExp(term));
  }
  for (const qualifier of ["估算", "最多", "可能", "等待", "不构成单独依据"]) {
    assert.match(dictionary, new RegExp(qualifier));
  }
});
