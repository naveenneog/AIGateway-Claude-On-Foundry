import { createHash } from 'node:crypto';
import { z } from 'zod';

export const API_VERSION = '2025-09-01-preview';
export const ROLE_API_VERSION = '2022-04-01';
export const MODELS_USER_ROLE = 'a6b68e3d-a1f0-4c60-8678-237c050cf4ea';
export const MANAGED_POLICY_IDS = new Set(['user-budget', 'group-budget', 'org-budget']);
const RESERVED_ALIASES = new Set(['sonnet', 'opus', 'haiku', 'default', 'best', 'opusplan']);

const guid = z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
const usd = z.number().min(0.000000001).max(10_000_000);
const segment = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/);
const aliasName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/).refine(n => !RESERVED_ALIASES.has(n), 'reserved Claude CLI alias');

const AccessGroup = z.strictObject({
  alias: aliasName,
  description: z.string().max(256).optional(),
  model: segment,
  principals: z.array(z.strictObject({
    id: guid,
    type: z.enum(['Group', 'User', 'ServicePrincipal']).default('Group'),
  })).min(1),
  userBudgetUsd: usd,
  groupBudgetUsd: usd.optional(),
  userOverrides: z.array(z.strictObject({ tenantId: guid, objectId: guid, budgetUsd: usd })).default([]),
});

const NativeConfig = z.strictObject({
  subscriptionId: guid,
  resourceGroup: z.string().regex(/^[-\w._()]{1,90}$/),
  gatewayName: z.string().regex(/^[a-zA-Z][a-zA-Z0-9-]{0,49}$/),
  location: z.enum(['eastus2', 'swedencentral']).default('eastus2'),
  foundry: z.strictObject({
    accountId: z.string().regex(/^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.CognitiveServices\/accounts\/[^/]+$/i),
    endpoint: z.url({ protocol: /^https$/ }),
  }),
  models: z.array(z.strictObject({ name: segment, deploymentName: segment.optional(), modelVersion: z.string().min(1).max(40) })).min(1),
  budgetPeriod: z.enum(['hour', 'day', 'week', 'month', 'year']).default('month'),
  orgBudgetUsd: usd.optional(),
  accessGroups: z.array(AccessGroup).min(1),
}).superRefine((config, ctx) => {
  const models = new Set(config.models.map(m => m.name));
  if (models.size !== config.models.length) ctx.addIssue({ code: 'custom', message: 'duplicate model name' });
  const aliases = new Set<string>();
  for (const group of config.accessGroups) {
    if (aliases.has(group.alias)) ctx.addIssue({ code: 'custom', message: `duplicate alias ${group.alias}` });
    aliases.add(group.alias);
    if (!models.has(group.model)) ctx.addIssue({ code: 'custom', message: `alias ${group.alias} targets unknown model ${group.model}` });
    if (group.groupBudgetUsd !== undefined && group.groupBudgetUsd < group.userBudgetUsd) {
      ctx.addIssue({ code: 'custom', message: `alias ${group.alias} group budget is below its per-user budget` });
    }
  }
});

export type NativeConfig = z.infer<typeof NativeConfig>;
export type Policy = Record<string, unknown> & { id?: unknown };
export interface ExistingPolicies { aliases?: Record<string, Policy[]>; workspace?: Policy[] }
export interface Operation {
  kind: 'provider' | 'model' | 'alias' | 'workspace' | 'role';
  method: 'PUT' | 'PATCH';
  path: string;
  apiVersion: string;
  body: any;
}

export function parseNativeConfig(raw: unknown): NativeConfig {
  return NativeConfig.parse(raw);
}

export function roleAssignmentName(scope: string, principalId: string, roleId: string): string {
  const h = createHash('sha256').update(`${scope.toLowerCase()}|${principalId.toLowerCase()}|${roleId.toLowerCase()}`).digest('hex');
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function mergePolicies(existing: Policy[], managed: Policy[]): Policy[] {
  return [...existing.filter(p => !MANAGED_POLICY_IDS.has(String(p.id))), ...managed];
}

function costLimit(id: string, amount: number, period: string, counterKey: string[], scope: 'resource' | 'workspace'): Policy {
  return { type: 'costLimit', id, amount, period, counterKey, scope };
}

export function planNative(config: NativeConfig, existing: ExistingPolicies = {}): Operation[] {
  const workspace = `/subscriptions/${config.subscriptionId}/resourceGroups/${config.resourceGroup}` +
    `/providers/Microsoft.ApiManagement/service/${config.gatewayName}/workspaces/default`;
  const provider = `${workspace}/modelProviders/foundry`;
  const op = (kind: Operation['kind'], method: Operation['method'], path: string, body: unknown, apiVersion = API_VERSION): Operation =>
    ({ kind, method, path, apiVersion, body });
  const result: Operation[] = [op('provider', 'PUT', provider, { properties: {
    kind: 'Foundry',
    foundry: {
      endpoint: config.foundry.endpoint,
      resourceIds: [config.foundry.accountId],
      authentication: { kind: 'ManagedIdentity', managedIdentity: { resource: 'https://cognitiveservices.azure.com/' } },
    },
  } })];
  for (const model of config.models) {
    const deployment = model.deploymentName ?? model.name;
    result.push(op('model', 'PUT', `${provider}/models/${model.name}`, { properties: {
      displayName: model.name,
      apiFormat: 'AnthropicMessages',
      supportedEndpoints: ['/anthropic/v1/messages'],
      deployment: { resourceId: `${config.foundry.accountId}/deployments/${deployment}`, modelName: deployment, modelVersion: model.modelVersion },
      policies: [],
    } }));
  }
  for (const group of config.accessGroups) {
    const user = costLimit('user-budget', group.userBudgetUsd, config.budgetPeriod, ['identity'], 'resource');
    if (group.userOverrides.length > 0) {
      user.overrides = group.userOverrides.map(o => ({ claims: { tid: o.tenantId, oid: o.objectId }, amount: o.budgetUsd }));
    }
    const managed = [user];
    if (group.groupBudgetUsd !== undefined) managed.push(costLimit('group-budget', group.groupBudgetUsd, config.budgetPeriod, [], 'resource'));
    result.push(op('alias', 'PUT', `${workspace}/aliases/${group.alias}`, { properties: {
      aliasName: group.alias,
      description: group.description ?? `Access group ${group.alias}`,
      backendModels: [{ resourceId: `${provider}/models/${group.model}` }],
      policies: mergePolicies(existing.aliases?.[group.alias] ?? [], managed),
    } }));
  }
  const org = config.orgBudgetUsd === undefined ? [] : [costLimit('org-budget', config.orgBudgetUsd, config.budgetPeriod, [], 'workspace')];
  result.push(op('workspace', 'PATCH', workspace, { properties: { policies: mergePolicies(existing.workspace ?? [], org) } }));
  const roleDefinitionId = `/subscriptions/${config.subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${MODELS_USER_ROLE}`;
  for (const group of config.accessGroups) {
    const scope = `${workspace}/aliases/${group.alias}`;
    for (const principal of group.principals) {
      const name = roleAssignmentName(scope, principal.id, MODELS_USER_ROLE);
      result.push(op('role', 'PUT', `${scope}/providers/Microsoft.Authorization/roleAssignments/${name}`,
        { properties: { roleDefinitionId, principalId: principal.id, principalType: principal.type } }, ROLE_API_VERSION));
    }
  }
  return result;
}
