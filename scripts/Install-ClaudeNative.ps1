[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[a-zA-Z][a-zA-Z0-9-]{0,49}$')][string]$GatewayName,
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9][a-z0-9-]{0,62}$')][string]$Alias,
    [Parameter(Mandatory)][string]$SettingsPath,
    [string]$SubscriptionId
)
$ErrorActionPreference = 'Stop'
$arguments = @{
    GatewayUrl = "https://$GatewayName.azure-api.net/default/models/anthropic"
    TokenResource = 'https://azure-api.net/aigateway'
    SettingsPath = $SettingsPath
    Model = $Alias
}
if ($SubscriptionId) { $arguments.SubscriptionId = $SubscriptionId }
& (Join-Path $PSScriptRoot 'Install-ClaudeGateway.ps1') @arguments
