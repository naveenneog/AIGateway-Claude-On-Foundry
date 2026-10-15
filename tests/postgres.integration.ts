import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import test from 'node:test';
import EmbeddedPostgres from 'embedded-postgres';
import { PostgresDatabase } from '../src/database.js';
import { Ledger } from '../src/ledger.js';
import { parsePolicy } from '../src/policy.js';
import { policyFixture } from './support.js';

test('real PostgreSQL: independent pools share caps and exactly-once settlement', { timeout: 120000 }, async () => {
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const address = socket.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  await mkdir(path.resolve('.local'), { recursive: true });
  const password = randomBytes(24).toString('hex');
  const logs: string[] = [];
  let phase = 'initialise';
  const server = new EmbeddedPostgres({
    databaseDir: path.resolve('.local', `postgres-${randomUUID()}`),
    user: 'postgres', password, port, persistent: false,
    postgresFlags: ['-h', '127.0.0.1'],
    onLog: (message) => logs.push(String(message)), onError: (message) => process.stderr.write(String(message) + '\n')
  });
  const pools: PostgresDatabase[] = [];
  try {
    await server.initialise();
    phase = 'start';
    await server.start();
    phase = 'create database';
    await server.createDatabase('gateway_test');
    const url = `postgresql://postgres:${password}@127.0.0.1:${port}/gateway_test`;
    pools.push(new PostgresDatabase(url), new PostgresDatabase(url));
    const ledgers = pools.map((db) => new Ledger(db));
    phase = 'initialize ledger';
    await ledgers[0]!.initialize();
    phase = 'shared-cap contention';
    const results = await Promise.allSettled(Array.from({ length: 100 }, (_, i) =>
      ledgers[i % 2]!.reserve(`pg-${i}`, [{ key: 'org', limit: 1000 }, { key: `user:${i}`, limit: 100 }], 100, {})));
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 10);
    for (const result of results) {
      if (result.status === 'rejected') assert.match(String(result.reason), /budget_exceeded/);
    }
    assert.equal(await ledgers[0]!.balance('org'), 1000);
    const successes = results.flatMap((result, i) => result.status === 'fulfilled' ? [i] : []);
    const settled = await Promise.all(ledgers.map((ledger) => ledger.settle(`pg-${successes[0]}`, 20)));
    assert.equal(settled.filter(Boolean).length, 1);
    assert.equal(await ledgers[1]!.balance('org'), 920);
    phase = 'policy CAS';
    const policy = parsePolicy(policyFixture());
    await ledgers[0]!.putPolicy(policy, 0);
    const writes = await Promise.allSettled(ledgers.map((ledger) => ledger.putPolicy(policy, 1)));
    assert.equal(writes.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal((await ledgers[1]!.getPolicy()).version, 2);
    phase = 'BU-tier matrix reservations';
    for (let offset = 0; offset < 1000; offset += 100) {
      await Promise.all(Array.from({ length: 100 }, (_, index) => {
        const i = offset + index;
        return ledgers[i % 2]!.reserve(`matrix-${i}`, [
          { key: 'matrix-org', limit: 10000 },
          { key: `matrix-bu:${i % 100}`, limit: 100 },
          { key: `matrix-tier:${i % 100}:${Math.floor(i / 100)}`, limit: 10 },
          { key: `matrix-user:${i}`, limit: 10 }
        ], 10, {});
      }));
    }
    assert.equal(await ledgers[1]!.balance('matrix-org'), 10000);
    await assert.rejects(ledgers[0]!.reserve('matrix-deny', [{ key: 'matrix-org', limit: 10000 }], 1, {}), /budget_exceeded/);
    phase = 'BU-tier matrix settlements';
    for (let offset = 0; offset < 1000; offset += 100) {
      await Promise.all(Array.from({ length: 100 }, (_, index) => ledgers[index % 2]!.settle(`matrix-${offset + index}`, 1)));
    }
    assert.equal(await ledgers[0]!.balance('matrix-org'), 1000);
  } catch (error) {
    throw new Error(`PostgreSQL integration failed during ${phase}:\n${logs.join('')}`, { cause: error });
  } finally {
    await Promise.all(pools.map((pool) => pool.close()));
    await server.stop();
  }
});
