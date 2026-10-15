import assert from 'node:assert/strict';
import test from 'node:test';
import { SqliteDatabase } from '../src/database.js';
import { buildGateway, type Dependencies } from '../src/gateway.js';
import { Ledger } from '../src/ledger.js';
import { parsePolicy } from '../src/policy.js';
import { policyFixture } from './support.js';

async function fixture(upstream: Dependencies['upstream']) {
  const db = new SqliteDatabase(':memory:');
  const ledger = new Ledger(db);
  await ledger.initialize();
  await ledger.putPolicy(parsePolicy(policyFixture()), 0);
  const app = buildGateway({
    ledger, upstream,
    authenticate: async (header) => ({ oid: header ?? 'one', tid: 'test', applicationId: 'cli-app', admin: false }),
    memberships: async () => ['group-finance', 'group-research']
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address === 'object');
  return { app, ledger, url: `http://127.0.0.1:${address.port}`, close: async () => { await app.close(); await db.close(); } };
}
const body = { model: 'sonnet', max_tokens: 16, messages: [{ role: 'user', content: 'synthetic' }] };

test('actual TCP requests preserve concurrent reserve and settle accounting', { timeout: 15000 }, async () => {
  const f = await fixture(async () => Response.json({ content: [], usage: { input_tokens: 10, output_tokens: 2 } }));
  try {
    const responses = await Promise.all(Array.from({ length: 32 }, (_, i) =>
      fetch(`${f.url}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer person-${i}` }, body: JSON.stringify(body) })));
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-budget-status'), 'settled');
      await response.json();
    }
    assert.deepEqual(await f.ledger.report(), { requests: 32, heldMicros: 0, settledMicros: 32 * 60 });
  } finally { await f.close(); }
});

test('socket disconnect after message_stop but before EOF retains the hold', { timeout: 15000 }, async () => {
  const aborted = Promise.withResolvers<void>();
  const f = await fixture(async (_body, signal) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(
        'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}\n\n' +
        'data: {"type":"message_delta","usage":{"output_tokens":2}}\n\n' +
        'data: {"type":"message_stop"}\n\n'
      ));
      signal.addEventListener('abort', () => {
        controller.error(new DOMException('Aborted', 'AbortError'));
        aborted.resolve();
      }, { once: true });
    }
  }), { headers: { 'content-type': 'text/event-stream' } }));
  try {
    const response = await fetch(`${f.url}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, stream: true }) });
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /message_stop/);
    await reader.cancel();
    await aborted.promise;
    const report = await f.ledger.report();
    assert.equal(report.settledMicros, 0);
    assert.ok(report.heldMicros > 0);
  } finally { await f.close(); }
});
