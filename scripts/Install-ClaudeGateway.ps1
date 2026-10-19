[CmdletBinding()]
param(
    [Parameter(Mandatory)][uri]$GatewayUrl,
    [Parameter(Mandatory)][ValidatePattern('^(api://[a-zA-Z0-9._/-]+|https://[a-zA-Z0-9._/-]+)$')][string]$TokenResource,
    [Parameter(Mandatory)][string]$SettingsPath,
    [string]$SubscriptionId,
    [Parameter(Mandatory)][ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$')][string]$Model
)
$ErrorActionPreference = 'Stop'
if ($Model -in @('sonnet', 'opus', 'haiku', 'default')) {
    throw 'Use a full model ID, not a reserved Claude CLI alias such as sonnet.'
}
if (($GatewayUrl.Scheme -ne 'https' -and -not ($GatewayUrl.IsLoopback -and $GatewayUrl.Scheme -eq 'http')) -or $GatewayUrl.UserInfo -or $GatewayUrl.Query -or $GatewayUrl.Fragment) {
    throw 'Use an HTTPS gateway URL, or HTTP loopback for a local pilot only.'
}
if (Test-Path -LiteralPath $SettingsPath) { throw 'Settings path already exists. Choose a new profile; existing settings are never overwritten.' }
$helper = Join-Path $PSScriptRoot 'Get-GatewayToken.ps1'
$command = "pwsh -NoProfile -File `"$helper`" -Resource `"$TokenResource`""
if ($SubscriptionId) {
    if ($SubscriptionId -notmatch '^[a-fA-F0-9-]{36}$') { throw 'Subscription ID must be a GUID.' }
    $command += " -SubscriptionId `"$SubscriptionId`""
}
$settings = @{
    apiKeyHelper = $command
    model = $Model
    availableModels = @($Model)
    env = @{
        ANTHROPIC_BASE_URL = $GatewayUrl.AbsoluteUri.TrimEnd('/')
        ANTHROPIC_MODEL = $Model
        ANTHROPIC_DEFAULT_SONNET_MODEL = $Model
        ANTHROPIC_DEFAULT_HAIKU_MODEL = $Model
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
        CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1'
        CLAUDE_CODE_API_KEY_HELPER_TTL_MS = '60000'
        CLAUDE_CODE_MAX_OUTPUT_TOKENS = '8192'
    }
}
$settings | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $SettingsPath -Encoding utf8
Write-Output "Created isolated Claude settings: $SettingsPath"
Write-Output 'No API keys or access tokens were saved. Use claude --settings <path>.'
