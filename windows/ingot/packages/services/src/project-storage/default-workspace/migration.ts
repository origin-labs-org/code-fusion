import type { DatabaseSync } from "node:sqlite";
import type { ProjectMigrationContext } from "#src/project-storage/contract.js";

export const DEFAULT_WORKSPACE_CANDIDATES_SQL = `
SELECT p.project_id FROM projects p JOIN project_roots r USING(project_id)
WHERE p.host_id=? AND p.deleted=0 AND p.name_overridden=0
  AND p.updated_at=p.created_at
  AND p.created_at<=(SELECT applied_at FROM schema_migration WHERE id='0005_projects')
  AND (SELECT count(*) FROM project_roots other WHERE other.project_id=p.project_id)=1
  AND replace(r.root_path, char(92), '/') GLOB '*/.cf/workspace/default'
`;

export function migrateDefaultWorkspaceTasks(db: DatabaseSync, context: ProjectMigrationContext) {
  const ids = db.prepare(DEFAULT_WORKSPACE_CANDIDATES_SQL).all(context.hostId ?? "local");
  const now = (context.now ?? Date.now)();
  for (const { project_id } of ids) {
    db.prepare("UPDATE tasks SET project_id=NULL WHERE project_id=? AND host_id=?").run(
      String(project_id),
      context.hostId ?? "local",
    );
    db.prepare("UPDATE projects SET deleted=1,deleted_at=?,updated_at=? WHERE project_id=?").run(
      now,
      now,
      String(project_id),
    );
  }
}
