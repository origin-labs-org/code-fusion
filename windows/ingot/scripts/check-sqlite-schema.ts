#!/usr/bin/env -S pnpm exec tsx
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { TaskIndexRepo } from "../packages/services/src/session/taskIndexRepo.js";
import { AutomationRepo } from "../packages/services/src/session/automationRepo.js";
import { OffPeakTaskRepo } from "../packages/services/src/session/offPeakTaskRepo.js";
import { getTasksIndexDatabasePath, setDataBaseDir } from "../packages/services/src/paths.js";
import { SQLITE_MIGRATIONS } from "../apps/cli/packages/adapters/src/storage/session-store/migrations.js";
import { sqliteMigrations } from "../packages/shared/src/sqlite-migrations/index.js";
import { assertAdditiveSchema, dumpSqliteSchema } from "./sqlite-schema-contract.mjs";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const update = process.argv.includes("--update");
const base =
  process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA || process.env.SQLITE_SCHEMA_BASE_REF || "HEAD";
const exec = promisify(execFile);
await exec("git", ["rev-parse", "--verify", `${base}^{commit}`]);
const directory = await mkdtemp(join(tmpdir(), "cf-schema-check-"));
const cli = new DatabaseSync(":memory:");
setDataBaseDir(directory);
const repos = [new AutomationRepo(), new OffPeakTaskRepo(), new TaskIndexRepo()];
try {
  for (const repo of repos) await repo.ensureReady();
  const app = new DatabaseSync(getTasksIndexDatabasePath(), { readOnly: true });
  let appSql: string;
  try {
    appSql = dumpSqliteSchema(app);
  } finally {
    app.close();
  }
  await sqliteMigrations.migrate(cli, SQLITE_MIGRATIONS, {
    database: "cli",
    backupDirectories: [directory],
    appliedAtColumn: "time_applied",
  });
  const schemas = [
    ["packages/services/src/project-storage/schema.baseline.sql", appSql],
    [
      "apps/cli/packages/adapters/src/storage/session-store/schema.baseline.sql",
      dumpSqliteSchema(cli),
    ],
  ];
  for (const [path, current] of schemas) {
    let previous: string | undefined;
    try {
      previous = (await exec("git", ["show", `${base}:${path}`])).stdout;
    } catch {
      
    }
    if (previous) assertAdditiveSchema(previous, current);
    if (update) await writeFile(path, current);
    else {
      const baseline = await readFile(path, "utf8");
      assertAdditiveSchema(baseline, current);
      assertAdditiveSchema(current, baseline);
      if (baseline !== current)
        throw new Error(`Schema baseline differs: ${path}; review then run pnpm db:schema:update`);
    }
    console.log(`SQLite schema compatible: ${path}`);
  }
} finally {
  for (const repo of repos.toReversed()) repo.close();
  cli.close();
  setDataBaseDir(null);
  await rm(directory, { recursive: true, force: true });
}
