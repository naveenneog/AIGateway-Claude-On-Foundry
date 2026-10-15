targetScope = 'resourceGroup'

@description('Globally unique AI Gateway name.')
param gatewayName string
param location string = 'eastus2'
param publisherEmail string = 'platform@example.invalid'
param publisherName string = 'AI Platform'

resource gateway 'Microsoft.ApiManagement/service@2025-09-01-preview' = {
  name: gatewayName
  location: location
  identity: { type: 'SystemAssigned' }
  sku: { name: 'AIGateway', capacity: 1 }
  properties: {
    publisherEmail: publisherEmail
    publisherName: publisherName
  }
}

resource connector 'Microsoft.Web/connectorGateways@2026-05-01-preview' = {
  name: gatewayName
  location: location
  properties: {}
}

output gatewayId string = gateway.id
output principalId string = gateway.identity.principalId
output gatewayUrl string = gateway.properties.gatewayUrl
