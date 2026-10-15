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

## Automated correctness

The suite includes policy ambiguity/denial, malformed input, spoofed client headers,
identity issuer/audience/scope checks, admin CAS, Graph failure/cache bounds,
concurrent admission, idempotent settlement, missing usage, cache pricing,
fragmented CRLF/UTF-8 SSE and a real TCP disconnect after message stop before EOF.

Real PostgreSQL is launched as an isolated local process for
`npm run test:postgres`; two independent pools verify contention and all 1,000
BU/tier pairs. This is not a managed Azure PostgreSQL throughput test.

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

**In progress, not yet a pass.** The ignored `.local/soak-summary.json` and
`.local/soak-events.ndjson` are the measurement record. Scheduled autonomous
follow-up checks the record and fixes demonstrated failures. Raw private runtime
data must never be committed. Any failed sample remains part of the result;
restarting or deleting evidence cannot turn the run green.

One sample at 18:35 UTC failed while the pilot was being restarted; the replacement
process hit the Azure CLI output problem above. That failure remains in the log.
The repaired process passed a separate real JSON/SSE/denial check at 18:43 UTC.
The ongoing record, including any later failures, determines the final result.

## Review

Independent runtime security review: PASS, no exploitable findings reported.
Independent Architect/Coder/QA/UX council reviewed the service. Its split-usage
correctness finding was reproduced and fixed, and the socket/matrix coverage
gaps were addressed. Prior budget-library security review also passed.
This is scoped engineering evidence, not production certification.
