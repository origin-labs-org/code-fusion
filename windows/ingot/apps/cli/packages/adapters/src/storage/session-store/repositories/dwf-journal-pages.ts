

import type { DatabaseSync } from "node:sqlite";
import type { StoredEvent } from "@origin-ai/cf-dynamic-workflow";
import { decodeEvent } from "./dwf-journal-codecs.js";

export interface DwfEventPageQuery {
  afterSequence?: number;
  limit: number;
  maxBytes: number;
}

export interface DwfEventPageRow {
  payload_json: string;
  sequence: number;
  time_created: number;
  type: string;
}

export interface DwfEventPageFilter {
  params: readonly (string | number)[];
  sql: string;
}

const NO_FILTER: DwfEventPageFilter = { params: [], sql: "" };

export function pageEventRows(
  db: DatabaseSync,
  runId: string,
  query: DwfEventPageQuery,
  filter: DwfEventPageFilter = NO_FILTER,
): { rows: DwfEventPageRow[]; hasMore: boolean } {
  if (query.limit <= 0) return { rows: [], hasMore: false };
  const after = query.afterSequence;
  const cursor = after === undefined ? "" : " and sequence > ?";
  const found = db
    .prepare(
      `
      with sized as (
        select sequence, octet_length(payload_json) as bytes
        from dwf_event
        where run_id = ?${filter.sql}${cursor}
        order by sequence
        limit ?
      ),
      ranked as (
        select sequence,
               row_number() over (order by sequence) as rn,
               sum(bytes) over (order by sequence rows unbounded preceding) as through
        from sized
      )
      select r.sequence, e.type, e.time_created,
             case when r.rn = 1 or (r.rn <= ? and r.through <= ?) then e.payload_json end
               as payload_json
      from ranked r
      join dwf_event e on e.run_id = ? and e.sequence = r.sequence
      order by r.sequence
      `,
    )
    .all(
      runId,
      ...filter.params,
      ...(after === undefined ? [] : [after]),
      query.limit + 1,
      query.limit,
      Math.max(0, query.maxBytes),
      runId,
    ) as unknown as Array<Omit<DwfEventPageRow, "payload_json"> & { payload_json: string | null }>;
  const end = found.findIndex((row) => row.payload_json === null);
  const inPage = end === -1 ? found : found.slice(0, end);
  return { rows: inPage as DwfEventPageRow[], hasMore: end !== -1 };
}

export function listEventPage(
  db: DatabaseSync,
  runId: string,
  query: DwfEventPageQuery,
): { events: StoredEvent[]; hasMore: boolean } {
  const { rows, hasMore } = pageEventRows(db, runId, query);
  return { events: rows.map(decodeEvent), hasMore };
}
