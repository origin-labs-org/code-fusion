import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface SqliteSchemaMigration {
  id: string;
  sql: string;
  appVersion: string;
}

export class SqliteSchemaMigrationChecksumError extends Error {
  public constructor(public readonly migrationId: string) {
    super(
      `SQLite migration checksum mismatch for ${migrationId}. Historical migrations are immutable; add a new migration instead.`,
    );
    this.name = "SqliteSchemaMigrationChecksumError";
  }
}

export function ensureSqliteSchemaMigrationTable(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migration (
    id TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    app_version TEXT,
    time_applied INTEGER NOT NULL
  )`);
}

export function applySqliteSchemaMigration(
  db: DatabaseSync,
  migration: SqliteSchemaMigration,
  onExecuted?: () => void,
): void {
  if (!db.isTransaction) throw new Error("SQLite schema migration requires an active transaction");
  if (isMigrationApplied(db, migration)) return;
  db.exec(migration.sql);
  onExecuted?.();
  db.prepare(
    "INSERT INTO schema_migration (id, checksum, app_version, time_applied) VALUES (?, ?, ?, ?)",
  ).run(migration.id, migrationChecksum(migration), migration.appVersion, Date.now());
}

function migrationChecksum(migration: SqliteSchemaMigration): string {
  return createHash("sha256").update(migration.sql.trim()).digest("hex");
}

function isMigrationApplied(db: DatabaseSync, migration: SqliteSchemaMigration): boolean {
  const applied = db
    .prepare("SELECT checksum FROM schema_migration WHERE id = ?")
    .get(migration.id);
  if (!applied) return false;
  if (applied.checksum !== migrationChecksum(migration)) {
    throw new SqliteSchemaMigrationChecksumError(migration.id);
  }
  return true;
}

export const SESSION_DATABASE_IDENTITY_MIGRATION: SqliteSchemaMigration = {
  id: "0024_session_database_identity",
  appVersion: "0.16.9",
  sql: `
    CREATE TABLE IF NOT EXISTS cf_database_identity (
      scope TEXT PRIMARY KEY,
      identity TEXT NOT NULL
    );
    SELECT scope, identity FROM cf_database_identity WHERE 0;
  `,
};

export function runSessionDatabaseIdentityMigration(db: DatabaseSync): void {
  if (
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migration'")
      .get() &&
    isMigrationApplied(db, SESSION_DATABASE_IDENTITY_MIGRATION)
  ) {
    return;
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    ensureSqliteSchemaMigrationTable(db);
    applySqliteSchemaMigration(db, SESSION_DATABASE_IDENTITY_MIGRATION);
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
