# ADR-0004: Native-only mode — AI Gateway tier without a governance service

Status: accepted (preview platform). Date: 2026-10-19.

## Context

The governance service (ADR-0001..0003) enforces BU AND tier intersection,
pooled reservations and exact USD holds, but needs a host and PostgreSQL. Many
organisations only need: who may use which Claude model, and a USD cap per
person, optionally pooled per group. The Azure AI Gateway tier (preview)
offers Entra direct access, alias-scoped RBAC and `costLimit` policies that are
visible and editable in its portal. The policy schema was taken from the
portal bundle and release notes (2025-09-01-preview API):

- `costLimit { id, amount, period, counterKey, scope, overrides[] }`.
- `counterKey ["identity"]` counts per caller (tenant + object ID).
- `counterKey []` is labelled "Policy instance": one counter for the policy.
- Overrides match exact claims, first match wins; claims never form a pool.
- Workspace `default` carries gateway-wide policies (`scope: workspace`).
- AI Gateway Models User (`a6b68e3d-…`) can be assigned at an alias scope.
- Gateway access tokens carry no `groups` claim, so claims cannot key on groups.

## Decision

Provide a second, opt-in deployment mode with **no compute and no database**:

- One **alias per access group**. The alias's single backend model is that
  group's model allowlist.
- Access is **Azure RBAC on the alias**, assigned to the Entra group. Azure
  resolves membership server-side, so there is no roster sync and no runtime
  key reaches developers.
- Per-person cap: `user-budget`, `counterKey ["identity"]`, on every alias.
- Opt-in group pool: `group-budget`, `counterKey []`, on that alias.
- Opt-in org cap: `org-budget`, `counterKey []`, `scope: workspace`.
- Optional per-person overrides via `{claims: {tid, oid}}`.
- A TypeScript planner (`src/native/plan.ts`) turns one JSON file into ordered,
  idempotent ARM operations. It uses deterministic role-assignment names and
  preserves portal-added policies whose ids it does not manage.
  `scripts/Install-NativeOnly.ps1` applies them; `-PlanOnly` prints them.

## Consequences

Kept from the governed mode: arbitrary numbers of groups and tiers, model
allowlists, per-person USD caps, optional pools, no sync, and edits in a UI.

Given up (choose the governed mode if any is required):

- No BU AND tier intersection. Each access group is one alias, and BU×tier
  combinations must be modelled as their own groups.
- A person in two groups gets two aliases and **two independent caps**.
- Budgets are per alias, not per person across aliases (the org cap is global).
- Caps are guardrails evaluated on observed cost, not reservations. In-flight
  or concurrent requests can overshoot, by about one request per caller.
- No client (CLI vs Desktop) policy. Both use the same token audience.
- RBAC and policy changes propagate in seconds to minutes (measured in VALIDATION).
- Removing an access group from config does not delete its alias; the installer warns.
- Preview platform: schema, behaviour and pricing may change. Gateway pricing is
  not a promise of free model inference.
