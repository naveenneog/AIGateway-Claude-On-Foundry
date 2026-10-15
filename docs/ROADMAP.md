# Roadmap

## M1: Independent, request-time governed gateway

- [x] P-1: Resolve arbitrary BU/tier/client/model policies without user projection.
  Given verified group membership, requests resolve exactly one BU and tier;
  ambiguous, absent, or disallowed entitlements fail closed.
- [x] P-2: Reserve USD ceilings atomically before forwarding.
  Concurrent requests cannot spend the same remaining org, BU, tier, or user budget.
  Missing usage and interrupted requests retain their reservations.
- [ ] P-3: Serve authenticated Anthropic JSON and streaming requests.
  Native AI Gateway and direct Foundry are selectable upstreams; credentials
  never reach developers. Policy changes are versioned and effective on next request.
- [ ] P-4: Deploy and exercise the FDPO live path, document measured limitations.
  Verify real inference and denied cases separately; do not substitute mocks for Azure.
- [ ] P-5: Review, measure a 50,000-principal population, publish sanitized sources.

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
