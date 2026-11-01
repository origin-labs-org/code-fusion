

import type {
  ActorRecord,
  AskStats,
  Caps,
  NodeKind,
  NodeRecord,
  NodeRecordStatus,
  PersonaSpec,
  RunEvent,
  RunRecord,
  RunSettlementRecord,
  RunStatus,
  StoredEvent,
  WorkflowErrorJson,
  WorldReadInput,
} from "@origin-ai/cf-dynamic-workflow";
import { decodeJson, encodeJson } from "../json.js";

export type DwfRunPhysicalStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

type RunStopReason = NonNullable<RunRecord["stopReason"]>;

interface DwfStoppedEnvelope {
  stopReason: RunStopReason;
  supersededBy?: string;
  error?: WorkflowErrorJson;
}

interface DwfRunSettlementFields {
  status: RunStatus;
  stopReason?: RunStopReason;
  supersededBy?: string;
  failure?: WorkflowErrorJson;
}

const INTERRUPTED_CODE = "Interrupted";
const STOP_REASONS: ReadonlySet<string> = new Set([
  "user",
  "model",
  "provider",
  "interrupted",
  "superseded",
]);

export function encodeRunSettlement(
  status: RunStatus,
  settlement?: Pick<RunSettlementRecord, "stopReason" | "supersededBy" | "failure">,
): { status: DwfRunPhysicalStatus; failureJson: string | null } {
  switch (status) {
    case "stopped": {
      const envelope: DwfStoppedEnvelope = { stopReason: settlement?.stopReason ?? "user" };
      if (settlement?.supersededBy !== undefined) envelope.supersededBy = settlement.supersededBy;
      if (settlement?.failure !== undefined) envelope.error = settlement.failure;
      return { status: "cancelled", failureJson: JSON.stringify(envelope) };
    }
    case "errored":
      return { status: "failed", failureJson: encodeJson(settlement?.failure) };
    case "completed":
      return { status: "completed", failureJson: encodeJson(settlement?.failure) };
    case "pending":
    case "running":
      return { status, failureJson: null };
  }
}

function decodeRunSettlement(
  status: DwfRunPhysicalStatus,
  failureJson: string | null,
): DwfRunSettlementFields {
  const raw = decodeJson<Record<string, unknown>>(failureJson);
  switch (status) {
    case "cancelled": {
      const fields: DwfRunSettlementFields = { status: "stopped", stopReason: "user" };
      if (raw !== undefined && isStoppedEnvelope(raw)) {
        fields.stopReason = raw.stopReason;
        if (typeof raw.supersededBy === "string" && raw.supersededBy.length > 0) {
          fields.supersededBy = raw.supersededBy;
        }
        if (raw.error !== undefined) fields.failure = raw.error;
      }
      return fields;
    }
    case "failed": {
      const failure = raw as WorkflowErrorJson | undefined;
      if (failure?.code === INTERRUPTED_CODE) {
        return { status: "stopped", stopReason: "interrupted", failure };
      }
      return failure === undefined ? { status: "errored" } : { status: "errored", failure };
    }
    case "completed": {
      const failure = raw as WorkflowErrorJson | undefined;
      return failure === undefined ? { status: "completed" } : { status: "completed", failure };
    }
    case "pending":
    case "running":
      return { status };
  }
}

function isStoppedEnvelope(
  value: Record<string, unknown>,
): value is DwfStoppedEnvelope & Record<string, unknown> {
  return typeof value.stopReason === "string" && STOP_REASONS.has(value.stopReason);
}

export function encodeRunStatusPredicate(statuses: readonly RunStatus[]): {
  sql: string;
  params: string[];
} {
  const clauses: string[] = [];
  const params: string[] = [];
  for (const status of statuses) {
    switch (status) {
      case "stopped":
        clauses.push(
          "(status = 'cancelled' or (status = 'failed' and json_extract(failure_json, '$.code') = ?))",
        );
        params.push(INTERRUPTED_CODE);
        break;
      case "errored":
        clauses.push(
          "(status = 'failed' and coalesce(json_extract(failure_json, '$.code'), '') <> ?)",
        );
        params.push(INTERRUPTED_CODE);
        break;
      default:
        clauses.push("status = ?");
        params.push(status);
    }
  }
  return { sql: clauses.length === 0 ? "0" : `(${clauses.join(" or ")})`, params };
}

export interface DwfRunRow {
  args_json: string | null;
  caps_max_concurrency: number;
  cwd: string | null;
  failure_json: string | null;
  id: string;
  name: string | null;
  parent_session_id: string | null;
  result_json: string | null;
  
  resumed_from: string | null;
  script_hash: string | null;
  script_text: string | null;
  
  spent_tokens: number;
  
  status: DwfRunPhysicalStatus;
  time_created: number;
  time_updated: number;
  tool_call_id: string | null;
}

export type DwfRunMetadataRow = Omit<DwfRunRow, "result_json">;

export interface DwfRunTimestamps {
  timeCreated: number;
  timeUpdated: number;
}

export type DwfRunListItem = Omit<RunRecord, "failure" | "result"> & DwfRunTimestamps;

export type DwfRunDetailRow = RunRecord & DwfRunTimestamps;

export type DwfRunSessionRow = DwfRunMetadataRow;

export type DwfRunSessionListItem = DwfRunListItem & Pick<RunRecord, "failure">;

