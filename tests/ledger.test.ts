import assert from 'node:assert/strict';
import test from 'node:test';
import { SqliteDatabase } from '../src/database.js';
import { Ledger } from '../src/ledger.js';
import { priceUsage, reserveCeiling, usdMicros, budgetMicros } from '../src/money.js';
import { parsePolicy } from '../src/policy.js';
import { policyFixture } from './support.js';

test('integer micro-USD rounds up and accounts for cache writes and reads', () => {
  const model = parsePolicy(policyFixture()).models.sonnet!;
  assert.equal(usdMicros(0.0000011), 2);
  assert.equal(budgetMicros(0.0000011), 1);
  assert.equal(priceUsage(model, { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 }), 210);
  assert.equal(reserveCeiling(model, 100), 1_201_500);
  assert.throws(() => priceUsage(model, { input_tokens: 10 }), /usage_unavailable/);
  assert.throws(() => priceUsage(model, { input_tokens: -1, output_tokens: 2 }), /usage_unavailable/);
});

test('concurrent requests cannot exceed any shared scope', async () => {
  const db = new SqliteDatabase(':memory:');
  const ledger = new Ledger(db);
  await ledger.initialize();
  const attempts = await Promise.allSettled(Array.from({ length: 100 }, (_, i) =>
    ledger.reserve(`request-${i}`, [{ key: 'org:2026-10', limit: 100 }, { key: `user-${i}`, limit: 100 }], 30, { model: 'sonnet' })));
  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 3);
  assert.equal(await ledger.balance('org:2026-10'), 90);
  assert.equal(await ledger.balance('user-99'), 0);
  await db.close();
});

test('settlement releases unused ceiling exactly once and retains unknown usage', async () => {
  const db = new SqliteDatabase(':memory:');
  const ledger = new Ledger(db);
  await ledger.initialize();
  await ledger.reserve('one', [{ key: 'org', limit: 100 }], 80, { model: 'sonnet' });
  assert.equal(await ledger.settle('one', 20), true);
  assert.equal(await ledger.settle('one', 20), false);
  assert.equal(await ledger.balance('org'), 20);
  await ledger.reserve('two', [{ key: 'org', limit: 100 }], 80, { model: 'sonnet' });
  assert.equal(await ledger.settle('two', undefined), false);
  assert.equal(await ledger.settle('two', 81), false);
  assert.equal(await ledger.balance('org'), 100);
  assert.equal((await ledger.report()).heldMicros, 80);
  assert.equal((await ledger.report()).settledMicros, 20);
  await db.close();
});

test('failed multi-scope reservation rolls back all writes; duplicate IDs deny', async () => {
  const db = new SqliteDatabase(':memory:');
  const ledger = new Ledger(db);
  await ledger.initialize();
  await assert.rejects(ledger.reserve('deny', [{ key: 'a', limit: 100 }, { key: 'b', limit: 0 }], 1, {}), /budget_exceeded/);
  assert.equal(await ledger.balance('a'), 0);
  await ledger.reserve('id', [{ key: 'a', limit: 100 }], 20, {});
  await assert.rejects(ledger.reserve('id', [{ key: 'a', limit: 100 }], 20, {}), /duplicate_request/);
  assert.equal(await ledger.balance('a'), 20);
  await db.close();
});

test('policy is versioned, durable, and stale admin writes fail', async () => {
  const db = new SqliteDatabase(':memory:');
  const ledger = new Ledger(db);
  await ledger.initialize();
  const policy = parsePolicy(policyFixture());
  assert.equal(await ledger.putPolicy(policy, 0), 1);
  assert.equal((await ledger.getPolicy()).version, 1);
  await assert.rejects(ledger.putPolicy(policy, 0), /policy_conflict/);
  assert.equal(await ledger.putPolicy({ ...policy, monthlyBudgetUsd: 0 }, 1), 2);
  assert.equal((await ledger.getPolicy()).policy.monthlyBudgetUsd, 0);
  await db.close();
});

test('reservation lock ordering is invariant across host locales', async () => {
  const db = new SqliteDatabase(':memory:');
  const ledger = new Ledger(db);
  await ledger.initialize();
  await ledger.reserve('ordered', ['a', 'Z', 'A', 'ä'].map((key) => ({ key, limit: 10 })), 1, {});
  const [row] = await db.query('SELECT scopes FROM reservations WHERE id = ?', ['ordered']);
  assert.deepEqual(JSON.parse(String(row!.scopes)), ['A', 'Z', 'a', 'ä']);
  await db.close();
});

test('SQLite public reads cannot observe a transaction that later rolls back', async () => {
  const db = new SqliteDatabase(':memory:');
  await db.query('CREATE TABLE isolation_test(value INTEGER)');
  await db.query('INSERT INTO isolation_test(value) VALUES (0)');
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const writing = db.transaction(async (tx) => {
    await tx.query('UPDATE isolation_test SET value = 10');
    entered.resolve();
    await release.promise;
    throw new Error('expected_rollback');
  });
  await entered.promise;
  const reading = db.query('SELECT value FROM isolation_test');
  release.resolve();
  await assert.rejects(writing, /expected_rollback/);
  assert.equal((await reading)[0]!.value, 0);
  await db.close();
});
