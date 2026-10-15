# Setup and deployment boundaries

## 1. Provision only the native preview gateway

Use a new resource group where authorized. If subscription-level group creation
is denied but an existing group is authorized, use unique names in that group.
Never run a complete-mode deployment or replace unrelated shared resources.

```powershell
.\scripts\Deploy-NativeGateway.ps1 `
  -SubscriptionId YOUR-SUBSCRIPTION `
  -ResourceGroup YOUR-PILOT-RG `
  -GatewayName YOUR-GLOBALLY-UNIQUE-GATEWAY `
  -Location eastus2
```

The script deploys `sku.name: AIGateway`, not a billable APIM v2 substitute.
It also creates the companion connector gateway. The current preview resource
versions are explicitly pinned; Bicep can warn that preview child-resource
schemas are unavailable even when ARM accepts them.

## 2. Connect an existing Foundry deployment

```powershell
.\scripts\Connect-NativeModel.ps1 `
  -SubscriptionId YOUR-SUBSCRIPTION `
  -ResourceGroup YOUR-PILOT-RG `
  -GatewayName YOUR-GATEWAY `
  -FoundryAccountId /subscriptions/.../providers/Microsoft.CognitiveServices/accounts/... `
  -FoundryEndpoint https://YOUR-ACCOUNT.services.ai.azure.com/ `
  -DeploymentName YOUR-DEPLOYMENT `
  -ModelVersion YOUR-DEPLOYMENT-VERSION `
  -AliasName claude-pilot
```

The native gateway's managed identity receives Foundry User only on that account.
The callable alias points to the full catalog-model child resource. Its sample
native cost policy is USD 1/day per calling identity. It is not a shared BU pool.

For temporary native Entra verification, grant your verifier identity
**AI Gateway Models User** at the new gateway's scope. Do not grant this direct
upstream access to ordinary developer identities in the governed deployment.

```powershell
.\scripts\Test-NativeGateway.ps1 -SubscriptionId YOUR-SUBSCRIPTION `
  -ResourceGroup YOUR-PILOT-RG -GatewayName YOUR-GATEWAY
.\scripts\Test-NativeBudget.ps1 -SubscriptionId YOUR-SUBSCRIPTION `
  -ResourceGroup YOUR-PILOT-RG -GatewayName YOUR-GATEWAY
```

The budget experiment modifies only its pilot alias, reads and preserves the
existing policy array, and restores it in `finally`. Use an isolated alias:
ARM updates and runtime propagation are asynchronous. A live denial's response
body currently says `LLM cost quota is exceeded`; it does not necessarily expose
the internal `LlmCostQuotaExceeded` code.

## 3. Configure the governance service

Create a single-tenant Entra API application:

- Expose delegated scope `Gateway.Invoke`.
- Define application role `Gateway.Admin` for approved policy operators.
- Use separate approved OAuth application IDs for client families.
- Give the runtime managed identity the documented Graph application permission
  required by `/users/{id}/getMemberObjects`, with tenant-admin consent.
  Verify the least-privilege choice for your directory:
  https://learn.microsoft.com/graph/api/directoryobject-getmemberobjects
- Grant only the runtime identity native **AI Gateway Models User** on the pilot
  gateway (or approved alias scope). For direct Foundry mode, grant Foundry User
  on the account instead.

The service verifies tenant, issuer, audience, signature, expiry, user ID, OAuth
client ID and delegated scope. Configure `TOKEN_AUDIENCE` to the token's actual
API audience (v2 tokens can use the application GUID rather than its URI).
No authentication bypass is provided for local development.

Development uses **AzureCliCredential**, not an ambient credential chain. Run
`az login` for the intended tenant. If you have multiple accounts/subscriptions,
set `DEVELOPMENT_SUBSCRIPTION_ID` to the intended subscription belonging to
`TENANT_ID`; otherwise the CLI credential selects the configured tenant.
The CLI process has a 15-second bound. Azure CLI rejects supplying tenant and
subscription selectors together, so the runtime uses one unambiguous selector.
Production ignores this development selector and uses managed identity.

Set `DATABASE_URL` to a durable PostgreSQL database for production. Use TLS with
certificate verification and an approved network boundary. `max: 10` pool
connections per replica must fit the database's connection budget. SQLite is
rejected in `NODE_ENV=production`; with SQLite the server binds only loopback.

`POLICY_FILE` seeds an empty database once. Replace all example identifiers and
verify prices/context/output ceilings before bootstrapping. Subsequent changes
must use the authenticated admin API, not a deployment-time overwrite.

Build the supplied Dockerfile and deploy the container on your approved platform.
For low idle cost, use consumption compute with min replicas zero and a separately
costed PostgreSQL service. This repository does not claim the governance container
was deployed or production sized merely because the native gateway was deployed.

## 4. Local FDPO-style live pilot

`Start-LocalLivePilot.ps1` derives a private policy from the signed-in verifier's
existing group membership and uses Azure CLI credentials for Graph/native calls.
Bootstrap and native probes acquire explicit subscription-selected Graph/ARM
tokens through `Invoke-AzureRequest.ps1`; they do not rely on `az rest` choosing
the intended account. The helper permits only approved HTTPS endpoints and no
redirects, and never puts bearer tokens in command arguments.
It writes only ignored `.local` data and binds loopback. Its deliberately high
illustrative price ceilings are test controls, not a price book.

This is **not** a production identity/configuration shortcut: use the dedicated
API application, managed identity, approved groups and PostgreSQL when hosting.

## 5. Client profiles and Desktop

`Install-ClaudeGateway.ps1` creates a new profile, never overwrites global Claude
settings, and stores no access token. Its helper acquires fresh Entra tokens.
It is PowerShell-based and has been tested with installed Claude Code on Windows.

Desktop allowance is enforced by the same validated OAuth-client-ID allowlist,
but the actual Desktop enterprise configuration/UI was not exercised in this
pilot. Use the supported vendor enterprise provider configuration; do not treat
a User-Agent or an invented Desktop config schema as an enforcement mechanism.
