[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SubscriptionId,
    [Parameter(Mandatory)][string]$ResourceGroup,
    [Parameter(Mandatory)][string]$GatewayName,
    [Parameter(Mandatory)][string]$FoundryAccountId,
    [Parameter(Mandatory)][string]$FoundryEndpoint,
    [Parameter(Mandatory)][string]$DeploymentName,
    [Parameter(Mandatory)][string]$ModelVersion,
    [string]$AliasName = 'claude-pilot'
)
$ErrorActionPreference = 'Stop'
$gateway = & az apim show --subscription $SubscriptionId -g $ResourceGroup -n $GatewayName --only-show-errors -o json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Cannot read gateway' }
$null = & az role assignment create --subscription $SubscriptionId --assignee-object-id $gateway.identity.principalId --assignee-principal-type ServicePrincipal --role '53ca6127-db72-4b80-b1b0-d745d6d5456d' --scope $FoundryAccountId --output none
if ($LASTEXITCODE -ne 0) { throw 'Cannot grant gateway access to Foundry' }
$template = Join-Path $PSScriptRoot '..\infra\native-model.bicep'
& az deployment group create --subscription $SubscriptionId -g $ResourceGroup --name native-model --template-file $template --parameters "gatewayName=$GatewayName" "foundryAccountId=$FoundryAccountId" "foundryEndpoint=$FoundryEndpoint" "deploymentName=$DeploymentName" "modelVersion=$ModelVersion" "aliasName=$AliasName" --query properties.outputs -o json
if ($LASTEXITCODE -ne 0) { throw 'Native model deployment failed' }
