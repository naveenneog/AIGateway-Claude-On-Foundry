# Status

**Active packet:** P-5 - Population measurement and public publication
**State:** GATE
**Branch:** main

## Acceptance and evidence

- Entra verification and live transitive Graph membership; no projected roster.
- BU AND tier AND combination allowlists; configurable pair/person/output budgets.
- Anthropic JSON/SSE; missing, partial, failed and disconnected usage retains holds.
- Admin policy CAS; no live policy overwrite on process restart.
- Isolated CLI profile, refreshed JWT helper, no saved tokens.
- Real installed Claude Code returned OK through the governed native FDPO path.

Thirty-eight unit/integration/TCP tests pass, strict TypeScript and build pass.
Real local PostgreSQL passed independent-pool contention/CAS/idempotency and
1,000 BU/tier pair checks. Population measurement and native Azure details are
separately scoped in `docs/VALIDATION.md`.

## Council

| Role | Verdict | Evidence |
|---|---|---|
| Architect | PASS | Independent council reviewed boundaries; pair-budget semantics now explicit. |
| Coder | PASS | Independent council's split-usage flag defect reproduced and fixed. |
| QA | PASS | Added partial-delta, byte-fragment CRLF/UTF-8, actual TCP cancellation and PG matrix coverage. |
| UX | PASS | Independent review; actionable invalid-field errors and isolated non-overwriting client profiles. |
| Security | PASS | Independent runtime specialist found no exploitable findings; prior budget-library specialist also passed. |

## RED records

- Missing gateway/identity/runtime modules before their tests.
- CLI helper JWT header returned 502 before normalization.
- Current CLI system-role message returned 400 before supported passthrough.
- Partial usage delta tests returned undefined before output-seen accumulation.
- Per-combination policy helper missing before override implementation.
- Budget rounding export missing before conservative limit rounding.

## Completed packets

- P-1 `a42733b`: arbitrary BU/tier policy; packet gate passed.
- P-2 `789e1a3`: atomic USD reservations; independent council; packet gate passed.
- P-3 `880a7e5`: authenticated JSON/SSE runtime, configurable combinations and
  installed-client integration; packet gate passed with an oversized-WIP warning.
- P-4 `1321cdf`: verified native preview deployment, quota and live/client probes;
  warning-safe startup regression. All correctness checks pass.

Current population run: 50,000 simulated callers, 100 BUs x 10 tiers, 128
in-flight injected requests, 390.50 requests/sec, p95 400.92 ms. Mocked identity,
Graph and inference; exact 50,000 person rows and zero holds. See validation
scope and measured limitations; this is not a 50k-concurrent cloud test.

## Current autonomous work

An eight-hour real-live rolling validation started 2026-10-15 18:14:40 UTC and
ends 2026-10-16 02:14:40 UTC (07:44 IST). It is **not yet a pass**.
The first completed sample passed JSON, SSE, denied model, anonymous denial and
an installed Claude Code check. Subsequent samples are authoritative.

Private evidence: ignored `.local/soak-summary.json` and `soak-events.ndjson`.
Never commit `.local`, tokens, tenant/group/person/subscription IDs or hostnames.
Do not reset the record to erase a failed sample.

Detached service handle: `live-governance-final-v2` (supersedes `live-governance-v4`
in the original schedule prompt). Detached measurement:
`eight-hour-live-soak`. Schedule #1 checks every 30 minutes, fixes demonstrated
failures test-first, and stops after final evidence at the deadline.
Do not stop the live service until dependent checks finish.

The 18:35 UTC sample failed during restart; Azure CLI diagnostic output broke
startup. Quiet JSON calls and a PowerShell regression address it. Real flow
passed again at 18:43 UTC. Keep the failed sample; this is a rolling engineering
run, not an uninterrupted unchanged-build certification.

## Remaining delivery work

Finish public repository publication and observe GitHub CI. Update this file
with the actual CI result, then use P-6 as the only active packet.
P-6 acceptance: eight elapsed hours, complete evidence and honest failure count;
rerun full checks, publish sanitized final result, stop schedule/helper service.

## Explicit limits / next release work

Native gateway is deployed; the governance service live pilot is loopback,
not a remotely hosted production deployment. Desktop UI onboarding, managed
PostgreSQL capacity, production networking/backup/restore, invoice reconciliation
and true high-concurrency cloud SLOs are not certified. Do not manufacture claims
or new paid infrastructure merely to fill the remaining timer.
