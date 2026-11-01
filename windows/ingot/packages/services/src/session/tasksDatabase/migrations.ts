import { TASK_GROUP_ADMISSIONS_SQL } from "#src/task-groups/migration-v6.js";
import { basename, dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { databaseMigrationIdSchema, type DatabaseMigrationFacts } from "@origin-ai/cf-shared";
import type { DatabaseSync } from "node:sqlite";
import { sqliteMigrations, type SqliteMigration } from "@origin-ai/cf-shared/sqlite-migrations";
import {
  AUTOMATION_SCHEMA,
  OFF_PEAK_SCHEMA,
  TASK_INDEX_SCHEMA,
} from "#src/session/tasksDatabase/schema-v1.js";
import { importLegacyAutomationSelections } from "#src/session/tasksDatabase/provider-selection-v2.js";
import { OFFICIAL_GLM_SELECTION_MIGRATION_SQL } from "#src/session/tasksDatabase/official-glm-selection-v3.js";
import { CONTROLLER_REMOTE_SCHEMA_SQL } from "#src/session/tasksDatabase/controller-remote-schema-v4.js";
import {
  adoptSourceServerWorkspaceSchema,
  SOURCE_SERVER_SCHEMA_CHECKSUM_INPUT,
} from "#src/session/tasksDatabase/source-server-schema-v5.js";

const columns = [
  ["tasks", "title_overridden", "INTEGER NOT NULL DEFAULT 0"],
  ["tasks", "last_unread_at", "INTEGER NOT NULL DEFAULT 0"],
  ["tasks", "searchable_text", "TEXT NOT NULL DEFAULT ''"],
  ["tasks", "cron_automation_id", "TEXT"],
  ["tasks", "off_peak_task_id", "TEXT"],
  ["automations", "target_task_id", "TEXT"],
  ["automations", "bot_delivery_target", "TEXT"],
  ["automations", "mode", "TEXT"],
  ["automations", "end_at", "INTEGER"],
  ["automations", "schedule_rule", "TEXT"],
  ["automations", "schedule_edited_by_user", "INTEGER NOT NULL DEFAULT 0"],
  ["automations", "thought_level", "TEXT"],
  ["automations", "model_selection", "TEXT"],
  ["automations", "scheduled_run_count", "INTEGER NOT NULL DEFAULT 0"],
  ["automation_runs", "model_selection", "TEXT"],
  ["off_peak_tasks", "thought_level", "TEXT"],
  ["off_peak_tasks", "model_selection", "TEXT"],
  ["off_peak_tasks", "history_deleted_at", "INTEGER"],
] as const;
const indexes = `
  CREATE INDEX IF NOT EXISTS idx_tasks_cron_automation ON tasks(cron_automation_id, updated_at DESC)
    WHERE cron_automation_id IS NOT NULL AND deleted=0;
  CREATE INDEX IF NOT EXISTS idx_tasks_off_peak_task ON tasks(off_peak_task_id, updated_at DESC)
    WHERE off_peak_task_id IS NOT NULL AND deleted=0;
  CREATE INDEX IF NOT EXISTS idx_automations_target_task ON automations(target_task_id) WHERE target_task_id IS NOT NULL;
`;
const terminalStatuses = "'completed','failed','cancelled'";
const activePredicate = `session_id IS NOT NULL AND status NOT IN (${terminalStatuses})`;
const boundIndex = `CREATE UNIQUE INDEX IF NOT EXISTS idx_off_peak_bound_active ON off_peak_tasks(workspace_key,session_id) WHERE ${activePredicate}`;
const executionColumns = [
  ["automations", "project_id"],
  ["automations", "host_id"],
  ["automations", "additional_directories"],
  ["off_peak_tasks", "project_id"],
  ["off_peak_tasks", "host_id"],
  ["off_peak_tasks", "additional_directories"],
] as const;

const definitions = [
  {
    id: "0001_adopt_task_schema",
    touchedTables: [
      "tasks",
      "task_groups",
      "task_group_members",
      "task_group_view_node_orders",
      "task_group_workspace_bootstraps",
      "automations",
      "automation_runs",
      "off_peak_tasks",
    ],
    apply: adoptSchema,
    checksumInput: [
      TASK_INDEX_SCHEMA,
      AUTOMATION_SCHEMA,
      OFF_PEAK_SCHEMA,
      columns,
      indexes,
      boundIndex,
      "scheduled-count-backfill-v1",
    ],
  },
  {
    id: "0002_provider_selection",
    touchedTables: ["automations"],
    apply: importLegacyAutomationSelections,
    checksumInput: ["legacy-automation-selection-v1", "no-provider-for-legacy-off-peak-v1"],
  },
  {
    id: "0003_official_glm_selection",
    touchedTables: ["automations"],
    apply: (db: DatabaseSync) => db.exec(OFFICIAL_GLM_SELECTION_MIGRATION_SQL),
    checksumInput: [OFFICIAL_GLM_SELECTION_MIGRATION_SQL],
  },
  {
    id: "0004_project_execution_scopes",
    touchedTables: ["automations", "off_peak_tasks"],
    checksumInput: [executionColumns, "nullable-text-v1"],
    apply: (db: DatabaseSync) => {
      for (const [table, column] of executionColumns) {
        if (
          !db
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .some((entry) => entry.name === column)
        )
          db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
      }
    },
  },
  {
    id: "0006_task_group_admissions",
    touchedTables: ["task_group_admissions"],
    checksumInput: [TASK_GROUP_ADMISSIONS_SQL],
    apply: (db: DatabaseSync) => db.exec(TASK_GROUP_ADMISSIONS_SQL),
  },
] as const;

export type TasksDatabaseMigrationScope = "base" | "controller-remote" | "source-server";

interface TasksDatabaseMigrationOptions {
  scope?: TasksDatabaseMigrationScope;
  dbPath?: string;
  transactionOpen?: boolean;
  migration?: DatabaseMigrationFacts;
  onProgress?: (phase: "migrating" | "committing", migration: DatabaseMigrationFacts) => void;
}

function prepareMigrations(scope: TasksDatabaseMigrationScope) {
  const migrations =
    scope === "base"
      ? definitions
      : scope === "controller-remote"
        ? [
            {
              id: "0004_controller_remote_identity",
              checksumInput: [CONTROLLER_REMOTE_SCHEMA_SQL],
              touchedTables: ["controller_remote_identity_migrations"],
              apply: (db: DatabaseSync) => db.exec(CONTROLLER_REMOTE_SCHEMA_SQL),
            },
          ]
        : [
            {
              id: "0005_source_server_workspace_schema",
              checksumInput: SOURCE_SERVER_SCHEMA_CHECKSUM_INPUT,
              touchedTables: [
                "workspace_alias",
                "workspace_migration_schema_version",
                "workspace_migration_ledger",
                "workspace_migration_conflicts",
                "workspace_migration_ledger_v2",
                "workspace_migration_conflicts_v2",
              ],
              apply: adoptSourceServerWorkspaceSchema,
            },
          ];
  return migrations.map((migration) => ({
    id: migration.id,
    appVersion: "3.12.0",
    sql: JSON.stringify(migration.checksumInput),
    touchedTables: migration.touchedTables,
    apply: migration.apply,
    checksum: createHash("sha256").update(JSON.stringify(migration.checksumInput)).digest("hex"),
  }));
}

export async function runTasksDatabaseMigrations(
  db: DatabaseSync,
  scopeOrOptions: string | TasksDatabaseMigrationOptions = "base",
) {
  const options: TasksDatabaseMigrationOptions =
    typeof scopeOrOptions === "string"
      ? ["base", "controller-remote", "source-server"].includes(scopeOrOptions)
        ? { scope: scopeOrOptions as TasksDatabaseMigrationScope }
        : { dbPath: scopeOrOptions }
      : scopeOrOptions;
  const scope = options.scope ?? "base";
  const migrations = prepareMigrations(scope);
  if (!options.transactionOpen && areTasksDatabaseMigrationsApplied(db, scope))
    return { applied: [], backupSkipped: false };
  const facts = options.migration ?? {
    kind: inspectTasksMigrationKind(db, scope),
    executedCount: 0,
    committedCount: 0,
  };
  const path =
    options.dbPath ??
    String(
      db
        .prepare("pragma database_list")
        .all()
        .find((row) => row.name === "main")?.file ?? ":memory:",
    );
  const directory = dirname(path);
  const dataRoot = basename(directory) === "v2" ? dirname(directory) : directory;
  let currentMigrationId: string | undefined;
  try {
    const result = await sqliteMigrations.migrate(db, migrations, {
      database: "tasks_schema",
      journalTable: "tasks_schema_migration",
      backupDirectories: [join(dataRoot, "backup")],
      transactionOpen: options.transactionOpen,
      onBeforeApply: (id) => {
        currentMigrationId = id;
        if (facts.kind === "none") facts.kind = "upgrade";
        if (facts.lastAppliedMigrationId === undefined) {
          const baseline = db
            .prepare("SELECT id FROM tasks_schema_migration ORDER BY id DESC LIMIT 1")
            .get();
          facts.lastAppliedMigrationId = baseline
            ? databaseMigrationIdSchema.safeParse(baseline.id).data
            : null;
        }
        options.onProgress?.("migrating", { ...facts });
      },
      onApplied: () => {
        facts.executedCount++;
      },
      onCommitting: () => {
        if (facts.lastAppliedMigrationId === undefined) {
          const baseline = db
            .prepare("SELECT id FROM tasks_schema_migration ORDER BY id DESC LIMIT 1")
            .get();
          facts.lastAppliedMigrationId = baseline
            ? databaseMigrationIdSchema.safeParse(baseline.id).data
            : null;
        }
        options.onProgress?.("committing", { ...facts });
      },
    });
    facts.committedCount = facts.executedCount;
    return result;
  } catch (error) {
    if (error && typeof error === "object" && currentMigrationId)
      Object.assign(error, { migrationId: currentMigrationId });
    throw error;
  }
}

function isMigrationApplied(db: DatabaseSync, id: string, checksum: string): boolean {
  const applied = db.prepare("SELECT checksum FROM tasks_schema_migration WHERE id=?").get(id);
  if (!applied) return false;
  if (applied.checksum !== checksum)
    throw Object.assign(new Error(`Task database migration checksum mismatch: ${id}`), {
      kind: "checksum_mismatch",
      migrationId: id,
    });
  return true;
}

export function areTasksDatabaseMigrationsApplied(
  db: DatabaseSync,
  scope: TasksDatabaseMigrationScope = "base",
): boolean {
  if (
    !db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tasks_schema_migration'")
      .get()
  )
    return false;
  return prepareMigrations(scope).every(({ id, checksum }) => isMigrationApplied(db, id, checksum));
}

export function inspectTasksMigrationKind(
  db: DatabaseSync,
  scope: TasksDatabaseMigrationScope = "base",
): DatabaseMigrationFacts["kind"] {
  const hasLedger = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tasks_schema_migration'")
    .get();
  let pending = false;
  for (const { id, checksum } of prepareMigrations(scope)) {
    if (!hasLedger || !isMigrationApplied(db, id, checksum)) pending = true;
  }
  if (!pending) return "none";
  return db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT IN ('tasks_schema_migration', 'sqlite_sequence') LIMIT 1",
    )
    .get()
    ? "upgrade"
    : "initialize";
}

function adoptSchema(db: DatabaseSync): void {
  db.exec(TASK_INDEX_SCHEMA + AUTOMATION_SCHEMA + OFF_PEAK_SCHEMA);
  for (const [table, column, definition] of columns) {
    const existing = db.prepare(`PRAGMA table_info(${table})`).all();
    if (existing.some((entry) => entry.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    if (table === "automations" && column === "scheduled_run_count") {
      db.exec("UPDATE automations SET scheduled_run_count=run_count");
    }
  }
  db.exec(indexes);
  const duplicate = db
    .prepare(`SELECT 1 FROM off_peak_tasks WHERE ${activePredicate}
    GROUP BY workspace_key, session_id HAVING count(*)>1 LIMIT 1`)
    .get();
  if (!duplicate) db.exec(boundIndex);
}
