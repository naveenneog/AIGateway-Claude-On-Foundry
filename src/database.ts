import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

export type Row = Record<string, unknown>;
export interface Session {
  query(sql: string, values?: (string | number | null)[]): Promise<Row[]>;
  readonly lock: string;
}
export interface Database extends Session {
  transaction<T>(action: (session: Session) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export class SqliteDatabase implements Database {
  private readonly db: DatabaseSync;
  private tail: Promise<unknown> = Promise.resolve();
  readonly lock = '';
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  }
  private async direct(sql: string, values: (string | number | null)[] = []): Promise<Row[]> {
    return this.db.prepare(sql).all(...values) as Row[];
  }
  async query(sql: string, values: (string | number | null)[] = []): Promise<Row[]> {
    return this.tail.then(() => this.direct(sql, values));
  }
  async transaction<T>(action: (session: Session) => Promise<T>): Promise<T> {
    const execute = async () => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const result = await action({ lock: this.lock, query: this.direct.bind(this) });
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    };
    const result = this.tail.then(execute);
    this.tail = result.catch(() => undefined);
    return result;
  }
  async close() { await this.tail; this.db.close(); }
}

export class PostgresDatabase implements Database {
  private readonly pool: pg.Pool;
  readonly lock = ' FOR UPDATE';
  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  }
  private session(client: pg.Pool | pg.PoolClient): Session {
    return {
      lock: this.lock,
      query: async (sql, values = []) => {
        let index = 0;
        const result = await client.query(sql.replace(/\?/g, () => `$${++index}`), values);
        return result.rows as Row[];
      }
    };
  }
  query(sql: string, values?: (string | number | null)[]) {
    return this.session(this.pool).query(sql, values);
  }
  async transaction<T>(action: (session: Session) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await action(this.session(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async close() { await this.pool.end(); }
}
