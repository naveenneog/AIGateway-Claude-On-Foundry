[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^(api://[a-zA-Z0-9._/-]+|https://[a-zA-Z0-9._/-]+)$')][string]$Resource,
    [string]$SubscriptionId
)
$ErrorActionPreference = 'Stop'
$arguments = @('account', 'get-access-token', '--resource', $Resource, '--output', 'json')
if ($SubscriptionId) { $arguments += @('--subscription', $SubscriptionId) }
$token = & az @arguments | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $token.accessToken) { throw 'Token acquisition failed. Run az login for the correct tenant and retry.' }
[Console]::Out.Write($token.accessToken)
