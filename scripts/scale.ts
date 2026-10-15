import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { SqliteDatabase } from '../src/database.js';
import { buildGateway } from '../src/gateway.js';
import { Ledger } from '../src/ledger.js';
import { parsePolicy } from '../src/policy.js';

const users = Number(process.env.SCALE_USERS ?? 50000);
const concurrency = Number(process.env.SCALE_CONCURRENCY ?? 128);
assert.ok(Number.isInteger(users) && users >= 50000 && users <= 1000000);
assert.ok(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 512);
const db = new SqliteDatabase(':memory:');
const ledger = new Ledger(db);
await ledger.initialize();
const policy = parsePolicy({
  monthlyBudgetUsd: 1000000,
  models: { sonnet: { deployment: 'simulated', contextTokens: 200000, maxOutputTokens: 4096, inputUsdPerMillion: 3, outputUsdPerMillion: 15, cacheReadUsdPerMillion: 0.3, cacheWriteUsdPerMillion: 6 } },
  clients: { cli: { applicationIds: ['simulated-cli'] } },
  businessUnits: Object.fromEntries(Array.from({ length: 100 }, (_, i) =>
    [`bu-${i}`, { groups: [`bu-${i}`], models: ['sonnet'], clients: ['cli'], monthlyBudgetUsd: 100000 }])),
  tiers: Object.fromEntries(Array.from({ length: 10 }, (_, i) =>
    [`tier-${i}`, { groups: [`tier-${i}`], models: ['sonnet'], clients: ['cli'], monthlyBudgetUsd: 10000, userMonthlyBudgetUsd: 10 }]))
});
await ledger.putPolicy(policy, 0);
const now = new Date('2026-10-15T00:00:00Z');
const app = buildGateway({
  ledger, now: () => now,
  authenticate: async (header) => ({ oid: header!.slice(7), tid: 'simulation', applicationId: 'simulated-cli', admin: false }),
  memberships: async (who) => { const i = Number(who.oid); return [`bu-${i % 100}`, `tier-${Math.floor(i / 100) % 10}`]; },
  upstream: async () => Response.json({ content: [{ type: 'text', text: 'OK' }], usage: { input_tokens: 10, output_tokens: 2 } })
});
const durations: number[] = [];
const started = performance.now();
try {
  for (let offset = 0; offset < users; offset += concurrency) {
    await Promise.all(Array.from({ length: Math.min(concurrency, users - offset) }, async (_, index) => {
      const start = performance.now();
      const response = await app.inject({
        method: 'POST', url: '/v1/messages', headers: { authorization: `Bearer ${offset + index}` },
        payload: { model: 'sonnet', max_tokens: 16, messages: [{ role: 'user', content: 'synthetic load' }] }
      });
      assert.equal(response.statusCode, 200);
      durations.push(performance.now() - start);
    }));
  }
  const elapsedSeconds = (performance.now() - started) / 1000;
  const [row] = await db.query("SELECT COUNT(*) AS count FROM balances WHERE scope LIKE 'user:%'");
  assert.equal(Number(row!.count), users);
  assert.equal(await ledger.balance('org:2026-10'), users * 60);
  assert.deepEqual(await ledger.report(), { requests: users, heldMicros: 0, settledMicros: users * 60 });
  durations.sort((a, b) => a - b);
  const summary = {
    kind: 'simulated-http-sqlite-population', realEntra: false, realGraph: false, realInference: false,
    users, businessUnits: 100, tiers: 10, concurrency, elapsedSeconds,
    requestsPerSecond: users / elapsedSeconds,
    p50Milliseconds: durations[Math.floor(users * 0.50)],
    p95Milliseconds: durations[Math.floor(users * 0.95)],
    p99Milliseconds: durations[Math.floor(users * 0.99)],
    distinctPersonBudgetRows: Number(row!.count), heldMicros: 0,
    rssMegabytes: process.memoryUsage().rss / 1024 / 1024,
    measuredAt: new Date().toISOString()
  };
  await mkdir('.local', { recursive: true });
  await writeFile(path.join('.local', 'scale-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await app.close();
  await db.close();
}
