[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SubscriptionId,
    [uri]$GatewayUrl = 'http://127.0.0.1:8088',
    [string]$Model = 'claude-sonnet-5',
    [string]$TokenResource = 'https://azure-api.net/aigateway'
)
$ErrorActionPreference = 'Stop'
$base = $GatewayUrl.AbsoluteUri.TrimEnd('/')
$ready = Invoke-RestMethod "$base/readyz" -TimeoutSec 10
if ($ready.status -ne 'ready') { throw 'Governance endpoint is not ready.' }
$token = & az account get-access-token --subscription $SubscriptionId --resource $TokenResource --only-show-errors -o json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $token.accessToken) { throw 'Cannot acquire live verification token.' }
$headers = @{ Authorization = "Bearer $($token.accessToken)" }
$watch = [Diagnostics.Stopwatch]::StartNew()
try {
    $payload = @{ model = $Model; max_tokens = 16; messages = @(@{ role = 'user'; content = 'Reply only OK.' }) }
    $json = Invoke-WebRequest "$base/v1/messages" -Method Post -Headers $headers -Body ($payload | ConvertTo-Json -Depth 6) -ContentType 'application/json' -SkipHttpErrorCheck -TimeoutSec 120
    if ($json.StatusCode -ne 200 -or $json.Headers['x-budget-status'] -ne 'settled' -or ($json.Content | ConvertFrom-Json).content[0].text.Trim() -ne 'OK') {
        throw "Live JSON inference or usage settlement failed (HTTP $($json.StatusCode))."
    }
    $payload.stream = $true
    $stream = Invoke-WebRequest "$base/v1/messages" -Method Post -Headers $headers -Body ($payload | ConvertTo-Json -Depth 6) -ContentType 'application/json' -SkipHttpErrorCheck -TimeoutSec 120
    if ($stream.StatusCode -ne 200 -or $stream.Content -notmatch 'message_stop' -or $stream.Content -notmatch '"output_tokens"') {
        throw "Live streaming inference failed (HTTP $($stream.StatusCode))."
    }
    $payload.model = 'forbidden-model'
    $deny = Invoke-WebRequest "$base/v1/messages" -Method Post -Headers $headers -Body ($payload | ConvertTo-Json -Depth 6) -ContentType 'application/json' -SkipHttpErrorCheck -TimeoutSec 30
    if ($deny.StatusCode -ne 403 -or $deny.Content -notmatch 'model_not_allowed') { throw 'Disallowed model was not rejected.' }
    $anonymous = Invoke-WebRequest "$base/v1/models" -SkipHttpErrorCheck -TimeoutSec 30
    if ($anonymous.StatusCode -ne 401) { throw 'Unauthenticated access was not rejected.' }
    [pscustomobject]@{ kind = 'live-governance-native-foundry'; timestamp = [DateTimeOffset]::UtcNow.ToString('o'); jsonStatus = 200; jsonBudgetStatus = 'settled'; streamStatus = 200; disallowedModelStatus = 403; anonymousStatus = 401; durationMilliseconds = $watch.ElapsedMilliseconds } | ConvertTo-Json -Compress
} finally { $token = $null }
