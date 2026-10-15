# Project charter

Build a separate low-idle-cost governance service for Claude on Foundry.
Support arbitrary BUs and tiers, server-owned model/client permissions,
per-person attribution and transactional USD caps without manual membership sync.

Correctness and fail-closed behavior take precedence over admission availability.
Only validated Entra claims identify callers. Graph owns membership, PostgreSQL
owns policy and money state, and the configured upstream owns inference.
SQLite is a single-process local adapter, not the scaling architecture.

Never write to the reference project, disclose credentials, publish tenant
identifiers or overwrite shared resources. Use a new resource group for FDPO.
Separate native AI Gateway, direct Foundry and mocks in every result.

Test first, retain RED evidence, review all five council roles, run the packet
gate and commit green work. No production-scale or eight-hour verification claim
without corresponding data.
