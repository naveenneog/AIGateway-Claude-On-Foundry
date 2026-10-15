import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import pg from 'pg';
import { PostgresDatabase } from '../src/database.js';

test('PostgreSQL close waits for client disconnect, not just pool bookkeeping', async (t) => {
  const client = new pg.Client();
  t.mock.method(pg.Pool.prototype, 'end', async function (this: pg.Pool) {
    this.emit('connect', client);
  });
  const db = new PostgresDatabase('postgresql://fixture@127.0.0.1/fixture');
  let closed = false;
  const closing = db.close().then(() => { closed = true; });
  await setImmediate();
  assert.equal(closed, false, 'pool end must not finish close while its client remains connected');
  client.emit('end');
  await closing;
  assert.equal(closed, true);
});
