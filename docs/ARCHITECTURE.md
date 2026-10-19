# Architecture: what we are building and why

## Goal

Developers use Claude in Foundry. Entra groups decide access, allowed models,
allowed clients (Claude Code CLI or Desktop) and spend. Budgets apply at four
monthly levels: organisation, BU, BU x tier, and person. There are no
per-developer named values and no manual membership sync.

## Request path

```text
Developer (Claude Code)
   |  Entra user token
   v
Governance service (this project)
   - Entra group lookup via Microsoft Graph on every request (no sync)
   - BU AND tier rules: allowed models and clients
   - Reserve USD at org / BU / BU x tier / person, settle actual cost
   |  service managed identity
   v
Azure AI Gateway (native)
   - Model alias -> Claude deployment
   - Holds the Foundry credential; developers never receive it
   - Overall USD and rate cap as a safety net
   v
Claude in Foundry
```

| Component | Owns |
|---|---|
| Entra ID | Who is in which BU and tier group |
| Governance service + PostgreSQL | Policy, pooled and per-person budgets, model/client rules |
| Azure AI Gateway | Routing, upstream credential, outer cost/rate guardrail |
| Foundry | Claude inference |

## Why not the AI Gateway alone

Checked live and in the portal on 2026-10-15 (preview; this can change):

| Need | Native AI Gateway |
|---|---|
| Entra sign-in, routing to Claude, USD limit per caller | Yes |
| Shared BU or BU x tier budget | No: group overrides give each person a separate counter |
| Require BU AND tier membership | No built-in rule |
| Allowed models / CLI vs Desktop per group | No per-group allowlist found |
| Reserve-before-call guarantee against overspend | No: guardrail, not a reservation |

The governance service adds only those missing pieces. All requests reach the
native gateway as the service's identity, so native per-caller limits act as one
outer cap, not per-developer caps. Size that cap for the whole service.

## Hosting

The governance service is stateless; budgets live in PostgreSQL, so enforcement
is identical on any host. Default: Azure Container Apps (existing Dockerfile,
plain SSE streaming). Functions Flex Consumption is a valid alternative after a
port; see [ADR-0003](adr/0003-hosting-container-apps-or-functions.md).

## Simpler alternative: AI Gateway only

Implemented in P-7 ([guide](NATIVE-ONLY.md), [ADR-0004](adr/0004-native-only-mode.md)).
Each access group is one alias, with Azure RBAC for each person and a
per-person USD cap. Entra group assignments did not grant access in the live
preview test, so membership changes need an installer rerun. An optional
pooled group cap and a gateway-wide cap need no extra service or database. You
lose the BU-and-tier rule, no-sync membership, pools spanning several aliases,
and client control.

See [CAPABILITIES.md](CAPABILITIES.md), [ADR-0002](adr/0002-request-time-governance.md)
and the [deployment and user guide](USER-GUIDE.md).
