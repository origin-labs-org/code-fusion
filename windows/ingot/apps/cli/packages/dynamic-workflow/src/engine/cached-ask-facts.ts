

import type { ImportedActorState } from "./imported-cache.js";
import { INSTRUCTIONS_HEAD_MAX_CHARS, type ActorRef } from "./types.js";

export interface CachedAskFacts {
  kind: "ask";
  actor: ActorRef;
  actorSeq: number;
  instructionsHead?: string;
  sourceSessionId?: string;
}

export function cachedAskFacts(
  actor: ActorRef,
  seq: number,
  instructions: string,
  imported: ImportedActorState | undefined,
): CachedAskFacts {
  const instructionsHead = headOfInstructions(instructions);
  const sourceSessionId = imported?.sourceSessionAt(seq);
  return {
    kind: "ask",
    actor,
    actorSeq: seq,
    ...(instructionsHead === undefined ? {} : { instructionsHead }),
    ...(sourceSessionId === undefined ? {} : { sourceSessionId }),
  };
}

export function headOfInstructions(instructions: string): string | undefined {
  const trimmed = instructions.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length <= INSTRUCTIONS_HEAD_MAX_CHARS
    ? trimmed
    : trimmed.slice(0, INSTRUCTIONS_HEAD_MAX_CHARS);
}
