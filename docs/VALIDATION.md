# Validation evidence

Recorded 2026-10-15. No tenant, subscription, group, person, token or private
endpoint identifiers are included here.

## Live Azure / real client

| Check | Observed result |
|---|---|
| Native AIGateway preview deployment | Succeeded on FDPO in an authorized existing resource group; subscription-level new-group creation was denied |
| Foundry provider + managed identity role | ARM accepted; native inference subsequently succeeded |
| Callable alias + `AnthropicMessages` | Native Anthropic route returned 200 and `OK` |
| Native Entra authentication | 200 with the documented audience/scope |
| Native runtime key | 200; temporary verification key deleted afterward |
| Native USD quota | First tiny request 200, subsequent request 403 `LLM cost quota is exceeded`; policy restored |
| Governance JWT + live Graph + native + Foundry | JSON 200 with `x-budget-status: settled` |
| Governed native SSE | 200, output usage and complete `message_stop` observed |
| Disallowed model | 403 before upstream inference |
| Missing user authentication | 401 |
| Installed Claude Code 2.1.272 | Actual client returned `OK`; 97 input / 4 output tokens; API time 9658 ms in one smoke |

The governance service in these live checks is a loopback pilot. This does not
establish a deployed/production-sized remote governance service.

## Reproduced defects and fixes

- Locale-dependent SQL lock ordering: exact code-unit order regression failed,
  then passed after replacing `localeCompare`.
- SQLite same-connection dirty reads: a read observed uncommitted 10 before
  rollback; queued external reads now observe committed 0.
- Current Claude Code sent a system-role message: strict legacy role validation
  returned 400; native-compatible system messages now pass through.
- Reserved CLI alias expanded `sonnet` to the full model ID: installer now
  requires a full/non-reserved ID, with the configured registry matching it.
- Later partial streaming usage erased the output-seen flag: regression returned
  undefined for a complete stream; accumulated flag now preserves complete usage.
- Fractional micro-USD budget ceiling: budget rounding now goes down while charge
  rounding goes up.
- A pilot restart encountered Azure CLI diagnostic text on its JSON output and
  failed to start. Machine-readable CLI calls now suppress warnings; a mocked
  CLI startup/token-output regression passes and real JSON/SSE flow recovered.
- PostgreSQL pool close could resolve before client sockets disconnected,
  racing Linux fixture shutdown. A deterministic regression reproduced the early
  close; the adapter now waits for every connected client's end event.
- Live directory failures recurred as Graph 404. The ambient development
  credential returned a token from a different tenant. Explicit CLI account
  selection returned the expected tenant/principal and Graph 200. Bootstrap
  and native probes also use explicit subscription-selected bearer authentication,
  rather than relying on implicit `az rest` authentication.
- Native temporary-key cleanup failure previously emitted only a warning.
  A mocked regression reproduced a success-shaped result; cleanup failure now
  fails the verifier. Real temporary-key inference and deletion subsequently passed.

## Automated correctness

The suite includes policy ambiguity/denial, malformed input, spoofed client headers,
identity issuer/audience/scope checks, admin CAS, Graph failure/cache bounds,
concurrent admission, idempotent settlement, missing usage, cache pricing,
fragmented CRLF/UTF-8 SSE and a real TCP disconnect after message stop before EOF.

Real PostgreSQL is launched as an isolated local process for
`npm run test:postgres`; two independent pools verify contention and all 1,000
BU/tier pairs. This is not a managed Azure PostgreSQL throughput test.

