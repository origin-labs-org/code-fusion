import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";

export interface SqliteMigration {
  id: string;
  
  previousIds?: readonly string[];
  appVersion: string;
  sql: string;
  touchedTables: readonly string[];
  apply?: (db: DatabaseSync) => void;
}

export interface MigrationBackupTable {
  name: string;
  columns: string[];
  rows: number;
  hash: string;
}

export interface MigrationBackup {
  version: 1;
  database: string;
  journalTable?: "schema_migration" | "tasks_schema_migration";
  migrations: string[];
  tables: MigrationBackupTable[];
  skipped?: "insufficient-space";
}

export interface MigrationOptions {
  database: string;
  transactionOpen?: boolean;
  onBeforeApply?: (migrationId: string) => void | Promise<void>;
  onApplied?: (migrationId: string) => void;
  onCommitting?: () => void | Promise<void>;
  
  journalTable?: "schema_migration" | "tasks_schema_migration";
  
  backupDirectories: readonly string[];
  
  fallbackBackupDirectories?: () => Promise<readonly string[]>;
  
  appliedAtColumn?: "time_applied" | "applied_at";
  now?: () => number;
  onBackupSkipped?: (backup: MigrationBackup) => void;
}

export interface MigrationResult {
  applied: string[];
  backupPath?: string;
  backupSkipped: boolean;
}

export class MigrationChecksumError extends Error {
  constructor(readonly migrationId: string) {
    super(`Migration checksum mismatch: ${migrationId}`);
    this.name = "MigrationChecksumError";
  }
}

export interface SqliteMigrationsContract {
  
  migrate(
    db: DatabaseSync,
    migrations: readonly SqliteMigration[],
    options: MigrationOptions,
  ): Promise<MigrationResult>;
  
  restore(db: DatabaseSync, backupPath: string): Promise<void>;
}

export const STORAGE_MIGRATION_COMMAND = "storage-migrate";
export const storageMigrationReportSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("storage-migrated"),
    applied: z.array(z.string()),
    backupPath: z.string().optional(),
    backupSkipped: z.boolean(),
  })
  .strict();
