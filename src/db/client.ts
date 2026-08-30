import { drizzle } from 'drizzle-orm/expo-sqlite';
import * as SQLite from 'expo-sqlite';

import * as schema from './schema';

export const DATABASE_NAME = 'flashcards.db';

/**
 * `enableChangeListener` is what makes drizzle's `useLiveQuery` re-run when a
 * table changes, so list screens refresh without any manual invalidation.
 */
export const sqliteDb = SQLite.openDatabaseSync(DATABASE_NAME, { enableChangeListener: true });

// SQLite disables FK enforcement per connection; our ON DELETE CASCADE needs it.
sqliteDb.execSync('PRAGMA foreign_keys = ON;');

export const db = drizzle(sqliteDb, { schema });
