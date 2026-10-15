import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePolicy, resolveEntitlement } from '../src/policy.js';
import { policyFixture } from './support.js';

test('arbitrary BU and tier names resolve from verified groups', () => {
  const policy = parsePolicy(policyFixture());
  const result = resolveEntitlement(policy, ['group-finance', 'group-research'], 'cli-app', 'sonnet');
  assert.equal(result.bu, 'finance');
  assert.equal(result.tier, 'research');
  assert.equal(result.client, 'cli');
});

test('BU and tier allowlists intersect', () => {
  const policy = parsePolicy(policyFixture());
  assert.throws(() => resolveEntitlement(policy, ['group-finance', 'group-research'], 'desktop-app', 'sonnet'), /client_not_allowed/);
  assert.throws(() => resolveEntitlement(policy, ['group-finance', 'group-research'], 'cli-app', 'opus'), /model_not_allowed/);
  assert.throws(() => resolveEntitlement(policy, [], 'cli-app', 'sonnet'), /membership_required/);
});

test('ambiguous membership is denied, never highest privilege wins', () => {
  const raw = policyFixture();
  raw.businessUnits.other = { ...raw.businessUnits.finance!, groups: ['group-other'] };
  const policy = parsePolicy(raw);
  assert.throws(() => resolveEntitlement(policy, ['group-finance', 'group-other', 'group-research'], 'cli-app', 'sonnet'), /ambiguous_membership/);
});

test('invalid configuration fails at boundary', () => {
  const raw = policyFixture();
  assert.throws(() => parsePolicy({ ...raw, surprise: true }));
  assert.throws(() => parsePolicy({ ...raw, monthlyBudgetUsd: -1 }));
  assert.throws(() => parsePolicy({ ...raw, models: { sonnet: { ...raw.models.sonnet, inputUsdPerMillion: -1 } } }));
  assert.throws(() => parsePolicy({ ...raw, tiers: {} }));
  assert.throws(() => parsePolicy({ ...raw, clients: { cli: { applicationIds: [] } } }));
});

test('many BUs and tiers do not create per-person configuration', () => {
  const raw = policyFixture();
  for (let i = 0; i < 200; i++) {
    raw.businessUnits[`bu-${i}`] = { ...raw.businessUnits.finance!, groups: [`bu-group-${i}`] };
    raw.tiers[`tier-${i}`] = { ...raw.tiers.research!, groups: [`tier-group-${i}`] };
  }
  const policy = parsePolicy(raw);
  assert.equal(resolveEntitlement(policy, ['bu-group-199', 'tier-group-199'], 'cli-app', 'sonnet').tier, 'tier-199');
  assert.equal(Object.keys(policy.businessUnits).length, 201);
});
