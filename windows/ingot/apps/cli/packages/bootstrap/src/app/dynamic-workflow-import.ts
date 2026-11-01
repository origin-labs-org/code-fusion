// ============================================================
// ============================================================
//
//
//
//
//
//
//
//
//

import type { Logger, SessionId } from "@origin-ai/cf-contracts";
import type {
  ActorRecord,
  ImportedActorCandidate,
  ImportedAskEntry,
  ImportedInFlightAsk,
  ImportedRunCache,
  ImportedWorldEntry,
  ListActorsOptions,
  ListNodesOptions,
  NodeKind,
  NodeRecord,
  RunRecord,
} from "@origin-ai/cf-dynamic-workflow";
import { TERMINAL_RUN_STATUSES } from "./dynamic-workflow-run-observation.js";
import type { ActorTranscriptStore } from "./workflow-actor-transcript.js";

interface ImportedCacheJournalReader {
  getRun(runId: string): RunRecord | undefined;
  listActors(runId: string, opts: ListActorsOptions): ActorRecord[];
  listNodes(runId: string, opts: ListNodesOptions): NodeRecord[];
}

const IMPORTED_NODE_KINDS: readonly NodeKind[] = ["ask", "world-read", "world-run"];

type ImportedCacheRefusalReason =
  
  | "run_not_found"
  
  | "not_amendable"
  
  | "missing_boundaries";

type BuildImportedCacheResult =
  | { ok: true; cache: ImportedRunCache; resumedFrom: string }
  | { ok: false; reason: ImportedCacheRefusalReason };

type AmendPreflightRefusalReason = Exclude<ImportedCacheRefusalReason, "not_amendable">;

type AmendPreflightResult =
  | { ok: true; run: RunRecord }
  | { ok: false; reason: AmendPreflightRefusalReason };

export function preflightAmendImport(
  journal: Pick<ImportedCacheJournalReader, "getRun" | "listNodes">,
  predecessorRunId: string,
): AmendPreflightResult {
  const run = journal.getRun(predecessorRunId);
  if (run === undefined) return { ok: false, reason: "run_not_found" };
  const asks = journal.listNodes(predecessorRunId, { kinds: ["ask"], withResult: false });
  if (!completedAsksHaveBoundaries(asks)) {
    return { ok: false, reason: "missing_boundaries" };
  }
  return { ok: true, run };
}

function completedAsksHaveBoundaries(nodes: readonly NodeRecord[]): boolean {
  for (const node of nodes) {
    if (node.kind !== "ask" || node.status !== "completed") continue;
    if (node.messageBoundary === undefined) return false;
  }
  return true;
}

interface AmendImportDeps {
  journal: ImportedCacheJournalReader;
  
  actorTranscriptStore?: ActorTranscriptStore;
  logger?: Logger;
}

export interface AmendImportOptions {
  
  quietSessions?: ReadonlySet<string>;
}

export async function buildImportedCache(
  deps: AmendImportDeps,
  predecessorRunId: string,
  options?: AmendImportOptions,
): Promise<BuildImportedCacheResult> {
  const { actorTranscriptStore: transcripts, journal, logger } = deps;

  const run = journal.getRun(predecessorRunId);
  if (run === undefined) return { ok: false, reason: "run_not_found" };
  if (!TERMINAL_RUN_STATUSES.has(run.status)) return { ok: false, reason: "not_amendable" };

  const nodes = journal.listNodes(predecessorRunId, {
    kinds: IMPORTED_NODE_KINDS,
    withResult: true,
  });
  if (!completedAsksHaveBoundaries(nodes)) return { ok: false, reason: "missing_boundaries" };

  const asksByActor = groupAsksByActor(nodes);
  const actors = new Map<string, ImportedActorCandidate>();
  const records = journal.listActors(predecessorRunId, { withPersona: true });
  for (const record of namedUniqueActors(records, logger)) {
    const name = record.name!;
    const candidate = await buildActorCandidate({
      actor: record,
      journal,
      ...(logger === undefined ? {} : { logger }),
      asks: asksByActor.get(actorKey(record.siteId, record.ordinal)) ?? [],
      predecessorRunId,
      ...(options?.quietSessions === undefined ? {} : { quietSessions: options.quietSessions }),
      ...(transcripts === undefined ? {} : { transcripts }),
    });
    if (candidate !== undefined) actors.set(name, candidate);
  }

  return {
    ok: true,
    cache: { actors, world: buildWorldQueues(nodes) },
    resumedFrom: predecessorRunId,
  };
}

