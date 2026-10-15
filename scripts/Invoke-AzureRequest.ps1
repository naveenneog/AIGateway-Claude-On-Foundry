[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SubscriptionId,
    [Parameter(Mandatory)][uri]$Uri,
    [ValidateSet('Get', 'Post', 'Put', 'Patch', 'Delete')][string]$Method = 'Get',
    [string]$Body
)
$ErrorActionPreference = 'Stop'
if ($Uri.Scheme -ne 'https' -or $Uri.Port -ne 443 -or $Uri.UserInfo -or
    $Uri.Host -notin @('graph.microsoft.com', 'management.azure.com')) {
    throw 'Azure requests require an approved HTTPS Graph or ARM endpoint.'
}
$resource = if ($Uri.Host -eq 'graph.microsoft.com') { 'https://graph.microsoft.com/' } else { 'https://management.azure.com/' }
$json = & az account get-access-token --subscription $SubscriptionId --resource $resource --only-show-errors -o json
if ($LASTEXITCODE -ne 0) { throw 'Cannot obtain an Azure request token for the selected subscription.' }
$token = $json | ConvertFrom-Json
$json = $null
if (-not $token.accessToken) { throw 'Azure request token is missing.' }
try {
    $request = @{
        Uri = $Uri; Method = $Method; Headers = @{ Authorization = "Bearer $($token.accessToken)" }
        TimeoutSec = 30; MaximumRedirection = 0
    }
    if ($PSBoundParameters.ContainsKey('Body')) { $request.Body = $Body; $request.ContentType = 'application/json' }
    Invoke-RestMethod @request
} finally { $token = $null }
