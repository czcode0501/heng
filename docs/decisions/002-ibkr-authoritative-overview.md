# ADR-002: Make the overview use authoritative IBKR account snapshots

## Status

Accepted

## Date

2026-08-15

## Contract

`POST /api/broker-accounts/snapshot` remains read-only and additive. For IBKR it returns:

- account net liquidation, stock market value, total cash and the TWS account-update time;
- position quantity, average cost, current market price, market value, cost basis, unrealized P&L, unrealized return percentage and realized P&L;
- metadata identifying `IBKR TWS Account Window` as the source and 180 seconds as the documented account-window cadence.

Missing broker fields are `null` and render as unavailable. The application must never backfill them from Yahoo, BaoStock, the research portfolio, or a calculated placeholder.

## Refresh and persistence

After a successful IBKR sync, the browser may persist only loopback host, socket port and Client ID so the overview can reconnect automatically. It must not persist account IDs, passwords, holdings, cash, prices, P&L or local broker data.

The overview refreshes the read-only snapshot every three minutes while the page is open. This is described as broker-authoritative account data, not tick-by-tick real-time market data.

## Source

Interactive Brokers documents `reqAccountUpdates` as returning the same data as the TWS Account Window. `updatePortfolio` supplies market price, market value, average cost and unrealized/realized P&L. Account-window values normally update after a position change or on the fixed three-minute interval.

https://www.interactivebrokers.com/docs/tws-api/doc/account-portfolio-data/account-updates/receiving-account-updates
