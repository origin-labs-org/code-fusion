import type { CfTaskMeta, CfWorkspaceTaskListChanged } from "@origin-ai/cf-shared";
import type { SessionSummary, SessionsIndexReconcileResult } from "@origin-ai/cf-shared/cf-protocol-v4";

export interface TaskWorkspace {
  workspacePath: string;
  workspaceIdentity?: string;
}
export interface TaskFactTarget extends TaskWorkspace {
  taskId: string;
}
export type TaskFactMutation = { type: "rename"; title: string } | { type: "delete" };
export interface CliTaskFacts {
  meta: CfTaskMeta;
  titleSource?: string;
  lastOutcome?: "completed" | "interrupted" | "error";
  deleted?: boolean;
}

export interface TaskFactStore {
  applyCliFacts(facts: CliTaskFacts): Promise<CfTaskMeta>;
  applyCliDeletion(target: TaskFactTarget): Promise<void>;
  markCliOrphan(target: TaskFactTarget): Promise<void>;
  listReconciliationRows(
    target: TaskWorkspace,
  ): Promise<Array<{ meta: CfTaskMeta; handoffPending: number }>>;
  getTaskMeta(target: TaskFactTarget): Promise<CfTaskMeta | null>;
}
export interface TaskFactSource {
  reconcile(target: TaskWorkspace, sessionIds: string[]): Promise<SessionsIndexReconcileResult>;
  execute(target: TaskFactTarget, intent: TaskFactMutation): Promise<void>;
}
export interface TaskFactChange {
  target: TaskFactTarget;
  meta?: CfTaskMeta;
  reason: CfWorkspaceTaskListChanged["reason"];
}
export interface TaskFactsContract {
  ingest(target: TaskWorkspace, summary: SessionSummary): Promise<CfTaskMeta>;
  removed(target: TaskFactTarget): Promise<void>;
  refresh(target: TaskFactTarget): Promise<CfTaskMeta | null>;
  mutate(target: TaskFactTarget, intent: TaskFactMutation): Promise<CfTaskMeta | null>;
  reconcile(
    target: TaskWorkspace,
    presentSessionIds: ReadonlySet<string>,
    stillCurrent: () => boolean,
  ): Promise<void>;
}

export interface SubagentIndexRepair {
  target: TaskWorkspace;
  visibleSessionIds: ReadonlySet<string>;
  agentService: {
    listSessions(
      target: TaskWorkspace & { sessionIds: string[]; runtimePolicy: "existing-only" },
    ): Promise<Array<{ sessionId: string; sessionKind?: string; workspace: TaskWorkspace }>>;
  };
  taskIndexRepo: {
    listTaskMetas(target: TaskWorkspace): Promise<Array<{ taskId: string }>>;
    removeSubagentIndexRow(target: TaskFactTarget): Promise<unknown>;
  };
  isCurrent: () => boolean;
  onRemoved: () => void;
}
