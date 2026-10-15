[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SubscriptionId,
    [Parameter(Mandatory)][string]$GatewayName,
    [string]$AliasName = 'claude-pilot',
    [int]$Port = 8088,
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$')][string]$ClientModelId = 'claude-sonnet-5'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$local = Join-Path $root '.local'
$null = New-Item -ItemType Directory -Path $local -Force
$tokenJson = & az account get-access-token --subscription $SubscriptionId --resource 'https://azure-api.net/aigateway' --only-show-errors -o json
if ($LASTEXITCODE -ne 0) { throw 'Cannot obtain native Entra token' }
$token = $tokenJson | ConvertFrom-Json
$tokenJson = $null
$encoded = $token.accessToken.Split('.')[1].Replace('-', '+').Replace('_', '/')
$encoded = $encoded.PadRight([int]([Math]::Ceiling($encoded.Length / 4.0) * 4), '=')
$claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded)) | ConvertFrom-Json
$groups = & (Join-Path $PSScriptRoot 'Invoke-AzureRequest.ps1') -SubscriptionId $SubscriptionId `
    -Uri "https://graph.microsoft.com/v1.0/users/$($claims.oid)/getMemberObjects" -Method Post -Body '{"securityEnabledOnly":true}'
if (-not $groups.value.Count) { throw 'Live pilot requires a resolvable existing security-group membership' }
$policy = @{
    monthlyBudgetUsd = 1000
    models = @{ $ClientModelId = @{
        deployment = $AliasName; contextTokens = 2000000; maxOutputTokens = 65536
        inputUsdPerMillion = 100; outputUsdPerMillion = 500
        cacheReadUsdPerMillion = 100; cacheWriteUsdPerMillion = 200
    } }
    clients = @{ cli = @{ applicationIds = @($(if ($claims.azp) { $claims.azp } else { $claims.appid })) } }
    businessUnits = @{ pilot = @{ groups = @($groups.value[0]); models = @($ClientModelId); clients = @('cli'); monthlyBudgetUsd = 1000 } }
    tiers = @{ validation = @{ groups = @($groups.value[0]); models = @($ClientModelId); clients = @('cli'); monthlyBudgetUsd = 1000; userMonthlyBudgetUsd = 1000 } }
}
$policyPath = Join-Path $local 'pilot-policy.json'
$policy | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $policyPath -Encoding utf8
$env:NODE_ENV = 'development'
$env:TENANT_ID = $claims.tid
$env:DEVELOPMENT_SUBSCRIPTION_ID = $SubscriptionId
$env:TOKEN_AUDIENCE = $claims.aud
$env:REQUIRED_SCOPE = 'Data.All'
$env:UPSTREAM_MODE = 'native'
$env:UPSTREAM_BASE_URL = "https://$GatewayName.azure-api.net/default/models/anthropic"
$env:LOCAL_SQLITE_PATH = Join-Path $local 'pilot.db'
$env:POLICY_FILE = $policyPath
$env:GRAPH_CACHE_SECONDS = '0'
$env:PORT = [string]$Port
$token = $null
Set-Location $root
& node (Join-Path $root 'dist\src\main.js')
if ($LASTEXITCODE -ne 0) { throw 'Local live pilot exited with an error' }
