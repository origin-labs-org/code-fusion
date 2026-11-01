// ============================================================
// ============================================================
//

import type { WorkflowRunActor, WorkflowRunState } from "./workflow-runs.js";

function actorKey(siteId: string, ordinal: number): string {
  return `${siteId}\0${ordinal}`;
}

export function withDerivedWorkflowActorStatuses(run: WorkflowRunState): WorkflowRunState {
  const executing = new Set<string>();
  const live = new Set<string>();
  const owned = new Set<string>();
  for (const node of run.nodes) {
    if (node.actorSiteId === undefined || node.actorOrdinal === undefined) continue;
    const key = actorKey(node.actorSiteId, node.actorOrdinal);
    owned.add(key);
    switch (node.phase) {
      case "executing":
      case "repairing":
      case "nudged":
        executing.add(key);
        break;
      case "queued":
      case "dispatched":
      case "waiting":
        live.add(key);
        break;
      default:
        break;
    }
  }
  const runLive = run.status === "pending" || run.status === "running";
  return {
    ...run,
    actors: run.actors.map((actor) => {
      const key = actorKey(actor.siteId, actor.ordinal);
      const status: WorkflowRunActor["status"] = !runLive
        ? "completed"
        : executing.has(key)
          ? "running"
          : live.has(key) || !owned.has(key)
            ? "waiting"
            : "completed";
      return actor.status === status ? actor : { ...actor, status };
    }),
  };
}
