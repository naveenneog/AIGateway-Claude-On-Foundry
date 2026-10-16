# Status

**Active packet:** none (P-6 complete with disclosed failures)
**State:** DONE
**Branch:** main

## Acceptance and evidence

- Entra verification and live transitive Graph membership; no projected roster.
- BU AND tier AND combination allowlists; configurable pair/person/output budgets.
- Anthropic JSON/SSE; missing, partial, failed and disconnected usage retains holds.
- Admin policy CAS; no live policy overwrite on process restart.
- Isolated CLI profile, refreshed JWT helper, no saved tokens.
- Real installed Claude Code returned OK through the governed native FDPO path.

Forty-two unit/integration/TCP tests pass, strict TypeScript and build pass.
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
- P-5 `f371edc`: current-code 50k population measurement and public publication.
- CI diagnostics `6277b59`: preserve PostgreSQL failure context and independent
  OS results. [Observed Ubuntu/Windows CI pass](https://github.com/naveenneog/AIGateway-Claude-On-Foundry/actions/runs/38789146966).
- P-6 correction `4434a65`: deterministic PostgreSQL disconnect-wait regression
  and fix; [Ubuntu/Windows CI passed](https://github.com/naveenneog/AIGateway-Claude-On-Foundry/actions/runs/38790507795).
- P-6 correction `8bc5330`: explicit account selection, scoped Graph/ARM requests
  and fail-closed verifier cleanup;
  [Ubuntu/Windows CI passed](https://github.com/naveenneog/AIGateway-Claude-On-Foundry/actions/runs/38794951979).
  Installed Claude Code also passed against this corrected live service.

Public repository: https://github.com/naveenneog/AIGateway-Claude-On-Foundry
The latest packet gate passed 26 checks with no warnings or failures.

Current population run: 50,000 simulated callers, 100 BUs x 10 tiers, 128
in-flight injected requests, 390.50 requests/sec, p95 400.92 ms. Mocked identity,
Graph and inference; exact 50,000 person rows and zero holds. See validation
scope and measured limitations; this is not a 50k-concurrent cloud test.

## Current autonomous work

An eight-hour real-live rolling validation started 2026-10-15 18:14:40 UTC and
ended 2026-10-16 02:14:40 UTC (07:44 IST); final result below.
The first completed sample passed JSON, SSE, denied model, anonymous denial and
an installed Claude Code check. Subsequent samples are authoritative.

Private evidence: ignored `.local/soak-summary.json` and `soak-events.ndjson`.
Never commit `.local`, tokens, tenant/group/person/subscription IDs or hostnames.
Do not reset the record to erase a failed sample.

Detached service handle: `live-governance-pinned-v3` (supersedes `live-governance-v4`
in the original schedule prompt). Detached measurement:
`eight-hour-live-soak`. Schedule #1 checks every 30 minutes, fixes demonstrated
failures test-first, and stops after final evidence at the deadline.
Do not stop the live service until dependent checks finish.

The 18:35 UTC sample failed during restart; Azure CLI diagnostic output broke
startup. Quiet JSON calls and a PowerShell regression address it. Real flow
passed again at 18:43 UTC. Keep the failed sample; this is a rolling engineering
run, not an uninterrupted unchanged-build certification.

Another sample at 18:56 UTC failed closed with directory_unavailable (503).
A separate real probe passed at 19:00 UTC. The original generic error cannot
establish whether credentials, transport or a Graph HTTP status caused it;
new safe diagnostics distinguish those phases on recurrence (U-10).
The diagnostic build restarted and passed readiness at 19:05 UTC.

Recurrence at 19:06 showed Graph HTTP 404. A direct credential check confirmed
the ambient default credential belonged to a different tenant. Explicit
subscription-selected CLI credentials returned the expected tenant/principal
and Graph 200. Bootstrap's implicit `az rest` authentication also returned 404
even with a subscription argument; explicit in-memory Graph/ARM bearer
authentication fixed that path without changing global Azure CLI settings.
Full real JSON/SSE/denial flow passed at 19:27 UTC, and the scheduled sample
also passed. Snapshot at 19:27: **4 passing, 4 failing**, not complete.
Failed samples and unsuccessful restart attempts have not been erased.

Failure triage at 4.7 h (23 passing, 5 failing, not complete):
1. 18:35 UTC restart: loopback refused connection; caused by Azure CLI warnings
   in JSON output, fixed in `1321cdf`.
2-4. 18:56/19:06/19:16 UTC 503s: fail-closed directory lookups; the observed
   cross-tenant credential selection was fixed in `8bc5330` (the first generic
   503 cannot be classified retroactively).
5. 21:42 UTC 502 `upstream_unavailable`: the native upstream call threw
   before a response; it was transient (all later samples passed). Token and
   transport failures were indistinguishable, so upstream errors now carry safe
   phase/cause-type diagnostics. The running pilot was not restarted mid-soak,
   so this sample remains unclassified; no retry was added because inference
   is not idempotent and Anthropic SDK clients retry 5xx by default.

## P-6 final result

Completed 2026-10-16 02:14:41 UTC after 8.00 h: **41 passed, 5 failed** of 46
samples. **Not a clean eight-hour pass**, and not an unchanged-build run. After
the credential fix, 38 of 39 samples passed; the remaining failure was one
transient upstream 502. Full sanitized table: `docs/VALIDATION.md`. Post-run
checks passed: npm test (42), test:postgres, typecheck, PowerShell regression,
packet gate. Schedule and loopback pilot were stopped after the final checks.

U-9 (PostgreSQL close race) and U-10 (credential selection) stay resolved.
A hosted rerun of the corrected build is the next honest endurance step.

## Explicit limits / next release work

Native gateway is deployed; the governance service live pilot is loopback,
not a remotely hosted production deployment. Desktop UI onboarding, managed
PostgreSQL capacity, production networking/backup/restore, invoice reconciliation
and true high-concurrency cloud SLOs are not certified. Do not manufacture claims
or new paid infrastructure merely to fill the remaining timer.
