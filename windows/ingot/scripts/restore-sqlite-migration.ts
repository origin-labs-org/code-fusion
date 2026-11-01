#!/usr/bin/env -S pnpm exec tsx
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sqliteMigrations } from "../packages/shared/src/sqlite-migrations/index.js";

const args = process.argv.slice(2);
if (args.length !== 2 || args.some((arg) => arg.startsWith("-"))) {
  throw new Error(
    "Usage: pnpm exec tsx scripts/restore-sqlite-migration.ts <database.sqlite> <backup-directory>. Stop all database writers first.",
  );
}
const databasePath = resolve(args[0]!);
const backupPath = resolve(args[1]!);
if (!(await stat(databasePath)).isFile()) throw new Error("Database must already exist");
const db = new DatabaseSync(databasePath);
try {
  db.exec("PRAGMA busy_timeout=0");
  await sqliteMigrations.restore(db, backupPath);
  console.log(`Restored and verified: ${databasePath}`);
} finally {
  db.close();
}
