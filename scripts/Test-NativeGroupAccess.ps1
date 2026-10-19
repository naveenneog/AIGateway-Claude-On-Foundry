# Live check that Entra *group* membership controls access to a native alias for a signed-in user.
# Managed identities are unsuitable here: Azure caches their tokens (and group claims) for ~24 hours.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SubscriptionId,
    [Parameter(Mandatory)][string]$ResourceGroup,
    [Parameter(Mandatory)][string]$GatewayName,
    [Parameter(Mandatory)][string]$FoundryAccountId,
    [Parameter(Mandatory)][string]$FoundryEndpoint,
    [Parameter(Mandatory)][string]$Model,
    [Parameter(Mandatory)][string]$ModelVersion,
    # Existing security group you own that does not contain the signed-in user.
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F-]{36}$')][string]$GroupId,
    # Temporarily remove the signed-in user's direct grants on the gateway or above (restored afterwards).
    [switch]$SuspendDirectGrants,
    [int]$TimeoutMinutes = 90,
    [string]$EvidencePath = (Join-Path (Split-Path $PSScriptRoot) '.local\native-group-access-evidence.jsonl')
)
$ErrorActionPreference = 'Stop'
$azureRequest = Join-Path $PSScriptRoot 'Invoke-AzureRequest.ps1'
$installer = Join-Path $PSScriptRoot 'Install-NativeOnly.ps1'
$modelsUserRole = 'a6b68e3d-a1f0-4c60-8678-237c050cf4ea'
$run = (Get-Date).ToString('MMddHHmm')
$alias = "agw-g-$run"
$api = '?api-version=2025-09-01-preview'
$rolesApi = 'api-version=2022-04-01'
$gatewayId = "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup/providers/Microsoft.ApiManagement/service/$GatewayName"
$workspace = "https://management.azure.com$gatewayId/workspaces/default"
$endpoint = "https://$GatewayName.azure-api.net/default/models/anthropic/v1/messages"
$graphGroup = "https://graph.microsoft.com/v1.0/groups/$GroupId"
$location = & az group show --subscription $SubscriptionId -n $ResourceGroup --query location --only-show-errors -o tsv
$me = (& $azureRequest -SubscriptionId $SubscriptionId -Uri 'https://graph.microsoft.com/v1.0/me?$select=id').id
$configFile = Join-Path ([IO.Path]::GetTempPath()) "agw-group-test-$run.json"
$results = [Collections.Generic.List[object]]::new()
$suspended = [Collections.Generic.List[object]]::new()
$joined = $false

function Write-Evidence([hashtable]$Entry) {
    $Entry.at = (Get-Date).ToString('o')
    $Entry | ConvertTo-Json -Compress -Depth 6 | Add-Content -LiteralPath $EvidencePath
}
function Assert-Case([string]$Name, [bool]$Passed, [string]$Detail) {
    $results.Add([pscustomobject]@{ case = $Name; passed = $Passed; detail = $Detail })
    Write-Evidence @{ case = $Name; passed = $Passed; detail = $Detail }
    Write-Output ("{0} {1} - {2}" -f ($(if ($Passed) { 'PASS' } else { 'FAIL' })), $Name, $Detail)
}
function Invoke-Model {
    $token = (& az account get-access-token --subscription $SubscriptionId --resource 'https://azure-api.net/aigateway' --only-show-errors -o json | ConvertFrom-Json).accessToken
    $body = @{ model = $alias; max_tokens = 8; messages = @(@{ role = 'user'; content = 'Reply OK.' }) } | ConvertTo-Json -Depth 5
    $response = Invoke-WebRequest -Uri $endpoint -Method Post -Headers @{ Authorization = "Bearer $token"; 'anthropic-version' = '2023-06-01' } -Body $body -ContentType 'application/json' -SkipHttpErrorCheck -TimeoutSec 120
    $token = $null
    $text = "$($response.Content)"
    $result = [pscustomobject]@{ status = [int]$response.StatusCode; quota = $text -match 'cost quota is exceeded'
        body = if ($response.StatusCode -eq 200) { 'ok' } else { $text.Substring(0, [Math]::Min(160, $text.Length)) } }
    Write-Evidence @{ call = $result }
    $result
}
function Wait-Model([scriptblock]$Until, [int]$TimeoutSeconds, [int]$Interval = 30) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    do {
        $result = Invoke-Model
        if (& $Until $result) { return $result | Add-Member seconds ([int]$watch.Elapsed.TotalSeconds) -PassThru }
        Start-Sleep -Seconds $Interval
    } while ($watch.Elapsed.TotalSeconds -lt $TimeoutSeconds)
    $result | Add-Member seconds ([int]$watch.Elapsed.TotalSeconds) -PassThru
}
function Set-Membership([bool]$Member) {
    if ($Member) {
        $body = @{ '@odata.id' = "https://graph.microsoft.com/v1.0/directoryObjects/$me" } | ConvertTo-Json
        $null = & $azureRequest -SubscriptionId $SubscriptionId -Uri "$graphGroup/members/`$ref" -Method Post -Body $body
    } else {
        $null = & $azureRequest -SubscriptionId $SubscriptionId -Uri "$graphGroup/members/$me/`$ref" -Method Delete
    }
    $script:joined = $Member
}
function Get-DirectGrants {
    $all = & $azureRequest -SubscriptionId $SubscriptionId -Uri "https://management.azure.com$gatewayId/providers/Microsoft.Authorization/roleAssignments?$rolesApi&`$filter=principalId eq '$me'"
    @($all.value | Where-Object { $_.properties.roleDefinitionId -like "*/$modelsUserRole" -and $gatewayId -like "$($_.properties.scope)*" })
}

