

import type { DatabaseSync } from "node:sqlite";
import type {
  ActorRecord,
  Caps,
  GetNodeOptions,
  JournalStorePort,
  ListActorsOptions,
  ListEventsOptions,
  ListNodesOptions,
  NodeKind,
  NodeRecord,
  RunEvent,
  RunRecord,
  RunSettlementRecord,
  RunStatus,
  StoredEvent,
} from "@origin-ai/cf-dynamic-workflow";
import { encodeJson } from "../json.js";
import {
  countTaggedReports,
  listArtifactItems,
  listArtifactRows,
  type DwfArtifactItem,
  type DwfArtifactItemsQuery,
} from "./dwf-journal-artifacts.js";
import { listEventPage, type DwfEventPageQuery } from "./dwf-journal-pages.js";
import {
  countNodeRows,
  getNodeRow,
  listActorRows,
  listEventRows,
  listNodeRows,
  sumResultBytes,
} from "./dwf-journal-reads.js";
import {
  decodeActor,
  decodeRun,
  encodeResultJson,
  encodeRunSettlement,
  type DwfActorRow,
  type DwfEventRow,
  type DwfWorldNodeRow,
  type DwfRunDetailRow,
  type DwfRunListItem,
  type DwfRunRow,
  type DwfRunSessionListItem,
} from "./dwf-journal-codecs.js";
import {
  countNodesByStatus,
  getRunRow,
  listRecentLogEvents,
  listRunLifeSpans,
  listRuns,
  listRunsByParentSession,
  listWorldNodes,
  type DwfListRunsQuery,
  type DwfNodeStatusCounts,
  type DwfRunIntrospectionQueries,
  type DwfRunLifeSpan,
} from "./dwf-journal-introspection.js";

export type { DwfArtifactItem, DwfArtifactItemsQuery } from "./dwf-journal-artifacts.js";
export type {
  DwfListRunsQuery,
  DwfNodeStatusCounts,
  DwfRunIntrospectionQueries,
  DwfRunLifeSpan,
} from "./dwf-journal-introspection.js";

class SqliteDwfJournalStore implements JournalStorePort, DwfRunIntrospectionQueries {
  constructor(private readonly db: DatabaseSync) {}

