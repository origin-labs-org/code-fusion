import { DatabaseSync, type SQLInputValue } from "node:sqlite";

interface SqliteReadinessDatabase {
  close: () => void;
  prepare: (sql: string) => {
    get: (...params: SQLInputValue[]) => unknown;
  };
}

interface WaitForSqliteTableOptions {
  delay?: (ms: number) => Promise<void>;
  now?: () => number;
  openDatabase?: (databasePath: string) => SqliteReadinessDatabase;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

const DEFAULT_SQLITE_READINESS_TIMEOUT_MS = 30_000;
const DEFAULT_SQLITE_READINESS_POLL_INTERVAL_MS = 100;

export async function waitForSqliteTable(
  databasePath: string,
  tableName: string,
  options: WaitForSqliteTableOptions = {},
) {
  const delay = options.delay ?? defaultDelay;
  const now = options.now ?? Date.now;
  const openDatabase = options.openDatabase ?? openReadonlyDatabase;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_SQLITE_READINESS_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_SQLITE_READINESS_TIMEOUT_MS;
  const startedAt = now();
  let lastError = `table ${tableName} 尚未Completed migration`;

  while (now() - startedAt <= timeoutMs) {
    let database: SqliteReadinessDatabase | null = null;
    try {
      database = openDatabase(databasePath);
      const ready = database
        .prepare("select 1 as ready from sqlite_master where type = 'table' and name = ?")
        .get(tableName);
      if (ready) return;
      lastError = `table ${tableName} 尚未Completed migration`;
    } catch (error) {
      lastError = describeError(error);
    } finally {
      database?.close();
    }

    if (now() - startedAt >= timeoutMs) break;
    await delay(pollIntervalMs);
  }

  throw new Error(
    `SQLite fixture Wait timed out: path=${databasePath}, table=${tableName}, lastError=${lastError}`,
  );
}

function openReadonlyDatabase(databasePath: string): SqliteReadinessDatabase {
  return new DatabaseSync(databasePath, { readOnly: true });
}

function defaultDelay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
