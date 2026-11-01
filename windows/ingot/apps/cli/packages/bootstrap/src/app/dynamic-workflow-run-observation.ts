// ============================================================
// ============================================================

import type { DwfRunListItem, DwfRunSessionListItem } from "@origin-ai/cf-adapters/storage";
import {
  boundDynamicWorkflowRunEventPayload,
  DYNAMIC_WORKFLOW_SNAPSHOT_MAX_REPORT_BYTES,
  DYNAMIC_WORKFLOW_SNAPSHOT_MAX_REPORTS,
  type DynamicWorkflowRunError,
  type DynamicWorkflowRunHole,
  type DynamicWorkflowRunLogEntry,
  type DynamicWorkflowRunPendingQuestion,
  type DynamicWorkflowRunSessionSummary,
  type DynamicWorkflowRunSnapshot,
  type DynamicWorkflowRunStopReason,
  type DynamicWorkflowRunSummary,
} from "@origin-ai/cf-contracts";
import type {
  JournalStorePort,
  RunRecord,
  RunSettlement,
  RunStatus,
  RunStopReason,
  StoredEvent,
  WorkflowErrorCode,
  WorkflowErrorJson,
} from "@origin-ai/cf-dynamic-workflow";
import { artifactsOf } from "./dynamic-workflow-run-artifact-projection.js";
import { runLineageActiveMs } from "./dynamic-workflow-run-elapsed.js";
import {
  readRunModelBindings,
  readRunScriptPath,
  readRunSubagentModel,
} from "./dynamic-workflow-run-launch-anchor.js";
import { resolveDynamicWorkflowRunLabel } from "./dynamic-workflow-run-label.js";
import { lineageFields, supersededByOf } from "./dynamic-workflow-run-lineage.js";
import type { CompiledHole } from "./dynamic-workflow-run-holes.js";
import type { ActorSessionQuiescence } from "./workflow-driver-quiescence.js";
import type { WorkflowRunControl } from "./workflow-run-control.js";

export { artifactsOf };

export interface RunRegistryEntry {
  controller: AbortController;
  startedAt: Date;
  toolCallId?: string;
  parentSessionId?: string;
  
  cwd: string;
  name?: string;
  scriptText: string;
  
  maxConcurrency?: number;
  
  control?: WorkflowRunControl;
  
  subagentModel?: string;
  
  modelBindings?: Record<string, string>;
  
  scriptPath?: string;
  
  resumedFrom?: string;
  
  holes?: readonly CompiledHole[];
  
  phaseNames?: readonly string[];
  
  inheritedTokens?: number;
  
  quiescence?: ActorSessionQuiescence;
  
  settlement: Promise<RunSettlement>;
  
  terminal?: RunSettlement;
  completedAt?: Date;
  
  foreignTerminalLogged?: true;
}

export const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "completed",
  "errored",
  "stopped",
]);

export function snapshotOf(
  taskId: string,
  runs: Map<string, RunRegistryEntry>,
  journal: JournalStorePort,
  pendingQuestions: readonly DynamicWorkflowRunPendingQuestion[] = [],
  defaultConcurrency?: number,
  
  holes: readonly DynamicWorkflowRunHole[] = [],
): DynamicWorkflowRunSnapshot | undefined {
  const entry = runs.get(taskId);
  const record = journal.getRun(taskId);
  if (entry === undefined && record === undefined) return undefined;

  const status: DynamicWorkflowRunSnapshot["status"] = runStatusToTaskStatus(
    synthesizeRunStatus(entry, record?.status),
  );

  const settled = status !== "running";

  const activeDurationMs = settled ? runLineageActiveMs(journal, taskId) : undefined;

  const runStatus = synthesizeRunStatus(entry, record?.status);
  const terminal = TERMINAL_RUN_STATUSES.has(runStatus);
  const stopReason = terminal ? stopReasonOf(entry, record) : undefined;
  const failure = terminal ? terminalErrorField(runStatus, entry, record).error : undefined;
  const error = failure?.message;
  const parentSessionId = entry?.parentSessionId ?? record?.parentSessionId;

  return {
    runId: taskId,
    taskId,
    startedAt: entry?.startedAt ?? new Date(0),
    status,
    ...(terminal ? { runStatus } : {}),
    ...(stopReason === undefined ? {} : { stopReason }),
    ...(parentSessionId === undefined ? {} : { parentSessionId }),
    ...lineageFields(entry?.resumedFrom ?? record?.resumedFrom, supersededByOf(entry, record)),
    ...runConcurrencyField(
      entry?.maxConcurrency ?? record?.caps.maxConcurrency,
      defaultConcurrency,
    ),
    ...runSubagentModelField(
      entry === undefined ? readRunSubagentModel(journal, taskId) : entry.subagentModel,
    ),
    ...runScriptPathField(
      entry === undefined ? readRunScriptPath(journal, taskId) : entry.scriptPath,
    ),
    ...runModelBindingsField(
      entry === undefined ? readRunModelBindings(journal, taskId) : entry.modelBindings,
    ),
    ...(failure === undefined ? {} : { failure }),
    ...(activeDurationMs === undefined ? {} : { activeDurationMs }),
    ...(entry?.completedAt === undefined ? {} : { completedAt: entry.completedAt }),
    ...(error === undefined ? {} : { error }),
    ...(pendingQuestions.length === 0 ? {} : { pendingQuestions }),
    ...(holes.length === 0 ? {} : { holes }),
    ...(settled ? reportsOf(taskId, journal) : {}),
    ...(settled ? artifactsOf(taskId, journal) : {}),
    ...(entry?.terminal?.status === "completed"
      ? { output: entry.terminal.artifact }
      :
        record?.status === "completed" && record.result !== undefined
        ? { output: record.result }
        : {}),
  };
}

