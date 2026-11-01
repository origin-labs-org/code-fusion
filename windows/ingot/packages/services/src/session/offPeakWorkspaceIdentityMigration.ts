import { OFF_PEAK_TERMINAL_STATUSES } from "@origin-ai/cf-shared";
import type { DatabaseSync } from "node:sqlite";

const terminalStatuses = OFF_PEAK_TERMINAL_STATUSES.map((status) => `'${status}'`).join(", ");

export function cancelConflictingOffPeakBindings(
  db: DatabaseSync,
  sourceKey: string,
  targetKey: string,
  now: number,
): void {
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(off_peak_tasks)")
      .all()
      .map((row) => row.name),
  );
  if (!["workspace_key", "session_id", "status"].every((column) => columns.has(column))) return;

  db.prepare(`UPDATE off_peak_tasks
    SET status = 'cancelled', ended_at = ?, updated_at = ?, failure_reason = NULL,
        schedulable = 0, claim_running = 0, claimed_at = NULL
    WHERE workspace_key = ? AND session_id IS NOT NULL
      AND status NOT IN (${terminalStatuses})
      AND EXISTS (
        SELECT 1 FROM off_peak_tasks target
        WHERE target.workspace_key = ? AND target.session_id = off_peak_tasks.session_id
          AND target.status NOT IN (${terminalStatuses})
      )`).run(now, now, sourceKey, targetKey);
}
