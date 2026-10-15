[CmdletBinding()]
param(
    [Parameter(Mandatory)][uri]$GatewayUrl,
    [Parameter(Mandatory)][string]$PolicyFile,
    [Parameter(Mandatory)][string]$TokenResource,
    [string]$SubscriptionId
)
$ErrorActionPreference = 'Stop'
if ($GatewayUrl.Scheme -ne 'https' -and -not ($GatewayUrl.IsLoopback -and $GatewayUrl.Scheme -eq 'http')) {
    throw 'Policy updates require HTTPS or a loopback development endpoint.'
}
$arguments = @('account', 'get-access-token', '--resource', $TokenResource, '-o', 'json')
if ($SubscriptionId) { $arguments += @('--subscription', $SubscriptionId) }
$token = & az @arguments | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $token.accessToken) { throw 'Token acquisition failed; sign in to the correct tenant.' }
try {
    $base = $GatewayUrl.AbsoluteUri.TrimEnd('/')
    $headers = @{ Authorization = "Bearer $($token.accessToken)" }
    $current = Invoke-RestMethod "$base/admin/policy" -Headers $headers -TimeoutSec 30
    $headers['If-Match'] = [string]$current.version
    $policy = Get-Content -LiteralPath $PolicyFile -Raw
    $result = Invoke-RestMethod "$base/admin/policy" -Method Put -Headers $headers -Body $policy -ContentType 'application/json' -TimeoutSec 30
    [pscustomobject]@{ appliedVersion = $result.version; effective = 'next request; no membership sync required' } | ConvertTo-Json
} finally { $token = $null }
