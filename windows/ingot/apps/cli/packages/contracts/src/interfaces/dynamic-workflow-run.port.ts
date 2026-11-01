// ============================================================
// ============================================================

import type {
  DynamicWorkflowRunHealth,
  DynamicWorkflowRunPhaseView,
  DynamicWorkflowRunSubagentView,
} from "./dynamic-workflow-run-roster.port.js";
import type {
  DynamicWorkflowRunRetuneRequest,
  DynamicWorkflowRunRetuneResult,
} from "./dynamic-workflow-run-retune.port.js";
import type {
  DynamicWorkflowRunFillHoleRequest,
  DynamicWorkflowRunHole,
  FillWorkflowHoleResult,
} from "./dynamic-workflow-run-hole.port.js";
import type {
  DynamicWorkflowRunWorkspaceNode,
  DynamicWorkflowRunWorkspaceNodeResult,
  DynamicWorkflowRunWorkspaceNodeResultQuery,
} from "./dynamic-workflow-run-workspace.port.js";
import type { DynamicWorkflowRunProgressPayload } from "../events/session.events.js";
import type { ModelSelection } from "../model/model.js";
import type { SessionId, ToolCallId } from "./shared.js";
import type { TraceContext } from "../tracing/tracer.js";
import type { WorkflowTaskSnapshot } from "./workflow.port.js";

export interface DynamicWorkflowRunSubmitRequest {
  
  scriptText: string;
  
  cwd: string;
  
  name?: string;
  
  args?: Record<string, unknown>;
  
  parentSessionId?: SessionId | string;
  
  toolCallId?: ToolCallId | string;
  
  launchInputId?: string;
  
  phaseNames?: string[];
  
  maxConcurrency?: number;
  
  subagentModel?: ModelSelection;
  
  modelBindings?: Record<string, ModelSelection>;
  
  scriptPath?: string;
  
  phaseAlongside?: number[][];
  trace: TraceContext;
}

export interface DynamicWorkflowRunSubmitOptions {
  signal?: AbortSignal;
}

export type DynamicWorkflowRunSubmitResult = { ok: true; runId: string };

export interface DynamicWorkflowRunAmendRequest {
  scriptText: string;
  cwd: string;
  
  predecessorRunId: string;
  
  name?: string;
  parentSessionId?: SessionId | string;
  
  toolCallId?: ToolCallId | string;
  
  phaseNames?: string[];
  
  maxConcurrency?: number;
  
  subagentModel?: ModelSelection;
  
  modelBindings?: Record<string, ModelSelection>;
  
  scriptPath?: string;
  
  phaseAlongside?: number[][];
  
  inheritArgs?: true;
  trace: TraceContext;
}

export type DynamicWorkflowRunAmendRefusalReason =
  
  | "run_not_found"
  
  | "missing_boundaries";

export type DynamicWorkflowRunAmendResult =
  | {
      ok: true;
      runId: string;
      
      supersededRunId?: string;
    }
  | { ok: false; reason: DynamicWorkflowRunAmendRefusalReason };

export type DynamicWorkflowRunCancelInitiator = "user" | "model" | { superseded: string };

export const DYNAMIC_WORKFLOW_SNAPSHOT_MAX_REPORTS = 256;

export const DYNAMIC_WORKFLOW_SNAPSHOT_MAX_REPORT_BYTES = 8 * 1024 * 1024;

export type DynamicWorkflowRunSnapshot = Omit<WorkflowTaskSnapshot, "output"> & {
  output?: unknown;
  
  runStatus?: DynamicWorkflowRunLifecycleStatus;
  stopReason?: DynamicWorkflowRunStopReason;
  
  parentSessionId?: string;
  
  resumedFrom?: string;
  
  supersededBy?: string;
  
  maxConcurrency?: number;
  
  subagentModel?: string;
  
  modelBindings?: Record<string, string>;
  
  scriptPath?: string;
  
  failure?: DynamicWorkflowRunError;
  
  activeDurationMs?: number;
  
  reports?: readonly unknown[];
  
  reportCount?: number;
  
  pendingQuestions?: readonly DynamicWorkflowRunPendingQuestion[];
  
  holes?: readonly DynamicWorkflowRunHole[];
  
  artifacts?: readonly DynamicWorkflowRunArtifact[];
};

