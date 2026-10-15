[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SubscriptionId,
    [Parameter(Mandatory)][string]$ResourceGroup,
    [Parameter(Mandatory)][string]$GatewayName,
    [ValidateSet('eastus2', 'swedencentral')][string]$Location = 'eastus2'
)
$ErrorActionPreference = 'Stop'
function Invoke-Az {
    param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
    $result = & az @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Azure command failed: $($Arguments[0])" }
    return $result
}
$existing = Invoke-Az group exists --subscription $SubscriptionId --name $ResourceGroup
if ($existing -ne 'true') {
    $null = Invoke-Az group create --subscription $SubscriptionId --name $ResourceGroup --location $Location --tags project=AIGateway-Claude-On-Foundry purpose=pilot --output none
}
$template = Join-Path $PSScriptRoot '..\infra\native-gateway.bicep'
Invoke-Az deployment group create --subscription $SubscriptionId --resource-group $ResourceGroup --name native-gateway --template-file $template --parameters "gatewayName=$GatewayName" "location=$Location" --query properties.outputs --output json
