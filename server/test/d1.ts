/**
 * D1 on `node:sqlite`, for the tests: the same SQLite underneath, the same
 * migrations, behind the subset of D1's API the Worker uses (`src/db.ts`).
 *
 * Kept faithful where it matters: `first()` gives null for no row, `batch()` is
 * one transaction, and `undefined` is refused the way D1 refuses it — a missed
 * bind would otherwise pass here and fail in production.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result, D1Value } from '../src/db.ts';

const MIGRATIONS = new URL('../migrations/', import.meta.url);

class Statement implements D1PreparedStatement {
  readonly db: DatabaseSync;
  readonly query: string;
  readonly values: D1Value[];

  constructor(db: DatabaseSync, query: string, values: D1Value[] = []) {
    this.db = db;
    this.query = query;
    this.values = values;
  }

  bind(...values: D1Value[]): D1PreparedStatement {
    if (values.some((value) => value === undefined)) throw new Error('D1_TYPE_ERROR: undefined bind');

    return new Statement(this.db, this.query, values);
  }

  async first<T>(): Promise<T | null> {
    return this.firstSync<T>();
  }

  async all<T>(): Promise<D1Result<T>> {
    return this.allSync<T>();
  }

  async run(): Promise<D1Result> {
    return this.runSync();
  }

  firstSync<T>(): T | null {
    const row = this.db.prepare(this.query).get(...this.values);

    return row ? ({ ...row } as T) : null;
  }

  allSync<T>(): D1Result<T> {
    const rows = this.db.prepare(this.query).all(...this.values);

    return { results: rows.map((row) => ({ ...row }) as T), success: true, meta: {} };
  }

  runSync(): D1Result {
    const result = this.db.prepare(this.query).run(...this.values);

    return {
      results: [],
      success: true,
      meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
    };
  }
}

export type TestDb = D1Database & { raw: DatabaseSync };

export function createDb(): TestDb {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');

  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
  }

  return {
    raw: db,
    prepare: (query) => new Statement(db, query),
    async batch(statements) {
      db.exec('BEGIN');

      try {
        const results = statements.map((statement) => {
          const own = statement as Statement;

          return /^\s*(SELECT|WITH)/i.test(own.query)
            ? own.allSync<Record<string, unknown>>()
            : own.runSync();
        });

        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