[GitHub CI run 38789146966](https://github.com/naveenneog/AIGateway-Claude-On-Foundry/actions/runs/38789146966)
passed the Ironclad gate, real PostgreSQL test and PowerShell regression on both
Ubuntu and Windows under Node 24. Early Ubuntu attempts failed with a database
connection termination; an intermediate passing rerun did not resolve the cause.
Recurrence exposed the pool-close/disconnect race above, reproduced deterministically.
Fix `4434a65` passed both platforms in
[run 38790507795](https://github.com/naveenneog/AIGateway-Claude-On-Foundry/actions/runs/38790507795).
Current credential/cleanup fix `8bc5330` passed both platforms in
[run 38794951979](https://github.com/naveenneog/AIGateway-Claude-On-Foundry/actions/runs/38794951979),
including all 41 normal tests, real PostgreSQL and the isolated PowerShell
regressions. Installed Claude Code passed again against that corrected live build.

## Population benchmark

The current-code run at 2026-10-15 18:39 UTC processed 50,000 distinct simulated
callers / 100 BUs / 10 tiers, 128 in-flight injected requests, in 128.04 seconds
(390.50 requests/second), p95 400.92 ms, p99 582.99 ms and process RSS 336.39 MiB.
It verified 50,000 person budget rows, exact settlement and zero uncertain holds.
It used mocked identity/Graph/inference and serialized SQLite writes, not a real
Azure load test. These are local observations, not a cloud throughput guarantee.

## Eight-hour endurance measurement

Started 2026-10-15 18:14:40 UTC. Deadline 2026-10-16 02:14:40 UTC
(07:44 IST). Real governed JSON/SSE and denial probes run at 10-minute intervals,
with an isolated real Claude Code smoke approximately hourly.

**In-progress record during the run.** The ignored `.local/soak-summary.json` and
`.local/soak-events.ndjson` are the measurement record. Scheduled autonomous
follow-up checks the record and fixes demonstrated failures. Raw private runtime
data must never be committed. Any failed sample remains part of the result;
restarting or deleting evidence cannot turn the run green.

One sample at 18:35 UTC failed while the pilot was being restarted; the replacement
process hit the Azure CLI output problem above. That failure remains in the log.
The repaired process passed a separate real JSON/SSE/denial check at 18:43 UTC.
The ongoing record, including any later failures, determines the final result.

A second sample at 18:56 UTC failed with directory_unavailable (503), before
inference; a separate 19:00 UTC real probe passed. This was correct fail-closed
behavior but remains an availability failure. Later diagnostic failures exposed
the credential-selection issue above; the original generic 503 cannot be
retrospectively assigned that cause with certainty.

At 19:27 UTC, full real JSON/SSE/denial flow and the scheduled sample passed
after explicit credential selection. The record then contained **4 passing and
4 failing samples**, incomplete.

### Final result (completed 2026-10-16 02:14:41 UTC)

**Not a clean eight-hour pass.** Elapsed 8.00 h; **46 samples: 41 passed,
5 failed** (89%). The harness exited non-zero as designed because failures exist.
The build also changed during the run: the credential correction was applied by
restart near 19:25 UTC, and diagnostics commit `e0839da` was never deployed live,
so this is a rolling engineering measurement,
not an unchanged-build endurance certification.

| Failure (UTC) | Category | Disposition |
|---|---|---|
| 18:35 | Loopback service restarting; connection refused | Fixed `1321cdf` (CLI warnings broke JSON) |
| 18:56, 19:06, 19:16 | Fail-closed directory lookup, 503 | Cross-tenant credential selection fixed `8bc5330`; first 503 not retroactively classifiable |
| 21:42 | Native upstream request threw, 502 | Transient, unclassified; diagnostics added `e0839da` |

After the 19:16 credential fix: **38 of 39 samples passed** over ~6.9 h; the only
failure was the transient upstream 502. Every passing sample returned JSON 200
with settled budget, SSE 200, disallowed model 403 and anonymous 401. Passing
sample wall time (two real inferences plus denials): min 16.7 s, median 19.5 s,
max 38.1 s. Installed Claude Code ran inside 7 passing samples (every sixth);
its result is not recorded separately from the sample. Final regression after
completion: 42 unit/TCP tests, real PostgreSQL integration, typecheck, isolated
PowerShell regression and Ironclad packet gate all passed.

## Review

Independent runtime security review: PASS, no exploitable findings reported.
Independent Architect/Coder/QA/UX council reviewed the service. Its split-usage
correctness finding was reproduced and fixed, and the socket/matrix coverage
gaps were addressed. Prior budget-library security review also passed.
This is scoped engineering evidence, not production certification.

## Native-only mode (P-7)

Run 2026-10-19 (IST 17:10–17:25) on the FDPO pilot gateway by
`scripts/Test-NativeOnlyFlow.ps1`: **14 passed, 0 failed**. Two temporary
user-assigned managed identities (A, B) plus the operator user; tokens minted
in a short-lived container; temporary aliases; everything deleted afterwards
(verified: no identities, aliases or containers left; workspace policies restored).

| Check | Result |
|---|---|
| Installer applies config (provider, model, 2 aliases, workspace, 4 roles) | 9 operations OK |
| Installer rerun | idempotent, no failures |
| Member identity on its alias (RBAC at alias scope) | 200 within 3 s |
| SSE streaming | 200, `text/event-stream` |
| Identity without a role on another alias | 403 Access denied (not quota) |
| Installed Claude Code 2.1.272 through the alias | returned `NATIVE-OK` |
| Per-person cap: A exhausted | A 403 quota after 12 s; B's first call 200 (separate counter) |
| B's own counter | B 403 quota afterwards |
| Opt-in pool `counterKey []` | after A exhausted the pool, B 403 immediately: **shared** |
| Override `{tid, oid}` for B on a tiny cap | B 200 repeatedly; A 403 quota |
| Opt-in org cap on workspace | 403 quota within 12 s |
| Org cap removed via config | 200 within 2 s |
| Role assignment deleted | denied after 64 s |

Re-run after the council fixes (config checked before any Azure change,
filtered workspace snapshot, checked restore, IMDS mint retry): **14/14 PASS**,
revocation 63 s, cleanup verified (no test identities, aliases or containers;
workspace policies restored). An earlier attempt failed only at the token mint
(container IMDS not ready); cleanup still restored the workspace.

Earlier the same day the pilot alias's $1/day per-identity cap stopped a real
Claude Code session with `403 LLM cost quota is exceeded`.

Not covered: Entra **group** principals (the tenant's per-user directory-object
quota blocked creating test groups; group RBAC is standard Azure behaviour but
unverified here), Claude Desktop, overshoot size under concurrency, multi-unit
gateways, and propagation at scale.
