[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SubscriptionId,
    [Parameter(Mandatory)][string]$ResourceGroup,
    [Parameter(Mandatory)][string]$GatewayName,
    [string]$AliasName = 'claude-pilot'
)
$ErrorActionPreference = 'Stop'
$url = "https://management.azure.com/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup/providers/Microsoft.ApiManagement/service/$GatewayName/workspaces/default/aliases/$AliasName"
$url += '?api-version=2025-09-01-preview'
$azureRequest = Join-Path $PSScriptRoot 'Invoke-AzureRequest.ps1'
$original = & $azureRequest -SubscriptionId $SubscriptionId -Uri $url
$token = & az account get-access-token --subscription $SubscriptionId --resource 'https://azure-api.net/aigateway' --only-show-errors -o json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Cannot obtain native runtime token' }
$restore = New-TemporaryFile
$experiment = New-TemporaryFile
try {
    @{ properties = @{ policies = $original.properties.policies } } | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $restore.FullName -Encoding utf8
    $policies = @($original.properties.policies | Where-Object { $_.id -ne 'pilot-daily' })
    $policies += @{ type = 'costLimit'; id = 'pilot-daily'; amount = 0.000001; period = 'day'; counterKey = @('identity'); scope = 'resource' }
    @{ properties = @{ policies = $policies } } | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $experiment.FullName -Encoding utf8
    $null = & $azureRequest -SubscriptionId $SubscriptionId -Uri $url -Method Patch -Body (Get-Content -LiteralPath $experiment.FullName -Raw)
    $request = @{ model = $AliasName; max_tokens = 8; messages = @(@{ role = 'user'; content = 'Reply OK.' }) } | ConvertTo-Json -Depth 5
    $headers = @{ Authorization = "Bearer $($token.accessToken)"; 'anthropic-version' = '2023-06-01' }
    $blocked = $false
    for ($attempt = 1; $attempt -le 12; $attempt++) {
        $response = Invoke-WebRequest -Uri "https://$GatewayName.azure-api.net/default/models/anthropic/v1/messages" -Method Post -Headers $headers -Body $request -ContentType 'application/json' -SkipHttpErrorCheck -TimeoutSec 90
        [pscustomobject]@{ attempt = $attempt; status = [int]$response.StatusCode; body = if ($response.StatusCode -ne 200) { $response.Content } else { 'inference succeeded before policy propagation' } } | ConvertTo-Json -Compress
        if ($response.StatusCode -eq 403 -and $response.Content -match 'LLM cost quota is exceeded') { $blocked = $true; break }
        if ($response.StatusCode -ne 200) { throw "Unexpected native status $($response.StatusCode)" }
        Start-Sleep -Seconds 10
    }
    if (-not $blocked) { throw 'Native cost cap not observed within bounded propagation window' }
} finally {
    try { $null = & $azureRequest -SubscriptionId $SubscriptionId -Uri $url -Method Patch -Body (Get-Content -LiteralPath $restore.FullName -Raw) }
    catch { throw "URGENT: native budget restore failed; original policy snapshot retained at $($restore.FullName)." }
    Remove-Item -LiteralPath $restore.FullName
    Remove-Item -LiteralPath $experiment.FullName
    $token = $null
}
