

import type {
  ArtifactContentOp,
  ArtifactOp,
  ArtifactPresetOp,
  WorldReadOp,
} from "../facade/registry.js";
import type { AskProgress, AskStats } from "./ask-observation-types.js";
import type { ActorSessionSeed } from "./imported-cache-types.js";
import type {
  GetNodeOptions,
  ListActorsOptions,
  ListEventsOptions,
  ListNodesOptions,
} from "./journal-read-types.js";

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

export interface InstanceRef {
  siteId: string;
  ordinal: number;
}

export interface ActorRef {
  siteId: string;
  ordinal: number;
}

export type ActorId = string;

export function refToString(ref: InstanceRef | ActorRef): string {
  return `${ref.siteId}@${ref.ordinal}`;
}

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

export interface PersonaSpec {
  name?: string;
  system?: string;
  
  model?: string;
}

export interface AskMessage {
  instructions: string;
  typed: boolean;
  schema?: unknown;
}

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

export type { Violation } from "../schema/types.js";
import type { Violation } from "../schema/types.js";

export type ValidateFn = (schema: unknown, value: unknown) => Violation[];

export interface AskSpec {
  typed: boolean;
  schema?: unknown;
}

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

export type ImportCloseCause = "mutating-tool" | "world-run";

export interface Caps {
  maxConcurrency: number;
}

import type { ProviderStopDetails, RunStallInfo } from "./run-terminal.js";

export type { ProviderStopDetails, RunStallInfo };

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

import type { WorkflowError, WorkflowErrorJson } from "./errors.js";

export { WorkflowError } from "./errors.js";
export type { WorkflowErrorCode, WorkflowErrorJson, WorkflowErrorMismatch } from "./errors.js";

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

export type { WorldReadOp };

export type { ArtifactContentOp, ArtifactOp, ArtifactPresetOp };

export interface ArtifactRef {
  id: string;
  version: number;
}

export interface ArtifactVersionRecord {
  id: string;
  kind: ArtifactOp;
  
  version: number;
  title?: string;
  description?: string;
  
  contentType?: string;
  
  bytes?: number;
  
  uri?: string;
  
  sourcePath?: string;
  
  spec?: unknown;
  
  publishedAt?: number;
  
  primary?: true;
}

export interface ArtifactPublishRequest {
  runId: string;
  siteId: string;
  ordinal: number;
  op: ArtifactContentOp;
  id: string;
  version: number;
  
  path?: string;
  
  content?: string;
  
  opts?: unknown;
}

export interface WorkflowHostApi {
  createActor(siteId: string, name?: string, persona?: string | PersonaSpec): ActorId;
  ask(siteId: string, actor: ActorId, instructions: string): Promise<unknown>;
  worldRead(siteId: string, op: WorldReadOp, args: unknown[]): Promise<unknown>;
  
  report(siteId: string, item: unknown, artifactId?: string): void;
  
  enterPhase(name: string): void;
  
  hole(siteId: string, name: string, prompt?: string): Promise<{ code: string }>;
  
  publishArtifact(siteId: string, op: ArtifactContentOp, args: unknown[]): Promise<ArtifactRef>;
  
  declareArtifact(siteId: string, op: ArtifactPresetOp, args: unknown[]): void;
  log(message: string): void;
}

// ————————————————————————————————————————————————————————————————
// Boundary B：driver port
// ————————————————————————————————————————————————————————————————

export interface SessionRef {
  readonly id: string;
}

export type SubmitVerdict =
  | { kind: "accept" }
  | { kind: "reject"; violations: Violation[] }
  | { kind: "nudge" };

export interface WorkflowDriver {
  
  createActorSession(
    actor: ActorRef,
    persona: PersonaSpec,
    seed?: ActorSessionSeed,
  ): Promise<SessionRef>;
  startAsk(session: SessionRef, instance: InstanceRef, message: AskMessage): void;
  respondToSubmit(instance: InstanceRef, verdict: SubmitVerdict): void;
  cancelAsk(instance: InstanceRef): void;
  
  executeWorldRead(op: WorldReadOp, args: unknown[]): Promise<unknown>;
  
  executeArtifactPublish?(request: ArtifactPublishRequest): Promise<ArtifactVersionRecord>;
  journal: JournalStorePort;
  emit(event: RunEvent): void;
  
  dispose?(): void;
}

export interface AskWaitInfo {
  cause: "slot" | "backoff";
  reason?: string;
  attempt?: number;
  delayMs?: number;
  retryAfterMs?: number;
}

