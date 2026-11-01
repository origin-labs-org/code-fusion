

import type { DatabaseSync } from "node:sqlite";

const MAX_INDEX_LIKE_SEGMENTS = 6;

const CLIPPED_CHARS = 1000;

const ROW_OVERHEAD_BYTES = 64;

export function fieldPathCandidates(path: string): string[] {
  const segments = path.split(".");
  const indexLike = segments.filter((segment) => arrayIndexOf(segment) !== undefined).length;
  if (indexLike > MAX_INDEX_LIKE_SEGMENTS) return [];
  let candidates = ["$.item"];
  for (const segment of segments) {
    const asKey = `.${JSON.stringify(segment)}`;
    const index = arrayIndexOf(segment);
    candidates = candidates.flatMap((prefix) =>
      index === undefined ? [prefix + asKey] : [prefix + asKey, `${prefix}[${index}]`],
    );
  }
  return candidates;
}

function arrayIndexOf(segment: string): number | undefined {
  const index = Number(segment);
  return Number.isInteger(index) && index >= 0 ? index : undefined;
}

function fieldExpression(path: string, maxValueBytes: number): { sql: string; params: string[] } {
  const candidates = fieldPathCandidates(path);
  if (candidates.length === 0) return { sql: "null", params: [] };
  const value = `coalesce(${candidates.map(() => "e.payload_json -> ?").join(", ")}, null)`;
  const sql = `(select case
      when v is null then null
      when octet_length(v) <= ${maxValueBytes} then v
      when json_type(v) = 'text' then json_quote(substr(v ->> '$', 1, ${CLIPPED_CHARS}) || '…')
      else json_quote(substr(v, 1, ${CLIPPED_CHARS}) || '…')
    end from (select ${value} as v))`;
  return { sql, params: candidates };
}

export interface DwfArtifactFieldPageQuery {
  afterSequence?: number;
  fields: readonly string[];
  limit: number;
  maxBytes: number;
  maxValueBytes: number;
}

export interface DwfArtifactFieldItem {
  fields: Record<string, unknown>;
  ordinal: number;
  sequence: number;
  siteId: string;
}

export function listArtifactFieldItems(
  db: DatabaseSync,
  runId: string,
  artifactId: string,
  query: DwfArtifactFieldPageQuery,
): { items: DwfArtifactFieldItem[]; hasMore: boolean } {
  if (query.limit <= 0) return { items: [], hasMore: false };
  const fields = query.fields.map((path) => fieldExpression(path, query.maxValueBytes));
  const columns = fields.map((field, index) => `${field.sql} as f${index}`).join(",\n");
  const bytes = fields.map((_field, index) => `coalesce(octet_length(f${index}), 0)`).join(" + ");
  const after = query.afterSequence;
  const cursor = after === undefined ? "" : " and e.sequence > ?";
  const rows = db
    .prepare(
      `
      with page as (
        select e.sequence,
               json_extract(e.payload_json, '$.instance.siteId') as site_id,
               json_extract(e.payload_json, '$.instance.ordinal') as ordinal${columns ? `,\n${columns}` : ""}
        from dwf_event e
        where e.run_id = ?
          and e.type = 'report'
          and json_extract(e.payload_json, '$.artifactId') = ?${cursor}
        order by e.sequence
        limit ?
      ),
      ranked as (
        select *,
               row_number() over (order by sequence) as rn,
               sum(${ROW_OVERHEAD_BYTES}${bytes ? ` + ${bytes}` : ""})
                 over (order by sequence rows unbounded preceding) as through
        from page
      )
      select * from ranked order by sequence
      `,
    )
    .all(
      ...fields.flatMap((field) => field.params),
      runId,
      artifactId,
      ...(after === undefined ? [] : [after]),
      query.limit + 1,
    ) as unknown as Array<Record<string, string | number | null>>;
  const maxBytes = Math.max(0, query.maxBytes);
  const end = rows.findIndex(
    (row) =>
      row.rn !== 1 && ((row.rn as number) > query.limit || (row.through as number) > maxBytes),
  );
  const inPage = end === -1 ? rows : rows.slice(0, end);
  const items = inPage.map((row) => {
    const values: Record<string, unknown> = {};
    query.fields.forEach((path, index) => {
      const text = row[`f${index}`];
      if (typeof text === "string") values[path] = JSON.parse(text);
    });
    return {
      sequence: row.sequence as number,
      siteId: String(row.site_id),
      ordinal: Number(row.ordinal),
      fields: values,
    };
  });
  return { items, hasMore: end !== -1 };
}
