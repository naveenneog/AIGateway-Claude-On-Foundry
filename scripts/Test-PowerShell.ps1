$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$work = Join-Path $root ".local\powershell-regression-$([guid]::NewGuid().ToString('N'))"
$originalLocation = Get-Location
$null = New-Item -ItemType Directory -Path (Join-Path $work 'scripts') -Force
$global:AigatewayPowerShellTestStarted = 0
$global:AigatewayPowerShellTestToken = 'fixture.' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(
    '{"tid":"fixture","oid":"fixture","aud":"fixture","azp":"fixture"}'
)).TrimEnd('=').Replace('+', '-').Replace('/', '_') + '.signature'
function global:az {
    $global:LASTEXITCODE = 0
    if ($args -notcontains '--only-show-errors') { 'Native CLI diagnostic before JSON'; return }
    if ($args -contains 'get-access-token') { @{ accessToken = $global:AigatewayPowerShellTestToken } | ConvertTo-Json -Compress }
    elseif ($args -contains 'rest') { '{"value":["fixture-group"]}' }
    else { throw 'Unexpected Azure CLI operation in regression' }
}
function global:node { $global:AigatewayPowerShellTestStarted++; $global:LASTEXITCODE = 0 }
try {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Start-LocalLivePilot.ps1') -Destination (Join-Path $work 'scripts')
    & (Join-Path $work 'scripts\Start-LocalLivePilot.ps1') -SubscriptionId fixture -GatewayName fixture
    if ($global:AigatewayPowerShellTestStarted -ne 1) { throw 'Pilot did not start exactly once' }
    $originalOut = [Console]::Out
    $captured = [IO.StringWriter]::new()
    try {
        [Console]::SetOut($captured)
        & (Join-Path $PSScriptRoot 'Get-GatewayToken.ps1') -Resource 'api://fixture'
    } finally { [Console]::SetOut($originalOut) }
    if ($captured.ToString() -cne $global:AigatewayPowerShellTestToken) { throw 'Token helper output must contain only the token' }
    Write-Output 'PowerShell startup and token-helper warning suppression passed.'
} finally {
    Set-Location $originalLocation
    Remove-Item Function:\az
    Remove-Item Function:\node
    Remove-Variable AigatewayPowerShellTestStarted, AigatewayPowerShellTestToken -Scope Global
    Remove-Item -LiteralPath $work -Recurse -Force
}
