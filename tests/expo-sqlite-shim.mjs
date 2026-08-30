/**
 * Minimal `expo-sqlite` stand-in over Node's built-in `node:sqlite`, covering
 * exactly the surface drizzle's expo-sqlite driver touches. Lets the tests call
 * the real functions from `src/db/queries.ts` against a real SQLite engine.
 *
 * Two things the driver quietly depends on:
 *  - `addDatabaseChangeListener` must be a module-level export, not a method.
 *  - drizzle emits SELECTs without column aliases and maps results
 *    *positionally*, so `executeForRawResultSync` has to hand back arrays.
 *    Reading rows by name would collapse repeated expression columns.
 */
import { DatabaseSync } from 'node:sqlite';

export function openDatabaseSync() {
  const db = new DatabaseSync(':memory:');
  return {
    prepareSync: (source) => prepare(db, source),
    execSync: (source) => db.exec(source),
    closeSync: () => db.close(),
    addDatabaseChangeListener,
  };
}

export function addDatabaseChangeListener() {
  return { remove() {} };
}

function prepare(db, source) {
  const stmt = db.prepare(source);
  const meta = db.prepare('select changes() as c, last_insert_rowid() as r');

  // The statement runs exactly once per call; `all()` does not report changes,
  // so those come from a separate read.
  const runOnce = (params, asArrays) => {
    stmt.setReturnArrays(asArrays);

    let rows;
    try {
      rows = stmt.all(...params);
    } catch {
      stmt.run(...params);
      rows = [];
    }

    const { c, r } = meta.get();
    return {
      changes: c,
      lastInsertRowId: r,
      getAllSync: () => rows,
      getFirstSync: () => rows[0] ?? null,
    };
  };

  return {
    executeSync: (params = []) => runOnce(params, false),
    executeForRawResultSync: (params = []) => runOnce(params, true),
    finalizeSync() {},
  };
}