$null = New-Item -ItemType File -Force -Path $EvidencePath
Write-Evidence @{ run = $run; alias = $alias; mode = 'user-via-group' }
try {
    $members = @((& $azureRequest -SubscriptionId $SubscriptionId -Uri "$graphGroup/members?`$select=id&`$top=999").value.id)
    if ($me -in $members) { throw 'Use a group that does not already contain the signed-in user.' }
    $direct = Get-DirectGrants
    if ($direct.Count -gt 0 -and -not $SuspendDirectGrants) { throw 'The signed-in user has direct gateway access; rerun with -SuspendDirectGrants.' }
    foreach ($grant in $direct) {
        $suspended.Add($grant)
        $null = & $azureRequest -SubscriptionId $SubscriptionId -Uri "https://management.azure.com$($grant.id)?$rolesApi" -Method Delete
    }
    Write-Evidence @{ suspendedGrants = $suspended.Count }

    $config = [ordered]@{
        subscriptionId = $SubscriptionId; resourceGroup = $ResourceGroup; gatewayName = $GatewayName; location = $location
        foundry = @{ accountId = $FoundryAccountId; endpoint = $FoundryEndpoint }
        models = @(@{ name = $Model; modelVersion = $ModelVersion })
        accessGroups = @([ordered]@{ alias = $alias; model = $Model; principals = @(@{ id = $GroupId; type = 'Group' }); userBudgetUsd = 5 })
    }
    $config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $configFile -Encoding utf8
    $install = & $installer -ConfigPath $configFile 6>&1 3>&1
    Write-Evidence @{ install = @($install | ForEach-Object { "$_" }) }
    Assert-Case 'installer assigns the Entra group on the alias' (@($install | Where-Object { "$_" -like 'OK *PUT role *' }).Count -ge 1) 'group role assignment created'

    $outside = Wait-Model { param($r) $r.status -in 401, 403 -and -not $r.quota } 900
    Assert-Case 'user outside the group is denied' ($outside.status -in 401, 403 -and -not $outside.quota) "status $($outside.status) after $($outside.seconds)s"

    Set-Membership $true
    $in = Wait-Model { param($r) $r.status -eq 200 } ($TimeoutMinutes * 60)
    Assert-Case 'adding the user to the Entra group grants access (no rerun, no sync)' ($in.status -eq 200) "status $($in.status) after $($in.seconds)s"

    Set-Membership $false
    if ($in.status -eq 200) {
        $out = Wait-Model { param($r) $r.status -in 401, 403 -and -not $r.quota } ($TimeoutMinutes * 60)
        Assert-Case 'removing the user from the Entra group revokes access' ($out.status -in 401, 403 -and -not $out.quota) "denied after $($out.seconds)s"
    } else { Write-Output 'SKIP removing the user from the Entra group revokes access - access was never granted' }
} finally {
    $cleanupFailed = $false
    if ($joined) { try { Set-Membership $false } catch { $cleanupFailed = $true; Write-Warning "Remove yourself from group $GroupId manually: $_" } }
    Remove-Item -LiteralPath $configFile -ErrorAction SilentlyContinue
    $scope = "$gatewayId/workspaces/default/aliases/$alias"
    try {
        $assignments = & $azureRequest -SubscriptionId $SubscriptionId -Uri "https://management.azure.com$scope/providers/Microsoft.Authorization/roleAssignments?$rolesApi&`$filter=atScope()"
        foreach ($assignment in @($assignments.value | Where-Object { $_.id -like "$scope/*" })) {
            $null = & $azureRequest -SubscriptionId $SubscriptionId -Uri "https://management.azure.com$($assignment.id)?$rolesApi" -Method Delete
        }
        $null = & $azureRequest -SubscriptionId $SubscriptionId -Uri "$workspace/aliases/$alias$api" -Method Delete
    } catch { $cleanupFailed = $true; Write-Warning "Cleanup of alias $alias needs attention: $_" }
    foreach ($grant in $suspended) {
        try {
            $body = @{ properties = @{ roleDefinitionId = $grant.properties.roleDefinitionId; principalId = $me; principalType = $grant.properties.principalType } } | ConvertTo-Json
            $null = & $azureRequest -SubscriptionId $SubscriptionId -Uri "https://management.azure.com$($grant.id)?$rolesApi" -Method Put -Body $body
        } catch { $cleanupFailed = $true; Write-Warning "URGENT: restore your gateway role assignment $($grant.name) manually: $_" }
    }
    $restored = (Get-DirectGrants).Count
    if ($restored -lt $suspended.Count) { $cleanupFailed = $true; Write-Warning 'URGENT: direct gateway grants were not all restored.' }
    Write-Evidence @{ cleanup = 'done'; grantsRestored = $restored; cleanupFailed = $cleanupFailed }
}
$results | Format-Table -AutoSize | Out-String -Width 200 | Write-Output
if ($cleanupFailed) { throw 'Cleanup needs attention; see warnings.' }
$failed = @($results | Where-Object { -not $_.passed })
if ($failed.Count -gt 0) { throw "$($failed.Count) group-access checks failed." }
