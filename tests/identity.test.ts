import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { createAuthenticator, GraphMemberships } from '../src/identity.js';

const tenant = '11111111-1111-4111-8111-111111111111';
const oid = '22222222-2222-4222-8222-222222222222';
const appId = '33333333-3333-4333-8333-333333333333';
const audience = 'api://gateway-test';
const keys = await generateKeyPair('RS256');
const jwks = createLocalJWKSet({ keys: [{ ...await exportJWK(keys.publicKey), kid: 'test' }] });
async function token(changes: Record<string, unknown> = {}) {
  return new SignJWT({ tid: tenant, oid, azp: appId, scp: 'Gateway.Invoke', ...changes })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(`https://login.microsoftonline.com/${tenant}/v2.0`)
    .setAudience(audience).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
}

test('Entra authenticator verifies signature, tenant, audience, scope and user identity', async () => {
  const authenticate = createAuthenticator({ tenantId: tenant, audience, requiredScope: 'Gateway.Invoke' }, jwks);
  const user = await authenticate(`Bearer ${await token()}`);
  assert.equal(user.oid, oid);
  assert.equal(user.applicationId, appId);
  assert.equal(user.admin, false);
  for (const authorization of [
    undefined,
    'Bearer invalid',
    `Bearer ${await token({ tid: 'wrong-tenant' })}`,
    `Bearer ${await token({ oid: undefined })}`,
    `Bearer ${await token({ scp: 'Other.Scope' })}`,
    `Bearer ${await token({ idtyp: 'app' })}`
  ]) await assert.rejects(authenticate(authorization), /invalid_token/);
  const wrong = new SignJWT({ tid: tenant, oid, azp: appId, scp: 'Gateway.Invoke' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer('https://evil.invalid')
    .setAudience(audience).setExpirationTime('5m');
  await assert.rejects(authenticate(`Bearer ${await wrong.sign(keys.privateKey)}`), /invalid_token/);
});

test('admin access comes only from validated application role', async () => {
  const authenticate = createAuthenticator({ tenantId: tenant, audience, requiredScope: 'Gateway.Invoke' }, jwks);
  assert.equal((await authenticate(`Bearer ${await token({ roles: ['Gateway.Admin'] })}`)).admin, true);
  assert.equal((await authenticate(`Bearer ${await token({ admin: true })}`)).admin, false);
});

test('wrong audience, expired token and a different signing key are rejected', async () => {
  const authenticate = createAuthenticator({ tenantId: tenant, audience, requiredScope: 'Gateway.Invoke' }, jwks);
  const claims = { tid: tenant, oid, azp: appId, scp: 'Gateway.Invoke' };
  const make = () => new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(`https://login.microsoftonline.com/${tenant}/v2.0`).setIssuedAt();
  await assert.rejects(authenticate(`Bearer ${await make().setAudience('api://other').setExpirationTime('5m').sign(keys.privateKey)}`), /invalid_token/);
  await assert.rejects(authenticate(`Bearer ${await make().setAudience(audience).setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(keys.privateKey)}`), /invalid_token/);
  const other = await generateKeyPair('RS256');
  await assert.rejects(authenticate(`Bearer ${await make().setAudience(audience).setExpirationTime('5m').sign(other.privateKey)}`), /invalid_token/);
});

test('Graph resolves transitive membership at request time and failures do not become empty access', async () => {
  let calls = 0;
  const graph = new GraphMemberships(async () => 'fixture-graph-token', {
    ttlSeconds: 0,
    fetch: async (url, init) => {
      calls++;
      assert.equal(String(url), `https://graph.microsoft.com/v1.0/users/${oid}/getMemberObjects`);
      assert.deepEqual(JSON.parse(String(init?.body)), { securityEnabledOnly: true });
      return Response.json({ value: ['group-one', 'group-two'] });
    }
  });
  assert.deepEqual(await graph.get({ oid, tid: tenant, applicationId: appId, admin: false }), ['group-one', 'group-two']);
  await graph.get({ oid, tid: tenant, applicationId: appId, admin: false });
  assert.equal(calls, 2);
  const failing = new GraphMemberships(async () => 'fixture', { fetch: async () => new Response('', { status: 429 }) });
  await assert.rejects(failing.get({ oid, tid: tenant, applicationId: appId, admin: false }), /directory_unavailable/);
});

test('Graph cache is bounded in duration and failures do not cache denials', async () => {
  let now = 1000;
  let calls = 0;
  const graph = new GraphMemberships(async () => 'fixture', { ttlSeconds: 10, now: () => now, fetch: async () => {
    calls++;
    return Response.json({ value: calls === 1 ? ['old'] : ['new'] });
  } });
  const user = { oid, tid: tenant, applicationId: appId, admin: false };
  assert.deepEqual(await graph.get(user), ['old']);
  now = 9999;
  assert.deepEqual(await graph.get(user), ['old']);
  now = 11001;
  assert.deepEqual(await graph.get(user), ['new']);
  assert.equal(calls, 2);
});

test('a directory failure is retried, never cached as successful empty membership', async () => {
  let calls = 0;
  const graph = new GraphMemberships(async () => 'fixture', {
    ttlSeconds: 60,
    fetch: async () => ++calls === 1 ? new Response('', { status: 429 }) : Response.json({ value: ['approved-group'] })
  });
  const user = { oid, tid: tenant, applicationId: appId, admin: false };
  await assert.rejects(graph.get(user), /directory_unavailable/);
  assert.deepEqual(await graph.get(user), ['approved-group']);
  assert.equal(calls, 2);
});
