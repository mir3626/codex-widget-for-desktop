import { createRequire as createNodeRequire } from "node:module";
import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";
import { LATEST_STORAGE_SCHEMA_VERSION, STORAGE_MIGRATIONS } from "./schema.js";
import type { StoragePaths } from "./paths.js";
import type { StorageHealth } from "./types.js";

export type SqlValue = string | number | bigint | null | Uint8Array;

export function createDatabaseSyncConstructor(): new (path: string) => NodeDatabaseSync {
  return loadDatabaseSync();
}

export function configureDatabase(database: NodeDatabaseSync): void {
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
}

export function migrate(database: NodeDatabaseSync): void {
  database.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`);

  for (const migration of STORAGE_MIGRATIONS) {
    const row = database.prepare("SELECT version FROM schema_migrations WHERE version = ?").get(migration.version);
    if (row) {
      continue;
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, CURRENT_TIMESTAMP)")
        .run(migration.version, migration.name);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

export function readStorageHealth(
  database: NodeDatabaseSync,
  paths: StoragePaths,
  options: { integrityCheck?: boolean } = {}
): StorageHealth {
  const journalMode = readSingleValue(database, "PRAGMA journal_mode", "journal_mode");
  const foreignKeys = Number(readSingleValue(database, "PRAGMA foreign_keys", "foreign_keys")) === 1;
  const integrity = options.integrityCheck === false
    ? "not_checked"
    : String(readSingleValue(database, "PRAGMA integrity_check", "integrity_check"));
  const schemaVersion = Number(readSingleValue(database, "SELECT COALESCE(MAX(version), 0) AS value FROM schema_migrations", "value"));
  const migrationsApplied = Number(readSingleValue(database, "SELECT COUNT(*) AS value FROM schema_migrations", "value"));
  const tableCount = Number(
    readSingleValue(
      database,
      "SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      "value"
    )
  );

  return {
    state: "ready",
    appDataDir: paths.appDataDir,
    databasePath: paths.databasePath,
    blobDir: paths.blobDir,
    schemaVersion,
    latestSchemaVersion: LATEST_STORAGE_SCHEMA_VERSION,
    migrationsApplied,
    tableCount,
    journalMode: String(journalMode),
    foreignKeys,
    integrity
  };
}

export function readSingleValue(database: NodeDatabaseSync, sql: string, key: string, ...values: SqlValue[]): unknown {
  const row = database.prepare(sql).get(...values);
  return row?.[key];
}

function loadDatabaseSync(): new (path: string) => NodeDatabaseSync {
  try {
    return createNodeRequire(import.meta.url)("node:sqlite").DatabaseSync as new (path: string) => NodeDatabaseSync;
  } catch {
    try {
      return createNodeRequire(import.meta.url)("better-sqlite3") as new (path: string) => NodeDatabaseSync;
    } catch (error) {
      throw new Error(`SQLite runtime is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
