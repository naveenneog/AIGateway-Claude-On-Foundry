param([switch]$Isolated)
$ErrorActionPreference = 'Stop'
if (-not $Isolated) {
    & (Get-Process -Id $PID).Path -NoProfile -File $PSCommandPath -Isolated
    if ($LASTEXITCODE -ne 0) { throw 'Isolated PowerShell regressions failed.' }
    return
}
$root = Split-Path $PSScriptRoot
$work = Join-Path $root ".local\powershell-regression-$([guid]::NewGuid().ToString('N'))"
$originalLocation = Get-Location
$null = New-Item -ItemType Directory -Path (Join-Path $work 'scripts') -Force
$global:AigatewayPowerShellTestStarted = 0
$global:AigatewayPowerShellTestResource = ''
$global:AigatewayPowerShellTestDeleted = $false
$global:AigatewayPowerShellTestFailDelete = $false
$global:AigatewayPowerShellTestToken = 'fixture.' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(
    '{"tid":"fixture","oid":"fixture","aud":"fixture","azp":"fixture"}'
)).TrimEnd('=').Replace('+', '-').Replace('/', '_') + '.signature'
function global:az {
    $global:LASTEXITCODE = 0
    if ($args -notcontains '--only-show-errors') { 'Native CLI diagnostic before JSON'; return }
    if ($args -contains 'get-access-token') {
        $subscription = [Array]::IndexOf($args, '--subscription')
        if ($subscription -lt 0 -or $args[$subscription + 1] -cne 'fixture') { throw 'Credential must use the selected subscription' }
        $global:AigatewayPowerShellTestResource = $args[[Array]::IndexOf($args, '--resource') + 1]
        @{ accessToken = $global:AigatewayPowerShellTestToken } | ConvertTo-Json -Compress
    }
    elseif ($args -contains 'rest') {
        $subscription = [Array]::IndexOf($args, '--subscription')
        if ($subscription -lt 0 -or $args[$subscription + 1] -cne 'fixture') { throw 'REST must use the selected subscription, not ambient account state' }
        '{"value":["fixture-group"]}'
    }
    else { throw 'Unexpected Azure CLI operation in regression' }
}
function global:node { $global:AigatewayPowerShellTestStarted++; $global:LASTEXITCODE = 0 }
function global:Invoke-RestMethod {
    param($Uri, $Method, $Headers, $Body, $ContentType, $TimeoutSec, $MaximumRedirection)
    if ($Headers.Authorization -cne "Bearer $global:AigatewayPowerShellTestToken" -or $MaximumRedirection -ne 0) {
        throw 'Azure request authentication or redirect boundary failed.'
    }
    if ([string]$Uri -like 'https://graph.microsoft.com/*') { @{ value = @('fixture-group') } }
    elseif ([string]$Uri -like '*/listSecrets?*') { @{ primaryKey = $global:AigatewayPowerShellTestToken } }
    elseif ($Method -eq 'Delete') {
        if ($global:AigatewayPowerShellTestFailDelete) { throw 'Fixture cleanup failure' }
        $global:AigatewayPowerShellTestDeleted = $true
    } else { @{ authorized = $true } }
}
function global:Invoke-WebRequest {
    param($Uri, $Method, $Headers, $Body, $ContentType, [switch]$SkipHttpErrorCheck, $TimeoutSec)
    if ($Headers['api-key'] -cne $global:AigatewayPowerShellTestToken) { throw 'Native verifier did not use its isolated credential' }
    @{ StatusCode = 200; Content = '{"content":[]}' }
}
try {
    foreach ($file in Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1') {
        $ast = [Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$null, [ref]$null)
        $commands = $ast.FindAll({ param($node)
            $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'az'
        }, $true)
        foreach ($command in $commands) {
            $parts = @($command.CommandElements | ForEach-Object { $_.Extent.Text })
            if ($parts -contains 'rest') {
                throw "Implicit Azure REST authentication in $($file.Name); use Invoke-AzureRequest."
            }
        }
    }
    foreach ($name in @('Start-LocalLivePilot.ps1', 'Invoke-AzureRequest.ps1')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $work 'scripts')
    }
    & (Join-Path $work 'scripts\Start-LocalLivePilot.ps1') -SubscriptionId fixture -GatewayName fixture
    if ($global:AigatewayPowerShellTestStarted -ne 1) { throw 'Pilot did not start exactly once' }
    if ($env:DEVELOPMENT_SUBSCRIPTION_ID -cne 'fixture') { throw 'Pilot did not pin the selected subscription' }
    if ($global:AigatewayPowerShellTestResource -cne 'https://graph.microsoft.com/') { throw 'Bootstrap must request the Graph audience' }
    $azureRequest = Join-Path $PSScriptRoot 'Invoke-AzureRequest.ps1'
    $arm = & $azureRequest -SubscriptionId fixture -Uri 'https://management.azure.com/subscriptions/fixture' -Method Patch -Body '{"fixture":true}'
    if (-not $arm.authorized -or $global:AigatewayPowerShellTestResource -cne 'https://management.azure.com/') { throw 'ARM request must use its own audience' }
    foreach ($invalid in @('http://graph.microsoft.com/', 'https://untrusted.invalid/', 'https://graph.microsoft.com:8443/')) {
        $rejected = $false
        try { $null = & $azureRequest -SubscriptionId fixture -Uri $invalid }
        catch {
            if ($_.Exception.Message -notmatch 'approved HTTPS') { throw }
            $rejected = $true
        }
        if (-not $rejected) { throw 'Azure request accepted an unapproved endpoint' }
    }
    $nativeTest = Join-Path $PSScriptRoot 'Test-NativeGateway.ps1'
    $native = & $nativeTest -SubscriptionId fixture -ResourceGroup fixture -GatewayName fixture -Authentication Key | ConvertFrom-Json
    if ($native.status -ne 200 -or -not $global:AigatewayPowerShellTestDeleted) { throw 'Native verifier did not revoke its temporary key' }
    $global:AigatewayPowerShellTestFailDelete = $true
    $cleanupFailed = $false
    try { $null = & $nativeTest -SubscriptionId fixture -ResourceGroup fixture -GatewayName fixture -Authentication Key }
    catch {
        if ($_.Exception.Message -notmatch 'Verification key cleanup failed') { throw }
        $cleanupFailed = $true
    }
    if (-not $cleanupFailed) { throw 'Native verifier reported success despite failed key revocation' }
    $originalOut = [Console]::Out
    $captured = [IO.StringWriter]::new()
    try {
        [Console]::SetOut($captured)
        & (Join-Path $PSScriptRoot 'Get-GatewayToken.ps1') -Resource 'api://fixture' -SubscriptionId fixture
    } finally { [Console]::SetOut($originalOut) }
    if ($captured.ToString() -cne $global:AigatewayPowerShellTestToken) { throw 'Token helper output must contain only the token' }
    Write-Output 'PowerShell startup and token-helper warning suppression passed.'
} finally {
    Set-Location $originalLocation
    Remove-Item Function:\az
    Remove-Item Function:\node
    Remove-Item Function:\Invoke-RestMethod
    Remove-Item Function:\Invoke-WebRequest
    Remove-Variable AigatewayPowerShellTestStarted, AigatewayPowerShellTestToken, AigatewayPowerShellTestResource, AigatewayPowerShellTestDeleted, AigatewayPowerShellTestFailDelete -Scope Global
    Remove-Item -LiteralPath $work -Recurse -Force
}
