# Roadmap

## M1: Independent, request-time governed gateway

- [x] P-1: Resolve arbitrary BU/tier/client/model policies without user projection.
  Given verified group membership, requests resolve exactly one BU and tier;
  ambiguous, absent, or disallowed entitlements fail closed.
- [x] P-2: Reserve USD ceilings atomically before forwarding.
  Concurrent requests cannot spend the same remaining org, BU, tier, or user budget.
  Missing usage and interrupted requests retain their reservations.
- [x] P-3: Serve authenticated Anthropic JSON and streaming requests.
  Native AI Gateway and direct Foundry are selectable upstreams; credentials
  never reach developers. Policy changes are versioned and effective on next request.
- [x] P-4: Deploy and exercise the FDPO live path, document measured limitations.
  Verify real inference and denied cases separately; do not substitute mocks for Azure.
- [x] P-5: Review, measure a 50,000-principal population, publish sanitized sources.
- [x] P-6: Complete eight hours of real-live rolling validation without erasing failures.
  Done 2026-10-16: 8.00 h, 41 passed / 5 failed (disclosed, not a clean pass).
  Record observed elapsed time and failure count, publish sanitized evidence and
  stop the monitoring schedule and helper service when dependent checks finish.
  Investigate U-9 if PostgreSQL CI termination recurs; preserve diagnostic logs
  and do not suppress or relabel a failing test.
  Investigate U-10 if live directory failures recur, using safe phase/status
  diagnostics. Never bypass the membership check to improve availability.

## M2: AI-Gateway-only mode (no service, no database)

- [x] P-7: Config-driven installer for native aliases, RBAC and USD caps.
  One alias per access group; RBAC on the alias; per-person cap always; group
  pool and org cap opt-in; per-person overrides; idempotent reruns that keep
  portal-added policies. Live flow 14/14 (see VALIDATION). Entra group
  principals tested live and did not grant access in the preview (U-15), so
  access is per-person User assignments.
- [ ] Optional `-ExpandGroups`: resolve group members into User assignments
  and reconcile removals on each run (a scheduled sync; not built).

## Explicit exclusions

- No edits to the reference repository or existing shared Azure workloads.
- No claim of 50,000 simultaneous inference streams from a population test.
- No claim that gateway preview pricing includes free Claude inference.
- No automatic release of uncertain reservations: this could enable overspending.
- No client executable attestation using User-Agent; OAuth client identity is not
  proof of which binary is running.
- Eight-hour soak is a separate timed measurement, not implied by a fast test run.

## Follow-on release criteria

Multi-region failover, provider billing reconciliation, managed database load tests,
private-network rollout, directory throttling at target traffic, and client binary
attestation require additional operational evidence before production approval.
