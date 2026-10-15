import assert from 'node:assert/strict';
import test from 'node:test';
import { AzureCliCredential, ManagedIdentityCredential } from '@azure/identity';
import { createCredential, createUpstream, parseEnvironment } from '../src/runtime.js';

test('runtime refuses production SQLite, insecure upstreams and missing identity config', () => {
  assert.throws(() => parseEnvironment({ NODE_ENV: 'production' }), /configuration/);
  const env = {
    NODE_ENV: 'production', TENANT_ID: '11111111-1111-4111-8111-111111111111',
    TOKEN_AUDIENCE: 'api://gateway', DATABASE_URL: 'postgresql://user:fixture@localhost/gateway',
    UPSTREAM_MODE: 'native', UPSTREAM_BASE_URL: 'https://test.azure-api.net/default/models/anthropic'
  };
  assert.equal(parseEnvironment(env).mode, 'native');
  assert.throws(() => parseEnvironment({ ...env, UPSTREAM_BASE_URL: 'http://test.azure-api.net' }), /configuration/);
  assert.throws(() => parseEnvironment({ ...env, UPSTREAM_BASE_URL: 'https://attacker.invalid' }), /configuration/);
});

test('native upstream uses server token, fixed path and no redirects or caller headers', async () => {
  const upstream = createUpstream({
    mode: 'native', baseUrl: 'https://test.azure-api.net/default/models/anthropic',
    token: async () => 'fixture-server-token',
    fetch: async (url, init) => {
      assert.equal(String(url), 'https://test.azure-api.net/default/models/anthropic/v1/messages');
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('authorization'), 'Bearer fixture-server-token');
      assert.equal(headers.get('anthropic-version'), '2023-06-01');
      assert.equal(headers.get('x-bu'), null);
      assert.equal(init?.redirect, 'error');
      assert.equal(JSON.parse(String(init?.body)).model, 'claude-alias');
      return Response.json({ usage: { input_tokens: 1, output_tokens: 1 } });
    }
  });
  assert.equal((await upstream({ model: 'claude-alias' }, new AbortController().signal)).status, 200);
});

test('development uses explicit CLI credentials, never an ambient credential chain', () => {
  const env = {
    TENANT_ID: '11111111-1111-4111-8111-111111111111', TOKEN_AUDIENCE: 'api://gateway',
    DEVELOPMENT_SUBSCRIPTION_ID: '22222222-2222-4222-8222-222222222222',
    LOCAL_SQLITE_PATH: ':memory:', UPSTREAM_MODE: 'native', UPSTREAM_BASE_URL: 'https://test.azure-api.net'
  };
  const config = parseEnvironment(env);
  assert.equal(config.developmentSubscriptionId, env.DEVELOPMENT_SUBSCRIPTION_ID);
  assert.ok(createCredential(config, { NODE_ENV: 'development' }) instanceof AzureCliCredential);
  assert.ok(createCredential(config, { NODE_ENV: 'production' }) instanceof ManagedIdentityCredential);
  assert.throws(() => parseEnvironment({ ...env, DEVELOPMENT_SUBSCRIPTION_ID: 'ambiguous-name' }), /configuration/);
});
