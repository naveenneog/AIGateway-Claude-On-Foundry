import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseNativeConfig, planNative, mergePolicies, roleAssignmentName, MANAGED_POLICY_IDS } from '../src/native/plan.js';

const sub = '00000000-0000-0000-0000-000000000001';
const tid = '00000000-0000-0000-0000-0000000000aa';
const groupA = '00000000-0000-0000-0000-00000000000a';
const groupB = '00000000-0000-0000-0000-00000000000b';
const userX = '00000000-0000-0000-0000-0000000000cc';

function raw(): any {
  return {
    subscriptionId: sub, resourceGroup: 'rg', gatewayName: 'gw',
    foundry: { accountId: `/subscriptions/${sub}/resourceGroups/rg/providers/Microsoft.CognitiveServices/accounts/f`, endpoint: 'https://f.services.ai.azure.com/' },
    models: [{ name: 'claude-sonnet-5', modelVersion: '1' }, { name: 'claude-opus-5', modelVersion: '1' }],
    accessGroups: [
      { alias: 'claude-standard', model: 'claude-sonnet-5', principals: [{ id: groupA }], userBudgetUsd: 50 },
      { alias: 'claude-premium', model: 'claude-opus-5', principals: [{ id: groupB }], userBudgetUsd: 200, groupBudgetUsd: 2000,
        userOverrides: [{ tenantId: tid, objectId: userX, budgetUsd: 500 }] },
    ],
  };
}
const ops = (r = raw(), existing = {}) => planNative(parseNativeConfig(r), existing);
const alias = (name: string, r = raw()) => ops(r).find(o => o.path.endsWith(`/aliases/${name}`))!;

test('per-user budget is an identity-keyed cost limit on each access group alias', () => {
  const standard = alias('claude-standard');
  assert.equal(standard.method, 'PUT');
  assert.deepEqual(standard.body.properties.policies, [
    { type: 'costLimit', id: 'user-budget', amount: 50, period: 'month', counterKey: ['identity'], scope: 'resource' },
  ]);
  assert.match(standard.body.properties.backendModels[0].resourceId, /\/modelProviders\/foundry\/models\/claude-sonnet-5$/);
});

test('group pool is opt-in and uses a shared policy-instance counter', () => {
  const premium = alias('claude-premium').body.properties.policies;
  assert.deepEqual(premium.find((p: any) => p.id === 'group-budget'),
    { type: 'costLimit', id: 'group-budget', amount: 2000, period: 'month', counterKey: [], scope: 'resource' });
  assert.equal(alias('claude-standard').body.properties.policies.some((p: any) => p.id === 'group-budget'), false);
});

test('per-user overrides use exact tenant and object claims', () => {
  const user = alias('claude-premium').body.properties.policies.find((p: any) => p.id === 'user-budget');
  assert.deepEqual(user.overrides, [{ claims: { tid, oid: userX }, amount: 500 }]);
});

test('org budget is opt-in on the gateway workspace and absent means removed', () => {
  const ws = (r: any) => ops(r).find(o => o.path.endsWith('/workspaces/default'))!;
  assert.deepEqual(ws(raw()).body, { properties: { policies: [] } });
  assert.equal(ws(raw()).method, 'PATCH');
  const withOrg = { ...raw(), orgBudgetUsd: 10000 };
  assert.deepEqual(ws(withOrg).body.properties.policies,
    [{ type: 'costLimit', id: 'org-budget', amount: 10000, period: 'month', counterKey: [], scope: 'workspace' }]);
});

test('access is granted by RBAC on the alias, never with keys or member sync', () => {
  const roles = ops().filter(o => o.path.includes('/roleAssignments/'));
  assert.equal(roles.length, 2);
  const role = roles.find(o => o.path.includes('/aliases/claude-standard/'))!;
  assert.equal(role.body.properties.principalId, groupA);
  assert.equal(role.body.properties.principalType, 'Group');
  assert.equal(role.body.properties.roleDefinitionId,
    `/subscriptions/${sub}/providers/Microsoft.Authorization/roleDefinitions/a6b68e3d-a1f0-4c60-8678-237c050cf4ea`);
  assert.equal(ops().some(o => /keys|members/i.test(o.path)), false);
});

test('role assignment names are deterministic GUIDs so reruns are idempotent', () => {
  const a = roleAssignmentName('/scope', groupA, 'role');
  assert.equal(a, roleAssignmentName('/scope', groupA, 'role'));
  assert.notEqual(a, roleAssignmentName('/scope', groupB, 'role'));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.deepEqual(ops(), ops());
});

test('operations are ordered provider, models, aliases, workspace, roles', () => {
  const kinds = ops().map(o => o.kind);
  assert.deepEqual(kinds, ['provider', 'model', 'model', 'alias', 'alias', 'workspace', 'role', 'role']);
});

test('portal-edited policies outside the managed ids are preserved on rerun', () => {
  const custom = { type: 'costLimit', id: 'portal-weekly', amount: 3, period: 'week', counterKey: ['identity'], scope: 'resource' };
  const stale = { type: 'costLimit', id: 'user-budget', amount: 1, period: 'month', counterKey: ['identity'], scope: 'resource' };
  const merged = mergePolicies([custom, stale], [{ ...stale, amount: 50 }]);
  assert.deepEqual(merged, [custom, { ...stale, amount: 50 }]);
  const planned = ops(raw(), { aliases: { 'claude-standard': [custom] }, workspace: [custom] });
  assert.deepEqual(planned.find(o => o.kind === 'alias')!.body.properties.policies[0], custom);
  assert.deepEqual(planned.find(o => o.kind === 'workspace')!.body.properties.policies, [custom]);
  assert.deepEqual([...MANAGED_POLICY_IDS], ['user-budget', 'group-budget', 'org-budget']);
});

test('many access groups scale linearly without per-person configuration', () => {
  const r = raw();
  for (let i = 0; i < 300; i++) r.accessGroups.push({ alias: `bu-${i}-std`, model: 'claude-sonnet-5', principals: [{ id: groupA }], userBudgetUsd: 10 });
  assert.equal(ops(r).filter(o => o.kind === 'alias').length, 302);
});

test('invalid configuration fails at the boundary', () => {
  const bad = (mutate: (r: any) => void) => { const r = raw(); mutate(r); assert.throws(() => parseNativeConfig(r)); };
  bad(r => { r.surprise = true; });
  bad(r => { r.accessGroups[0].model = 'missing'; });
  bad(r => { r.accessGroups[1].alias = 'claude-standard'; });
  bad(r => { r.accessGroups[0].alias = 'Bad Alias'; });
  bad(r => { r.accessGroups[0].alias = 'sonnet'; });
  bad(r => { r.accessGroups[0].userBudgetUsd = 0; });
  bad(r => { r.accessGroups[0].principals = []; });
  bad(r => { r.accessGroups[0].principals[0].id = 'not-a-guid'; });
  bad(r => { r.accessGroups[1].groupBudgetUsd = 100; });
  bad(r => { r.budgetPeriod = 'fortnight'; });
  bad(r => { r.foundry.endpoint = 'http://insecure'; });
  bad(r => { r.location = 'westeurope'; });
  assert.equal(parseNativeConfig(raw()).location, 'eastus2');
});

test('published example config is valid and opts into a group pool', async () => {
  const config = parseNativeConfig(JSON.parse(await readFile(new URL('../config/native-only.example.json', import.meta.url), 'utf8')));
  assert.ok(config.accessGroups.some(g => g.groupBudgetUsd !== undefined));
  assert.ok(config.accessGroups.some(g => g.groupBudgetUsd === undefined));
});
