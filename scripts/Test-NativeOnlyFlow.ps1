[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SubscriptionId,
    [Parameter(Mandatory)][string]$ResourceGroup,
    [Parameter(Mandatory)][string]$GatewayName,
    [Parameter(Mandatory)][string]$FoundryAccountId,
    [Parameter(Mandatory)][string]$FoundryEndpoint,
    [Parameter(Mandatory)][string]$Model,
    [Parameter(Mandatory)][string]$ModelVersion,
    [string]$EvidencePath = (Join-Path (Split-Path $PSScriptRoot) '.local\native-only-evidence.jsonl'),
    [switch]$SkipClaudeCli,
    [int]$RevocationTimeoutSeconds = 900
)
$ErrorActionPreference = 'Stop'
$azureRequest = Join-Path $PSScriptRoot 'Invoke-AzureRequest.ps1'
$installer = Join-Path $PSScriptRoot 'Install-NativeOnly.ps1'
$run = (Get-Date).ToString('MMddHHmm')
$std = "agw-t-std-$run"; $prem = "agw-t-prem-$run"; $mint = "agw-t-mint-$run"
$api = '?api-version=2025-09-01-preview'
$gatewayId = "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup/providers/Microsoft.ApiManagement/service/$GatewayName"
$workspace = "https://management.azure.com$gatewayId/workspaces/default"
$endpoint = "https://$GatewayName.azure-api.net/default/models/anthropic/v1/messages"
$account = & az account show --subscription $SubscriptionId --only-show-errors -o json | ConvertFrom-Json
$location = & az group show --subscription $SubscriptionId -n $ResourceGroup --query location --only-show-errors -o tsv
$me = (& $azureRequest -SubscriptionId $SubscriptionId -Uri 'https://graph.microsoft.com/v1.0/me?$select=id').id
$results = [Collections.Generic.List[object]]::new()
$tokens = @{}
$identities = @{}
$configFile = Join-Path ([IO.Path]::GetTempPath()) "agw-native-test-$run.json"
$settingsFile = Join-Path ([IO.Path]::GetTempPath()) "agw-native-claude-$run.json"
$workspaceSnapshot = @((& $azureRequest -SubscriptionId $SubscriptionId -Uri "$workspace$api").properties.policies | Where-Object { $_ })

