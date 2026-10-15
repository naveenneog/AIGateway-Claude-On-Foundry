import type { Database } from './database.js';
import { GatewayError } from './errors.js';
import { parsePolicy, type Policy } from './policy.js';

export type Scope = { key: string; limit: number };

function safeAmount(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new GatewayError(400, 'invalid_amount');
}

export class Ledger {
  constructor(private readonly db: Database) {}
  async initialize() {
    await this.db.query('CREATE TABLE IF NOT EXISTS balances (scope TEXT PRIMARY KEY, used BIGINT NOT NULL CHECK (used >= 0))');
    await this.db.query(`CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY, amount BIGINT NOT NULL, charged BIGINT,
      scopes TEXT NOT NULL, metadata TEXT NOT NULL, created_at TEXT NOT NULL)`);
    await this.db.query('CREATE TABLE IF NOT EXISTS policies (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, document TEXT NOT NULL)');
    await this.db.query('CREATE INDEX IF NOT EXISTS reservations_created ON reservations(created_at)');
  }
  async reserve(id: string, scopes: Scope[], amount: number, metadata: Record<string, string>) {
    safeAmount(amount);
    if (!scopes.length || new Set(scopes.map((scope) => scope.key)).size !== scopes.length) {
      throw new GatewayError(400, 'invalid_scopes');
    }
    for (const scope of scopes) safeAmount(scope.limit);
    await this.db.transaction(async (tx) => {
      if ((await tx.query('SELECT id FROM reservations WHERE id = ?', [id])).length) {
        throw new GatewayError(409, 'duplicate_request');
      }
      const sorted = [...scopes].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
      for (const scope of sorted) {
        await tx.query('INSERT INTO balances(scope, used) VALUES (?, 0) ON CONFLICT(scope) DO NOTHING', [scope.key]);
        const [row] = await tx.query(`SELECT used FROM balances WHERE scope = ?${tx.lock}`, [scope.key]);
        if (Number(row!.used) + amount > scope.limit) throw new GatewayError(403, 'budget_exceeded');
        await tx.query('UPDATE balances SET used = used + ? WHERE scope = ?', [amount, scope.key]);
      }
      await tx.query('INSERT INTO reservations(id, amount, charged, scopes, metadata, created_at) VALUES (?, ?, NULL, ?, ?, ?)',
        [id, amount, JSON.stringify(sorted.map((scope) => scope.key)), JSON.stringify(metadata), new Date().toISOString()]);
    });
  }
  async settle(id: string, charged: number | undefined): Promise<boolean> {
    if (charged === undefined) return false;
    safeAmount(charged);
    return this.db.transaction(async (tx) => {
      const [row] = await tx.query(`SELECT amount, charged, scopes FROM reservations WHERE id = ?${tx.lock}`, [id]);
      if (!row) throw new GatewayError(404, 'reservation_not_found');
      if (row.charged !== null || charged > Number(row.amount)) return false;
      const scopes: string[] = JSON.parse(String(row.scopes));
      for (const scope of scopes) {
        await tx.query(`SELECT used FROM balances WHERE scope = ?${tx.lock}`, [scope]);
        await tx.query('UPDATE balances SET used = used - ? WHERE scope = ?', [Number(row.amount) - charged, scope]);
      }
      await tx.query('UPDATE reservations SET charged = ? WHERE id = ?', [charged, id]);
      return true;
    });
  }
  async balance(key: string) {
    const [row] = await this.db.query('SELECT used FROM balances WHERE scope = ?', [key]);
    return Number(row?.used ?? 0);
  }
  async report() {
    const [row] = await this.db.query(`SELECT COUNT(*) AS requests,
      COALESCE(SUM(CASE WHEN charged IS NULL THEN amount ELSE 0 END), 0) AS held,
      COALESCE(SUM(COALESCE(charged, 0)), 0) AS settled FROM reservations`);
    return { requests: Number(row!.requests), heldMicros: Number(row!.held), settledMicros: Number(row!.settled) };
  }
  async getPolicy(): Promise<{ version: number; policy: Policy }> {
    const [row] = await this.db.query('SELECT version, document FROM policies WHERE id = 1');
    if (!row) throw new GatewayError(503, 'policy_not_configured');
    return { version: Number(row.version), policy: parsePolicy(JSON.parse(String(row.document))) };
  }
  async putPolicy(policy: Policy, expectedVersion: number): Promise<number> {
    const parsed = parsePolicy(policy);
    return this.db.transaction(async (tx) => {
      await tx.query('INSERT INTO policies(id, version, document) VALUES (1, 0, ?) ON CONFLICT(id) DO NOTHING', [JSON.stringify(parsed)]);
      const [row] = await tx.query(`SELECT version FROM policies WHERE id = 1${tx.lock}`);
      if (Number(row!.version) !== expectedVersion) throw new GatewayError(409, 'policy_conflict');
      await tx.query('UPDATE policies SET version = ?, document = ? WHERE id = 1', [expectedVersion + 1, JSON.stringify(parsed)]);
      return expectedVersion + 1;
    });
  }
}