export interface DynamicWorkflowRunArtifactVersion {
  version: number;
  title?: string;
  description?: string;
  contentType?: string;
  bytes?: number;
  uri?: string;
  sourcePath?: string;
  spec?: unknown;
  
  publishedAt: number;
  
  primary?: true;
}

export type DynamicWorkflowRunArtifactKind =
  | "file"
  | "markdown"
  | "chart"
  | "table"
  | "metrics"
  | "board";

export interface DynamicWorkflowRunArtifact {
  id: string;
  kind: DynamicWorkflowRunArtifactKind;
  title?: string;
  description?: string;
  contentType?: string;
  sourcePath?: string;
  spec?: unknown;
  
  version: number;
  versions: readonly DynamicWorkflowRunArtifactVersion[];
  
  itemCount: number;
  
  primary?: true;
}

export interface DynamicWorkflowRunArtifactItem {
  sequence: number;
  siteId: string;
  ordinal: number;
  
  item?: unknown;
  
  fields?: Record<string, unknown>;
}

export interface DynamicWorkflowRunArtifactItemPage {
  afterSequence?: number;
  limit: number;
  maxBytes: number;
  
  fields?: readonly string[];
}

export interface DynamicWorkflowRunArtifactItemsResult {
  items: readonly DynamicWorkflowRunArtifactItem[];
  hasMore: boolean;
}

export interface DynamicWorkflowRunArtifactBytes {
  bytes: Uint8Array;
  contentType: string;
}

export interface DynamicWorkflowRunPendingQuestion {
  
  qid: string;
  
  actor: string;
  
  actorName?: string;
  question: string;
  
  context?: string;
  
  askedAt: number;
}

export type DynamicWorkflowResolveQuestionRefusalReason =
  
  | "unknown_question"
  
  | "already_resolved"
  
  | "run_not_in_flight";

export type DynamicWorkflowResolveQuestionResult =
  | { ok: true; qid: string }
  | { ok: false; reason: DynamicWorkflowResolveQuestionRefusalReason; message: string };

export interface DynamicWorkflowRunWaitOptions {
  signal?: AbortSignal;
}

export interface DynamicWorkflowRunEventPage {
  
  afterSequence?: number;
  limit?: number;
  maxBytes?: number;
}

export interface DynamicWorkflowRunEventsResult {
  events: DynamicWorkflowRunEvent[];
  hasMore: boolean;
}

export interface DynamicWorkflowRunEvent {
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  
  truncated?: boolean;
}

export const DYNAMIC_WORKFLOW_RUN_EVENT_PAYLOAD_LIMITS = {
  maxStringLength: 2_048,
  maxArrayItems: 32,
  maxKeys: 32,
  maxDepth: 6,
} as const;