export type ConcurrencyChangeReason =
  | "rate_limited"
  | "provider_overloaded"
  | "offpeak_queued"
  | "recovered"
  | "idle_reset"
  | "limit_lowered"
  | "seeded";

export interface ConcurrencyChange {
  /** provider key（`${providerId}/${modelId}`）。 */
  key: string;
  previous: number;
  next: number;
  reason: ConcurrencyChangeReason;
  lastGood?: number;
  lastBad?: number;
  
  cooldownMs?: number;
}

export interface WorkflowReportSink {
  
  askSubmitAttempted(instance: InstanceRef, payload: unknown): void;
  
  askTurnEnded(instance: InstanceRef, finalText: string): void;
  
  askProgress(instance: InstanceRef, progress: AskProgress): void;
  
  askStats(instance: InstanceRef, stats: AskStats): void;
  
  askFailed(instance: InstanceRef, error: WorkflowError): void;
  
  stopRun(error: WorkflowError): void;
  
  runStalled(info: RunStallInfo): void;
  
  
  askWaiting(instance: InstanceRef, info: AskWaitInfo): void;
  
  askExecuting(instance: InstanceRef): void;
  
  askMutating(instance: InstanceRef): void;
  
  concurrencyChanged(change: ConcurrencyChange): void;
}

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

export type NodeKind = "ask" | "world-read" | "world-run" | "report" | "artifact";

export interface WorldReadInput {
  op: string;
  args: unknown[];
  truncated?: true;
}

export const WORLD_READ_INPUT_MAX_BYTES = 4096;

export type NodeOutcome = "ok" | "failed" | "cancelled";

export type RunStatus = "pending" | "running" | "completed" | "errored" | "stopped";

export type RunStopReason = "user" | "model" | "provider" | "interrupted" | "superseded";

export type RunEvent =
  | { type: "run-started"; runId: string; caps: Caps }
  
  | {
      type: "run-launched";
      inputId: string;
      toolCallId?: string;
      parentSessionId?: string;
      phaseNames?: string[];
      subagentModel?: string;
      subagentPermissionMode?: string;
      
      modelBindings?: Record<string, string>;
      scriptPath?: string;
      phaseAlongside?: number[][];
      
      holes?: number[];
    }
  
  | {
      type: "actor-created";
      actor: ActorRef;
      name?: string;
      persona?: PersonaSpec;
      phaseName?: string;
    }
  | {
      type: "node-queued";
      instance: InstanceRef;
      kind: NodeKind;
      actor?: ActorRef;
      actorSeq?: number;
      phaseName?: string;
      
      instructionsHead?: string;
    }
  
  | {
      type: "node-dispatched";
      instance: InstanceRef;
      kind?: NodeKind;
      actor?: ActorRef;
      actorName?: string;
      actorPhaseName?: string;
      
      actorPersonaModel?: string;
      phaseName?: string;
      instructionsHead?: string;
    }
  | { type: "node-repairing"; instance: InstanceRef; attempt: number; violations: Violation[] }
  | { type: "node-nudged"; instance: InstanceRef }
  
  | ({ type: "node-waiting"; instance: InstanceRef } & AskWaitInfo)
  | { type: "node-executing"; instance: InstanceRef }
  | ({ type: "concurrency-changed" } & ConcurrencyChange)
  
  | { type: "run-caps-changed"; runId: string; caps: Caps; previous: Caps }
  | {
      type: "node-settled";
      instance: InstanceRef;
      outcome: NodeOutcome;
      cached?: boolean;
      error?: WorkflowErrorJson;
      
      phaseName?: string;
      
      kind?: NodeKind;
      actor?: ActorRef;
      actorSeq?: number;
      instructionsHead?: string;
      
      sourceSessionId?: string;
    }
  
  | ({ type: "node-progress"; instance: InstanceRef } & AskProgress)
  
  | { type: "usage-updated"; spentTokens: number }
  | { type: "log"; message: string }
  
  | { type: "import-cache-closed"; instance: InstanceRef; cause: ImportCloseCause; actorName?: string }
  
  | { type: "phase-entered"; name: string; ordinal: number }
  
  | {
      type: "hole-reached";
      instance: InstanceRef;
      name: string;
      prompt?: string;
      phaseName?: string;
    }
  
  | {
      type: "hole-filled";
      siteId: string;
      filledAt: number;
      filledBy?: string;
      phaseNames: string[];
      holes?: number[];
      
      scriptPath?: string;
    }
  
  | { type: "report"; instance: InstanceRef; item: unknown; artifactId?: string }
  
  | { type: "artifact-published"; instance: InstanceRef; artifact: ArtifactVersionRecord }
  
  | {
      type: "artifact-failed";
      instance: InstanceRef;
      id: string;
      op: ArtifactContentOp;
      error: WorkflowErrorJson;
    }
  | { type: "compaction"; actor: ActorRef }
  
  | {
      type: "escalation-raised";
      qid: string;
      actor: ActorRef;
      
      actorName?: string;
      question: string;
      context?: string;
      
      askedAt: number;
    }
  | { type: "escalation-resolved"; qid: string; answer: string }
  
  | ({ type: "run-stalled" } & RunStallInfo)
  
  | {
      type: "run-settled";
      status: RunStatus;
      stopReason?: RunStopReason;
      
      supersededBy?: string;
      error?: WorkflowErrorJson;
    };

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