function namedUniqueActors(records: ActorRecord[], logger?: Logger): ActorRecord[] {
  const byName = new Map<string, ActorRecord[]>();
  for (const record of records) {
    const name = record.name;
    if (name === undefined || name === "") continue;
    const bucket = byName.get(name);
    if (bucket === undefined) byName.set(name, [record]);
    else bucket.push(record);
  }
  const unique: ActorRecord[] = [];
  for (const [name, bucket] of byName) {
    if (bucket.length === 1) {
      unique.push(bucket[0]!);
      continue;
    }
    logger?.warn?.("Dynamic workflow amend: duplicate actor name in predecessor, skipped", {
      actorName: name,
      count: bucket.length,
      event: "dynamic_workflow.amend.duplicate_actor_name",
      module: "bootstrap.app",
    });
  }
  return unique;
}

async function buildActorCandidate(input: {
  actor: ActorRecord;
  journal: ImportedCacheJournalReader;
  logger?: Logger;
  
  asks: readonly NodeRecord[];
  predecessorRunId: string;
  quietSessions?: ReadonlySet<string>;
  transcripts?: ActorTranscriptStore;
}): Promise<ImportedActorCandidate | undefined> {
  const { actor, asks, journal, logger, predecessorRunId, quietSessions, transcripts } = input;
  const name = actor.name!;

  if (actor.persona === undefined) return undefined;

  const { entries, next } = completedAskPrefix(asks);
  if (entries.length === 0 && next?.status !== "running") return undefined;

  const source = resolveTranscriptSource({
    actorName: name,
    journal,
    startRunId: predecessorRunId,
  });
  if (source === undefined) {
    logger?.info?.("Dynamic workflow amend: no transcript source for actor, import dropped", {
      actorName: name,
      event: "dynamic_workflow.amend.transcript_source_missing",
      module: "bootstrap.app",
      runId: predecessorRunId,
    });
    return undefined;
  }

  const boundary = entries.length === 0 ? 0 : entries[entries.length - 1]!.messageBoundary;
  const messageCount =
    transcripts === undefined ? undefined : await countSource(transcripts, source.sessionId);
  if (transcripts !== undefined && (messageCount === undefined || messageCount < boundary)) {
    logger?.warn?.(
      "Dynamic workflow amend: transcript source shorter than boundary, import dropped",
      {
        actorName: name,
        event: "dynamic_workflow.amend.transcript_source_short",
        messageBoundary: boundary,
        module: "bootstrap.app",
        sessionId: source.sessionId,
      },
    );
    return undefined;
  }

  const inFlight = resolveInFlightAsk({
    actor,
    boundary,
    ...(logger === undefined ? {} : { logger }),
    ...(messageCount === undefined ? {} : { messageCount }),
    ...(next === undefined ? {} : { next }),
    predecessorRunId,
    ...(quietSessions === undefined ? {} : { quietSessions }),
    sourceSessionId: source.sessionId,
  });
  if (entries.length === 0 && inFlight === undefined) return undefined;

  return {
    persona: actor.persona,
    entries,
    ...(inFlight === undefined ? {} : { inFlight }),
    transcriptSourceSessionId: source.sessionId,
    ...(source.resolvedModel === undefined ? {} : { resolvedModel: source.resolvedModel }),
  };
}

function resolveInFlightAsk(input: {
  actor: ActorRecord;
  boundary: number;
  logger?: Logger;
  messageCount?: number;
  next?: NodeRecord;
  predecessorRunId: string;
  quietSessions?: ReadonlySet<string>;
  sourceSessionId: string;
}): ImportedInFlightAsk | undefined {
  const { actor, boundary, logger, messageCount, next, quietSessions, sourceSessionId } = input;
  if (next === undefined || next.status !== "running") return undefined;

  const drop = (reason: string): undefined => {
    logger?.info?.("Dynamic workflow amend: in-flight ask not carried", {
      actorName: actor.name,
      event: "dynamic_workflow.amend.in_flight_dropped",
      module: "bootstrap.app",
      reason,
      runId: input.predecessorRunId,
      sessionId: sourceSessionId,
    });
    return undefined;
  };

  if (actor.sessionId === undefined || actor.sessionId !== sourceSessionId) {
    return drop("transcript_source_is_ancestor");
  }
  if (messageCount === undefined) return drop("no_transcript_count");
  if (quietSessions !== undefined && !quietSessions.has(sourceSessionId)) {
    return drop("session_not_quiescent");
  }
  if (messageCount <= boundary) return drop("no_transcript_beyond_prefix");

  return { inputHash: next.inputHash, messageBoundary: messageCount };
}

