# Operations and financial semantics

## Ownership and consistency

Graph owns group membership; PostgreSQL owns live policy and budgets; the native
gateway/Foundry owns inference. There is no projected user roster to reconcile.
The default membership cache TTL is zero. Optional TTL is bounded to 60 seconds;
directory replication and token revocation are still Entra/Graph concerns.
Directory failure or throttling returns a failure, never an empty-success grant.

Exactly one BU and one tier must match. Multiple matches deny; there is no
"highest privilege wins" rule. Optional BU `tiers` restricts eligible tiers.
Model/client access is the intersection of BU, tier and optional combination
allowlists. A combination can change financial allowance but cannot widen access.

## Four independent monthly counters

UTC calendar-month keys are org, BU, **BU/tier pair**, and person. The tier's
`monthlyBudgetUsd` is a template for each pair, not a global tier-wide sum.
`tierOverrides` customizes that pair. The person's key is a SHA-256 pseudonym of
tenant/user, stable across BU/tier changes for the month; moving someone does
not mint a new person allowance. Moving a request across midnight does not move
its reservation or settlement to a new month.

All four counters reserve in one database transaction before dispatch. PostgreSQL
locks rows in code-unit order, independent of machine locale. Settlement locks
the reservation, updates the same stored scope keys, and is idempotent.

## What a USD cap means

This is conservative **configured list-price token accounting**, not provider
invoice accounting. Verify deployed maximum context, output, long-context
prices, cache write/read multipliers, and any contract-specific rates.

Reservation = maximum input context x highest configured input/cache price
plus requested maximum output x output price. This can deny a request whose
likely answer would be cheap. The deliberate tradeoff is bounding exposure
without relying on approximate client-side token counts.

Charges round upward to micro-USD, budgets downward. JSON usage must include
valid input/output counts. Streaming must have complete usage, message stop
and EOF. Partial usage deltas are merged; CRLF/UTF-8/chunk boundaries are handled.
Usage above configured token ceilings, missing usage, provider errors, timeouts
and client disconnects retain the original ceiling.

Successful JSON responses expose `x-budget-status: settled|held`. Streaming
cannot change response headers after completion; retained holds emit a structured
server warning and appear in `/admin/usage` as held amounts.

## Uncertain reservations

There is **no automatic TTL release**, silent refund, or scheduled "sync" that
turns an unknown request into zero spend. A process crash may leave a safe hold.
Operators must reconcile against trusted provider billing/request evidence before
any exceptional adjustment. This release intentionally provides no unsafe
bulk-refund endpoint. Keep native caps as a second guardrail.

Long-lived ledgers need a retention/archival policy. Do not delete unresolved
reservations merely to save storage. Aggregate reporting is currently global;
per-BU export, audit history and invoice reconciliation are further operations
work, not silently claimed complete.

## API operations

- `GET /healthz`: liveness, no credentials.
- `GET /readyz`: database/policy readiness, no policy details.
- `GET /v1/models`: only caller-entitled model IDs.
- `POST /v1/messages`: Anthropic JSON/SSE.
- `GET /admin/policy`: `Gateway.Admin` role, returns version.
- `PUT /admin/policy`: same role plus decimal `If-Match` version; stale writes 409.
- `GET /admin/usage`: global request count, held and settled micro-USD totals.

Anthropic `x-api-key` is accepted **only as an Entra JWT transport** for
`apiKeyHelper`. It is verified identically to Bearer auth. Conflicting credentials
are rejected. The service does not accept a static developer API key.

External request bodies are capped at 1 MiB; upstream operations have a 110-second
bound. Paid server tools are rejected. These are intentional supported-contract
limits, not claims that every future Claude client feature works.

## Security boundary

Never give clients upstream native keys or direct Foundry/native invoke roles.
Protect database connection strings and Graph/identity permissions.
Production hosting must configure TLS, ingress limits, managed identity,
network controls, database backup/restore, secret rotation and alerts.
OAuth-client identity is not proof of which public-client binary is running.

The live native verifier and loopback pilot are experiment resources. Preserve
the soak record until its result is reported, then stop the helper services and
revoke verifier access. Never delete the shared resource group to clean up a pilot.
