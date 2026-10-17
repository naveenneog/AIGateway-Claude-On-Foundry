# Deployment and user guide

Two components work together. Developers only ever call the governance service.

```text
Claude Code (developer)
   | Entra user token
   v
Governance service (HTTPS container)
   |-- Microsoft Graph: live group membership (no sync job)
   |-- PostgreSQL: policy, reservations, spend
   v managed identity
Azure AI Gateway (native) -> Claude deployment in Foundry
```

Status: the native gateway scripts and the Dockerfile exist. There is **no
one-command production deployment** yet for the governance service, PostgreSQL
and Entra. Live validation used a loopback governance service against real
Azure resources. Run a small hosted pilot before onboarding everyone.

## 1. Prepare

Install Node.js 24+, PowerShell 7, Azure CLI, Git and Docker.

```powershell
git clone https://github.com/naveenneog/AIGateway-Claude-On-Foundry.git
Set-Location AIGateway-Claude-On-Foundry
npm ci; npm test; npm run typecheck; npm run build
az login --tenant YOUR-TENANT-ID
```

Use a dedicated resource group. Never replace shared Foundry resources.

## 2. Deploy the native gateway and connect Claude

```powershell
.\scripts\Deploy-NativeGateway.ps1 -SubscriptionId SUB -ResourceGroup RG `
  -GatewayName UNIQUE-GATEWAY -Location eastus2

.\scripts\Connect-NativeModel.ps1 -SubscriptionId SUB -ResourceGroup RG `
  -GatewayName UNIQUE-GATEWAY `
  -FoundryAccountId /subscriptions/SUB/resourceGroups/FOUNDRY-RG/providers/Microsoft.CognitiveServices/accounts/ACCOUNT `
  -FoundryEndpoint https://ACCOUNT.services.ai.azure.com/ `
  -DeploymentName CLAUDE-DEPLOYMENT -ModelVersion VERSION -AliasName claude-pilot
```

**Change the sample native cost policy before onboarding.** It is USD 1/day
per calling identity. All developers reach the gateway through the governance
service's single identity, so the sample cap would block everyone together.
Set it as a deliberate outer safety cap.

Never give developers native gateway keys or invoke roles; that bypasses the
pooled budgets.

## 3. Entra setup

| Item | Configuration |
|---|---|
| API application | Single tenant; delegated scope `Gateway.Invoke`; app role `Gateway.Admin` |
| Admins | Assign `Gateway.Admin` only to policy operators |
| Client families | `clients.<name>.applicationIds` must equal the token's actual `azp`/`appid` |
| BU groups | e.g. `AI-BU-Engineering`, `AI-BU-Finance` |
| Tier groups | e.g. `AI-Tier-Builder`, `AI-Tier-Analyst`, `AI-Tier-Sandbox` |
| Runtime managed identity | Graph permission for `getMemberObjects` (admin consent); **AI Gateway Models User** on the gateway; database secret access |

The supplied token helper uses Azure CLI, so the CLI client must be allowed
to request your API scope and its client ID must be in the policy. A new
client ID in the policy does not by itself create a sign-in flow, and a client
ID does not prove which desktop binary is running.

Each developer must match **exactly one** BU group and **one** tier group.
Missing or multiple matches are denied.

## 4. Write the policy

Copy `config/policy.example.json` to a private file and replace every
placeholder group and application ID. **Verify prices, context and output
ceilings**; the example prices are illustrative.

| Scope | Field | Example |
|---|---|---:|
| Organisation | `monthlyBudgetUsd` | 5000 |
| BU pool | `businessUnits.<bu>.monthlyBudgetUsd` | 2000 |
| BU x tier pool | `tiers.<tier>.monthlyBudgetUsd` or `businessUnits.<bu>.tierOverrides.<tier>.monthlyBudgetUsd` | 800 |
| Each person | `tiers.<tier>.userMonthlyBudgetUsd` or the BU override | 60 |
| Output cap | `maxOutputTokens` on tier or override | 8192 |
| Models / clients | `models`, `clients` on BU, tier, override (intersection) | |

All four USD counters are checked atomically per request and reset each UTC
month. Reservations use the model's configured maximum input context plus the
requested output, so a small remaining balance can deny a cheap prompt.
Missing or uncertain usage keeps its hold.

## 5. Host the governance service

```powershell
docker build -t REGISTRY.azurecr.io/claude-governance:v1 .
docker push REGISTRY.azurecr.io/claude-governance:v1
```

Deploy to Azure Container Apps (consumption) with HTTPS ingress on port 8080,
a managed identity, probes `/healthz` and `/readyz`, request timeout above the
service's 110-second upstream bound, and a durable PostgreSQL with verified
TLS, backups and alerts. Scale-to-zero lowers idle cost but adds cold starts;
PostgreSQL and inference still cost money.

Azure Functions Flex Consumption is a supported alternative host, but the port
is not implemented yet. See [ADR-0003](adr/0003-hosting-container-apps-or-functions.md)
for why Container Apps is the default and what a Functions port requires.

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `TENANT_ID` | Tenant GUID |
| `TOKEN_AUDIENCE` | Actual audience in issued tokens |
| `REQUIRED_SCOPE` | `Gateway.Invoke` |
| `UPSTREAM_MODE` | `native` |
| `UPSTREAM_BASE_URL` | `https://GATEWAY.azure-api.net/default/models/anthropic` |
| `DATABASE_URL` | Secret reference, `sslmode=verify-full` |
| `GRAPH_CACHE_SECONDS` | `0` |
| `POLICY_FILE` | Path to your approved policy in the container |

