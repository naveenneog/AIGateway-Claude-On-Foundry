# AI Gateway - Claude on Foundry

Configurable business-unit, tier, model and OAuth-client governance for Claude,
backed by the **Azure API Management AI Gateway preview**.

**No per-user named values. No roster projection. No membership-sync jobs.**
Developers sign in with Entra ID. The service resolves group membership at request
time, intersects permissions and reserves USD budget before forwarding inference.

This is an independent project. The
[reference accelerator](https://github.com/naveenneog/claude-code-foundry-gateway)
was read for guidance and was not modified.

## Two deployment modes

| | **AI Gateway only** ([guide](docs/NATIVE-ONLY.md)) | **Governed** (this service) |
|---|---|---|
| Infrastructure | Gateway only; no compute, no database | Gateway + service + PostgreSQL |
| Access | RBAC per alias (one alias per access group) | Live Graph membership, BU AND tier |
| Per-person USD cap | Yes, native, editable in the portal | Yes, reserved before inference |
| Group / org pool | Opt-in, one pool per alias + gateway-wide | Org, BU, BU×tier pools, reserved |
| BU AND tier, CLI vs Desktop | No | Yes |
| Live verified | 14/14 checks, installed Claude Code | See below |

Start with **AI Gateway only** if per-person caps plus optional per-group pools
are enough: `scripts\Install-NativeOnly.ps1 -ConfigPath <file>`.

## What works

| Capability | Implementation |
|---|---|
| Any number of BUs and tiers | One validated, versioned JSON policy; no two-tier assumptions |
| BU x tier combinations | Per-combination budgets, person allowance and output limits |
| Model/client permissions | BU AND tier AND combination allowlists; no override can widen a parent |
| No manual membership sync | Live transitive Microsoft Graph membership; zero cache TTL by default |
| USD enforcement | Atomic org, BU, BU/tier and person monthly reservations |
| Concurrent replicas | PostgreSQL transactions and deterministic row-lock order |
| Claude inference | Native Anthropic JSON and SSE, including current Claude Code system messages |
| Attribution | Server-owned BU/tier/client/model and policy version; no prompt/body ledger |
| Live policy changes | Admin API with `If-Match`; takes effect on the next request |
| Local testing | SQLite adapter restricted to loopback development |

**Verified on FDPO:** native gateway provisioning, managed-identity Foundry backend,
canonical model alias, real inference, native USD quota denial, governed JSON/SSE
and installed Claude Code **2.1.272** returning `OK`.
See [validation evidence](docs/VALIDATION.md) for exactly what was measured.

**Not claimed:** a clean eight-hour soak (it completed 41 passed / 5 failed, see
validation), 50,000 concurrent
streams, exact Azure-invoice accounting, verified Claude Desktop UI onboarding,
or a fully hosted production governance-service deployment. The current live
governance pilot runs on loopback against the real Azure native gateway.

## Architecture

```text
Claude Code / approved client
  -> Entra JWT verification (issuer, audience, tenant, user, OAuth client, scope)
  -> live Graph transitive membership
  -> BU AND tier AND optional combination policy
  -> PostgreSQL: reserve org + BU + BU/tier + person USD ceilings atomically
  -> native AI Gateway: server identity, model alias, native USD/rate guardrails
  -> Foundry Claude: gateway managed identity
  <- native JSON/SSE usage
  -> settle token/cache charge or retain an uncertain hold
```

Do **not** give ordinary developers direct native gateway keys/RBAC or Foundry
access: that bypasses the aggregate budgets in this service. The temporary native
verifier grant used in live testing is not the developer deployment pattern.
Direct Foundry is an explicitly selected upstream mode, never a hidden fallback.

### Why not native AI Gateway alone?

The portal's September 24 release adds native Entra access, and October 1 adds
claim-based USD overrides. These are newer than some Learn pages and the
reference project's September test. Native Entra and USD limits work in our pilot.

But a claim override sets each matching identity's allowance; it **does not pool
spend across matching people**. A `counterKey []` limit does pool spend, but only
for one alias (verified live in P-7). The native tier cannot pool across several
aliases per BU, or intersect BU AND tier membership. This service supplies those
controls; if you don't need them, use [AI Gateway only](docs/NATIVE-ONLY.md).
See [capability assessment](docs/CAPABILITIES.md) and
[ADR-0002](docs/adr/0002-request-time-governance.md).

## Start here

Requires **Node.js 24+**, PowerShell 7 for the scripts, Azure CLI, an approved
Foundry Claude deployment, and an Entra application for this service.

```powershell
npm ci
npm test
npm run test:postgres
.\scripts\Test-PowerShell.ps1
npm run typecheck
npm run build
```

The end-to-end [deployment and user guide](docs/USER-GUIDE.md) covers hosting,
Entra, policy, developer onboarding and administration. The
[architecture overview](docs/ARCHITECTURE.md) explains what the AI Gateway does
and what this service adds.

1. Follow [setup](docs/SETUP.md) to provision the native gateway and connect an
   existing Foundry deployment. No existing Foundry resources are replaced.
2. Create your Entra API scope/application role and grant the service identity
   Graph membership-read permission. Use PostgreSQL for any hosted/multi-replica
   deployment. Configure environment variables from `.env.example`.
3. Edit `config\policy.example.json`: replace group/application IDs, choose approved
   models, and **verify all context/output/price ceilings for your deployment**.
   Its prices are illustrative configuration, not a verified Microsoft price book.
4. Bootstrap with `POLICY_FILE`, then use the admin policy API for live changes.
   `POLICY_FILE` is used only if the database has no policy; it never overwrites
   an existing live policy on restart.

```powershell
# Local development only: create .local first, configure your .env privately.
New-Item -ItemType Directory -Path .local -Force
node --env-file=.env dist\src\main.js

# Create a separate CLI profile. Existing profiles are never overwritten.
.\scripts\Install-ClaudeGateway.ps1 `
  -GatewayUrl https://YOUR-GOVERNANCE-SERVICE `
  -TokenResource api://YOUR-API-APPLICATION-ID `
  -SettingsPath .local\claude.settings.json `
  -Model gateway-sonnet

claude --settings .local\claude.settings.json
```

Use a **full/non-reserved model ID**, not `sonnet`, `opus` or `haiku` as your
gateway registry key for Claude Code. The CLI can expand those reserved aliases
to a different model name before sending the request.

## Policy example

```json
{
  "businessUnits": {
    "engineering": {
      "groups": ["<engineering-security-group-id>"],
      "models": ["gateway-sonnet"],
      "clients": ["cli", "desktop"],
      "monthlyBudgetUsd": 700,
      "tiers": ["builder", "analyst", "sandbox"],
      "tierOverrides": {
        "builder": {
          "monthlyBudgetUsd": 250,
          "userMonthlyBudgetUsd": 40,
          "maxOutputTokens": 8192
        }
      }
    }
  }
}
```

This is an excerpt; the full validated document is
[`config/policy.example.json`](config/policy.example.json).
Tier monthly budgets apply **per BU/tier pair**, not as a global tier-wide pool.
The org and BU caps still bound total exposure. The person's balance is stable
across tier/BU changes in the same UTC calendar month.

```powershell
.\scripts\Set-GatewayPolicy.ps1 `
  -GatewayUrl https://YOUR-GOVERNANCE-SERVICE `
  -PolicyFile config\policy.example.json `
  -TokenResource api://YOUR-API-APPLICATION-ID
```

This changes actual configuration; it is **not a user/membership synchronization
step**. Entra/Graph owns membership.

## Cost, scale and limitations

Native gateway preview documentation currently describes the gateway as free
during preview. **That is not free Claude inference**, PostgreSQL, containers,
logs or networking. Preview terms/pricing can change.

The service avoids a fixed APIM v2 instance and user-proportional control-plane
resources. Consumption compute can scale to zero, but PostgreSQL has a nonzero
cost floor. Fifty thousand registered users do not imply a particular request
rate, and model quotas remain independent.

The synthetic 50k population benchmark uses simulated identities/inference and
serialized SQLite writes. It is not an Azure production-capacity certification.
Actual TCP tests and real PostgreSQL concurrent tests are separate.
See [scale and cost](docs/SCALE.md).

USD admission reserves a deliberately conservative context/output ceiling,
including the highest configured cache/input price. Charges round up to micro-USD;
budget limits round down. A request can be rejected despite having enough money
for its likely short answer. Missing/partial/error/aborted usage keeps the hold.
There is **no unsafe automatic expiration** of uncertain holds.
See [operations](docs/OPERATIONS.md) before using this with real budgets.

Client allowances verify OAuth application IDs, **not executable attestation**.
A stolen/reused public-client bearer token cannot prove CLI versus Desktop.
Server-billed tools are rejected until their non-token costs can be reserved.

## Verification

```powershell
node .ironclad\gate.mjs --stage packet
npm run scale
.\scripts\Test-LiveFlow.ps1 -SubscriptionId YOUR-SUBSCRIPTION
.\scripts\Test-ClaudeClient.ps1 -SettingsPath .local\claude.settings.json
```

The eight-hour live soak result (41/46 samples passed, failures disclosed) is in
[validation](docs/VALIDATION.md). Private runtime files stay in ignored `.local`.
MIT licensed.
