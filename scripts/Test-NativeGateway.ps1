[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SubscriptionId,
    [Parameter(Mandatory)][string]$ResourceGroup,
    [Parameter(Mandatory)][string]$GatewayName,
    [string]$AliasName = 'claude-pilot',
    [ValidateSet('Entra', 'Key')][string]$Authentication = 'Entra'
)
$ErrorActionPreference = 'Stop'
$base = "https://management.azure.com/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup/providers/Microsoft.ApiManagement/service/$GatewayName"
$keyId = "$base/apiKeys/pilot-verification"
$version = '?api-version=2025-09-01-preview'
$body = '{"properties":{"displayName":"Isolated pilot verification"}}'
$payload = New-TemporaryFile
try {
    if ($Authentication -eq 'Key') {
        Set-Content -LiteralPath $payload.FullName -Value $body -Encoding utf8
        $null = & az rest --method put --url "$keyId$version" --body "@$($payload.FullName)" --output none
        if ($LASTEXITCODE -ne 0) { throw 'Cannot create isolated verification key' }
        $keys = & az rest --method post --url "$keyId/listSecrets$version" --only-show-errors --output json | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0 -or -not $keys.primaryKey) { throw 'Cannot obtain verification credential' }
        $headers = @{ 'api-key' = $keys.primaryKey; 'anthropic-version' = '2023-06-01' }
    } else {
        $token = & az account get-access-token --subscription $SubscriptionId --resource 'https://azure-api.net/aigateway' --only-show-errors -o json | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0 -or -not $token.accessToken) { throw 'Cannot obtain Entra verification token' }
        $headers = @{ Authorization = "Bearer $($token.accessToken)"; 'anthropic-version' = '2023-06-01' }
    }
    $request = @{ model = $AliasName; max_tokens = 16; messages = @(@{ role = 'user'; content = 'Reply with only OK.' }) } | ConvertTo-Json -Depth 5
    $response = Invoke-WebRequest -Uri "https://$GatewayName.azure-api.net/default/models/anthropic/v1/messages" -Method Post -Headers $headers -Body $request -ContentType 'application/json' -SkipHttpErrorCheck -TimeoutSec 90
    [pscustomobject]@{ mode = 'native-ai-gateway'; status = [int]$response.StatusCode; body = $response.Content } | ConvertTo-Json -Depth 8
    if ($response.StatusCode -ne 200) { throw "Native inference returned HTTP $($response.StatusCode)" }
} finally {
    Remove-Item -LiteralPath $payload.FullName
    $keys = $null
    $token = $null
    if ($Authentication -eq 'Key') {
        $null = & az rest --method delete --url "$keyId$version" --output none
        if ($LASTEXITCODE -ne 0) { Write-Warning 'Verification key cleanup failed; revoke pilot-verification before sharing the gateway.' }
    }
}