`POLICY_FILE` seeds an **empty** database once. Restarting with an edited file
does not change the live policy; use the admin API. Production rejects SQLite.

## 6. Developer guide

Prerequisite: an admin has added you to one BU group and one tier group.

```powershell
az login --tenant YOUR-TENANT-ID
New-Item -ItemType Directory -Path .local -Force
.\scripts\Install-ClaudeGateway.ps1 `
  -GatewayUrl https://YOUR-GOVERNANCE-SERVICE `
  -TokenResource api://YOUR-API-APPLICATION-ID `
  -SettingsPath .local\claude.settings.json `
  -Model gateway-sonnet
claude --settings .local\claude.settings.json
```

- The profile is separate, never overwrites existing settings, and stores no
  token; a helper fetches fresh Entra tokens.
- Keep the scripts where they are; the profile references the helper path.
- Use your policy's model key (e.g. `gateway-sonnet`), not `sonnet`/`opus`/`haiku`.
- Claude Desktop onboarding is **not validated**; do not roll it out from this
  CLI example.

## 7. Administrator guide

- **Membership:** change Entra groups. No sync step; the next request uses
  Graph's current view (subject to Entra propagation).
- **Budgets, models, clients:** edit the full policy file and apply it:

```powershell
.\scripts\Set-GatewayPolicy.ps1 -GatewayUrl https://YOUR-GOVERNANCE-SERVICE `
  -PolicyFile config\policy.production.json -TokenResource api://YOUR-API-APPLICATION-ID
```

  Requires `Gateway.Admin`. Version checking rejects concurrent stale writes.
- **Usage:** `GET /admin/usage` returns **global** request count, settled and
  held micro-USD only. Per-BU/person reporting is not implemented yet.

| Error | Meaning |
|---|---|
| `invalid_token` | Wrong sign-in, tenant, audience or scope |
| `membership_required` | No configured BU or tier group |
| `ambiguous_membership` | More than one BU or tier group |
| `tier_not_allowed` | BU does not permit that tier |
| `model_not_allowed` / `client_not_allowed` | Policy denies the model or client |
| `budget_exceeded` | A monthly cap cannot hold the reservation |
| `output_limit_exceeded` | Requested output above the configured limit |
| `directory_unavailable` | Graph or its credential failed; denied safely |
| `upstream_unavailable` | Upstream token or model request failed |

## 8. Go-live checklist

On the hosted deployment verify: an allowed user succeeds, an unassigned user
is denied, a budget denial occurs, streaming works, a live policy update takes
effect, and removing a group member denies the next request. The eight-hour
pilot recorded 41 passed and 5 failed samples; it is not production
certification. See [VALIDATION.md](VALIDATION.md) and [SETUP.md](SETUP.md).
