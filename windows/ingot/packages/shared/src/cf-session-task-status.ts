import type { CfSessionStateSnapshot } from "./cf-protocol/index.js";
import { getCfUserVisibleMessages } from "./cf-session-visible-content.js";
import type { CfTaskMeta } from "./cf-task-types-core.js";
type CfTaskStatus = CfTaskMeta["status"];

function statusFromCfSession(
  status: CfSessionStateSnapshot["session"]["status"],
): CfTaskStatus {
  if (status === "running" || status === "waiting" || status === "paused") {
    return "running";
  }
  if (status === "error") return "error";
  if (status === "completed") return "completed";
  return undefined;
}

function hasBlockingActiveSnapshotRuntime(snapshot: CfSessionStateSnapshot): boolean {
  if (snapshot.runtime.activeTurnId || snapshot.runtime.activeTurnKind) {
    return true;
  }
  if ((snapshot.projection.pendingPermissions ?? []).length > 0) {
    return true;
  }
  return (snapshot.projection.activeToolCalls ?? []).some(
    (toolCall) => toolCall.status === "pending" || toolCall.status === "running",
  );
}

function hasActiveSnapshotRuntime(snapshot: CfSessionStateSnapshot): boolean {
  return hasBlockingActiveSnapshotRuntime(snapshot);
}

function isToolCallContinuationFinish(finish: string | undefined): boolean {
  const normalized = finish?.trim().toLowerCase().replace(/_/g, "-");
  return normalized === "tool-calls";
}

function hasCompletedVisibleAssistantTurn(snapshot: CfSessionStateSnapshot): boolean {
  const visibleMessages = getCfUserVisibleMessages(snapshot.messages, {
    target: snapshot.projection.target,
  });
  const latestVisibleMessage = visibleMessages.at(-1);
  if (latestVisibleMessage?.info.role !== "assistant") {
    return false;
  }
  if (isToolCallContinuationFinish(latestVisibleMessage.info.finish)) {
    return false;
  }
  return typeof latestVisibleMessage.info.time.completed === "number";
}

export function deriveCfTaskStatusFromSessionSnapshot(
  snapshot: CfSessionStateSnapshot,
): CfTaskStatus {
  if (snapshot.projection.lastError) {
    return "error";
  }

  const status = statusFromCfSession(snapshot.session.status);
  if (status === "error" || status === "completed") {
    return status;
  }
  if (hasCompletedVisibleAssistantTurn(snapshot) && !hasBlockingActiveSnapshotRuntime(snapshot)) {
    return "completed";
  }
  if (hasActiveSnapshotRuntime(snapshot)) {
    return status ?? "running";
  }
  return status;
}
