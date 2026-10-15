# Scale and infrastructure cost

## What 50,000 means here

The data model has no per-user named values, native keys, role assignments,
projected membership rows or sync jobs. Policy grows with BUs/tiers/combinations;
person budget rows grow lazily with actual monthly use.

`npm run scale` creates 50,000 distinct synthetic callers, 100 BUs and 10 tiers
through Fastify injection at 128 in-flight requests. It checks every response,
50,000 distinct person rows, exact aggregate settlement and zero retained holds.
Identity, Graph and inference are explicitly simulated, and SQLite serializes
writes. This measures application/policy/ledger overhead, not Azure capacity.

Separate tests exercise actual TCP requests and socket cancellation, and real
PostgreSQL with two independent pools. The PostgreSQL test covers concurrent
shared-cap admission/CAS/idempotency plus all 1,000 BU/tier pairs. It queues 100
operations at a time onto pools with up to 20 total database connections; that
does not mean 100 simultaneously executing SQL transactions.

## Capacity still depends on traffic

50,000 registered users is not 50,000 concurrent streams. For example, 5% of
50,000 people active with one request per minute is about 42 requests/second,
before retries, subagents and background requests. This is workload arithmetic,
not measured capacity or a recommended quota.

The shared org budget row serializes admissions. Short transactions and indexed
lookups keep the design simple/correct, but a very hot global pool can bottleneck.
Do not shard that financial authority casually: independent pools can overspend.
Benchmark PostgreSQL, Graph limits and model quotas at the intended traffic
before increasing replicas or promising production SLOs.

## Low-cost topology

Use one native AI Gateway preview resource, consumption compute for this service,
and a right-sized durable PostgreSQL database. Start with a small pool/replica
ceiling and scale compute to zero when appropriate. No Redis, Kubernetes,
per-user Azure resources, scheduled membership jobs or log-based budget
reconcilers are required for request admission.

The database is a nonzero idle cost floor. Additional costs can include a private
container registry, logs, private networking, backups and model inference.
Use Azure's current regional pricing/retail APIs or a cost calculator with your
actual subscription agreement. No unsupported fixed USD/month claim is made.

Graph TTL zero maximizes membership freshness but adds a directory call per
request. A bounded cache (up to 60 seconds) reduces repeated calls at the explicit
cost of revocation delay. Neither setting bypasses directory failures.

The preview portal describes the native gateway as currently free. This does
not include model tokens and is not an entitlement to free Foundry usage.
Credits and negotiated pricing belong to billing, not to this service's configured
list-price ledger.

## Required production proof

Before certifying a target deployment: run real managed PostgreSQL multi-replica
load with the full scope matrix, Graph throttling/failure drills, real-client
stream cancellation, model quota tests, backup/restore, and an observed cost
report. Publish request rate, concurrent streams, latency, error rate and billed
cost separately from population count.