function Write-Evidence([hashtable]$Entry) {
    $Entry.at = (Get-Date).ToString('o')
    $Entry | ConvertTo-Json -Compress -Depth 6 | Add-Content -LiteralPath $EvidencePath
}
function Assert-Case([string]$Name, [bool]$Passed, [string]$Detail) {
    $results.Add([pscustomobject]@{ case = $Name; passed = $Passed; detail = $Detail })
    Write-Evidence @{ case = $Name; passed = $Passed; detail = $Detail }
    Write-Output ("{0} {1} - {2}" -f ($(if ($Passed) { 'PASS' } else { 'FAIL' })), $Name, $Detail)
}
function Get-UserToken {
    (& az account get-access-token --subscription $SubscriptionId --resource 'https://azure-api.net/aigateway' --only-show-errors -o json | ConvertFrom-Json).accessToken
}
function Invoke-Model([string]$Who, [string]$Alias, [switch]$Stream) {
    $token = if ($Who -eq 'me') { Get-UserToken } else { $tokens[$Who] }
    $body = @{ model = $Alias; max_tokens = 8; messages = @(@{ role = 'user'; content = 'Reply OK.' }) }
    if ($Stream) { $body.stream = $true }
    $response = Invoke-WebRequest -Uri $endpoint -Method Post -Headers @{ Authorization = "Bearer $token"; 'anthropic-version' = '2023-06-01' } -Body ($body | ConvertTo-Json -Depth 5) -ContentType 'application/json' -SkipHttpErrorCheck -TimeoutSec 120
    $text = "$($response.Content)"
    $result = [pscustomobject]@{
        who = $Who; alias = $Alias; status = [int]$response.StatusCode
        quota = $text -match 'cost quota is exceeded'
        sse = "$($response.Headers['Content-Type'])" -match 'text/event-stream'
        body = if ($response.StatusCode -eq 200) { 'ok' } else { $text.Substring(0, [Math]::Min(200, $text.Length)) }
    }
    Write-Evidence @{ call = $result }
    $result
}
function Wait-Model([string]$Who, [string]$Alias, [scriptblock]$Until, [int]$TimeoutSeconds = 240, [int]$Interval = 10) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    do {
        $result = Invoke-Model $Who $Alias
        if (& $Until $result) { $result | Add-Member seconds ([int]$watch.Elapsed.TotalSeconds); return $result }
        Start-Sleep -Seconds $Interval
    } while ($watch.Elapsed.TotalSeconds -lt $TimeoutSeconds)
    $result | Add-Member seconds ([int]$watch.Elapsed.TotalSeconds) -PassThru | Add-Member timedOut $true -PassThru
}
function Install-Config([hashtable]$StandardSettings, [Nullable[double]]$OrgBudget) {
    $standard = [ordered]@{ alias = $std; model = $Model; principals = @(
        @{ id = $identities.a.principalId; type = 'ServicePrincipal' }, @{ id = $identities.b.principalId; type = 'ServicePrincipal' },
        @{ id = $me; type = 'User' }) }
    foreach ($key in $StandardSettings.Keys) { $standard[$key] = $StandardSettings[$key] }
    $config = [ordered]@{
        subscriptionId = $SubscriptionId; resourceGroup = $ResourceGroup; gatewayName = $GatewayName; location = $location
        foundry = @{ accountId = $FoundryAccountId; endpoint = $FoundryEndpoint }
        models = @(@{ name = $Model; modelVersion = $ModelVersion })
        accessGroups = @(
            $standard,
            [ordered]@{ alias = $prem; model = $Model; principals = @(@{ id = $me; type = 'User' }); userBudgetUsd = 5 })
    }
    if ($null -ne $OrgBudget) { $config.orgBudgetUsd = $OrgBudget }
    $config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $configFile -Encoding utf8
    $output = & $installer -ConfigPath $configFile 6>&1 3>&1
    Write-Evidence @{ install = @($output | ForEach-Object { "$_" }) }
    $output
}
function Set-AliasPolicies([object[]]$Policies) {
    $null = & $azureRequest -SubscriptionId $SubscriptionId -Uri "$workspace/aliases/$std$api" -Method Patch -Body (@{ properties = @{ policies = $Policies } } | ConvertTo-Json -Depth 10)
}
function New-TestTokens {
    $group = "https://management.azure.com/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup/providers/Microsoft.ContainerInstance/containerGroups/$mint"
    $script = 'for c in ' + $identities.a.clientId + ' ' + $identities.b.clientId + '; do for i in 1 2 3 4 5 6 7 8 9 10 11 12; do ' +
        'r=$(curl -s -H Metadata:true "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fazure-api.net%2Faigateway&client_id=$c"); ' +
        'case "$r" in *access_token*) break;; esac; echo "RETRY $c $(echo $r | head -c 200)"; sleep 10; done; printf "TOKEN %s %s\n" $c "$r"; done'
    $body = @{ location = $location; identity = @{ type = 'UserAssigned'; userAssignedIdentities = @{ $identities.a.id = @{}; $identities.b.id = @{} } }
        properties = @{ osType = 'Linux'; restartPolicy = 'Never'; containers = @(@{ name = 'mint'; properties = @{
            image = 'mcr.microsoft.com/azure-cli:latest'; command = @('/bin/sh', '-c', $script)
            resources = @{ requests = @{ cpu = 1; memoryInGB = 1.5 } } } }) } }
    try {
        $null = & $azureRequest -SubscriptionId $SubscriptionId -Uri "$group`?api-version=2023-05-01" -Method Put -Body ($body | ConvertTo-Json -Depth 10)
        for ($i = 0; $i -lt 60 -and $tokens.Count -lt 2; $i++) {
            Start-Sleep -Seconds 10
            try { $logs = (& $azureRequest -SubscriptionId $SubscriptionId -Uri "$group/containers/mint/logs?api-version=2023-05-01").content } catch { continue }
            foreach ($line in "$logs" -split "`n") {
                if ($line -match '^TOKEN (\S+) (\{.*\})') {
                    $key = if ($Matches[1] -eq $identities.a.clientId) { 'a' } else { 'b' }
                    $value = ($Matches[2] | ConvertFrom-Json).access_token
                    if ($value) { $tokens[$key] = $value }
                }
            }
        }
        if ($tokens.Count -lt 2) {
            $state = & $azureRequest -SubscriptionId $SubscriptionId -Uri "$group`?api-version=2023-05-01"
            $view = $state.properties.containers[0].properties.instanceView
            Write-Evidence @{ mintFailure = @{ group = $state.properties.instanceView.state; container = $view.currentState.state; exit = $view.currentState.exitCode
                events = @($view.events | ForEach-Object { "$($_.name): $($_.message)" }); logTail = ("$logs" -replace '"access_token":"[^"]+"', '"access_token":"***"').Substring(0, [Math]::Min(400, "$logs".Length)) } }
        }
    } finally {
        try { $null = & $azureRequest -SubscriptionId $SubscriptionId -Uri "$group`?api-version=2023-05-01" -Method Delete } catch { }
        $gone = $false
        for ($i = 0; $i -lt 12 -and -not $gone; $i++) {
            try { $null = & $azureRequest -SubscriptionId $SubscriptionId -Uri "$group`?api-version=2023-05-01"; Start-Sleep -Seconds 5 } catch { $gone = "$_" -match 'NotFound|ResourceNotFound|404' }
        }
        if (-not $gone) { Write-Warning "Delete container group $mint manually." }
    }
    if ($tokens.Count -lt 2) { throw 'Could not mint managed identity tokens.' }
}

