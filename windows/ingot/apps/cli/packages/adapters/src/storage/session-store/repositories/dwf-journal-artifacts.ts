

import type { DatabaseSync } from "node:sqlite";
import type { NodeRecord } from "@origin-ai/cf-dynamic-workflow";
import { decodeNode, type DwfNodeRow } from "./dwf-journal-codecs.js";
import { listArtifactFieldItems } from "./dwf-journal-fields.js";
import { pageEventRows } from "./dwf-journal-pages.js";

export interface DwfArtifactItemsQuery {
  
  afterSequence?: number;
  limit: number;
  maxBytes: number;
  
  fields?: { paths: readonly string[]; maxValueBytes: number };
}

export interface DwfArtifactItem {
  
  item?: unknown;
  
  fields?: Record<string, unknown>;
  ordinal: number;
  sequence: number;
  siteId: string;
}

export function listArtifactRows(db: DatabaseSync, runId: string): NodeRecord[] {
  const rows = db
    .prepare("select * from dwf_node where run_id = ? and kind = 'artifact' order by id")
    .all(runId) as unknown as DwfNodeRow[];
  return rows.map(decodeNode);
}

export function countTaggedReports(db: DatabaseSync, runId: string): ReadonlyMap<string, number> {
  const rows = db
    .prepare(
      `
      select artifact_id, count(*) as total from dwf_node
      where run_id = ? and kind = 'report' and artifact_id is not null
      group by artifact_id
      `,
    )
    .all(runId) as unknown as { artifact_id: string; total: number | bigint }[];
  return new Map(rows.map((row) => [row.artifact_id, Number(row.total)]));
}

export function listArtifactItems(
  db: DatabaseSync,
  runId: string,
  artifactId: string,
  query: DwfArtifactItemsQuery,
): { items: DwfArtifactItem[]; hasMore: boolean } {
  if (query.fields !== undefined) {
    return listArtifactFieldItems(db, runId, artifactId, {
      ...(query.afterSequence === undefined ? {} : { afterSequence: query.afterSequence }),
      fields: query.fields.paths,
      limit: query.limit,
      maxBytes: query.maxBytes,
      maxValueBytes: query.fields.maxValueBytes,
    });
  }
  const { rows, hasMore } = pageEventRows(db, runId, query, {
    sql: " and type = 'report' and json_extract(payload_json, '$.artifactId') = ?",
    params: [artifactId],
  });
  const items = rows.map((row) => {
    const payload = JSON.parse(row.payload_json) as {
      instance: { ordinal: number; siteId: string };
      item: unknown;
    };
    return {
      sequence: row.sequence,
      siteId: payload.instance.siteId,
      ordinal: payload.instance.ordinal,
      item: payload.item,
    };
  });
  return { items, hasMore };
}
