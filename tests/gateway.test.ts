import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGateway, type Dependencies } from '../src/gateway.js';
import { SqliteDatabase } from '../src/database.js';
import { Ledger } from '../src/ledger.js';
import { parsePolicy } from '../src/policy.js';
import { GatewayError } from '../src/errors.js';
import { policyFixture } from './support.js';

async function fixture(overrides: Partial<Dependencies> = {}) {
  const db = new SqliteDatabase(':memory:');
  const ledger = new Ledger(db);
  await ledger.initialize();
  await ledger.putPolicy(parsePolicy(policyFixture()), 0);
  let calls = 0;
  const app = buildGateway({
    ledger,
    authenticate: async () => ({ oid: 'person-1', tid: 'tenant-1', applicationId: 'cli-app', admin: false }),
    memberships: async () => ['group-finance', 'group-research'],
    upstream: async (_body, _signal) => {
      calls++;
      return Response.json({ id: 'msg-1', type: 'message', content: [{ type: 'text', text: 'OK' }], usage: { input_tokens: 10, output_tokens: 2 } });
    },
    ...overrides
  });
  return { app, ledger, calls: () => calls, close: async () => { await app.close(); await db.close(); } };
}
const request = { model: 'sonnet', max_tokens: 16, messages: [{ role: 'user', content: 'Hello' }] };

test('real HTTP wiring enforces policy and settles provider usage', async () => {
  const f = await fixture();
  const response = await f.app.inject({ method: 'POST', url: '/v1/messages', payload: request });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().content[0].text, 'OK');
  assert.equal(f.calls(), 1);
  assert.equal((await f.ledger.report()).settledMicros, 60);
  assert.equal((await f.ledger.report()).heldMicros, 0);
  await f.close();
});

test('Anthropic apiKeyHelper JWTs are verified as bearer tokens, ambiguous credentials deny', async () => {
  const f = await fixture({ authenticate: async (header) => {
    assert.equal(header, 'Bearer fixture-jwt');
    return { oid: 'person', tid: 'tenant', applicationId: 'cli-app', admin: false };
  } });
  assert.equal((await f.app.inject({ method: 'POST', url: '/v1/messages', headers: { 'x-api-key': 'fixture-jwt' }, payload: request })).statusCode, 200);
  assert.equal((await f.app.inject({ method: 'POST', url: '/v1/messages', headers: { 'x-api-key': 'fixture-jwt', authorization: 'Bearer other' }, payload: request })).statusCode, 401);
  assert.equal(f.calls(), 1);
  await f.close();
});