export function runConcurrencyField(
  applied: number | undefined,
  defaultConcurrency: number | undefined,
): { maxConcurrency?: number } {
  if (applied === undefined || defaultConcurrency === undefined || applied === defaultConcurrency) {
    return {};
  }
  return { maxConcurrency: applied };
}

export function runSubagentModelField(subagentModel: string | undefined): {
  subagentModel?: string;
} {
  return subagentModel === undefined ? {} : { subagentModel };
}

export function runModelBindingsField(modelBindings: Record<string, string> | undefined): {
  modelBindings?: Record<string, string>;
} {
  return modelBindings === undefined || Object.keys(modelBindings).length === 0
    ? {}
    : { modelBindings };
}

export function runScriptPathField(scriptPath: string | undefined): { scriptPath?: string } {
  return scriptPath === undefined ? {} : { scriptPath };
}

function reportsOf(
  taskId: string,
  journal: JournalStorePort,
): { reports?: readonly unknown[]; reportCount?: number } {
  const reportCount = journal.countNodes(taskId, "report");
  if (reportCount === 0) return {};
  const reports = journal
    .listNodes(taskId, {
      kinds: ["report"],
      withResult: true,
      limit: DYNAMIC_WORKFLOW_SNAPSHOT_MAX_REPORTS,
      maxResultBytes: DYNAMIC_WORKFLOW_SNAPSHOT_MAX_REPORT_BYTES,
    })
    .map((node) => node.result);
  return { reports, reportCount };
}

function synthesizeRunStatus(
  entry: RunRegistryEntry | undefined,
  journalStatus: RunStatus | undefined,
): RunStatus {
  if (entry?.terminal !== undefined) return terminalRunStatus(entry.terminal);
  if (
    entry !== undefined &&
    journalStatus !== undefined &&
    TERMINAL_RUN_STATUSES.has(journalStatus)
  ) {
    return "running";
  }
  if (journalStatus !== undefined) return journalStatus;
  return "pending";
}

function terminalRunStatus(settlement: RunSettlement): RunStatus {
  switch (settlement.status) {
    case "completed":
      return "completed";
    case "stopped":
      return "stopped";
    default:
      return "errored";
  }
}

function runStatusToTaskStatus(status: RunStatus): DynamicWorkflowRunSnapshot["status"] {
  switch (status) {
    case "completed":
      return "completed";
    case "errored":
      return "failed";
    case "stopped":
      return "cancelled";
    default:
      return "running";
  }
}

function stopReasonOf(
  entry: RunRegistryEntry | undefined,
  record: { status?: RunStatus; stopReason?: RunStopReason } | undefined,
): DynamicWorkflowRunStopReason | undefined {
  if (entry?.terminal !== undefined) {
    return entry.terminal.status === "stopped" ? entry.terminal.reason : undefined;
  }
  if (entry !== undefined) return undefined;
  if (record?.status === "stopped") return record.stopReason ?? "user";
  return undefined;
}

export function journalRunSummary(
  row: DwfRunListItem,
  entry: RunRegistryEntry | undefined,
  ownerSessionId: string,
): DynamicWorkflowRunSummary {
  const ownedByThisSession = entry !== undefined || row.parentSessionId === ownerSessionId;
  const possiblyInterrupted = !TERMINAL_RUN_STATUSES.has(row.status) && !ownedByThisSession;
  const stopReason = stopReasonOf(entry, row);
  return {
    runId: row.runId,
    ...resolveDynamicWorkflowRunLabel({
      runId: row.runId,
      ...(row.name === undefined ? {} : { name: row.name }),
      ...(row.scriptText === undefined ? {} : { scriptText: row.scriptText }),
    }),
    status: synthesizeRunStatus(entry, row.status),
    ...(stopReason === undefined ? {} : { stopReason }),
    ...lineageFields(entry?.resumedFrom ?? row.resumedFrom, supersededByOf(entry, row)),
    ownedByThisSession,
    ...(possiblyInterrupted ? { possiblyInterrupted: true } : {}),
    createdAt: row.timeCreated,
    updatedAt: row.timeUpdated,
  };
}

