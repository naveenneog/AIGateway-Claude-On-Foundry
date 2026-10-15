targetScope = 'resourceGroup'

param gatewayName string
param foundryAccountId string
param foundryEndpoint string
param deploymentName string
param modelVersion string
param aliasName string = 'claude-pilot'
param dailyBudgetUsd int = 1

resource gateway 'Microsoft.ApiManagement/service@2025-09-01-preview' existing = {
  name: gatewayName
}
resource workspace 'Microsoft.ApiManagement/service/workspaces@2025-09-01-preview' existing = {
  parent: gateway
  name: 'default'
}
resource provider 'Microsoft.ApiManagement/service/workspaces/modelProviders@2025-09-01-preview' = {
  parent: workspace
  name: 'foundry'
  properties: {
    kind: 'Foundry'
    foundry: {
      endpoint: foundryEndpoint
      resourceIds: [foundryAccountId]
      authentication: {
        kind: 'ManagedIdentity'
        managedIdentity: { resource: 'https://cognitiveservices.azure.com/' }
      }
    }
  }
}
resource model 'Microsoft.ApiManagement/service/workspaces/modelProviders/models@2025-09-01-preview' = {
  parent: provider
  name: deploymentName
  properties: {
    displayName: deploymentName
    apiFormat: 'AnthropicMessages'
    supportedEndpoints: ['/anthropic/v1/messages']
    deployment: {
      resourceId: '${foundryAccountId}/deployments/${deploymentName}'
      modelName: deploymentName
      modelVersion: modelVersion
    }
    policies: []
  }
}
resource alias 'Microsoft.ApiManagement/service/workspaces/aliases@2025-09-01-preview' = {
  parent: workspace
  name: aliasName
  properties: {
    aliasName: aliasName
    description: 'Independent Claude pilot'
    backendModels: [{ resourceId: model.id }]
    policies: [
      {
        type: 'costLimit'
        id: 'pilot-daily'
        amount: dailyBudgetUsd
        period: 'day'
        counterKey: ['identity']
        scope: 'resource'
      }
    ]
  }
}
output aliasId string = alias.id
output endpoint string = '${gateway.properties.gatewayUrl}/default/models/anthropic/v1/messages'
