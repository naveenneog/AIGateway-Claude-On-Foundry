[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ConfigPath,
    [switch]$PlanOnly
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$azureRequest = Join-Path $PSScriptRoot 'Invoke-AzureRequest.ps1'
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if ((Get-Content -LiteralPath $ConfigPath -Raw) -match '00000000-0000-0000-0000-0000000000') {
    throw 'Config still contains placeholder GUIDs from the example. Replace them with real IDs.'
}
$sub = $config.subscriptionId
$gatewayId = "/subscriptions/$sub/resourceGroups/$($config.resourceGroup)/providers/Microsoft.ApiManagement/service/$($config.gatewayName)"
$workspace = "https://management.azure.com$gatewayId/workspaces/default"
$api = '?api-version=2025-09-01-preview'

function Get-Optional([string]$Uri) {
    try { & $azureRequest -SubscriptionId $sub -Uri $Uri }
    catch {
        if ($_.Exception.Response.StatusCode -eq 404 -or "$_" -match 'NotFound|ResourceNotFound') { return $null }
        throw
    }
}

function Invoke-Planner($Existing) {
    $existingFile = New-TemporaryFile
    try {
        $Existing | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $existingFile.FullName -Encoding utf8
        $configFull = (Resolve-Path -LiteralPath $ConfigPath).Path
        Push-Location $root
        try { $json = & node (Join-Path $root 'node_modules/tsx/dist/cli.mjs') (Join-Path $PSScriptRoot 'native-plan.ts') $configFull $existingFile.FullName }
        finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) { throw 'Native-only configuration is invalid; see the error above.' }
        return $json
    } finally { Remove-Item -LiteralPath $existingFile.FullName -ErrorAction SilentlyContinue }
}

# Validate the whole config before any Azure write (deploy, role grant).
$null = Invoke-Planner @{ aliases = @{}; workspace = @() }
$location = if ($config.location) { $config.location } else { 'eastus2' }

$gateway = Get-Optional "https://management.azure.com$gatewayId$api"
if (-not $gateway) {
    if ($PlanOnly) { Write-Output "PLAN deploy AI Gateway $($config.gatewayName) in $($config.resourceGroup)" }
    else {
        & (Join-Path $PSScriptRoot 'Deploy-NativeGateway.ps1') -SubscriptionId $sub -ResourceGroup $config.resourceGroup -GatewayName $config.gatewayName -Location $location | Out-Null
        $gateway = Get-Optional "https://management.azure.com$gatewayId$api"
    }
}
if ($gateway -and -not $PlanOnly) {
    $null = & az role assignment create --subscription $sub --assignee-object-id $gateway.identity.principalId --assignee-principal-type ServicePrincipal --role '53ca6127-db72-4b80-b1b0-d745d6d5456d' --scope $config.foundry.accountId --only-show-errors --output none
    if ($LASTEXITCODE -ne 0) { throw 'Cannot grant the gateway managed identity access to Foundry.' }
}

$existing = @{ aliases = @{}; workspace = @() }
if ($gateway) {
    foreach ($group in $config.accessGroups) {
        $current = Get-Optional "$workspace/aliases/$($group.alias)$api"
        if ($current) { $existing.aliases[$group.alias] = @($current.properties.policies | Where-Object { $_ }) }
    }
    $ws = Get-Optional "$workspace$api"
    if ($ws) { $existing.workspace = @($ws.properties.policies | Where-Object { $_ }) }
}
$planJson = Invoke-Planner $existing
$operations = @($planJson | ConvertFrom-Json)

foreach ($operation in $operations) {
    $uri = "https://management.azure.com$($operation.path)?api-version=$($operation.apiVersion)"
    $label = "$($operation.method) $($operation.kind) $($operation.path.Split('/')[-1])"
    if ($PlanOnly) { Write-Output "PLAN $label"; continue }
    try {
        $null = & $azureRequest -SubscriptionId $sub -Uri $uri -Method $operation.method -Body ($operation.body | ConvertTo-Json -Depth 30 -Compress)
        Write-Output "OK   $label"
    } catch {
        if ($operation.kind -eq 'role' -and "$_" -match 'RoleAssignmentExists') { Write-Output "OK   $label (already assigned)"; continue }
        throw "Failed $label`: $_"
    }
}

if ($gateway) {
    $configured = @($config.accessGroups | ForEach-Object alias)
    $live = Get-Optional "$workspace/aliases$api"
    foreach ($alias in @($live.value | ForEach-Object name)) {
        if ($alias -notin $configured) { Write-Warning "Alias '$alias' exists on the gateway but not in this config; it is left unchanged." }
    }
}
Write-Output ''
Write-Output "Developer endpoint: https://$($config.gatewayName).azure-api.net/default/models/anthropic"
foreach ($group in $config.accessGroups) {
    Write-Output "  $($group.alias): scripts\Install-ClaudeNative.ps1 -GatewayName $($config.gatewayName) -Alias $($group.alias) -SettingsPath <new-file>"
}