export function boundDynamicWorkflowRunEventPayload(payload: Record<string, unknown>): {
  payload: Record<string, unknown>;
  truncated: boolean;
} {
  let truncated = false;
  const markTruncated = (): void => {
    truncated = true;
  };
  const bounded = boundJsonValue(payload, 0, markTruncated);
  return {
    payload: isJsonRecord(bounded) ? bounded : {},
    truncated,
  };
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundJsonValue(value: unknown, depth: number, markTruncated: () => void): unknown {
  const limits = DYNAMIC_WORKFLOW_RUN_EVENT_PAYLOAD_LIMITS;

  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    if (value.length <= limits.maxStringLength) return value;
    markTruncated();
    return truncateSurrogateSafe(value, limits.maxStringLength);
  }
  if (typeof value !== "object") {
    return undefined;
  }

  if (depth >= limits.maxDepth) {
    markTruncated();
    return undefined;
  }

  if (Array.isArray(value)) {
    const items =
      value.length > limits.maxArrayItems ? value.slice(0, limits.maxArrayItems) : value;
    if (items.length < value.length) markTruncated();
    const out: unknown[] = [];
    for (const item of items) {
      const boundedItem = boundJsonValue(item, depth + 1, markTruncated);
      out.push(boundedItem === undefined ? null : boundedItem);
    }
    return out;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const kept = entries.length > limits.maxKeys ? entries.slice(0, limits.maxKeys) : entries;
  if (kept.length < entries.length) markTruncated();
  const out: Record<string, unknown> = {};
  for (const [key, item] of kept) {
    const boundedItem = boundJsonValue(item, depth + 1, markTruncated);
    if (boundedItem !== undefined) out[key] = boundedItem;
  }
  return out;
}

function truncateSurrogateSafe(value: string, maxLength: number): string {
  const cut = value.slice(0, maxLength);
  const lastCode = cut.charCodeAt(cut.length - 1);
  const isHighSurrogate = lastCode >= 0xd800 && lastCode <= 0xdbff;
  return isHighSurrogate ? cut.slice(0, -1) : cut;
}

export { serializeWorkflowArtifact } from "@origin-ai/cf-shared/cf-protocol-v4";

export interface DynamicWorkflowRunPort {
  
  submit(
    request: DynamicWorkflowRunSubmitRequest,
    options?: DynamicWorkflowRunSubmitOptions,
  ): Promise<DynamicWorkflowRunSubmitResult>;
  
  amend?(
    request: DynamicWorkflowRunAmendRequest,
    options?: DynamicWorkflowRunSubmitOptions,
  ): Promise<DynamicWorkflowRunAmendResult>;
  
  defaultConcurrency?(): number;
  
  retuneConcurrency?(
    request: DynamicWorkflowRunRetuneRequest,
  ): Promise<DynamicWorkflowRunRetuneResult>;
  getTask(taskId: string): Promise<DynamicWorkflowRunSnapshot | undefined>;
  waitForTask(
    taskId: string,
    options?: DynamicWorkflowRunWaitOptions,
  ): Promise<DynamicWorkflowRunSnapshot | undefined>;
  
  cancel(runId: string, initiator?: DynamicWorkflowRunCancelInitiator): Promise<boolean>;
  
  listEvents(
    runId: string,
    options: DynamicWorkflowRunEventPage,
  ): Promise<DynamicWorkflowRunEventsResult>;
  
  listRuns?(query: DynamicWorkflowRunListQuery): Promise<DynamicWorkflowRunListResult>;
  
  getRunDetail?(runId: string): Promise<DynamicWorkflowRunDetail | undefined>;
  
  getScript?(runId: string): Promise<string | undefined>;
  
  resume?(runId: string): Promise<DynamicWorkflowRunResumeResult>;
  
  listRunsForSession?(limit?: number): Promise<DynamicWorkflowRunSessionSummary[]>;
  
  replayProgressForSession?(input: {
    excludeRunIds: ReadonlySet<string>;
  }): Promise<DynamicWorkflowRunProgressPayload[]>;
  
  resolveQuestion?(qid: string, answer: string): Promise<DynamicWorkflowResolveQuestionResult>;
  
  fillHole?(request: DynamicWorkflowRunFillHoleRequest): Promise<FillWorkflowHoleResult>;
  
  listArtifacts?(runId: string): Promise<readonly DynamicWorkflowRunArtifact[] | undefined>;
  
  listArtifactItems?(
    runId: string,
    artifactId: string,
    page: DynamicWorkflowRunArtifactItemPage,
  ): Promise<DynamicWorkflowRunArtifactItemsResult>;
  
  readArtifact?(
    runId: string,
    artifactId: string,
    version: number,
  ): Promise<DynamicWorkflowRunArtifactBytes | undefined>;
  
  listWorkspaceNodes?(
    runId: string,
  ): Promise<readonly DynamicWorkflowRunWorkspaceNode[] | undefined>;
  
  readWorkspaceNodeResult?(
    runId: string,
    siteId: string,
    ordinal: number,
    query: DynamicWorkflowRunWorkspaceNodeResultQuery,
  ): Promise<DynamicWorkflowRunWorkspaceNodeResult | undefined>;
}

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

export type DynamicWorkflowRunLifecycleStatus =
  | "completed"
  | "errored"
  | "pending"
  | "running"
  | "stopped";

export type DynamicWorkflowRunStopReason =
  | "user"
  | "model"
  | "provider"
  | "interrupted"
  | "superseded";

export interface DynamicWorkflowRunListQuery {
  
  cwd: string;
  
  limit: number;
  
  statuses?: readonly DynamicWorkflowRunLifecycleStatus[];
}

export interface DynamicWorkflowRunSummary {
  runId: string;
  
  label: string;
  
  labelSource: "name" | "script";
  status: DynamicWorkflowRunLifecycleStatus;
  
  stopReason?: DynamicWorkflowRunStopReason;
  
  resumedFrom?: string;
  
  supersededBy?: string;
  
  ownedByThisSession: boolean;
  
  possiblyInterrupted?: boolean;
  
  createdAt: number;
  updatedAt: number;
}

export interface DynamicWorkflowRunListItem extends DynamicWorkflowRunSummary {
  
  spentTokens: number;
}

export interface DynamicWorkflowRunListResult {
  runs: DynamicWorkflowRunListItem[];
  
  truncated?: boolean;
}

export interface DynamicWorkflowRunUsage {
  spentTokens: number;
  nodesObserved: number;
  nodesRunning: number;
  nodesCompleted: number;
  nodesFailed: number;
}

export interface DynamicWorkflowRunActor {
  siteId: string;
  ordinal: number;
  name?: string;
}

export interface DynamicWorkflowRunLogEntry {
  sequence: number;
  
  message: string;
  
  at?: number;
}

export interface DynamicWorkflowRunError {
  code: string;
  message: string;
  
  providerStop?: DynamicWorkflowRunProviderStop;
}

export interface DynamicWorkflowRunProviderStop {
  kind: "auth" | "not_configured" | "model_unavailable" | "invalid_request" | "quota" | "other";
  reason: string;
  providerId?: string;
  providerLabel?: string;
  modelId?: string;
  providerCode?: string;
  subagent?: string;
  subagentName?: string;
  phase?: string;
  rawMessage?: string;
  resetAt?: number;
}

export type * from "./dynamic-workflow-run-roster.port.js";

export type * from "./dynamic-workflow-run-retune.port.js";
export type * from "./dynamic-workflow-run-hole.port.js";

export type * from "./dynamic-workflow-run-workspace.port.js";

export interface DynamicWorkflowRunDetail extends DynamicWorkflowRunSummary {
  usage: DynamicWorkflowRunUsage;
  
  maxConcurrency?: number;
  
  subagentModel?: string;
  
  modelBindings?: Record<string, string>;
  
  scriptPath?: string;
  actors: DynamicWorkflowRunActor[];
  
  logTail: DynamicWorkflowRunLogEntry[];
  
  phases?: DynamicWorkflowRunPhaseView[];
  
  subagents: DynamicWorkflowRunSubagentView[];
  
  health: DynamicWorkflowRunHealth;
  
  result?: unknown;
  
  error?: DynamicWorkflowRunError;
  
  pendingQuestions?: readonly DynamicWorkflowRunPendingQuestion[];
  
  holes?: readonly DynamicWorkflowRunHole[];
  
  artifacts?: readonly DynamicWorkflowRunArtifact[];
}

export type DynamicWorkflowRunResumeErrorReason =
  
  | "not_found"
  
  | "not_resumable"
  
  | "superseded"
  
  | "already_running"
  
  | "script_missing"
  
  | "script_mismatch"
  
  | "compile_failed";

export type DynamicWorkflowRunResumeResult =
  | { ok: true; runId: string; toolCallId?: string }
  | { ok: false; reason: DynamicWorkflowRunResumeErrorReason; message?: string };

export interface DynamicWorkflowRunSessionSummary {
  runId: string;
  
  toolCallId?: string;
  
  label?: string;
  
  updatedAt?: number;
  status: "completed" | "errored" | "pending" | "running" | "stopped";
  
  stopReason?: DynamicWorkflowRunStopReason;
  
  resumedFrom?: string;
  
  supersededBy?: string;
  
  failureCode?: string;
  failureMessage?: string;
  
  resumable: boolean;
}