function completedAskPrefix(asks: readonly NodeRecord[]): {
  entries: ImportedAskEntry[];
  next?: NodeRecord;
} {
  const bySeq = new Map<number, NodeRecord>();
  for (const node of asks) {
    if (node.actorSeq === undefined) continue;
    bySeq.set(node.actorSeq, node);
  }

  const entries: ImportedAskEntry[] = [];
  for (let seq = 0; ; seq++) {
    const node = bySeq.get(seq);
    if (node === undefined || node.status !== "completed") {
      return { entries, ...(node === undefined ? {} : { next: node }) };
    }
    const entry: ImportedAskEntry = {
      inputHash: node.inputHash,
      result: node.result,
      messageBoundary: node.messageBoundary!,
    };
    if (node.stats !== undefined) entry.stats = node.stats;
    entries.push(entry);
  }
}

function resolveTranscriptSource(input: {
  actorName: string;
  journal: ImportedCacheJournalReader;
  startRunId: string;
}): { sessionId: string; resolvedModel?: string } | undefined {
  const { actorName, journal, startRunId } = input;
  const seen = new Set<string>();
  let runId: string | undefined = startRunId;

  while (runId !== undefined && !seen.has(runId)) {
    seen.add(runId);
    const matches = journal.listActors(runId, { name: actorName, withPersona: false });
    if (matches.length !== 1) return undefined;
    const actor = matches[0]!;
    if (actor.sessionId !== undefined) {
      return {
        sessionId: actor.sessionId,
        ...(actor.resolvedModel === undefined ? {} : { resolvedModel: actor.resolvedModel }),
      };
    }
    runId = journal.getRun(runId)?.resumedFrom;
  }
  return undefined;
}

async function countSource(
  transcripts: ActorTranscriptStore,
  sessionId: string,
): Promise<number | undefined> {
  try {
    return (await transcripts.messages({ sessionID: sessionId as SessionId })).length;
  } catch {
    return undefined;
  }
}

function actorKey(siteId: string, ordinal: number): string {
  return `${siteId}@${ordinal}`;
}

function groupAsksByActor(nodes: readonly NodeRecord[]): Map<string, NodeRecord[]> {
  const groups = new Map<string, NodeRecord[]>();
  for (const node of nodes) {
    if (node.kind !== "ask" || node.actorSiteId === undefined || node.actorOrdinal === undefined) {
      continue;
    }
    const key = actorKey(node.actorSiteId, node.actorOrdinal);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [node]);
    else group.push(node);
  }
  return groups;
}

function buildWorldQueues(nodes: readonly NodeRecord[]): ReadonlyMap<string, ImportedWorldEntry[]> {
  const world = new Map<string, ImportedWorldEntry[]>();
  for (const node of nodes) {
    if (node.kind !== "world-read" && node.kind !== "world-run") continue;
    if (node.status !== "completed") continue;
    const queue = world.get(node.inputHash);
    const entry: ImportedWorldEntry = {
      inputHash: node.inputHash,
      kind: node.kind,
      result: node.result,
    };
    if (queue === undefined) world.set(node.inputHash, [entry]);
    else queue.push(entry);
  }
  return world;
}

export async function rebuildImportedCacheForResume(
  deps: AmendImportDeps,
  
  run: { runId: string; predecessorRunId: string },
): Promise<ImportedRunCache | undefined> {
  const { predecessorRunId, runId } = run;
  const built = await buildImportedCache(deps, predecessorRunId);
  if (built.ok) return built.cache;
  deps.logger?.info?.("Dynamic workflow amend cache rebuild skipped; resuming without it", {
    event: "dynamic_workflow.amend.rebuild_skipped",
    module: "bootstrap.app",
    reason: built.reason,
    resumedFrom: predecessorRunId,
    runId,
  });
  return undefined;
}