export interface RunRecord {
  runId: string;
  parentSessionId?: string;
  cwd?: string;
  
  name?: string;
  
  toolCallId?: string;
  scriptText?: string;
  scriptHash?: string;
  
  args?: Record<string, unknown>;
  
  resumedFrom?: string;
  caps: Caps;
  
  spentTokens: number;
  status: RunStatus;
  
  stopReason?: RunStopReason;
  
  supersededBy?: string;
  failure?: WorkflowErrorJson;
  
  result?: unknown;
}

export interface ActorRecord {
  runId: string;
  siteId: string;
  ordinal: number;
  name?: string;
  persona?: PersonaSpec;
  sessionId?: string;
  
  resolvedModel?: string;
}

export type NodeRecordStatus = "running" | "completed" | "failed";

export interface NodeRecord {
  runId: string;
  siteId: string;
  ordinal: number;
  kind: NodeKind;
  actorSiteId?: string;
  actorOrdinal?: number;
  actorSeq?: number;
  inputHash: string;
  status: NodeRecordStatus;
  result?: unknown;
  error?: WorkflowErrorJson;
  stats?: AskStats;
  
  artifactId?: string;
  
  input?: WorldReadInput;
  
  messageBoundary?: number;
}

export interface StoredEvent {
  sequence: number;
  event: RunEvent;
  
  timeCreated?: number;
}

export type {
  GetNodeOptions,
  ListActorsOptions,
  ListEventsOptions,
  ListNodesOptions,
  RunEventType,
} from "./journal-read-types.js";

export interface RunSettlementRecord {
  
  stopReason?: RunStopReason;
  
  supersededBy?: string;
  failure?: WorkflowErrorJson;
  result?: unknown;
}

export interface JournalStorePort {
  createRun(record: RunRecord): void;
  getRun(runId: string): RunRecord | undefined;
  updateRunStatus(runId: string, status: RunStatus, settlement?: RunSettlementRecord): void;
  
  updateRunUsage(runId: string, spentTokens: number): void;
  
  updateRunCaps(runId: string, caps: Caps): void;
  
  updateRunScript(runId: string, scriptText: string, scriptHash: string): void;

  putActor(record: ActorRecord): void;
  getActor(runId: string, siteId: string, ordinal: number): ActorRecord | undefined;
  listActors(runId: string, opts: ListActorsOptions): ActorRecord[];

  putNode(record: NodeRecord): void;
  getNode(
    runId: string,
    siteId: string,
    ordinal: number,
    opts?: GetNodeOptions,
  ): NodeRecord | undefined;
  
  listNodes(runId: string, opts: ListNodesOptions): NodeRecord[];
  
  countNodes(runId: string, kind: NodeKind): number;
  
  sumResultBytes(runId: string, kind: NodeKind): number;

  appendEvent(runId: string, event: RunEvent): StoredEvent;
  
  listEvents(runId: string, opts: ListEventsOptions): StoredEvent[];
}

export {
  INSTRUCTIONS_HEAD_MAX_CHARS,
  LAST_TOOL_NAME_MAX_CHARS,
  LAST_TOOL_TARGET_MAX_CHARS,
} from "./ask-observation-types.js";
export type { AskLastTool, AskProgress, AskStats } from "./ask-observation-types.js";

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

export type {
  ActorSessionSeed,
  ImportedActorCandidate,
  ImportedAskEntry,
  ImportedInFlightAsk,
  ImportedRunCache,
  ImportedWorldEntry,
} from "./imported-cache-types.js";

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

export const REPAIR_ATTEMPTS = 3;

export const NUDGE_ATTEMPTS = 1;
