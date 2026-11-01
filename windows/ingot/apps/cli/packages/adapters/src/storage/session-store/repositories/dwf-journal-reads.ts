

import type { DatabaseSync } from "node:sqlite";
import type {
  ActorRecord,
  GetNodeOptions,
  ListActorsOptions,
  ListEventsOptions,
  ListNodesOptions,
  NodeKind,
  NodeRecord,
  StoredEvent,
} from "@origin-ai/cf-dynamic-workflow";
import {
  decodeActor,
  decodeEvent,
  decodeNode,
  type DwfActorRow,
  type DwfEventRow,
  type DwfNodeRow,
} from "./dwf-journal-codecs.js";

const UNBOUNDED = -1;

const NODE_COLUMNS_BEFORE_RESULT =
  "id, run_id, site_id, ordinal, kind, actor_site_id, actor_ordinal, actor_seq, input_hash, " +
  "input_json, status";
const NODE_COLUMNS_AFTER_RESULT =
  "error_json, stats_json, message_boundary, artifact_id, time_created, time_updated";

function nodeColumns(withResult: boolean): string {
  const result = withResult ? "result_json" : "null as result_json";
  return `${NODE_COLUMNS_BEFORE_RESULT}, ${result}, ${NODE_COLUMNS_AFTER_RESULT}`;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function limitParam(limit: number | undefined): number {
  return limit === undefined ? UNBOUNDED : Math.max(0, limit);
}

export function getNodeRow(
  db: DatabaseSync,
  runId: string,
  siteId: string,
  ordinal: number,
  opts: GetNodeOptions | undefined,
): NodeRecord | undefined {
  const row = db
    .prepare(
      `select ${nodeColumns(opts?.withResult ?? true)} from dwf_node
       where run_id = ? and site_id = ? and ordinal = ?`,
    )
    .get(runId, siteId, ordinal) as DwfNodeRow | undefined;
  return row ? decodeNode(row) : undefined;
}

export function listNodeRows(
  db: DatabaseSync,
  runId: string,
  opts: ListNodesOptions,
): NodeRecord[] {
  const kinds = opts.kinds;
  if (kinds !== "all" && kinds.length === 0) return [];
  const kindFilter = kinds === "all" ? "" : ` and kind in (${placeholders(kinds.length)})`;
  const kindParams = kinds === "all" ? [] : kinds;
  if (opts.maxResultBytes !== undefined) {
    return listNodeRowsWithinBytes(db, runId, opts, kindFilter, kindParams, opts.maxResultBytes);
  }
  const rows = db
    .prepare(
      `select ${nodeColumns(opts.withResult)} from dwf_node
       where run_id = ?${kindFilter}
       order by id limit ?`,
    )
    .all(runId, ...kindParams, limitParam(opts.limit)) as unknown as DwfNodeRow[];
  return rows.map(decodeNode);
}

function listNodeRowsWithinBytes(
  db: DatabaseSync,
  runId: string,
  opts: ListNodesOptions,
  kindFilter: string,
  kindParams: readonly string[],
  maxResultBytes: number,
): NodeRecord[] {
  const columns = nodeColumns(opts.withResult)
    .split(", ")
    .map((column) => (column.startsWith("null as ") ? column : `n.${column}`))
    .join(", ");
  const rows = db
    .prepare(
      `with sized as (
         select id, coalesce(octet_length(result_json), 0) as bytes from dwf_node
         where run_id = ?${kindFilter}
         order by id limit ?
       ),
       ranked as (
         select id,
                row_number() over (order by id) as rn,
                sum(bytes) over (order by id rows unbounded preceding) as through
         from sized
       )
       select ${columns} from ranked r join dwf_node n on n.id = r.id
       where r.rn = 1 or r.through <= ?
       order by r.id`,
    )
    .all(
      runId,
      ...kindParams,
      limitParam(opts.limit),
      Math.max(0, maxResultBytes),
    ) as unknown as DwfNodeRow[];
  return rows.map(decodeNode);
}

export function countNodeRows(db: DatabaseSync, runId: string, kind: NodeKind): number {
  const row = db
    .prepare("select count(*) as total from dwf_node where run_id = ? and kind = ?")
    .get(runId, kind) as { total: number | bigint } | undefined;
  return Number(row?.total ?? 0);
}

export function sumResultBytes(db: DatabaseSync, runId: string, kind: NodeKind): number {
  const row = db
    .prepare(
      "select coalesce(sum(octet_length(result_json)), 0) as total from dwf_node where run_id = ? and kind = ?",
    )
    .get(runId, kind) as { total: number | bigint } | undefined;
  return Number(row?.total ?? 0);
}

export function listActorRows(
  db: DatabaseSync,
  runId: string,
  opts: ListActorsOptions,
): ActorRecord[] {
  const persona = opts.withPersona ? "persona_json" : "null as persona_json";
  const nameFilter = opts.name === undefined ? "" : " and name = ?";
  const rows = db
    .prepare(
      `select id, run_id, site_id, ordinal, name, ${persona}, resolved_model, session_id,
              time_created, time_updated
       from dwf_actor where run_id = ?${nameFilter} order by id`,
    )
    .all(runId, ...(opts.name === undefined ? [] : [opts.name])) as unknown as DwfActorRow[];
  return rows.map(decodeActor);
}

export function listEventRows(
  db: DatabaseSync,
  runId: string,
  opts: ListEventsOptions,
): StoredEvent[] {
  const types = opts.types;
  if (types !== "all" && types.length === 0) return [];
  const cutoff = reportCutoff(db, runId, opts);
  const payload =
    cutoff === undefined
      ? "payload_json"
      : "case when type = 'report' and sequence > ? then json_remove(payload_json, '$.item') " +
        "else payload_json end as payload_json";
  const typeFilter = types === "all" ? "" : ` and type in (${placeholders(types.length)})`;
  const after = opts.afterSequence;
  const cursorFilter = after === undefined ? "" : " and sequence > ?";
  const rows = db
    .prepare(
      `select sequence, type, time_created, ${payload} from dwf_event
       where run_id = ?${typeFilter}${cursorFilter}
       order by sequence limit ?`,
    )
    .all(
      ...(cutoff === undefined ? [] : [cutoff]),
      runId,
      ...(types === "all" ? [] : types),
      ...(after === undefined ? [] : [after]),
      limitParam(opts.limit),
    ) as unknown as DwfEventRow[];
  return rows.map(decodeEvent);
}

function reportCutoff(
  db: DatabaseSync,
  runId: string,
  opts: ListEventsOptions,
): number | undefined {
  if (opts.reportItems === "all") return undefined;
  if (opts.types !== "all" && !opts.types.includes("report")) return undefined;
  const keep = Math.max(0, opts.reportItems.limit);
  if (keep === 0) return -1;
  const row = db
    .prepare(
      `select sequence from dwf_event where run_id = ? and type = 'report'
       order by sequence limit 1 offset ?`,
    )
    .get(runId, keep - 1) as { sequence: number } | undefined;
  return row?.sequence;
}