export interface DwfActorRow {
  id: number;
  name: string | null;
  ordinal: number;
  persona_json: string | null;
  resolved_model: string | null;
  run_id: string;
  session_id: string | null;
  site_id: string;
  time_created: number;
  time_updated: number;
}

export interface DwfNodeRow {
  actor_ordinal: number | null;
  actor_seq: number | null;
  actor_site_id: string | null;
  
  artifact_id: string | null;
  error_json: string | null;
  id: number;
  input_hash: string;
  
  input_json: string | null;
  kind: NodeKind;
  
  message_boundary: number | null;
  ordinal: number;
  result_json: string | null;
  run_id: string;
  site_id: string;
  stats_json: string | null;
  status: NodeRecordStatus;
  time_created: number;
  time_updated: number;
}

export interface DwfWorldNodeRow extends Omit<NodeRecord, "result">, DwfRunTimestamps {
  
  resultBytes?: number;
  
  resultCount?: number;
  
  exitCode?: number;
  
  stdoutBytes?: number;
  stderrBytes?: number;
}

export interface DwfEventRow {
  id: number;
  payload_json: string;
  run_id: string;
  sequence: number;
  time_created: number;
  type: string;
}

export function encodeResultJson(value: unknown): string | null {
  if (value === undefined) return null;
  const text = JSON.stringify(value);
  return text === undefined ? null : text;
}

function decodeRunMetadata(row: DwfRunMetadataRow): Omit<RunRecord, "failure" | "result"> {
  const caps: Caps = { maxConcurrency: row.caps_max_concurrency };

  const settlement = decodeRunSettlement(row.status, row.failure_json);
  const record: Omit<RunRecord, "failure" | "result"> = {
    runId: row.id,
    caps,
    spentTokens: row.spent_tokens,
    status: settlement.status,
  };
  if (settlement.stopReason !== undefined) record.stopReason = settlement.stopReason;
  if (settlement.supersededBy !== undefined) record.supersededBy = settlement.supersededBy;
  if (row.parent_session_id !== null) record.parentSessionId = row.parent_session_id;
  if (row.cwd !== null) record.cwd = row.cwd;
  if (row.name !== null) record.name = row.name;
  if (row.tool_call_id !== null) record.toolCallId = row.tool_call_id;
  if (row.script_text !== null) record.scriptText = row.script_text;
  if (row.script_hash !== null) record.scriptHash = row.script_hash;
  if (row.resumed_from !== null) record.resumedFrom = row.resumed_from;
  if (row.args_json !== null) record.args = JSON.parse(row.args_json) as Record<string, unknown>;
  return record;
}

export function decodeRun(row: DwfRunRow): RunRecord {
  const record: RunRecord = decodeRunMetadata(row);
  const { failure } = decodeRunSettlement(row.status, row.failure_json);
  if (failure !== undefined) record.failure = failure;
  if (row.result_json !== null) record.result = JSON.parse(row.result_json);
  return record;
}

export function decodeRunListItem(row: DwfRunMetadataRow): DwfRunListItem {
  return {
    ...decodeRunMetadata(row),
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  };
}

export function decodeRunDetailRow(row: DwfRunRow): DwfRunDetailRow {
  return { ...decodeRun(row), timeCreated: row.time_created, timeUpdated: row.time_updated };
}

export function decodeRunSessionListItem(row: DwfRunSessionRow): DwfRunSessionListItem {
  const item: DwfRunSessionListItem = decodeRunListItem(row);
  const { failure } = decodeRunSettlement(row.status, row.failure_json);
  if (failure !== undefined) item.failure = failure;
  return item;
}

export function decodeActor(row: DwfActorRow): ActorRecord {
  const record: ActorRecord = {
    runId: row.run_id,
    siteId: row.site_id,
    ordinal: row.ordinal,
  };
  if (row.name !== null) record.name = row.name;
  const persona = decodeJson<PersonaSpec>(row.persona_json);
  if (persona !== undefined) record.persona = persona;
  if (row.session_id !== null) record.sessionId = row.session_id;
  if (row.resolved_model !== null) record.resolvedModel = row.resolved_model;
  return record;
}

export function decodeNode(row: DwfNodeRow): NodeRecord {
  const record: NodeRecord = {
    runId: row.run_id,
    siteId: row.site_id,
    ordinal: row.ordinal,
    kind: row.kind,
    inputHash: row.input_hash,
    status: row.status,
  };
  if (row.actor_site_id !== null) record.actorSiteId = row.actor_site_id;
  if (row.actor_ordinal !== null) record.actorOrdinal = row.actor_ordinal;
  if (row.actor_seq !== null) record.actorSeq = row.actor_seq;
  if (row.result_json !== null) record.result = JSON.parse(row.result_json);
  const error = decodeJson<WorkflowErrorJson>(row.error_json);
  if (error !== undefined) record.error = error;
  const stats = decodeJson<AskStats>(row.stats_json);
  if (stats !== undefined) record.stats = stats;
  if (row.message_boundary !== null) record.messageBoundary = row.message_boundary;
  if (row.artifact_id !== null) record.artifactId = row.artifact_id;
  const input = decodeJson<WorldReadInput>(row.input_json);
  if (input !== undefined) record.input = input;
  return record;
}

export function decodeEvent(
  row: Pick<DwfEventRow, "payload_json" | "sequence" | "time_created">,
): StoredEvent {
  return {
    sequence: row.sequence,
    event: JSON.parse(row.payload_json) as RunEvent,
    timeCreated: row.time_created,
  };
}
