# ADR-0002: Request-time identity and transactional USD reservations

Status: accepted. Date: 2026-10-15.

## Context and conflicting evidence

The reference accelerator uses Entra identity, tier groups, APIM policies, named
values and projected membership. Its `docs/AI-GATEWAY-TIER.md` records newer native
costLimit support than Microsoft Learn's July policy list. Treat newer measured
evidence as a reason to live-test, not to conclude cost policies do not exist.
The reference reports model runtime 404s despite successful ARM provisioning.

## Decision

Build an independent TypeScript service. Retain the reference's good boundary:
developers authenticate individually; only server identities access Foundry.
Do not copy its per-person named values, fixed tier names or sync/reconciliation
jobs. Membership comes from Graph, never client-supplied BU/tier headers.

Store one versioned policy document and an indexed transactional budget ledger.
Use SQLite only for local development and functional tests; use PostgreSQL for
multiple service replicas. Lock budget rows in deterministic order in one
transaction for org, BU, BU/tier and person calendar-month budgets.
Prices use integer micro-USD, rounding charges upward. Reserve the configured
maximum input context at the highest configured input/cache price, plus maximum
output before inference. Settle against reported usage, retaining the full hold
when usage is missing, inconsistent, interrupted or exceeds the ceiling.
This sacrifices admission efficiency for conservative list-price enforcement.

Support explicit upstream modes: native AI Gateway for centralized routing and
native guardrails, or direct Foundry for a separately labelled path. No automatic
fallback that bypasses native policy. Never distribute gateway runtime keys.
Native cost limits are an additional guardrail, not the authoritative person/BU
ledger: published per-key semantics and cross-instance overshoot differ.

No paid tool execution is supported until its price can be reserved. Prices,
context limits and deployed model names are operator configuration, not guessed.
Do not claim credits, free inference, exact invoices, 50k concurrent users, or
an eight-hour soak without evidence.

## Tradeoffs and alternatives

Native-key-per-person was rejected: unpublished key limits, key lifecycle at 50k,
and no Entra application/user boundary. Azure Table/Cosmos compensating writes
would complicate cross-scope atomicity. PostgreSQL has a nonzero cost floor but
keeps budget correctness testable. Consumption compute can scale to zero; neither
database nor model usage is promised free. Org-wide row locks serialize admissions
at high traffic; measure and partition the financial domain before claiming
high concurrent throughput.

The initial charter's generated limits remain unchanged. Declare actual npm
commands once tests exist; this strengthens rather than relaxes the contract.

## Sources

- https://github.com/naveenneog/claude-code-foundry-gateway/blob/main/docs/AI-GATEWAY-TIER.md
- https://learn.microsoft.com/azure/api-management/ai-gateway-govern-secure-assets
- https://learn.microsoft.com/azure/api-management/ai-gateway-manage-models-tools
- https://learn.microsoft.com/graph/api/directoryobject-getmemberobjects

## 2026-10-15 evidence amendment

The live portal's published changelog is newer again: September 24 adds native
Entra access and model aliases; October 1 adds claim-based USD overrides.
The initial Learn-based assumption that native Entra is unavailable is withdrawn.
Live verification is still required. Native per-identity budget overrides do not,
by themselves, prove aggregate BU budget enforcement or intersection of two
independent group dimensions. Keep the small governance service for that contract
and strict pre-reservation semantics; use native features wherever measured.
Do not grant developer identities a direct upstream route that bypasses it.
Source: https://ai.gateway.azure.com/docs, public portal bundle
`/assets/index-CjhCTla2.js`, retrieved 2026-10-15.
