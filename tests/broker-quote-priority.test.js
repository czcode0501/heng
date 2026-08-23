import test from "node:test";
import assert from "node:assert/strict";

import { preferBrokerQuote } from "../broker-quote-priority.js";

const yahoo = { providerSymbol: "AAPL", price: 220, previousClose: 218, source: "Yahoo Finance" };

test("IBKR account price wins only for a matching valid US position", () => {
  const snapshot = {
    timestamp: "2026-08-16T14:01:00Z",
    meta: { priceSource: "IBKR TWS Account Window", snapshotState: "live" },
    positions: [{ symbol: "AAPL", currency: "USD", marketPrice: 224.5 }],
  };
  const quote = preferBrokerQuote({ symbol: "AAPL", currency: "USD" }, yahoo, snapshot);

  assert.equal(quote.price, 224.5);
  assert.equal(quote.previousClose, 218);
  assert.match(quote.source, /IBKR/);
  assert.equal(quote.marketDataType, "account-valuation");
});

test("invalid, unmatched, and non-US broker prices fall back to the original quote", () => {
  const snapshot = { positions: [{ symbol: "AAPL", currency: "USD", marketPrice: 0 }] };
  assert.deepEqual(preferBrokerQuote({ symbol: "MSFT", currency: "USD" }, yahoo, snapshot), yahoo);
  assert.deepEqual(preferBrokerQuote({ symbol: "AAPL", currency: "USD" }, yahoo, snapshot), yahoo);
  assert.deepEqual(preferBrokerQuote({ symbol: "600519", currency: "CNY" }, yahoo, snapshot), yahoo);
});