  createRun(record: RunRecord): void {
    const now = Date.now();
    const settlement = encodeRunSettlement(record.status, record);
    try {
      this.db
        .prepare(
          `
          insert into dwf_run (
            id, parent_session_id, cwd, name, script_text, script_hash, tool_call_id,
            args_json, resumed_from, caps_max_concurrency,
            spent_tokens, status, failure_json, result_json, time_created, time_updated
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          record.runId,
          record.parentSessionId ?? null,
          record.cwd ?? null,
          record.name ?? null,
          record.scriptText ?? null,
          record.scriptHash ?? null,
          record.toolCallId ?? null,
          encodeJson(record.args),
          record.resumedFrom ?? null,
          record.caps.maxConcurrency,
          record.spentTokens,
          settlement.status,
          settlement.failureJson,
          encodeResultJson(record.result),
          now,
          now,
        );
    } catch (error) {
      if (this.getRun(record.runId) !== undefined) {
        throw new Error(`dwf journal: run already exists: ${record.runId}`, { cause: error });
      }
      throw error;
    }
  }

  getRun(runId: string): RunRecord | undefined {
    const row = this.db.prepare("select * from dwf_run where id = ?").get(runId) as
      | DwfRunRow
      | undefined;
    return row ? decodeRun(row) : undefined;
  }

  updateRunStatus(runId: string, status: RunStatus, settlement?: RunSettlementRecord): void {
    const now = Date.now();
    if (status === "pending" || status === "running") {
      const { changes } = this.db
        .prepare(
          `
          update dwf_run set
            status = ?,
            failure_json = null,
            result_json = null,
            time_updated = ?
          where id = ?
          `,
        )
        .run(status, now, runId);
      this.assertRunTouched(changes, runId);
      return;
    }
    //
    //
    const encoded = encodeRunSettlement(status, settlement);
    const { changes } = this.db
      .prepare(
        `
        update dwf_run set
          status = ?,
          failure_json = ?,
          result_json = coalesce(?, result_json),
          time_updated = ?
        where id = ?
        `,
      )
      .run(encoded.status, encoded.failureJson, encodeResultJson(settlement?.result), now, runId);
    this.assertRunTouched(changes, runId);
  }

  updateRunUsage(runId: string, spentTokens: number): void {
    const { changes } = this.db
      .prepare("update dwf_run set spent_tokens = ?, time_updated = ? where id = ?")
      .run(spentTokens, Date.now(), runId);
    this.assertRunTouched(changes, runId);
  }

  
  updateRunCaps(runId: string, caps: Caps): void {
    const { changes } = this.db
      .prepare("update dwf_run set caps_max_concurrency = ?, time_updated = ? where id = ?")
      .run(caps.maxConcurrency, Date.now(), runId);
    this.assertRunTouched(changes, runId);
  }

  
  updateRunScript(runId: string, scriptText: string, scriptHash: string): void {
    const { changes } = this.db
      .prepare("update dwf_run set script_text = ?, script_hash = ?, time_updated = ? where id = ?")
      .run(scriptText, scriptHash, Date.now(), runId);
    this.assertRunTouched(changes, runId);
  }

  
  listNonTerminalRuns(parentSessionId: string): RunRecord[] {
    const rows = this.db
      .prepare(
        `
        select * from dwf_run
        where parent_session_id = ?
          and status not in ('completed', 'failed', 'cancelled')
        order by id
        `,
      )
      .all(parentSessionId) as unknown as DwfRunRow[];
    return rows.map(decodeRun);
  }

  listRuns(query: DwfListRunsQuery): DwfRunListItem[] {
    return listRuns(this.db, query);
  }

  getRunRow(runId: string): DwfRunDetailRow | undefined {
    return getRunRow(this.db, runId);
  }

  countNodesByStatus(runId: string): DwfNodeStatusCounts {
    return countNodesByStatus(this.db, runId);
  }

  listRecentLogEvents(runId: string, limit: number): StoredEvent[] {
    return listRecentLogEvents(this.db, runId, limit);
  }

  listRunLifeSpans(runId: string): DwfRunLifeSpan[] {
    return listRunLifeSpans(this.db, runId);
  }

  listRunsByParentSession(parentSessionId: string, limit: number): DwfRunSessionListItem[] {
    return listRunsByParentSession(this.db, parentSessionId, limit);
  }

  putActor(record: ActorRecord): void {
    const now = Date.now();
    this.db
      .prepare(
        `
        insert into dwf_actor (
          run_id, site_id, ordinal, name, persona_json, session_id, resolved_model,
          time_created, time_updated
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(run_id, site_id, ordinal) do update set
          name = excluded.name,
          persona_json = excluded.persona_json,
          session_id = excluded.session_id,
          resolved_model = excluded.resolved_model,
          time_updated = excluded.time_updated
        `,
      )
      .run(
        record.runId,
        record.siteId,
        record.ordinal,
        record.name ?? null,
        encodeJson(record.persona),
        record.sessionId ?? null,
        record.resolvedModel ?? null,
        now,
        now,
      );
  }

  getActor(runId: string, siteId: string, ordinal: number): ActorRecord | undefined {
    const row = this.db
      .prepare("select * from dwf_actor where run_id = ? and site_id = ? and ordinal = ?")
      .get(runId, siteId, ordinal) as DwfActorRow | undefined;
    return row ? decodeActor(row) : undefined;
  }

  listActors(runId: string, opts: ListActorsOptions): ActorRecord[] {
    return listActorRows(this.db, runId, opts);
  }

  putNode(record: NodeRecord): void {
    const now = Date.now();
    this.db
      .prepare(
        `
        insert into dwf_node (
          run_id, site_id, ordinal, kind, actor_site_id, actor_ordinal, actor_seq,
          input_hash, status, result_json, error_json, stats_json, message_boundary,
          artifact_id, input_json, time_created, time_updated
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(run_id, site_id, ordinal) do update set
          kind = excluded.kind,
          actor_site_id = excluded.actor_site_id,
          actor_ordinal = excluded.actor_ordinal,
          actor_seq = excluded.actor_seq,
          input_hash = excluded.input_hash,
          status = excluded.status,
          result_json = excluded.result_json,
          error_json = excluded.error_json,
          stats_json = excluded.stats_json,
          message_boundary = excluded.message_boundary,
          artifact_id = excluded.artifact_id,
          input_json = excluded.input_json,
          time_updated = excluded.time_updated
        `,
      )
      .run(
        record.runId,
        record.siteId,
        record.ordinal,
        record.kind,
        record.actorSiteId ?? null,
        record.actorOrdinal ?? null,
        record.actorSeq ?? null,
        record.inputHash,
        record.status,
        encodeResultJson(record.result),
        encodeJson(record.error),
        encodeJson(record.stats),
        record.messageBoundary ?? null,
        record.artifactId ?? null,
        encodeJson(record.input),
        now,
        now,
      );
  }

  getNode(
    runId: string,
    siteId: string,
    ordinal: number,
    opts?: GetNodeOptions,
  ): NodeRecord | undefined {
    return getNodeRow(this.db, runId, siteId, ordinal, opts);
  }

  listNodes(runId: string, opts: ListNodesOptions): NodeRecord[] {
    return listNodeRows(this.db, runId, opts);
  }

  countNodes(runId: string, kind: NodeKind): number {
    return countNodeRows(this.db, runId, kind);
  }

  sumResultBytes(runId: string, kind: NodeKind): number {
    return sumResultBytes(this.db, runId, kind);
  }

  listArtifactRows(runId: string): NodeRecord[] {
    return listArtifactRows(this.db, runId);
  }

  countTaggedReports(runId: string): ReadonlyMap<string, number> {
    return countTaggedReports(this.db, runId);
  }

  listWorldNodes(runId: string): DwfWorldNodeRow[] {
    return listWorldNodes(this.db, runId);
  }

  listArtifactItems(
    runId: string,
    artifactId: string,
    query: DwfArtifactItemsQuery,
  ): { items: DwfArtifactItem[]; hasMore: boolean } {
    return listArtifactItems(this.db, runId, artifactId, query);
  }

  listEventPage(
    runId: string,
    query: DwfEventPageQuery,
  ): { events: StoredEvent[]; hasMore: boolean } {
    return listEventPage(this.db, runId, query);
  }

  appendEvent(runId: string, event: RunEvent): StoredEvent {
    const timeCreated = Date.now();
    const row = this.db
      .prepare(
        `
        insert into dwf_event (run_id, sequence, type, payload_json, time_created)
        values (
          ?,
          coalesce((select max(sequence) + 1 from dwf_event where run_id = ?), 0),
          ?, ?, ?
        )
        returning sequence
        `,
      )
      .get(runId, runId, event.type, JSON.stringify(event), timeCreated) as
      | Pick<DwfEventRow, "sequence">
      | undefined;
    if (row === undefined) {
      throw new Error(`dwf journal: event insert returned no sequence for run: ${runId}`);
    }
    return { sequence: row.sequence, event, timeCreated };
  }

  listEvents(runId: string, opts: ListEventsOptions): StoredEvent[] {
    return listEventRows(this.db, runId, opts);
  }

  
  private assertRunTouched(changes: number | bigint, runId: string): void {
    if (Number(changes) === 0) throw new Error(`dwf journal: unknown run: ${runId}`);
  }
}

export function createDwfJournalStore(db: DatabaseSync): JournalStorePort {
  return new SqliteDwfJournalStore(db);
}
