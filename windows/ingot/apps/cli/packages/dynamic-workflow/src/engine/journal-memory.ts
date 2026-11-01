

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
} from "./types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function nodeCopy(node: NodeRecord, withResult: boolean): NodeRecord {
  const copy = clone(node);
  if (!withResult) delete copy.result;
  return copy;
}

function key(siteId: string, ordinal: number): string {
  return `${siteId}@${ordinal}`;
}

export class InMemoryJournalStore implements JournalStorePort {
  private readonly runs = new Map<string, RunRecord>();
  private readonly actors = new Map<string, Map<string, ActorRecord>>();
  private readonly nodes = new Map<string, Map<string, NodeRecord>>();
  private readonly events = new Map<string, StoredEvent[]>();

  createRun(record: RunRecord): void {
    if (this.runs.has(record.runId)) {
      throw new Error(`journal: run ${record.runId} already exists`);
    }
    this.runs.set(record.runId, clone(record));
    this.actors.set(record.runId, new Map());
    this.nodes.set(record.runId, new Map());
    this.events.set(record.runId, []);
  }

  getRun(runId: string): RunRecord | undefined {
    const r = this.runs.get(runId);
    return r === undefined ? undefined : clone(r);
  }

  updateRunStatus(runId: string, status: RunStatus, settlement?: RunSettlementRecord): void {
    const r = this.runs.get(runId);
    if (r === undefined) throw new Error(`journal: unknown run ${runId}`);
    r.status = status;
    if (status === "pending" || status === "running") {
      delete r.failure;
      delete r.result;
      delete r.stopReason;
      delete r.supersededBy;
      return;
    }
    if (settlement?.stopReason === undefined) delete r.stopReason;
    else r.stopReason = settlement.stopReason;
    if (settlement?.supersededBy === undefined) delete r.supersededBy;
    else r.supersededBy = settlement.supersededBy;
    if (settlement?.failure === undefined) delete r.failure;
    else r.failure = clone(settlement.failure);
    if (settlement?.result !== undefined) r.result = clone(settlement.result);
  }

  updateRunUsage(runId: string, spentTokens: number): void {
    const r = this.runs.get(runId);
    if (r === undefined) throw new Error(`journal: unknown run ${runId}`);
    r.spentTokens = spentTokens;
  }

  updateRunCaps(runId: string, caps: Caps): void {
    const r = this.runs.get(runId);
    if (r === undefined) throw new Error(`journal: unknown run ${runId}`);
    r.caps = clone(caps);
  }

  updateRunScript(runId: string, scriptText: string, scriptHash: string): void {
    const r = this.runs.get(runId);
    if (r === undefined) throw new Error(`journal: unknown run ${runId}`);
    r.scriptText = scriptText;
    r.scriptHash = scriptHash;
  }

  putActor(record: ActorRecord): void {
    const bucket = this.requireActorBucket(record.runId);
    bucket.set(key(record.siteId, record.ordinal), clone(record));
  }

  getActor(runId: string, siteId: string, ordinal: number): ActorRecord | undefined {
    const a = this.actors.get(runId)?.get(key(siteId, ordinal));
    return a === undefined ? undefined : clone(a);
  }

  listActors(runId: string, opts: ListActorsOptions): ActorRecord[] {
    const bucket = this.actors.get(runId);
    if (bucket === undefined) return [];
    const matched = [...bucket.values()].filter(
      (actor) => opts.name === undefined || actor.name === opts.name,
    );
    return matched.map((actor) => {
      const copy = clone(actor);
      if (!opts.withPersona) delete copy.persona;
      return copy;
    });
  }

  putNode(record: NodeRecord): void {
    const bucket = this.requireNodeBucket(record.runId);
    bucket.set(key(record.siteId, record.ordinal), clone(record));
  }

  getNode(
    runId: string,
    siteId: string,
    ordinal: number,
    opts?: GetNodeOptions,
  ): NodeRecord | undefined {
    const n = this.nodes.get(runId)?.get(key(siteId, ordinal));
    return n === undefined ? undefined : nodeCopy(n, opts?.withResult ?? true);
  }

  listNodes(runId: string, opts: ListNodesOptions): NodeRecord[] {
    const bucket = this.nodes.get(runId);
    if (bucket === undefined) return [];
    const kinds = opts.kinds;
    const matched = [...bucket.values()].filter(
      (node) => kinds === "all" || kinds.includes(node.kind),
    );
    const limited = opts.limit === undefined ? matched : matched.slice(0, Math.max(0, opts.limit));
    const budgeted =
      opts.maxResultBytes === undefined ? limited : withinBytes(limited, opts.maxResultBytes);
    return budgeted.map((node) => nodeCopy(node, opts.withResult));
  }

  countNodes(runId: string, kind: NodeKind): number {
    const bucket = this.nodes.get(runId);
    if (bucket === undefined) return 0;
    let count = 0;
    for (const node of bucket.values()) if (node.kind === kind) count += 1;
    return count;
  }

  sumResultBytes(runId: string, kind: NodeKind): number {
    const bucket = this.nodes.get(runId);
    if (bucket === undefined) return 0;
    let bytes = 0;
    for (const node of bucket.values()) if (node.kind === kind) bytes += resultBytes(node);
    return bytes;
  }

  appendEvent(runId: string, event: RunEvent): StoredEvent {
    const list = this.events.get(runId);
    if (list === undefined) throw new Error(`journal: unknown run ${runId}`);
    const stored: StoredEvent = {
      sequence: list.length,
      event: clone(event),
      timeCreated: Date.now(),
    };
    list.push(stored);
    return clone(stored);
  }

  listEvents(runId: string, opts: ListEventsOptions): StoredEvent[] {
    const list = this.events.get(runId);
    if (list === undefined) return [];
    const reportLimit = opts.reportItems === "all" ? undefined : opts.reportItems.limit;
    const stripped = new Set<number>();
    if (reportLimit !== undefined) {
      let rank = 0;
      for (const stored of list) {
        if (stored.event.type !== "report") continue;
        rank += 1;
        if (rank > reportLimit) stripped.add(stored.sequence);
      }
    }
    const types = opts.types;
    const after = opts.afterSequence;
    const filtered = list.filter(
      (e) =>
        (types === "all" || types.includes(e.event.type)) &&
        (after === undefined || e.sequence > after),
    );
    const limited =
      opts.limit === undefined ? filtered : filtered.slice(0, Math.max(0, opts.limit));
    return limited.map((stored) => {
      const copy = clone(stored);
      if (stripped.has(stored.sequence)) delete (copy.event as { item?: unknown }).item;
      return copy;
    });
  }

  private requireActorBucket(runId: string): Map<string, ActorRecord> {
    const bucket = this.actors.get(runId);
    if (bucket === undefined) throw new Error(`journal: unknown run ${runId}`);
    return bucket;
  }

  private requireNodeBucket(runId: string): Map<string, NodeRecord> {
    const bucket = this.nodes.get(runId);
    if (bucket === undefined) throw new Error(`journal: unknown run ${runId}`);
    return bucket;
  }
}

function resultBytes(node: NodeRecord): number {
  if (node.result === undefined) return 0;
  const text = JSON.stringify(node.result);
  return text === undefined ? 0 : new TextEncoder().encode(text).length;
}

function withinBytes(nodes: readonly NodeRecord[], maxResultBytes: number): NodeRecord[] {
  const kept: NodeRecord[] = [];
  let total = 0;
  for (const node of nodes) {
    const bytes = resultBytes(node);
    if (kept.length > 0 && total + bytes > maxResultBytes) break;
    kept.push(node);
    total += bytes;
  }
  return kept;
}