export function registryRunSummary(
  runId: string,
  entry: RunRegistryEntry,
): DynamicWorkflowRunSummary {
  return {
    runId,
    ...resolveDynamicWorkflowRunLabel({
      runId,
      ...(entry.name === undefined ? {} : { name: entry.name }),
      scriptText: entry.scriptText,
    }),
    status: synthesizeRunStatus(entry, undefined),
    ...(entry.terminal?.status === "stopped" ? { stopReason: entry.terminal.reason } : {}),
    ...lineageFields(entry.resumedFrom, supersededByOf(entry, undefined)),
    ownedByThisSession: true,
    createdAt: entry.startedAt.getTime(),
    updatedAt: (entry.completedAt ?? entry.startedAt).getTime(),
  };
}

export function terminalResultField(
  status: RunStatus,
  entry: RunRegistryEntry | undefined,
  row?: { result?: unknown },
): { result?: unknown } {
  if (status !== "completed") return {};
  if (entry?.terminal?.status === "completed" && entry.terminal.artifact !== undefined) {
    return { result: entry.terminal.artifact };
  }
  return row?.result === undefined ? {} : { result: row.result };
}

export function terminalErrorField(
  status: RunStatus,
  entry: RunRegistryEntry | undefined,
  row?: { failure?: WorkflowErrorJson },
): { error?: DynamicWorkflowRunError } {
  if (status !== "errored" && status !== "stopped") return {};
  const memoryError =
    entry?.terminal?.status === "errored"
      ? entry.terminal.error
      : entry?.terminal?.status === "stopped"
        ? entry.terminal.error
        : undefined;
  if (memoryError !== undefined) {
    const code = typeof memoryError.code === "string" ? memoryError.code : "DriverError";
    const providerStop = (memoryError as { providerStop?: WorkflowErrorJson["providerStop"] })
      .providerStop;
    return {
      error: {
        code,
        message: memoryError.message,
        ...(providerStop === undefined ? {} : { providerStop }),
      },
    };
  }
  if (row?.failure !== undefined) {
    return {
      error: {
        code: row.failure.code,
        message: row.failure.message,
        ...(row.failure.providerStop === undefined
          ? {}
          : { providerStop: row.failure.providerStop }),
      },
    };
  }
  return {};
}

export function toLogTailEntry(stored: StoredEvent): DynamicWorkflowRunLogEntry {
  const message = stored.event.type === "log" ? stored.event.message : "";
  const { payload } = boundDynamicWorkflowRunEventPayload({ message });
  return {
    sequence: stored.sequence,
    message: typeof payload.message === "string" ? payload.message : "",
    ...(stored.timeCreated === undefined ? {} : { at: stored.timeCreated }),
  };
}

export async function settleOrAbort(
  settlement: Promise<unknown>,
  signal?: AbortSignal,
): Promise<void> {
  if (signal === undefined) {
    await settlement;
    return;
  }
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const onAbort = (): void => resolve();
    signal.addEventListener("abort", onAbort, { once: true });
    void settlement.then(
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      },
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      },
    );
  });
}

export const INTERRUPTED_FAILURE_CODE: WorkflowErrorCode = "Interrupted";

export function isResumableRecord(record: Pick<RunRecord, "status" | "stopReason">): boolean {
  return isResumableSettlement(record.status, record.stopReason);
}

export function isResumableSettlement(status: RunStatus, stopReason?: RunStopReason): boolean {
  return status === "stopped" && stopReason !== "superseded";
}

export function toSessionSummary(
  row: DwfRunSessionListItem,
  entry?: RunRegistryEntry,
): DynamicWorkflowRunSessionSummary {
  const { label } = resolveDynamicWorkflowRunLabel({
    runId: row.runId,
    ...(row.name === undefined ? {} : { name: row.name }),
    ...(row.scriptText === undefined ? {} : { scriptText: row.scriptText }),
  });
  const status = synthesizeRunStatus(entry, row.status);
  const stopReason = stopReasonOf(entry, row);
  const live = entry !== undefined && entry.terminal === undefined;
  return {
    runId: row.runId,
    ...(row.toolCallId === undefined ? {} : { toolCallId: row.toolCallId }),
    label,
    updatedAt: row.timeUpdated,
    status,
    ...(stopReason === undefined ? {} : { stopReason }),
    ...lineageFields(row.resumedFrom, supersededByOf(entry, row)),
    ...(live || row.failure?.code === undefined ? {} : { failureCode: row.failure.code }),
    ...(live || row.failure?.message === undefined ? {} : { failureMessage: row.failure.message }),
    resumable: isResumableSettlement(status, stopReason),
  };
}
