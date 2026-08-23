# ADR-001: Separate market-data routing from read-only broker snapshots

## Status

Accepted

## Date

2026-08-15

## Context

The application needs free delayed market data for zero-configuration use and optional access to a user's real brokerage positions. Treating a broker login as another market-data radio option would create three problems:

- a connected account could be mistaken for a real-time exchange-data entitlement;
- the web interface could begin collecting credentials or expose order capabilities before the model and risk controls are ready;
- Tonghuashun iFinD market-data APIs could be misrepresented as a retail-account position API.

## Decision

Keep market-data routing on the free delayed provider for this stage. Add a separate stateless endpoint, `POST /api/broker-accounts/snapshot`, for IBKR and QMT only.

- IBKR connections are restricted to loopback TWS / IB Gateway hosts.
- QMT connects to an existing local `userdata_mini` directory through the broker-provided `xtquant` runtime.
- The server returns one normalized, read-only snapshot with a masked account ID.
- Broker passwords, API login credentials, account IDs, and local paths are not persisted.
- No order, cancellation, or trading endpoint is exposed.
- Tonghuashun iFinD remains labelled as market-data-only unless an official retail-position interface is documented and implemented.

## Alternatives Considered

### Import broker positions directly into a saved portfolio

Rejected for the first version. Importing would mutate the user's research portfolio and make a stale snapshot look like a continuously synchronized brokerage account.

### Automate the Tonghuashun desktop client

Rejected. Screen automation is brittle, difficult to secure, and is not an official account API contract.

### Enable order methods together with position reads

Rejected. Order authority requires a separate permission model, simulation stage, audit log, idempotency controls, and portfolio-level risk limits.

## Consequences

- Broker positions appear in a separate read-only panel on the overview.
- Restarting the local API clears broker snapshots; the user must explicitly resync.
- IBKR users need the official TWS API Python package, and QMT users need their broker's xtquant environment.
- Future trading support must use a new reviewed API rather than expanding the snapshot endpoint.