$null = New-Item -ItemType File -Force -Path $EvidencePath
Write-Evidence @{ run = $run; gateway = 'redacted'; aliases = @($std, $prem) }
try {
    foreach ($key in 'a', 'b') {
        $identities[$key] = & az identity create --subscription $SubscriptionId -g $ResourceGroup -n "agw-t-$key-$run" --tags purpose=agw-native-test --only-show-errors -o json | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0) { throw 'Cannot create test identity.' }
    }
    $install = Install-Config @{ userBudgetUsd = 5 } $null
    Assert-Case 'installer applies config' (@($install | Where-Object { "$_" -like 'OK *' }).Count -ge 7) "$(@($install | Where-Object { "$_" -like 'OK *' }).Count) operations OK"
    $again = Install-Config @{ userBudgetUsd = 5 } $null
    Assert-Case 'installer rerun is idempotent' (-not ($again -match 'Failed')) 'second apply succeeded'
    New-TestTokens

    $a = Wait-Model 'a' $std { param($r) $r.status -eq 200 } 900 20
    Assert-Case 'member identity reaches its alias (RBAC at alias scope)' ($a.status -eq 200) "status $($a.status) after $($a.seconds)s"
    $sse = Invoke-Model 'a' $std -Stream
    Assert-Case 'SSE streaming passes through' ($sse.status -eq 200 -and $sse.sse) "status $($sse.status) sse=$($sse.sse)"
    $deny = Invoke-Model 'a' $prem
    Assert-Case 'non-member is denied on another group alias' ($deny.status -in 401, 403 -and -not $deny.quota) "status $($deny.status)"
    $mine = Invoke-Model 'me' $std
    Assert-Case 'user principal reaches alias' ($mine.status -eq 200) "status $($mine.status)"
    if (-not $SkipClaudeCli) {
        $null = & (Join-Path $PSScriptRoot 'Install-ClaudeNative.ps1') -GatewayName $GatewayName -Alias $std -SettingsPath $settingsFile -SubscriptionId $SubscriptionId
        $cli = & claude --settings $settingsFile -p 'Reply with exactly: NATIVE-OK' 2>&1
        $cliText = "$cli" -replace '\s+', ' '
        Assert-Case 'Claude Code CLI works through native alias' ($cliText -match 'NATIVE-OK') $cliText.Substring([Math]::Max(0, $cliText.Length - 120))
    }

    $tiny = 0.000001
    $null = Install-Config @{ userBudgetUsd = $tiny } $null
    $blocked = Wait-Model 'a' $std { param($r) $r.quota }
    $other = Invoke-Model 'b' $std
    Assert-Case 'per-user cap blocks A while B keeps its own counter' ($blocked.quota -and $other.status -eq 200) "A quota after $($blocked.seconds)s; B first call $($other.status)"
    $bLater = Wait-Model 'b' $std { param($r) $r.quota } 120
    Assert-Case 'B is then capped by its own counter' ($bLater.quota) "B quota=$($bLater.quota)"

    Set-AliasPolicies @(@{ type = 'costLimit'; id = 'user-budget'; amount = 5; period = 'month'; counterKey = @('identity'); scope = 'resource' })
    $null = Wait-Model 'b' $std { param($r) $r.status -eq 200 }
    Set-AliasPolicies @(@{ type = 'costLimit'; id = 'user-budget'; amount = 5; period = 'month'; counterKey = @('identity'); scope = 'resource' },
        @{ type = 'costLimit'; id = 'group-budget'; amount = $tiny; period = 'month'; counterKey = @(); scope = 'resource' })
    $poolA = Wait-Model 'a' $std { param($r) $r.quota }
    $poolB = Invoke-Model 'b' $std
    Assert-Case 'opt-in group pool (counterKey []) is shared across identities' ($poolA.quota -and $poolB.quota) "A quota=$($poolA.quota) after $($poolA.seconds)s; B quota=$($poolB.quota)"

    $null = Install-Config @{ userBudgetUsd = $tiny; userOverrides = @(@{ tenantId = $account.tenantId; objectId = $identities.b.principalId; budgetUsd = 5 }) } $null
    $override = Wait-Model 'b' $std { param($r) $r.status -eq 200 }
    $overrideA = Invoke-Model 'a' $std
    $overrideB = Invoke-Model 'b' $std
    Assert-Case 'per-user override (tid+oid) raises one identity only' ($override.status -eq 200 -and $overrideB.status -eq 200 -and $overrideA.quota) "B 200 after $($override.seconds)s; A quota=$($overrideA.quota)"

    $null = Install-Config @{ userBudgetUsd = 5 } $tiny
    $org = Wait-Model 'b' $std { param($r) $r.quota }
    Assert-Case 'opt-in org budget on gateway workspace caps everyone' ($org.quota) "quota after $($org.seconds)s"
    $null = Install-Config @{ userBudgetUsd = 5 } $null
    $restored = Wait-Model 'a' $std { param($r) $r.status -eq 200 }
    Assert-Case 'removing org budget from config removes the cap' ($restored.status -eq 200) "A 200 after $($restored.seconds)s"

    $scope = "$gatewayId/workspaces/default/aliases/$std"
    $assignments = & $azureRequest -SubscriptionId $SubscriptionId -Uri "https://management.azure.com$scope/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01&`$filter=atScope()"
    $target = @($assignments.value | Where-Object { $_.properties.principalId -eq $identities.a.principalId })[0]
    $null = & $azureRequest -SubscriptionId $SubscriptionId -Uri "https://management.azure.com$($target.id)?api-version=2022-04-01" -Method Delete
    $revoked = Wait-Model 'a' $std { param($r) $r.status -in 401, 403 -and -not $r.quota } $RevocationTimeoutSeconds 30
    Assert-Case 'removing access revokes without key rotation or sync' ($revoked.status -in 401, 403 -and -not $revoked.quota) "denied after $($revoked.seconds)s"
} finally {
    $tokens.Clear()
    Remove-Item -LiteralPath $configFile, $settingsFile -ErrorAction SilentlyContinue
    foreach ($alias in $std, $prem) {
        $scope = "$gatewayId/workspaces/default/aliases/$alias"
        try {
            $assignments = & $azureRequest -SubscriptionId $SubscriptionId -Uri "https://management.azure.com$scope/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01&`$filter=atScope()"
            foreach ($assignment in @($assignments.value | Where-Object { $_.id -like "$scope/*" })) {
                $null = & $azureRequest -SubscriptionId $SubscriptionId -Uri "https://management.azure.com$($assignment.id)?api-version=2022-04-01" -Method Delete
            }
            $null = & $azureRequest -SubscriptionId $SubscriptionId -Uri "$workspace/aliases/$alias$api" -Method Delete
        } catch { Write-Warning "Cleanup of alias $alias needs attention: $_" }
    }
    $restoreFailed = $false
    try {
        $null = & $azureRequest -SubscriptionId $SubscriptionId -Uri "$workspace$api" -Method Patch -Body (@{ properties = @{ policies = $workspaceSnapshot } } | ConvertTo-Json -Depth 30)
        $after = @((& $azureRequest -SubscriptionId $SubscriptionId -Uri "$workspace$api").properties.policies | Where-Object { $_ })
        if (@($after | Where-Object { $_.id -eq 'org-budget' }).Count -gt @($workspaceSnapshot | Where-Object { $_.id -eq 'org-budget' }).Count) { throw 'test org-budget still present' }
    } catch { $restoreFailed = $true; Write-Warning "URGENT: restore gateway workspace policies manually: $_" }
    foreach ($identity in $identities.Values) { $null = & az identity delete --subscription $SubscriptionId --ids $identity.id --only-show-errors }
    Write-Evidence @{ cleanup = 'done'; workspaceRestored = -not $restoreFailed }
}
if ($restoreFailed) { throw 'Gateway workspace policies were not restored; fix them before using the gateway.' }
$failed = @($results | Where-Object { -not $_.passed })
$results | Format-Table -AutoSize | Out-String -Width 200 | Write-Output
if ($failed.Count -gt 0) { throw "$($failed.Count) native-only checks failed." }
