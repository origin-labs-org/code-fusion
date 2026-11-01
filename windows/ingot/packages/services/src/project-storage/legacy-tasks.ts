import type { DatabaseSync } from "node:sqlite";
import {
  resolveWorkspaceKey,
  parseRemoteWorkspaceIdentity,
  remoteHostIdFromWorkspaceIdentity,
} from "@origin-ai/cf-shared";
import { tableExists } from "#src/project-storage/schema.js";

export const HANDOFF_DELETE = 1;
export const HANDOFF_TITLE = 2;
export const HANDOFF_ORPHAN = 4;
export const OWNERSHIP_DECIDED = 8;

export function hostForWorkspace(workspaceKey: string): { hostId: string; kind: string } {
  const parsed = parseRemoteWorkspaceIdentity(workspaceKey);
  return {
    hostId: remoteHostIdFromWorkspaceIdentity(workspaceKey) ?? "local",
    kind: parsed?.kind ?? "local",
  };
}

export function ensureHost(db: DatabaseSync, workspaceKey: string, ownerHostId?: string): string {
  const { hostId, kind } = ownerHostId
    ? { hostId: ownerHostId, kind: ownerHostId === "local" ? "local" : "server" }
    : hostForWorkspace(workspaceKey);
  db.prepare(
    "INSERT OR IGNORE INTO hosts(host_id,kind,position) VALUES(?,?,(SELECT count(*) FROM hosts))",
  ).run(hostId, kind);
  return hostId;
}

export function uniqueRootProject(
  db: DatabaseSync,
  hostId: string,
  rootPath: string,
): string | null {
  const projects = db
    .prepare(`SELECT p.project_id FROM projects p JOIN project_roots r USING(project_id)
    WHERE p.host_id=? AND p.deleted=0 AND r.root_path=? LIMIT 2`)
    .all(hostId, rootPath) as { project_id: string }[];
  return projects.length === 1 ? projects[0]!.project_id : null;
}

export function initializeLegacyTaskIdentity(
  db: DatabaseSync,
  assignProject: boolean,
  ownerHostId?: string,
): void {
  if (!tableExists(db, "tasks")) return;
  const rows = db
    .prepare(
      "SELECT workspace_key,workspace_path,task_id,project_id FROM tasks WHERE host_id IS NULL",
    )
    .all() as {
    workspace_key: string;
    workspace_path: string;
    task_id: string;
    project_id: string | null;
  }[];
  const update = db.prepare(`UPDATE tasks SET host_id=?,root_path=workspace_path,project_id=?,
    cli_title=title,cli_title_source=CASE WHEN title_overridden=1 THEN 'custom' ELSE 'default' END,
    cli_created_at=created_at,cli_updated_at=updated_at,
    cli_last_outcome=CASE WHEN task_status='error' THEN 'error' WHEN task_status='interrupted' THEN 'interrupted' WHEN task_status='completed' THEN 'completed' ELSE NULL END,
    cli_deleted=0,handoff_pending=handoff_pending | ? | CASE WHEN deleted=1 THEN 1 ELSE 0 END | CASE WHEN title_overridden=1 THEN 2 ELSE 0 END
    WHERE workspace_key=? AND task_id=? AND host_id IS NULL`);
  for (const row of rows) {
    const hostId = ensureHost(db, row.workspace_key, ownerHostId);
    const projectId =
      row.project_id ?? (assignProject ? uniqueRootProject(db, hostId, row.workspace_path) : null);
    update.run(
      hostId,
      projectId,
      assignProject ? OWNERSHIP_DECIDED : 0,
      row.workspace_key,
      row.task_id,
    );
  }
}

function initializeLegacyDefinitions(db: DatabaseSync, ownerHostId?: string): void {
  for (const table of ["automations", "off_peak_tasks"]) {
    if (!tableExists(db, table)) continue;
    const rows = db
      .prepare(
        `SELECT DISTINCT workspace_key,workspace_path,project_id FROM ${table} WHERE host_id IS NULL`,
      )
      .all() as {
      workspace_key: string;
      workspace_path: string;
      project_id: string | null;
    }[];
    const update =
      db.prepare(`UPDATE ${table} SET host_id=?,project_id=?,additional_directories=coalesce(additional_directories,'[]')
      WHERE workspace_key=? AND workspace_path=? AND host_id IS NULL`);
    for (const row of rows) {
      const hostId = ensureHost(db, row.workspace_key, ownerHostId);
      update.run(
        hostId,
        row.project_id ?? uniqueRootProject(db, hostId, row.workspace_path),
        row.workspace_key,
        row.workspace_path,
      );
    }
  }
}

export function reconcileLegacy(db: DatabaseSync, ownerHostId?: string): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    ensureHost(db, "local", ownerHostId);
    initializeLegacyTaskIdentity(db, true, ownerHostId);
    initializeLegacyDefinitions(db, ownerHostId);
    if (tableExists(db, "tasks")) {
      db.exec(`UPDATE tasks SET handoff_pending=handoff_pending | ${HANDOFF_DELETE} WHERE deleted=1 AND coalesce(cli_deleted,0)=0;
        UPDATE tasks SET handoff_pending=handoff_pending | ${HANDOFF_TITLE}
        WHERE title_overridden=1 AND (coalesce(cli_title_source,'')<>'custom' OR coalesce(cli_title,'')<>title);`);
    }
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

export function admitTaskIdentity(
  db: DatabaseSync,
  task: { workspacePath: string; workspaceIdentity?: string; taskId: string },
  ownerHostId?: string,
): void {
  const key = resolveWorkspaceKey(task);
  const hostId = ensureHost(db, key, ownerHostId);
  db.prepare(
    "UPDATE tasks SET host_id=?,root_path=workspace_path,project_id=?,handoff_pending=handoff_pending | ? WHERE workspace_key=? AND task_id=? AND host_id IS NULL",
  ).run(
    hostId,
    uniqueRootProject(db, hostId, task.workspacePath),
    OWNERSHIP_DECIDED,
    key,
    task.taskId,
  );
}
