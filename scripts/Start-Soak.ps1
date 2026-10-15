[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SubscriptionId,
    [uri]$GatewayUrl = 'http://127.0.0.1:8088',
    [ValidateRange(0.01, 24)][double]$Hours = 8,
    [ValidateRange(30, 3600)][int]$IntervalSeconds = 600,
    [string]$SettingsPath
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
Set-Location $root
$local = Join-Path $root '.local'
$null = New-Item -ItemType Directory -Path $local -Force
$started = [DateTimeOffset]::UtcNow
$deadline = $started.AddHours($Hours)
$events = Join-Path $local 'soak-events.ndjson'
$summaryPath = Join-Path $local 'soak-summary.json'
if ($SettingsPath) { $SettingsPath = (Resolve-Path -LiteralPath $SettingsPath).Path }
if (Test-Path -LiteralPath $events) { throw 'A soak record already exists. Preserve it before starting another measurement.' }
$passed = 0
$failed = 0
do {
    $sampleTime = [DateTimeOffset]::UtcNow
    try {
        $sample = & (Join-Path $PSScriptRoot 'Test-LiveFlow.ps1') -SubscriptionId $SubscriptionId -GatewayUrl $GatewayUrl | ConvertFrom-Json
        if ($SettingsPath -and $passed % 6 -eq 0) {
            $null = & (Join-Path $PSScriptRoot 'Test-ClaudeClient.ps1') -SettingsPath $SettingsPath
        }
        $passed++
        $event = @{ time = $sampleTime.ToString('o'); result = 'pass'; checks = $sample }
    } catch {
        $failed++
        $event = @{ time = $sampleTime.ToString('o'); result = 'fail'; errorType = $_.Exception.GetType().Name; message = $_.Exception.Message }
    }
    $event | ConvertTo-Json -Compress -Depth 8 | Add-Content -LiteralPath $events -Encoding utf8
    $summary = @{
        startedAt = $started.ToString('o'); deadline = $deadline.ToString('o')
        updatedAt = [DateTimeOffset]::UtcNow.ToString('o')
        requestedHours = $Hours; elapsedHours = ([DateTimeOffset]::UtcNow - $started).TotalHours
        passed = $passed; failed = $failed; complete = ([DateTimeOffset]::UtcNow -ge $deadline)
        nativeModelCallsPerSample = 2
    }
    $summary | ConvertTo-Json | Set-Content -LiteralPath $summaryPath -Encoding utf8
    if (-not $summary.complete) {
        $remaining = [Math]::Ceiling(($deadline - [DateTimeOffset]::UtcNow).TotalSeconds)
        Start-Sleep -Seconds ([Math]::Min($IntervalSeconds, [Math]::Max(1, $remaining)))
    }
} while ([DateTimeOffset]::UtcNow -lt $deadline)
$summary.complete = $true
$summary.elapsedHours = ([DateTimeOffset]::UtcNow - $started).TotalHours
$summary.updatedAt = [DateTimeOffset]::UtcNow.ToString('o')
$summary | ConvertTo-Json | Set-Content -LiteralPath $summaryPath -Encoding utf8
if ($failed -gt 0) { throw "Soak completed with $failed failed sample(s); evidence retained." }
$summary | ConvertTo-Json
