# Changelog

All notable changes to AIGateway-Claude-On-Foundry, written for a **user**, not a compiler.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · [Semantic Versioning](https://semver.org).

## [Unreleased]

### Added
- Ironclad engineering discipline: charter, ledger, council and an executable gate. (P-0)
- Arbitrary BU/tier policy, intersected model/client allowlists, and fail-closed
  membership resolution without per-person projection. (P-1)
- Transactional multi-scope micro-USD reservations, cache-aware settlement,
  retained uncertain holds and versioned policy compare-and-swap. (P-2)
- Entra-authenticated JSON/SSE gateway with request-time Graph membership,
  explicit upstream modes, per-combination allowances and live admin CAS. (P-3)
- Isolated Claude CLI profile/token helper and real-client smoke scripts. (P-3)
- Native AI Gateway preview Bicep, callable Anthropic alias, live quota probes,
  50k synthetic population benchmark and timed live validation harness. (P-4/P-5)

- Deployment and user guide for administrators and developers. (docs)
- Architecture overview: AI Gateway role vs governance service, and the
  AI-Gateway-only alternative. (docs)

### Changed

### Fixed
- Current CLI system-message and full-model-ID compatibility.
- Partial streaming usage deltas no longer discard measured output counts.
- Budget limits round down while charges round up to integer micro-USD.
- Pilot startup and token helpers suppress Azure CLI warnings on machine-readable
  output; live interruption is retained in endurance evidence.
- PostgreSQL close waits for client disconnects before returning, eliminating
  the reproduced pool-bookkeeping/fixture-shutdown race.
- Directory failures include safe credential/transport/status diagnostics in
  server logs without exposing credential messages or changing fail-closed access.
- Development CLI credentials and live Azure probes select an explicit account,
  avoiding ambient cross-tenant authentication without changing global CLI state.
- Temporary-key verification fails if key revocation fails; isolated PowerShell
  regressions cover account selection, endpoint restrictions and cleanup failure.
- Upstream 502s now log whether token acquisition or the model request failed,
  with the cause type only, so transient upstream failures can be classified.

### Removed
