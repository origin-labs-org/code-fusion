// ============================================================
// ============================================================

import type { AskStats, NodeKind, PersonaSpec } from "./types.js";

export interface ImportedAskEntry {
  
  inputHash: string;
  result: unknown;
  stats?: AskStats;
  
  messageBoundary: number;
}

export interface ImportedInFlightAsk {
  
  inputHash: string;
  
  messageBoundary: number;
}

export interface ImportedActorCandidate {
  
  persona: PersonaSpec;
  
  entries: ImportedAskEntry[];
  
  inFlight?: ImportedInFlightAsk;
  
  transcriptSourceSessionId: string;
  
  resolvedModel?: string;
}

export interface ImportedWorldEntry {
  inputHash: string;
  kind: NodeKind;
  result: unknown;
}

export interface ImportedRunCache {
  
  actors: ReadonlyMap<string, ImportedActorCandidate>;
  
  world: ReadonlyMap<string, ImportedWorldEntry[]>;
}

export interface ActorSessionSeed {
  
  sourceSessionId: string;
  
  messageCount: number;
  
  resolvedModel?: string;
}
