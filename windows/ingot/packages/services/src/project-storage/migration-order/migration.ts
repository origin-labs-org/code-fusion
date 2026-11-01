import type { DatabaseSync } from "node:sqlite";
import type { ProjectMigrationContext } from "#src/project-storage/contract.js";

export const INITIAL_WORKSPACE_ORDER_SQL =
  "ALTER TABLE remote_project_entries ADD COLUMN initial_position INTEGER";

export function migrateInitialWorkspaceOrder(
  db: DatabaseSync,
  context: ProjectMigrationContext,
): void {
  if ((context.hostId ?? "local") !== "local") return;
  let position = 0;
  const assigned = new Set<string>();
  for (const workspace of context.settings?.lastWorkspaceSession ?? []) {
    if (workspace.kind === "remote") {
      const legacy = JSON.stringify(workspace);
      if (assigned.has(legacy)) continue;
      assigned.add(legacy);
      const result = db
        .prepare(
          "UPDATE remote_project_entries SET initial_position=? WHERE legacy_workspace_json=?",
        )
        .run(position, legacy);
      if (result.changes) position++;
    } else {
      const project = db
        .prepare(`SELECT p.project_id FROM projects p
        JOIN project_roots r ON r.project_id=p.project_id
        WHERE p.host_id='local' AND p.deleted=0 AND r.root_path=?`)
        .get(workspace.workspacePath);
      if (!project || assigned.has(String(project.project_id))) continue;
      assigned.add(String(project.project_id));
      db.prepare("UPDATE projects SET position=? WHERE project_id=?").run(
        position++,
        project.project_id!,
      );
    }
  }
}
