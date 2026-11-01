

import { canonicalJson } from "./hash.js";
import { personaIdentity } from "./persona.js";
import type {
  ActorRef,
  ActorSessionSeed,
  ImportedActorCandidate,
  ImportedAskEntry,
  ImportedRunCache,
  ImportedWorldEntry,
  InstanceRef,
  NodeRecord,
  PersonaSpec,
} from "./types.js";

export class ImportedActorState {
  
  private consumed = 0;
  private diverged = false;
  
  private carriedSeq?: number;

  constructor(private readonly candidate: ImportedActorCandidate) {}

  
  take(seq: number, hash: string): ImportedAskEntry | undefined {
    if (this.diverged) return undefined;
    const entry = this.candidate.entries[seq];
    if (entry === undefined || entry.inputHash !== hash) {
      this.diverge(seq, hash, true);
      return undefined;
    }
    this.consumed = seq + 1;
    return entry;
  }

  
  takeIfPure(seq: number, hash: string): ImportedAskEntry | undefined {
    if (this.diverged) return undefined;
    const entry = this.candidate.entries[seq];
    if (entry === undefined || entry.inputHash !== hash || entry.stats?.worldToolCalls !== 0) {
      this.diverge(seq, hash, false);
      return undefined;
    }
    this.consumed = seq + 1;
    return entry;
  }

  
  sourceSessionAt(seq: number): string | undefined {
    return !this.diverged && seq < this.consumed
      ? this.candidate.transcriptSourceSessionId
      : undefined;
  }

  
  carriedAt(seq: number): boolean {
    return this.carriedSeq === seq;
  }

  
  reconcileRecorded(
    seq: number,
    recordedHash: string,
    wasLive: boolean,
    queuedBeforeClose: boolean,
  ): void {
    if (this.diverged) return;
    if (wasLive) {
      this.diverge(seq, recordedHash, queuedBeforeClose);
      return;
    }
    const entry = this.candidate.entries[seq];
    if (entry === undefined || entry.inputHash !== recordedHash) {
      this.diverged = true;
      return;
    }
    this.consumed = Math.max(this.consumed, seq + 1);
  }

  
  seed(): ActorSessionSeed | undefined {
    const inFlight = this.candidate.inFlight;
    if (this.carriedSeq !== undefined && inFlight !== undefined) {
      return this.seedAt(inFlight.messageBoundary);
    }
    if (this.consumed === 0) return undefined;
    const last = this.candidate.entries[this.consumed - 1];
    if (last === undefined) return undefined;
    return this.seedAt(last.messageBoundary);
  }

  
  private diverge(seq: number, hash: string, cacheOpen: boolean): void {
    const inFlight = this.candidate.inFlight;
    if (
      cacheOpen &&
      inFlight !== undefined &&
      seq === this.candidate.entries.length &&
      this.consumed === seq &&
      inFlight.inputHash === hash
    ) {
      this.carriedSeq = seq;
    }
    this.diverged = true;
  }

  private seedAt(messageCount: number): ActorSessionSeed {
    const seed: ActorSessionSeed = {
      sourceSessionId: this.candidate.transcriptSourceSessionId,
      messageCount,
    };
    if (this.candidate.resolvedModel !== undefined) seed.resolvedModel = this.candidate.resolvedModel;
    return seed;
  }
}

export class ImportedWorldQueue {
  private readonly cursors = new Map<string, number>();

  constructor(private readonly world: ReadonlyMap<string, ImportedWorldEntry[]>) {}

  
  take(hash: string): ImportedWorldEntry | undefined {
    const queue = this.world.get(hash);
    if (queue === undefined) return undefined;
    const cursor = this.cursors.get(hash) ?? 0;
    const entry = queue[cursor];
    if (entry === undefined) return undefined;
    this.cursors.set(hash, cursor + 1);
    return entry;
  }
}

export function matchImportedActor(
  cache: ImportedRunCache | undefined,
  spec: PersonaSpec,
): ImportedActorState | undefined {
  if (cache === undefined) return undefined;
  const name = spec.name;
  if (name === undefined || name === "") return undefined;
  const candidate = cache.actors.get(name);
  if (candidate === undefined) return undefined;
  if (canonicalJson(personaIdentity(spec)) !== canonicalJson(personaIdentity(candidate.persona))) {
    return undefined;
  }
  return new ImportedActorState(candidate);
}

export function importedAskRecord(
  runId: string,
  instance: InstanceRef,
  actor: ActorRef,
  seq: number,
  hash: string,
  entry: ImportedAskEntry,
): NodeRecord {
  const record: NodeRecord = {
    runId,
    siteId: instance.siteId,
    ordinal: instance.ordinal,
    kind: "ask",
    actorSiteId: actor.siteId,
    actorOrdinal: actor.ordinal,
    actorSeq: seq,
    inputHash: hash,
    status: "completed",
    result: entry.result,
    messageBoundary: entry.messageBoundary,
  };
  if (entry.stats !== undefined) record.stats = entry.stats;
  return record;
}
