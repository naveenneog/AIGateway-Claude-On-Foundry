# AI Gateway only: deployment and user guide

Run Claude Code on Foundry using **only the Azure AI Gateway tier (preview)**.
There is no service to host and no database. Access and USD budgets are native
gateway features, visible and editable in the AI Gateway portal. Design and
trade-offs: [ADR-0004](adr/0004-native-only-mode.md). Live evidence:
[VALIDATION.md](VALIDATION.md#native-only-mode-p-7).

```text
Developer (Claude Code) --Entra token (aud https://azure-api.net/aigateway)-->
  AI Gateway alias  <- Azure RBAC: "AI Gateway Models User" for the Entra group
    costLimit user-budget   (per person, counterKey identity)
    costLimit group-budget  (optional pool, counterKey [] = shared counter)
  gateway workspace costLimit org-budget (optional, all aliases)
  -> Foundry Claude deployment (gateway managed identity)
```

## Concepts

| You want | Configure | Native mechanism |
|---|---|---|
| A tier / BU / team | One `accessGroups[]` entry | One model alias |
| Who may use it | `principals` (Entra group IDs) | RBAC on that alias; Azure resolves membership, no sync |
| Which model | `model` | The alias's single backend model |
| USD per person | `userBudgetUsd` | `costLimit` per identity |
| Pooled USD for the group (opt-in) | `groupBudgetUsd` | `costLimit` with one shared counter |
| Gateway-wide USD cap (opt-in) | `orgBudgetUsd` | Workspace `costLimit` |
| One person gets more | `userOverrides` (`tenantId`, `objectId`) | Claim override, exact match |
| Reset period | `budgetPeriod` (`hour` … `year`, default `month`) | Calendar period of the counters |

Want "Finance × Premium"? Make it its own access group (alias + Entra group).
Groups and aliases are unlimited in the config; no per-person entries are needed.

## 1. Admin: deploy

Prerequisites: PowerShell 7, Azure CLI, Node.js 24 (`npm ci` once), a Foundry
Claude deployment, and Owner or User Access Administrator on the resource group
(to assign roles) plus rights to create the gateway.

```powershell
Copy-Item config\native-only.example.json my-gateway.json   # edit IDs, budgets
.\scripts\Install-NativeOnly.ps1 -ConfigPath my-gateway.json -PlanOnly   # preview
.\scripts\Install-NativeOnly.ps1 -ConfigPath my-gateway.json             # apply
```

The installer:
- validates the whole config first, before any Azure change;
- creates the gateway if missing (`location`: `eastus2` (default) or
  `swedencentral`, the preview regions);
- grants its managed identity access to Foundry;
- creates the provider, models and aliases;
- writes the managed budgets and assigns RBAC.

Reruns are idempotent. Placeholder GUIDs from the example are rejected.

## 2. Admin: day-2 changes

- **Add or remove a person:** change Entra group membership; no rerun needed.
  Group-based assignment is standard Azure RBAC but was **not live-tested** here
  (tenant directory quota blocked creating test groups). Deleting a direct role
  assignment revoked access in 64 s live; allow several minutes for group changes.
- **Change an amount:** edit the JSON and rerun, or edit the policy in the
  AI Gateway portal (alias → policies).
  - The installer owns only `user-budget`, `group-budget` and `org-budget`.
    A rerun resets those to the JSON values.
  - Policies you add in the portal under other ids are preserved.
- **Remove an access group:** delete it from the JSON. The installer warns that
  the alias still exists; delete the alias and its role assignment in the portal.

## 3. Developer: connect Claude Code

```powershell
az login --tenant <your-tenant>
.\scripts\Install-ClaudeNative.ps1 -GatewayName <gateway> -Alias claude-standard -SettingsPath $HOME\.claude\gateway.json
claude --settings $HOME\.claude\gateway.json
```

The profile pins the alias as the model and refreshes Entra tokens through
`apiKeyHelper`; no keys are stored. Existing settings files are never overwritten.
Claude Code warns that the alias is not in its model catalog and assumes a
200k context window; requests still work.

Budget exhausted → HTTP 403 `LLM cost quota is exceeded. Try again in …`.
No access → HTTP 403 `Access denied … Ask an administrator to grant the required Azure role`.

## Limitations (by design of the native tier)

- No BU AND tier intersection; model each combination as its own access group.
- A person in two groups gets two aliases, each with its **own** per-person cap.
- Caps are checked against cost already observed, so concurrent or in-flight
  requests can overshoot slightly. They are guardrails, not reservations.
- No CLI vs Desktop distinction (same token audience). Claude Desktop is untested.
- Group membership is not a token claim, so overrides target people, not groups.
- Preview: API version `2025-09-01-preview`, behaviour and pricing may change.
  Model usage is billed; do not assume the gateway tier makes inference free.

Need pooled budgets across *several* groups, BU AND tier rules, or client
control? Use the governed mode in the [main guide](USER-GUIDE.md).

## Verify a deployment (optional, live)

`scripts\Test-NativeOnlyFlow.ps1` checks the end-to-end flow:
- It creates two temporary managed identities and temporary aliases, and runs
  the installer.
- It verifies: access, denial, streaming, Claude Code, per-person, pool,
  override and org caps, and revocation.
- It deletes everything it created. No directory app registrations or secrets
  are created.