test('current Claude Code system-role messages pass through without rewriting', async () => {
  let forwarded: unknown;
  const f = await fixture({ upstream: async (body) => {
    forwarded = body.messages;
    return Response.json({ content: [{ type: 'text', text: 'OK' }], usage: { input_tokens: 10, output_tokens: 2 } });
  } });
  const messages = [...request.messages, { role: 'system', content: 'Synthetic client system reminder.' }];
  const response = await f.app.inject({ method: 'POST', url: '/v1/messages?beta=true', payload: { ...request, messages } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(forwarded, messages);
  await f.close();
});

test('spoofed BU/tier/client headers do not change verified identity', async () => {
  const f = await fixture({ authenticate: async () => ({ oid: 'person', tid: 'tenant', applicationId: 'desktop-app', admin: false }) });
  const response = await f.app.inject({ method: 'POST', url: '/v1/messages', headers: { 'x-bu': 'finance', 'x-tier': 'research', 'x-client': 'cli' }, payload: request });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.type, 'client_not_allowed');
  assert.equal(f.calls(), 0);
  await f.close();
});

test('directory failure and invalid authentication fail closed before inference', async () => {
  for (const overrides of [
    { authenticate: async () => { throw new GatewayError(401, 'invalid_token'); } },
    { memberships: async () => { throw new GatewayError(503, 'directory_unavailable'); } }
  ]) {
    const f = await fixture(overrides);
    const response = await f.app.inject({ method: 'POST', url: '/v1/messages', payload: request });
    assert.ok([401, 503].includes(response.statusCode));
    assert.equal(f.calls(), 0);
    assert.equal((await f.ledger.report()).requests, 0);
    await f.close();
  }
});

test('zero budget and output excess deny before inference', async () => {
  const f = await fixture();
  const policy = parsePolicy(policyFixture());
  await f.ledger.putPolicy({ ...policy, monthlyBudgetUsd: 0 }, 1);
  const denied = await f.app.inject({ method: 'POST', url: '/v1/messages', payload: request });
  assert.equal(denied.statusCode, 403);
  const invalid = await f.app.inject({ method: 'POST', url: '/v1/messages', payload: { ...request, max_tokens: 999999 } });
  assert.equal(invalid.statusCode, 400);
  assert.equal(f.calls(), 0);
  await f.close();
});

test('combination budget and output overrides are enforced before inference', async () => {
  for (const override of [{ monthlyBudgetUsd: 0 }, { userMonthlyBudgetUsd: 0 }, { maxOutputTokens: 8 }]) {
    const f = await fixture();
    const raw = policyFixture();
    await f.ledger.putPolicy(parsePolicy({ ...raw, businessUnits: { finance: {
      ...raw.businessUnits.finance, tierOverrides: { research: override }
    } } }), 1);
    const response = await f.app.inject({ method: 'POST', url: '/v1/messages', payload: request });
    assert.equal(response.statusCode, 'maxOutputTokens' in override ? 400 : 403);
    assert.equal(f.calls(), 0);
    await f.close();
  }
});

test('missing usage and upstream failures retain conservative holds', async () => {
  for (const upstream of [
    async () => Response.json({ content: [] }),
    async () => { throw new Error('private upstream diagnostic'); },
    async () => Response.json({ error: { type: 'overloaded_error' } }, { status: 529 })
  ]) {
    const f = await fixture({ upstream });
    const response = await f.app.inject({ method: 'POST', url: '/v1/messages', payload: request });
    assert.ok([200, 502, 529].includes(response.statusCode));
    assert.ok((await f.ledger.report()).heldMicros > 0);
    assert.ok(!response.body.includes('private upstream diagnostic'));
    await f.close();
  }
});

test('paid server tools, unknown top-level fields and malformed bodies are denied', async () => {
  const f = await fixture();
  for (const payload of [
    { ...request, tools: [{ type: 'web_search_20250305', name: 'web_search' }] },
    { ...request, bypass: true },
    { ...request, messages: [] },
    { ...request, max_tokens: -1 }
  ]) {
    const response = await f.app.inject({ method: 'POST', url: '/v1/messages', payload });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(f.calls(), 0);
  await f.close();
});

test('policy admin requires role and If-Match; change affects next request', async () => {
  const f = await fixture();
  assert.equal((await f.app.inject({ method: 'GET', url: '/admin/policy' })).statusCode, 403);
  await f.close();
  const admin = await fixture({ authenticate: async () => ({ oid: 'admin', tid: 'tenant', applicationId: 'cli-app', admin: true }) });
  const changed = { ...policyFixture(), monthlyBudgetUsd: 0 };
  assert.equal((await admin.app.inject({ method: 'PUT', url: '/admin/policy', payload: changed })).statusCode, 428);
  assert.equal((await admin.app.inject({ method: 'PUT', url: '/admin/policy', headers: { 'if-match': '1' }, payload: changed })).statusCode, 200);
  assert.equal((await admin.app.inject({ method: 'PUT', url: '/admin/policy', headers: { 'if-match': '1' }, payload: changed })).statusCode, 409);
  assert.equal((await admin.app.inject({ method: 'POST', url: '/v1/messages', payload: request })).statusCode, 403);
  await admin.close();
});

test('fragmented streaming usage settles only after complete message_stop', async () => {
  const events = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"OK"}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":2}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n'
  ].join('');
  for (const complete of [true, false]) {
    const data = complete ? events : events.slice(0, events.lastIndexOf('event: message_stop'));
    const f = await fixture({ upstream: async () => new Response(new ReadableStream({
      start(controller) {
        const bytes = new TextEncoder().encode(data);
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
        controller.close();
      }
    }), { headers: { 'content-type': 'text/event-stream' } }) });
    const response = await f.app.inject({ method: 'POST', url: '/v1/messages', payload: { ...request, stream: true } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, data);
    const report = await f.ledger.report();
    assert.equal(report.settledMicros, complete ? 60 : 0);
    assert.equal(report.heldMicros > 0, !complete);
    await f.close();
  }
});
